import { del, put } from "@vercel/blob";
import { getRedis } from "@/lib/redis";
import { upsertVenueFromScan } from "@/lib/venueStore";
import type { AnalysisResult } from "@/lib/schema";

// Shared storage plumbing for the scan gallery (feed list in Redis,
// images in Vercel Blob, full analyses under scan:<id> keys).

export const LIST_KEY = "gallery:entries";
export const SCAN_KEY_PREFIX = "scan:";

// Per-user scan history: a Redis list of scan ids, newest first. Unlike
// the public feed (capped at 20), user scans keep their records/images
// so periods like "past year" work.
export function userScansKey(username: string): string {
  return `userscans:${username.toLowerCase()}`;
}
export const USER_SCANS_MAX = 500;

// "Consumed" = a bottle lineup with no pricing (wines that were drunk);
// "Seen" = priced wines spotted in a store or on a menu.
export type ScanClassification = "Consumed" | "Seen";

export interface GalleryEntry {
  id?: string; // scan record key suffix (absent on legacy entries)
  url: string; // summary card image
  caption: string;
  sceneType: string;
  at: string; // ISO timestamp
  postedBy?: string; // display name ("Mark T.", "markt") — absent = Guest
  username?: string; // stable account key; "guest" when not signed in
  classification?: ScanClassification;
  // The date the wines were consumed (Consumed) or last seen (Seen).
  // Defaults to the scan date; user-editable for Consumed scans.
  eventDate?: string; // YYYY-MM-DD
}

export interface ScanRecord {
  id: string;
  cardUrl: string;
  photoUrl: string; // the analyzed photo (same pixel size as analysis)
  caption: string;
  sceneType: string;
  at: string;
  postedBy?: string;
  username?: string;
  classification?: ScanClassification;
  eventDate?: string; // YYYY-MM-DD — consumption date / last-seen date
  result: AnalysisResult;
}

// Vercel injects BLOB_READ_WRITE_TOKEN by default, but a store connected
// with a custom env prefix names it <Prefix>_READ_WRITE_TOKEN. This
// deployment's public store uses the "thirdblob" prefix — prefer it, so
// leftover tokens from older (private) stores can never shadow it.
export function getBlobToken(): string | undefined {
  if (process.env.thirdblob_READ_WRITE_TOKEN)
    return process.env.thirdblob_READ_WRITE_TOKEN;
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [key, value] of Object.entries(process.env)) {
    if (key.endsWith("_READ_WRITE_TOKEN") && value) return value;
  }
  return undefined;
}

export function galleryEnabled(): boolean {
  return getRedis() !== null && !!getBlobToken();
}

export const FEED_MAX_ENTRIES = 20;

export interface SaveScanInput {
  cardBytes?: Buffer | null; // summary card; may be absent (fire-and-forget)
  photoBytes?: Buffer | null; // the analyzed photo
  result?: AnalysisResult | null;
  caption: string;
  sceneType: string;
  postedBy: string;
  username: string;
}

// Creates a scan: uploads images, writes the record and feed entry, indexes
// it in the poster's history, and trims the public feed. When no card image
// exists yet (server-side fire-and-forget save), the photo doubles as the
// feed thumbnail until the client renders the card and replaces it.
export async function saveScan(
  input: SaveScanInput
): Promise<{ id: string; entry: GalleryEntry } | null> {
  if (!galleryEnabled()) return null;
  const redis = getRedis()!;
  const token = getBlobToken();
  const id = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const uploaded: string[] = [];

  try {
    let photoUrl = "";
    if (input.photoBytes) {
      const photo = await put(`gallery/${id}-photo.jpg`, input.photoBytes, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: true,
        token,
      });
      uploaded.push(photo.url);
      photoUrl = photo.url;
    }
    let cardUrl = photoUrl;
    if (input.cardBytes) {
      const card = await put(`gallery/${id}-card.jpg`, input.cardBytes, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: true,
        token,
      });
      uploaded.push(card.url);
      cardUrl = card.url;
    }
    if (!cardUrl) return null; // nothing displayable

    const at = new Date().toISOString();
    const caption = input.caption.slice(0, 220);
    const hasPrices = input.result
      ? input.result.bottles.some((b) => b.listedPrice)
      : input.sceneType === "shelf_with_prices" ||
        input.sceneType === "wine_menu";
    const classification: ScanClassification = hasPrices ? "Seen" : "Consumed";

    const hasRecord = !!(input.result && photoUrl);
    if (hasRecord) {
      const record: ScanRecord = {
        id,
        cardUrl,
        photoUrl,
        caption,
        sceneType: input.sceneType,
        at,
        postedBy: input.postedBy,
        username: input.username,
        classification,
        eventDate: at.slice(0, 10),
        result: input.result!,
      };
      await redis.set(`${SCAN_KEY_PREFIX}${id}`, record);
      // Menu scans with a venue name also feed the Restaurants tab.
      await upsertVenueFromScan(input.result!, {
        photoUrl,
        scanId: id,
        at,
        eventDate: record.eventDate,
      });
    }
    const entry: GalleryEntry = {
      ...(hasRecord ? { id } : {}),
      url: cardUrl,
      caption,
      sceneType: input.sceneType,
      at,
      postedBy: input.postedBy,
      username: input.username,
      classification,
      eventDate: at.slice(0, 10),
    };

    await redis.lpush(LIST_KEY, entry);
    if (hasRecord && input.username !== "guest") {
      await redis.lpush(userScansKey(input.username), id);
      await redis.ltrim(userScansKey(input.username), 0, USER_SCANS_MAX - 1);
    }

    // Trim the public feed. Guests' aged-out scans are fully deleted;
    // signed-in users' scans keep their record + images for My Wines.
    const evicted = await redis.lrange<GalleryEntry>(
      LIST_KEY,
      FEED_MAX_ENTRIES,
      -1
    );
    await redis.ltrim(LIST_KEY, 0, FEED_MAX_ENTRIES - 1);
    for (const e of evicted) {
      if (e.username && e.username !== "guest") continue;
      del(e.url, { token }).catch(() => {});
      if (e.id) {
        const rec = await redis
          .get<ScanRecord>(`${SCAN_KEY_PREFIX}${e.id}`)
          .catch(() => null);
        if (rec?.photoUrl && rec.photoUrl !== e.url) {
          del(rec.photoUrl, { token }).catch(() => {});
        }
        await redis.del(`${SCAN_KEY_PREFIX}${e.id}`).catch(() => {});
      }
    }

    return { id, entry };
  } catch (err) {
    console.error("saveScan failed:", err);
    await Promise.all(uploaded.map((u) => del(u, { token }).catch(() => {})));
    return null;
  }
}
