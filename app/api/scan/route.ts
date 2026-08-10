import { getRedis } from "@/lib/redis";
import type { ScanRecord } from "@/lib/galleryStore";

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
