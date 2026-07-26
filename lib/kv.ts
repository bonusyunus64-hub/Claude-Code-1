import { Redis } from '@upstash/redis';

let client: Redis | null = null;

// Vercel's Upstash/KV integration injects KV_REST_API_URL + KV_REST_API_TOKEN
// (not the UPSTASH_REDIS_REST_* names @upstash/redis's fromEnv() looks for by
// default), so we read those explicitly.
function getUrl(): string | undefined {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
}

function getToken(): string | undefined {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
}

// Lazily constructed so a missing env var doesn't crash the whole server —
// routes that touch this check `isKvConfigured()` first and return a clear error instead.
export function getRedis(): Redis {
  if (!client) client = new Redis({ url: getUrl()!, token: getToken()! });
  return client;
}

export function isKvConfigured(): boolean {
  return !!getUrl() && !!getToken();
}
