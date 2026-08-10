import { Redis } from "@upstash/redis";

let redis: Redis | null | undefined;

// Vercel's Upstash integration sets KV_* names; a direct Upstash setup
// sets UPSTASH_*. Support both; return null when neither exists.
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}
