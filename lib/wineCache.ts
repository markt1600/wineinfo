import { getRedis } from "@/lib/redis";
import type { Money, Rating } from "@/lib/schema";

// A previously-researched wine, stored in Redis (Vercel's Upstash integration).
export interface WineCacheEntry {
  producer: string | null;
  wineName: string | null;
  vintage: string | null;
  region: string | null;
  grapeVariety: string | null;
  wineType: string | null;
  marketPrice: Money | null;
  marketPriceSource: string | null;
  ratings: Rating[];
  fetchedAt: string; // ISO timestamp of when this data was researched
}

const KEY_PREFIX = "wine:";
const TTL_SECONDS = 60 * 60 * 24 * 30; // prices/ratings go stale; 30 days

export function cacheEnabled(): boolean {
  return getRedis() !== null;
}

// "Château Margaux", "Grand Vin", "2015" -> "chateau margaux|grand vin|2015"
export function wineKey(
  producer: string | null | undefined,
  wineName: string | null | undefined,
  vintage: string | null | undefined
): string {
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${KEY_PREFIX}${norm(producer)}|${norm(wineName)}|${norm(vintage) || "nv"}`;
}

export async function cacheGetMany(
  keys: string[]
): Promise<Map<string, WineCacheEntry>> {
  const r = getRedis();
  const found = new Map<string, WineCacheEntry>();
  if (!r || keys.length === 0) return found;
  try {
    const values = await r.mget<(WineCacheEntry | null)[]>(...keys);
    keys.forEach((key, i) => {
      const v = values[i];
      if (v) found.set(key, v);
    });
  } catch (err) {
    console.error("wine cache read failed:", err);
  }
  return found;
}

export async function cacheSet(
  key: string,
  entry: WineCacheEntry
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, entry, { ex: TTL_SECONDS });
  } catch (err) {
    console.error("wine cache write failed:", err);
  }
}

// Used when a user flags a wine as misidentified — its cached research
// is suspect and must not be served to future scans.
export async function cacheDelete(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch (err) {
    console.error("wine cache delete failed:", err);
  }
}
