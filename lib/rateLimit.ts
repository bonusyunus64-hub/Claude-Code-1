import { NextRequest } from 'next/server';
import { getRedis, isKvConfigured } from '@/lib/kv';

// The login route guards a single shared password, so without a limiter an
// attacker gets unlimited guesses at it. Counts failures per client IP and locks
// the address out for a while once they pile up.

const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 15 * 60;

/**
 * Preference order, most trustworthy first. Confirmed against Vercel's own docs
 * (vercel.com/docs/headers/request-headers), since this is exactly the kind of
 * thing worth verifying rather than assuming:
 *
 * 1. `x-vercel-forwarded-for` / `x-real-ip` — set by Vercel's edge network itself.
 *    Vercel's docs say plainly that x-forwarded-for "could be overwritten if you're
 *    using a proxy on top of Vercel" (e.g. Cloudflare in front of the deployment) —
 *    x-vercel-forwarded-for is the header that survives that hop unchanged, because
 *    it's Vercel's own header name and nothing upstream of Vercel has a reason to
 *    set it. x-real-ip is documented as identical to x-forwarded-for and is equally
 *    a platform-set value. Both are safe to trust regardless of what the client sent.
 * 2. `x-forwarded-for` — per the same docs, Vercel "currently overwrite[s] the
 *    X-Forwarded-For header and do[es] not forward external IPs" by default, so on a
 *    plain Vercel deployment (no proxy of your own in front, not on the Enterprise
 *    "Trusted Proxy" feature that opts back into forwarding a caller-supplied value)
 *    it's just as trustworthy as the two above. It's ranked below them here only
 *    because that trust depends on neither of those two conditions applying — a
 *    dependency the platform-set headers don't have. Only the left-most entry is
 *    ever the original client; anything appended after that is intermediate hops.
 * 3. Neither present — `next dev` doesn't inject any of these, so this is the
 *    local-dev path. Every such request shares the 'unknown' bucket, which is
 *    safe-by-default (they throttle each other rather than being unlimited) and
 *    doesn't matter much in practice: brute-forcing SITE_PASSWORD over localhost
 *    isn't a real attack surface.
 */
export function clientIp(req: NextRequest): string {
  const vercelForwarded = req.headers.get('x-vercel-forwarded-for');
  if (vercelForwarded) return vercelForwarded.split(',')[0].trim();

  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  return 'unknown';
}

function attemptsKey(ip: string): string {
  return `trackpitch:login-attempts:${ip}`;
}

export interface RateLimitState {
  blocked: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Read-only check. Returns `blocked` once the address has burned through its
 * attempts. When Redis isn't configured this always allows — the limiter is a
 * hardening measure, not something worth locking the owner out of their own app over.
 */
export async function checkLoginRateLimit(ip: string): Promise<RateLimitState> {
  if (!isKvConfigured()) return { blocked: false, remaining: MAX_ATTEMPTS, retryAfterSeconds: 0 };

  const redis = getRedis();
  const key = attemptsKey(ip);
  const attempts = Number(await redis.get<number>(key)) || 0;
  if (attempts < MAX_ATTEMPTS) {
    return { blocked: false, remaining: MAX_ATTEMPTS - attempts, retryAfterSeconds: 0 };
  }

  const ttl = await redis.ttl(key);
  return { blocked: true, remaining: 0, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
}

/** Called only on a failed attempt — a correct password shouldn't consume budget. */
export async function recordFailedLogin(ip: string): Promise<void> {
  if (!isKvConfigured()) return;
  const redis = getRedis();
  const key = attemptsKey(ip);
  await redis.incr(key);
  // Refresh the window on every failure so sustained guessing keeps the lock on.
  await redis.expire(key, WINDOW_SECONDS);
}

export async function clearLoginAttempts(ip: string): Promise<void> {
  if (!isKvConfigured()) return;
  await getRedis().del(attemptsKey(ip));
}
