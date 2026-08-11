import { getRedis } from "@/lib/redis";
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
