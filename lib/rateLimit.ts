import { NextRequest } from 'next/server';
import { getRedis, isKvConfigured } from '@/lib/kv';

// The login route guards a single shared password, so without a limiter an
// attacker gets unlimited guesses at it. Counts failures per client IP and locks
// the address out for a while once they pile up.

const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 15 * 60;

export function clientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for; the left-most entry is the original client.
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
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
