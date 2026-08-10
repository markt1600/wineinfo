import { getRedis } from "@/lib/redis";
import type { AnalysisResult } from "@/lib/schema";

// Shared storage plumbing for the scan gallery (feed list in Redis,
// images in Vercel Blob, full analyses under scan:<id> keys).

export const LIST_KEY = "gallery:entries";
export const SCAN_KEY_PREFIX = "scan:";

export interface GalleryEntry {
  id?: string; // scan record key suffix (absent on legacy entries)
  url: string; // summary card image
  caption: string;
  sceneType: string;
  at: string; // ISO timestamp
}

export interface ScanRecord {
  id: string;
  cardUrl: string;
  photoUrl: string; // the analyzed photo (same pixel size as analysis)
  caption: string;
  sceneType: string;
  at: string;
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
