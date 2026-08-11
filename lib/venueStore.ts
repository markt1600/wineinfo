import { getRedis } from "@/lib/redis";
import type { AnalysisResult, Money, Rating } from "@/lib/schema";

// Per-restaurant wine lists, assembled from menu scans (sceneType
// wine_menu with a venue name) and admin CSV imports. Stored separately
// from the gallery/scan history: venue records survive feed trims and
// deletions, and imports land here without ever touching the feed.

export interface VenueWine {
  producer: string | null;
  wineName: string | null;
  vintage: string | null;
  region: string | null;
  wineType: string | null;
  bottleSizeML: number | null;
  listedPrice: Money | null; // what the venue charges
  marketPrice: Money | null;
  marketPriceSource: string | null;
  priceDeltaPct: number | null; // listed vs market (+ = markup, − = discount)
  ratings: Rating[];
  seenAt: string; // YYYY-MM-DD — when this wine was last seen on the menu
}

export interface VenueMenuPhoto {
  url: string;
  scanId?: string; // present when the photo belongs to a saved scan
  at: string; // ISO
}

export interface VenueRecord {
  slug: string;
  name: string;
  wines: VenueWine[];
  menuPhotos: VenueMenuPhoto[];
  updatedAt: string; // ISO — date of the newest menu information
}

export interface VenueSummary {
  slug: string;
  name: string;
  wineCount: number;
  photoCount: number;
  updatedAt: string;
}

const VENUES_KEY = "venues"; // hash: slug -> VenueSummary
const VENUE_PREFIX = "venue:";
const MAX_PHOTOS = 12;
// Large curated lists (e.g. a full restaurant wine book) can run past a
// thousand entries — keep real headroom above that rather than silently
// truncating a legitimately big list.
const MAX_WINES = 2000;

// "Le Bernardin" -> "le-bernardin"
export function venueSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function wineIdentity(w: {
  producer: string | null;
  wineName: string | null;
  vintage: string | null;
}): string {
  const norm = (s: string | null) =>
    (s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(w.producer)}|${norm(w.wineName)}|${norm(w.vintage) || "nv"}`;
}

// Merges new sightings into the venue's wine list (a fresher sighting of
// the same wine replaces the older one), optionally adds a menu photo, and
// refreshes the venues index.
export async function upsertVenue(
  name: string,
  wines: VenueWine[],
  photo?: VenueMenuPhoto | null
): Promise<void> {
  const redis = getRedis();
  const trimmedName = name.trim();
  const slug = venueSlug(trimmedName);
  if (!redis || !slug) return;

  try {
    const key = `${VENUE_PREFIX}${slug}`;
    const existing =
      (await redis.get<VenueRecord>(key)) ??
      ({
        slug,
        name: trimmedName,
        wines: [],
        menuPhotos: [],
        updatedAt: new Date(0).toISOString(),
      } as VenueRecord);

    const byId = new Map(existing.wines.map((w) => [wineIdentity(w), w]));
    for (const w of wines) {
      if (!w.producer && !w.wineName) continue;
      const id = wineIdentity(w);
      const prev = byId.get(id);
      if (!prev || w.seenAt >= prev.seenAt) byId.set(id, w);
    }
    const combined = [...byId.values()].sort((a, b) =>
      a.seenAt < b.seenAt ? 1 : -1
    );
    if (combined.length > MAX_WINES) {
      console.warn(
        `venue "${trimmedName}": ${combined.length} wines exceeds the ${MAX_WINES} cap — oldest ${combined.length - MAX_WINES} dropped`
      );
    }
    const merged = combined.slice(0, MAX_WINES);

    const photos = existing.menuPhotos.filter((p) => p.url !== photo?.url);
    if (photo?.url) photos.unshift(photo);

    let updatedAt = existing.updatedAt;
    for (const w of wines) {
      const iso = `${w.seenAt}T12:00:00.000Z`;
      if (iso > updatedAt) updatedAt = iso;
    }

    const record: VenueRecord = {
      slug,
      name: trimmedName, // latest spelling wins
      wines: merged,
      menuPhotos: photos.slice(0, MAX_PHOTOS),
      updatedAt,
    };
    await redis.set(key, record);
    const summary: VenueSummary = {
      slug,
      name: record.name,
      wineCount: merged.length,
      photoCount: record.menuPhotos.length,
      updatedAt,
    };
    await redis.hset(VENUES_KEY, { [slug]: summary });
  } catch (err) {
    console.error("venue upsert failed:", err);
  }
}

// Feeds a saved menu scan into the venue store.
export async function upsertVenueFromScan(
  result: AnalysisResult,
  scan: { photoUrl?: string; scanId?: string; at: string; eventDate?: string }
): Promise<void> {
  if (result.sceneType !== "wine_menu" || !result.venue?.trim()) return;
  const seenAt = scan.eventDate ?? scan.at.slice(0, 10);
  const wines: VenueWine[] = result.bottles
    .filter((b) => b.identified)
    .map((b) => ({
      producer: b.producer,
      wineName: b.wineName,
      vintage: b.vintage,
      region: b.region,
      wineType: b.wineType,
      bottleSizeML: b.bottleSizeML,
      listedPrice: b.listedPrice,
      marketPrice: b.marketPrice,
      marketPriceSource: b.marketPriceSource,
      priceDeltaPct: b.priceDeltaPct,
      ratings: b.ratings,
      seenAt,
    }));
  await upsertVenue(
    result.venue,
    wines,
    scan.photoUrl
      ? { url: scan.photoUrl, scanId: scan.scanId, at: scan.at }
      : null
  );
}

export async function listVenues(): Promise<VenueSummary[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const all = await redis.hgetall<Record<string, VenueSummary>>(VENUES_KEY);
    if (!all) return [];
    return Object.values(all).sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1
    );
  } catch (err) {
    console.error("venue list failed:", err);
    return [];
  }
}

// Admin tool: remove a venue entirely (e.g. before re-importing a
// corrected CSV from scratch). Only the venue index + record are
// removed — menu photos stay owned by the underlying scans/gallery and
// are not deleted here.
export async function deleteVenue(slug: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !/^[a-z0-9-]{1,60}$/.test(slug)) return false;
  const existing = await redis.get(`${VENUE_PREFIX}${slug}`);
  if (!existing) return false;
  await redis.del(`${VENUE_PREFIX}${slug}`);
  await redis.hdel(VENUES_KEY, slug);
  return true;
}

export async function getVenue(slug: string): Promise<VenueRecord | null> {
  const redis = getRedis();
  if (!redis || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  try {
    return (await redis.get<VenueRecord>(`${VENUE_PREFIX}${slug}`)) ?? null;
  } catch (err) {
    console.error("venue read failed:", err);
    return null;
  }
}

// Admin tool: bulk-set every wine's seenAt to a chosen date (e.g. to
// correct a menu that was imported with the wrong date, or backdate one
// that predates this app). Unlike upsertVenue, this always applies —
// there's no "newer wins" comparison, since the admin is the source of
// truth here. Returns the number of wines updated, or null if the venue
// doesn't exist.
export async function setVenueDate(
  slug: string,
  date: string
): Promise<number | null> {
  const redis = getRedis();
  if (!redis || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const record = await getVenue(slug);
  if (!record) return null;

  record.wines = record.wines.map((w) => ({ ...w, seenAt: date }));
  record.updatedAt = `${date}T12:00:00.000Z`;
  await redis.set(`${VENUE_PREFIX}${slug}`, record);

  const summary: VenueSummary = {
    slug: record.slug,
    name: record.name,
    wineCount: record.wines.length,
    photoCount: record.menuPhotos.length,
    updatedAt: record.updatedAt,
  };
  await redis.hset(VENUES_KEY, { [slug]: summary });
  return record.wines.length;
}

// Admin tool: correct a single wine's market price and recompute its
// listed-vs-market delta accordingly. Identity is producer+wineName+vintage
// (the same key merges use), so it targets exactly the wine the caller saw
// in the venue record — nothing else about the wine changes.
export async function updateWineMarketPrice(
  slug: string,
  wine: { producer: string | null; wineName: string | null; vintage: string | null },
  marketPrice: Money
): Promise<VenueWine | null> {
  const redis = getRedis();
  if (!redis) return null;
  const record = await getVenue(slug);
  if (!record) return null;

  const id = wineIdentity(wine);
  const idx = record.wines.findIndex((w) => wineIdentity(w) === id);
  if (idx < 0) return null;

  const updated: VenueWine = { ...record.wines[idx], marketPrice };
  updated.marketPriceSource = "Manually adjusted";
  updated.priceDeltaPct =
    updated.listedPrice &&
    updated.listedPrice.currency === marketPrice.currency &&
    marketPrice.amount > 0
      ? Math.round(
          ((updated.listedPrice.amount - marketPrice.amount) /
            marketPrice.amount) *
            100
        )
      : null;

  record.wines[idx] = updated;
  await redis.set(`${VENUE_PREFIX}${slug}`, record);
  return updated;
}
