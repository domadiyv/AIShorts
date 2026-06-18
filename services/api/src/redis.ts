import { Redis } from '@upstash/redis';

// Upstash REST client (reads UPSTASH_REDIS_REST_URL / _TOKEN from env).
// All cache ops are best-effort — a Redis hiccup must never break the API.
let redis: Redis | null = null;
try {
  redis = Redis.fromEnv();
} catch {
  redis = null; // no creds configured → run without cache
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
