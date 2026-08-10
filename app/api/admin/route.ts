import { timingSafeEqual } from "crypto";
import { del } from "@vercel/blob";
import { getRedis } from "@/lib/redis";
import {
  LIST_KEY,
  SCAN_KEY_PREFIX,
  galleryEnabled,
  getBlobToken,
  type GalleryEntry,
  type ScanRecord,
} from "@/lib/galleryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pinMatches(pin: string): boolean {
  const expected = process.env.ADMIN_PIN ?? "";
  const a = Buffer.from(pin);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Admin actions: verify the PIN, or delete selected scans (card blob,
// photo blob, and analysis record).
export async function POST(request: Request) {
  if (!process.env.ADMIN_PIN) {
    return Response.json(
      { error: "Admin is not configured — set the ADMIN_PIN environment variable." },
      { status: 503 }
    );
  }

  const body = (await request.json()) as {
    pin?: string;
    action?: "verify" | "delete";
    urls?: string[];
  };
  if (!body?.pin || !pinMatches(body.pin)) {
    return Response.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  if (body.action === "verify") {
    return Response.json({ ok: true });
  }

  if (body.action === "delete") {
    if (!galleryEnabled()) {
      return Response.json({ error: "Storage is not configured" }, { status: 503 });
    }
    const urls = new Set(
      (Array.isArray(body.urls) ? body.urls : []).filter(
        (u) => typeof u === "string"
      )
    );
    if (urls.size === 0) {
      return Response.json({ error: "Nothing selected" }, { status: 400 });
    }

    const redis = getRedis()!;
    const token = getBlobToken();
    const all = await redis.lrange<GalleryEntry>(LIST_KEY, 0, -1);
    const keep = all.filter((e) => !urls.has(e.url));
    const remove = all.filter((e) => urls.has(e.url));

    for (const e of remove) {
      del(e.url, { token }).catch((err) =>
        console.error("admin blob delete failed:", err)
      );
      if (e.id) {
        const rec = await redis
          .get<ScanRecord>(`${SCAN_KEY_PREFIX}${e.id}`)
          .catch(() => null);
        if (rec?.photoUrl) del(rec.photoUrl, { token }).catch(() => {});
        await redis.del(`${SCAN_KEY_PREFIX}${e.id}`).catch(() => {});
      }
    }

    // Rewrite the feed without the removed entries, preserving order.
    const pipeline = redis.pipeline();
    pipeline.del(LIST_KEY);
    if (keep.length > 0) pipeline.rpush(LIST_KEY, ...keep);
    await pipeline.exec();

    return Response.json({ ok: true, deleted: remove.length, remaining: keep.length });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
