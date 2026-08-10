import { del, put } from "@vercel/blob";
import { getRedis } from "@/lib/redis";
import type { AnalysisResult } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared history of scans. Every analysis auto-saves: the summary-card
// image and the analyzed photo go to Vercel Blob, the full analysis
// result JSON goes to Redis (scan:<id>), and a capped Redis list holds
// the feed metadata (newest first). Entries past the cap are trimmed
// with their blobs and records deleted.
const LIST_KEY = "gallery:entries";
const SCAN_KEY_PREFIX = "scan:";
const MAX_ENTRIES = 200;
const MAX_CARD_BYTES = 1.5 * 1024 * 1024;
const MAX_PHOTO_BYTES = 2.2 * 1024 * 1024;

export interface GalleryEntry {
  id?: string; // scan record key suffix (absent on legacy entries)
  url: string; // summary card image
  caption: string;
  sceneType: string;
  at: string; // ISO timestamp
}

export interface ScanRecord {
  id: string;
  cardUrl: string;
  photoUrl: string; // the analyzed photo (same pixel size as analysis)
  caption: string;
  sceneType: string;
  at: string;
  result: AnalysisResult;
}

// Vercel injects BLOB_READ_WRITE_TOKEN by default, but a store connected
// with a custom env prefix names it <Prefix>_READ_WRITE_TOKEN. This
// deployment's public store uses the "thirdblob" prefix — prefer it, so
// leftover tokens from older (private) stores can never shadow it.
function getBlobToken(): string | undefined {
  if (process.env.thirdblob_READ_WRITE_TOKEN)
    return process.env.thirdblob_READ_WRITE_TOKEN;
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [key, value] of Object.entries(process.env)) {
    if (key.endsWith("_READ_WRITE_TOKEN") && value) return value;
  }
  return undefined;
}

function galleryEnabled(): boolean {
  return getRedis() !== null && !!getBlobToken();
}

export async function GET(request: Request) {
  const storage = {
    redis: getRedis() !== null,
    blob: !!getBlobToken(),
    // A store id without any read-write token means only a PRIVATE blob
    // store is connected — this app needs a PUBLIC one (gallery images
    // are served by direct URL).
    privateBlobStore:
      !getBlobToken() &&
      Object.keys(process.env).some((k) => k.endsWith("_STORE_ID")),
  };
  if (!storage.redis || !storage.blob) {
    return Response.json({ enabled: false, storage, entries: [], total: 0 });
  }
  try {
    const limitParam = new URL(request.url).searchParams.get("limit");
    const limit = Math.min(
      MAX_ENTRIES,
      Math.max(1, Number(limitParam) || MAX_ENTRIES)
    );
    const redis = getRedis()!;
    const [entries, total] = await Promise.all([
      redis.lrange<GalleryEntry>(LIST_KEY, 0, limit - 1),
      redis.llen(LIST_KEY),
    ]);
    return Response.json({ enabled: true, storage, entries, total });
  } catch (err) {
    console.error("gallery list failed:", err);
    return Response.json({ enabled: false, storage, entries: [], total: 0 });
  }
}

export async function POST(request: Request) {
  if (!galleryEnabled()) {
    return Response.json({ error: "Gallery is not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    image?: string; // base64 JPEG summary card, no data: prefix
    photo?: string; // base64 JPEG of the analyzed photo
    result?: AnalysisResult;
    caption?: string;
    sceneType?: string;
  };
  if (!body?.image) {
    return Response.json({ error: "Missing image" }, { status: 400 });
  }

  const cardBytes = Buffer.from(body.image, "base64");
  if (cardBytes.length > MAX_CARD_BYTES) {
    return Response.json({ error: "Card image too large" }, { status: 413 });
  }
  const photoBytes = body.photo ? Buffer.from(body.photo, "base64") : null;
  if (photoBytes && photoBytes.length > MAX_PHOTO_BYTES) {
    return Response.json({ error: "Photo too large" }, { status: 413 });
  }

  const token = getBlobToken();
  const id = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const uploaded: string[] = [];

  try {
    const card = await put(`gallery/${id}-card.jpg`, cardBytes, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: true,
      token,
    });
    uploaded.push(card.url);

    let photoUrl = "";
    if (photoBytes) {
      const photo = await put(`gallery/${id}-photo.jpg`, photoBytes, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: true,
        token,
      });
      uploaded.push(photo.url);
      photoUrl = photo.url;
    }

    const at = new Date().toISOString();
    const caption = (body.caption ?? "").slice(0, 220);
    const sceneType = body.sceneType ?? "other";
    const entry: GalleryEntry = { id, url: card.url, caption, sceneType, at };

    const redis = getRedis()!;
    // Full record for the replay view, when the client sent the analysis.
    if (body.result && photoUrl) {
      const record: ScanRecord = {
        id,
        cardUrl: card.url,
        photoUrl,
        caption,
        sceneType,
        at,
        result: body.result,
      };
      await redis.set(`${SCAN_KEY_PREFIX}${id}`, record);
    }

    await redis.lpush(LIST_KEY, entry);
    // Trim the feed and fully delete anything that falls off the end.
    const evicted = await redis.lrange<GalleryEntry>(LIST_KEY, MAX_ENTRIES, -1);
    await redis.ltrim(LIST_KEY, 0, MAX_ENTRIES - 1);
    for (const e of evicted) {
      del(e.url, { token }).catch((err) =>
        console.error("gallery blob delete failed:", err)
      );
      if (e.id) {
        const rec = await redis
          .get<ScanRecord>(`${SCAN_KEY_PREFIX}${e.id}`)
          .catch(() => null);
        if (rec?.photoUrl) {
          del(rec.photoUrl, { token }).catch(() => {});
        }
        await redis.del(`${SCAN_KEY_PREFIX}${e.id}`).catch(() => {});
      }
    }

    return Response.json({ ok: true, entry });
  } catch (err) {
    console.error("gallery save failed:", err);
    // Don't leave orphaned blobs if we couldn't record the entry.
    await Promise.all(
      uploaded.map((u) => del(u, { token }).catch(() => {}))
    );
    return Response.json({ error: "Could not save scan" }, { status: 500 });
  }
}
