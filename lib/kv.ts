import { Redis } from '@upstash/redis';

let client: Redis | null = null;

// Lazily constructed so a missing env var doesn't crash the whole server —
// routes that touch this check `isKvConfigured()` first and return a clear error instead.
export function getRedis(): Redis {
  if (!client) client = Redis.fromEnv();
  return client;
}

export function isKvConfigured(): boolean {
  return !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
}
