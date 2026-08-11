import { del, list, put } from "@vercel/blob";
import { getRedis } from "@/lib/redis";
import { readSession } from "@/lib/auth";
import {
  LIST_KEY,
  SCAN_KEY_PREFIX,
  galleryEnabled,
  getBlobToken,
  saveScan,
  type GalleryEntry,
  type ScanClassification,
  type ScanRecord,
} from "@/lib/galleryStore";
import type { AnalysisResult } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared history of scans. Every analysis auto-saves: the summary-card
// image and the analyzed photo go to Vercel Blob, the full analysis
// result JSON goes to Redis (scan:<id>), and a capped Redis list holds
// the feed metadata (newest first). Entries past the cap are trimmed
// with their blobs and records deleted.
const MAX_ENTRIES = 20;
const MAX_CARD_BYTES = 1.5 * 1024 * 1024;
const MAX_PHOTO_BYTES = 2.2 * 1024 * 1024;

export type { GalleryEntry, ScanRecord };

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
    const entries = await redis.lrange<GalleryEntry>(LIST_KEY, 0, -1);

    // Self-heal: also surface card images that exist in Blob storage but
    // are missing from the Redis feed (older saves, or a recreated
    // database). They render without captions and open as plain cards.
    let merged = entries;
    try {
      const { blobs } = await list({
        prefix: "gallery/",
        token: getBlobToken(),
      });
      const known = new Set(entries.map((e) => e.url));
      const orphans: GalleryEntry[] = blobs
        .filter(
          (b) =>
            // card images only — skip the archived photos
            (b.pathname.includes("-card") ||
              b.pathname.startsWith("gallery/card-")) &&
            !known.has(b.url)
        )
        .map((b) => ({
          url: b.url,
          caption: "",
          sceneType: "other",
          at: new Date(b.uploadedAt).toISOString(),
        }));
      merged = [...entries, ...orphans].sort((a, b) =>
        a.at < b.at ? 1 : -1
      );
    } catch (err) {
      console.error("gallery blob listing failed:", err);
    }

    return Response.json({
      enabled: true,
      storage,
      entries: merged.slice(0, limit),
      total: merged.length,
    });
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
    replaceId?: string; // update an existing scan in place (post-edit)
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

  // Replace mode: the user edited a saved scan — swap in the regenerated
  // card, result, caption, and classification, keeping the entry's place,
  // poster, and archived photo.
  if (body.replaceId) {
    const redis = getRedis()!;
    const scanKey = `${SCAN_KEY_PREFIX}${body.replaceId}`;
    const existing = await redis.get<ScanRecord>(scanKey);
    if (!existing) {
      return Response.json({ error: "Scan not found" }, { status: 404 });
    }
    const card = await put(`gallery/${body.replaceId}-card.jpg`, cardBytes, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: true,
      token,
    });
    const caption = (body.caption ?? existing.caption).slice(0, 220);
    const hasPrices = body.result
      ? body.result.bottles.some((b) => b.listedPrice)
      : existing.classification === "Seen";
    const classification: ScanClassification = hasPrices ? "Seen" : "Consumed";
    const updated: ScanRecord = {
      ...existing,
      cardUrl: card.url,
      caption,
      classification,
      result: body.result ?? existing.result,
    };
    await redis.set(scanKey, updated);
    const all = await redis.lrange<GalleryEntry>(LIST_KEY, 0, -1);
    const rewritten = all.map((e) =>
      e.id === body.replaceId
        ? { ...e, url: card.url, caption, classification }
        : e
    );
    const pipeline = redis.pipeline();
    pipeline.del(LIST_KEY);
    if (rewritten.length > 0) pipeline.rpush(LIST_KEY, ...rewritten);
    await pipeline.exec();
    // Never delete the archived photo — it doubles as the thumbnail on
    // fire-and-forget saves until the first card render replaces it.
    if (
      existing.cardUrl &&
      existing.cardUrl !== card.url &&
      existing.cardUrl !== existing.photoUrl
    ) {
      del(existing.cardUrl, { token }).catch(() => {});
    }
    return Response.json({
      ok: true,
      entry: rewritten.find((e) => e.id === body.replaceId) ?? null,
    });
  }

  const session = readSession(request.headers.get("cookie"));
  const saved = await saveScan({
    cardBytes,
    photoBytes,
    result: body.result ?? null,
    caption: body.caption ?? "",
    sceneType: body.sceneType ?? "other",
    postedBy: session?.displayName ?? "Guest",
    username: session?.username ?? "guest",
  });
  if (!saved) {
    return Response.json({ error: "Could not save scan" }, { status: 500 });
  }
  return Response.json({ ok: true, entry: saved.entry });
}
