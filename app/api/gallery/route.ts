import { del, put } from "@vercel/blob";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared history of summary cards. Every analysis auto-saves its card:
// image in Vercel Blob, metadata in a capped Redis list (newest first).
// Entries past the cap are trimmed and their blobs deleted, bounding
// storage to roughly 100 MB worst case.
const LIST_KEY = "gallery:entries";
const MAX_ENTRIES = 200;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

export interface GalleryEntry {
  url: string;
  caption: string;
  sceneType: string;
  at: string; // ISO timestamp
}

function galleryEnabled(): boolean {
  return getRedis() !== null && !!process.env.BLOB_READ_WRITE_TOKEN;
}

export async function GET(request: Request) {
  if (!galleryEnabled()) {
    return Response.json({ enabled: false, entries: [], total: 0 });
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
    return Response.json({ enabled: true, entries, total });
  } catch (err) {
    console.error("gallery list failed:", err);
    return Response.json({ enabled: false, entries: [], total: 0 });
  }
}

export async function POST(request: Request) {
  if (!galleryEnabled()) {
    return Response.json({ error: "Gallery is not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    image?: string; // base64 JPEG, no data: prefix
    caption?: string;
    sceneType?: string;
  };
  if (!body?.image) {
    return Response.json({ error: "Missing image" }, { status: 400 });
  }

  const bytes = Buffer.from(body.image, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) {
    return Response.json({ error: "Image too large" }, { status: 413 });
  }

  const blob = await put(`gallery/card-${Date.now()}.jpg`, bytes, {
    access: "public",
    contentType: "image/jpeg",
    addRandomSuffix: true,
  });

  const entry: GalleryEntry = {
    url: blob.url,
    caption: (body.caption ?? "").slice(0, 220),
    sceneType: body.sceneType ?? "other",
    at: new Date().toISOString(),
  };

  const redis = getRedis()!;
  try {
    await redis.lpush(LIST_KEY, entry);
    // Delete blobs for anything that falls off the end of the feed.
    const evicted = await redis.lrange<GalleryEntry>(LIST_KEY, MAX_ENTRIES, -1);
    await redis.ltrim(LIST_KEY, 0, MAX_ENTRIES - 1);
    await Promise.all(
      evicted.map((e) =>
        del(e.url).catch((err) =>
          console.error("gallery blob delete failed:", err)
        )
      )
    );
  } catch (err) {
    console.error("gallery push failed:", err);
    // Don't leave an orphaned blob if we couldn't record it.
    await del(blob.url).catch(() => {});
    return Response.json({ error: "Could not save to gallery" }, { status: 500 });
  }

  return Response.json({ ok: true, entry });
}
