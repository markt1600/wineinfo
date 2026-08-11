import { timingSafeEqual } from "crypto";
import { del } from "@vercel/blob";
import { getRedis } from "@/lib/redis";
import {
  LIST_KEY,
  SCAN_KEY_PREFIX,
  galleryEnabled,
  getBlobToken,
  userScansKey,
  type GalleryEntry,
  type ScanRecord,
} from "@/lib/galleryStore";
import {
  cacheEnabled,
  cacheSet,
  wineKey,
  type WineCacheEntry,
} from "@/lib/wineCache";
import { setVenueDate, upsertVenue, type VenueWine } from "@/lib/venueStore";
import type { Money } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pinMatches(pin: string): boolean {
  const expected = process.env.ADMIN_PIN ?? "";
  const a = Buffer.from(pin);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// One imported wine: the cache-entry fields plus optional alias spellings
// (e.g. how a menu prints the name) that should resolve to the same entry,
// and optional venue fields that feed the Restaurants tab.
interface WineImport extends Partial<WineCacheEntry> {
  aliases?: {
    producer?: string | null;
    wineName?: string | null;
    vintage?: string | null;
  }[];
  venue?: string | null;
  listedPrice?: Money | null;
  seenAt?: string | null; // YYYY-MM-DD the menu is from
  sizeML?: number | null; // bottle size at the venue (375 = half bottle)
}

// Admin actions: verify the PIN, delete selected scans (card blob, photo
// blob, and analysis record), or bulk-import pre-researched wines into the
// Redis wine cache (no gallery/scan-history entries are created).
export async function POST(request: Request) {
  if (!process.env.ADMIN_PIN) {
    return Response.json(
      { error: "Admin is not configured — set the ADMIN_PIN environment variable." },
      { status: 503 }
    );
  }

  const body = (await request.json()) as {
    pin?: string;
    action?: "verify" | "delete" | "import_wines" | "set_venue_date";
    urls?: string[];
    entries?: WineImport[];
    defaultMenuDate?: string; // YYYY-MM-DD fallback when a row has no menuDate
    venueSlug?: string;
    date?: string; // YYYY-MM-DD, for set_venue_date
  };
  if (!body?.pin || !pinMatches(body.pin)) {
    return Response.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  if (body.action === "verify") {
    return Response.json({ ok: true });
  }

  if (body.action === "import_wines") {
    if (!cacheEnabled()) {
      return Response.json(
        { error: "Redis is not configured" },
        { status: 503 }
      );
    }
    const entries = (Array.isArray(body.entries) ? body.entries : []).slice(
      0,
      200
    );
    if (entries.length === 0) {
      return Response.json({ error: "No entries" }, { status: 400 });
    }
    const defaultMenuDate =
      body.defaultMenuDate && /^\d{4}-\d{2}-\d{2}$/.test(body.defaultMenuDate)
        ? body.defaultMenuDate
        : new Date().toISOString().slice(0, 10);
    let wines = 0;
    let keysWritten = 0;
    const byVenue = new Map<string, VenueWine[]>();
    for (const e of entries) {
      if (!e || (!e.producer && !e.wineName)) continue;
      const entry: WineCacheEntry = {
        producer: e.producer ?? null,
        wineName: e.wineName ?? null,
        vintage: e.vintage ?? null,
        region: e.region ?? null,
        grapeVariety: e.grapeVariety ?? null,
        wineType: e.wineType ?? null,
        marketPrice: e.marketPrice ?? null,
        marketPriceSource: e.marketPriceSource ?? null,
        ratings: Array.isArray(e.ratings) ? e.ratings : [],
        fetchedAt: e.fetchedAt ?? new Date().toISOString(),
      };
      // Write the canonical key plus any alias spellings (as printed on a
      // menu) so future scans hit the cache however the name is read.
      const keys = new Set([
        wineKey(entry.producer, entry.wineName, entry.vintage),
      ]);
      for (const a of Array.isArray(e.aliases) ? e.aliases : []) {
        if (a && (a.producer || a.wineName)) {
          keys.add(wineKey(a.producer, a.wineName, a.vintage));
        }
      }
      for (const k of keys) {
        await cacheSet(k, entry);
        keysWritten++;
      }
      wines++;

      // Rows with a venue also build that restaurant's wine list.
      const venueName = (e.venue ?? "").trim();
      if (venueName) {
        const listed = e.listedPrice ?? null;
        let priceDeltaPct: number | null = null;
        if (
          listed &&
          entry.marketPrice &&
          listed.currency === entry.marketPrice.currency &&
          entry.marketPrice.amount > 0
        ) {
          priceDeltaPct = Math.round(
            ((listed.amount - entry.marketPrice.amount) /
              entry.marketPrice.amount) *
              100
          );
        }
        const list = byVenue.get(venueName) ?? [];
        list.push({
          producer: entry.producer,
          wineName: entry.wineName,
          vintage: entry.vintage,
          region: entry.region,
          wineType: entry.wineType,
          bottleSizeML: e.sizeML ?? null,
          listedPrice: listed,
          marketPrice: entry.marketPrice,
          marketPriceSource: entry.marketPriceSource,
          priceDeltaPct,
          ratings: entry.ratings,
          seenAt:
            e.seenAt && /^\d{4}-\d{2}-\d{2}$/.test(e.seenAt)
              ? e.seenAt
              : defaultMenuDate,
        });
        byVenue.set(venueName, list);
      }
    }
    for (const [venueName, venueWines] of byVenue) {
      await upsertVenue(venueName, venueWines, null);
    }
    return Response.json({
      ok: true,
      wines,
      keysWritten,
      venues: byVenue.size,
    });
  }

  if (body.action === "set_venue_date") {
    if (!body.venueSlug || !body.date) {
      return Response.json(
        { error: "Missing venueSlug or date" },
        { status: 400 }
      );
    }
    const count = await setVenueDate(body.venueSlug, body.date);
    if (count === null) {
      return Response.json(
        { error: "Venue not found or invalid date" },
        { status: 404 }
      );
    }
    return Response.json({ ok: true, wines: count });
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

    // Orphaned cards (in Blob storage but not in the Redis feed) can be
    // selected in the admin UI too — delete their blobs directly.
    const inList = new Set(all.map((e) => e.url));
    let orphansDeleted = 0;
    for (const url of urls) {
      if (!inList.has(url) && url.includes(".blob.vercel-storage.com")) {
        orphansDeleted++;
        del(url, { token }).catch((err) =>
          console.error("admin orphan delete failed:", err)
        );
      }
    }

    for (const e of remove) {
      del(e.url, { token }).catch((err) =>
        console.error("admin blob delete failed:", err)
      );
      if (e.id) {
        const rec = await redis
          .get<ScanRecord>(`${SCAN_KEY_PREFIX}${e.id}`)
          .catch(() => null);
        if (rec?.photoUrl) del(rec.photoUrl, { token }).catch(() => {});
        // Admin deletion is total — drop it from the owner's history too.
        if (rec?.username && rec.username !== "guest") {
          await redis
            .lrem(userScansKey(rec.username), 0, e.id)
            .catch(() => {});
        }
        await redis.del(`${SCAN_KEY_PREFIX}${e.id}`).catch(() => {});
      }
    }

    // Rewrite the feed without the removed entries, preserving order.
    const pipeline = redis.pipeline();
    pipeline.del(LIST_KEY);
    if (keep.length > 0) pipeline.rpush(LIST_KEY, ...keep);
    await pipeline.exec();

    return Response.json({
      ok: true,
      deleted: remove.length + orphansDeleted,
      remaining: keep.length,
    });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
