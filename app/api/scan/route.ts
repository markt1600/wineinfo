import { getRedis } from "@/lib/redis";
import {
  LIST_KEY,
  SCAN_KEY_PREFIX,
  type GalleryEntry,
  type ScanRecord,
} from "@/lib/galleryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the full saved analysis for one scan (see gallery POST).
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^scan_[a-z0-9_]+$/i.test(id)) {
    return Response.json({ error: "Invalid scan id" }, { status: 400 });
  }
  const redis = getRedis();
  if (!redis) {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }
  try {
    const record = await redis.get<ScanRecord>(`scan:${id}`);
    if (!record) {
      return Response.json({ error: "Scan not found" }, { status: 404 });
    }
    return Response.json({ record });
  } catch (err) {
    console.error("scan fetch failed:", err);
    return Response.json({ error: "Could not load scan" }, { status: 500 });
  }
}

// Update a scan's event date (consumption date for bottle lineups /
// last-seen date for priced scans). Metadata-only: no card regeneration,
// no research.
export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string; eventDate?: string };
  const id = body?.id ?? "";
  const eventDate = body?.eventDate ?? "";
  if (!/^scan_[a-z0-9_]+$/i.test(id)) {
    return Response.json({ error: "Invalid scan id" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || isNaN(Date.parse(eventDate))) {
    return Response.json({ error: "Invalid date" }, { status: 400 });
  }
  const redis = getRedis();
  if (!redis) {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }
  try {
    const key = `${SCAN_KEY_PREFIX}${id}`;
    const record = await redis.get<ScanRecord>(key);
    if (!record) {
      return Response.json({ error: "Scan not found" }, { status: 404 });
    }
    await redis.set(key, { ...record, eventDate });

    const all = await redis.lrange<GalleryEntry>(LIST_KEY, 0, -1);
    const rewritten = all.map((e) => (e.id === id ? { ...e, eventDate } : e));
    const pipeline = redis.pipeline();
    pipeline.del(LIST_KEY);
    if (rewritten.length > 0) pipeline.rpush(LIST_KEY, ...rewritten);
    await pipeline.exec();

    return Response.json({ ok: true, eventDate });
  } catch (err) {
    console.error("scan date update failed:", err);
    return Response.json({ error: "Could not update date" }, { status: 500 });
  }
}
