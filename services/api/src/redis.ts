import { Redis } from '@upstash/redis';

// Upstash REST client (reads UPSTASH_REDIS_REST_URL / _TOKEN from env).
// All cache ops are best-effort — a Redis hiccup must never break the API.
//
// NOTE: newer @upstash/redis no longer throws from fromEnv() when creds are
// missing — it returns a client that then retries for ~13s per command,
// stalling every request. So we only construct the client when BOTH env vars
// are actually present; otherwise the API runs cache-less (and fast).
let redis: Redis | null = null;
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
if (redisUrl && redisToken) {
  try {
    redis = new Redis({ url: redisUrl, token: redisToken });
  } catch {
    redis = null; // misconfigured → run without cache
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    return (await redis.get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    /* ignore cache write errors */
  }
}

// Feed cache versioning: every feed key embeds the current version, and admin
// mutations bump it, so approve/reject/edit are visible immediately instead of
// after the TTL. Old-version keys simply expire.
const FEED_VERSION_KEY = 'feed:version';

export async function feedCacheVersion(): Promise<number> {
  if (!redis) return 0;
  try {
    return (await redis.get<number>(FEED_VERSION_KEY)) ?? 0;
  } catch {
    return 0;
  }
}

export async function bumpFeedCacheVersion(): Promise<void> {
  if (!redis) return;
  try {
    await redis.incr(FEED_VERSION_KEY);
  } catch {
    /* ignore */
  }
}
