import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// In-memory Redis fake — same shape as lib/rateLimit.test.ts's own mock. Deliberately
// NOT mocking lib/rateLimit.ts itself: the route's whole security value is the real
// 8-attempts/15-minute lockout wired end to end, so this exercises lib/rateLimit.ts and
// lib/auth.ts for real, only faking the Redis boundary underneath both.
const store = new Map<string, number>();
const ttls = new Map<string, number>();
let kvConfigured = true;

vi.mock('@/lib/kv', () => ({
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    incr: (key: string) => { const n = (store.get(key) ?? 0) + 1; store.set(key, n); return Promise.resolve(n); },
    expire: (key: string, seconds: number) => { ttls.set(key, seconds); return Promise.resolve(1); },
    ttl: (key: string) => Promise.resolve(ttls.get(key) ?? -1),
    del: (key: string) => { store.delete(key); ttls.delete(key); return Promise.resolve(1); },
  }),
}));

import { POST } from './route';
import { AUTH_COOKIE, SESSION_MAX_AGE_MS } from '@/lib/auth';

function loginReq(password: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ password }),
  });
}

describe('POST /api/auth', () => {
  beforeEach(() => {
    store.clear();
    ttls.clear();
    kvConfigured = true;
    vi.stubEnv('SITE_PASSWORD', 'correct-horse-battery-staple');
  });
  afterEach(() => vi.unstubAllEnvs());

  // Documented behaviour (README): "Login always fails; /api/auth returns a 500
  // explaining SITE_PASSWORD isn't set." Must fail closed, not treat a missing
  // secret as "anything goes".
  it('returns the documented 500 when SITE_PASSWORD is not configured, rather than letting anyone in', async () => {
    vi.stubEnv('SITE_PASSWORD', '');
    const res = await POST(loginReq('anything-at-all'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/SITE_PASSWORD/);
    expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });

  it('sets a session cookie with the documented attributes on a correct password', async () => {
    const res = await POST(loginReq('correct-horse-battery-staple'));
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(AUTH_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe('lax');
    expect(cookie!.path).toBe('/');
    // Kept in lockstep with lib/auth.ts's SESSION_MAX_AGE_MS by design (see the route's
    // own comment) — assert the actual relationship, not a hardcoded number, so this
    // doesn't silently drift if that constant ever changes.
    expect(cookie!.maxAge).toBe(SESSION_MAX_AGE_MS / 1000);
  });

  it('marks the cookie secure in production (cookie must not be sent over plain http there)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await POST(loginReq('correct-horse-battery-staple'));
    expect(res.cookies.get(AUTH_COOKIE)!.secure).toBe(true);
  });

  it('does not mark the cookie secure outside production (so local http dev still works)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const res = await POST(loginReq('correct-horse-battery-staple'));
    expect(res.cookies.get(AUTH_COOKIE)!.secure).toBe(false);
  });

  it('rejects a wrong password with 401 and issues no cookie', async () => {
    const res = await POST(loginReq('wrong-password'));
    expect(res.status).toBe(401);
    expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });

  it('rejects a non-string password body without throwing', async () => {
    const res = await POST(loginReq(12345));
    expect(res.status).toBe(401);
  });

  describe('rate limiting (8 failed attempts locks the address out for 15 minutes)', () => {
    it('allows failed attempts under the threshold to keep returning 401 (not yet blocked)', async () => {
      for (let i = 0; i < 7; i++) {
        const res = await POST(loginReq('wrong', { 'x-forwarded-for': '9.9.9.9' }));
        expect(res.status).toBe(401);
      }
    });

    it('locks the address out after 8 failed attempts, returning 429 with Retry-After', async () => {
      for (let i = 0; i < 8; i++) {
        const res = await POST(loginReq('wrong', { 'x-forwarded-for': '9.9.9.9' }));
        expect(res.status).toBe(401);
      }
      const blockedRes = await POST(loginReq('wrong', { 'x-forwarded-for': '9.9.9.9' }));
      expect(blockedRes.status).toBe(429);
      const body = await blockedRes.json();
      expect(body.error).toMatch(/Too many/);
      expect(Number(blockedRes.headers.get('Retry-After'))).toBeGreaterThan(0);
    });

    it('rejects even the correct password once the address is locked out', async () => {
      for (let i = 0; i < 8; i++) await POST(loginReq('wrong', { 'x-forwarded-for': '9.9.9.9' }));
      const res = await POST(loginReq('correct-horse-battery-staple', { 'x-forwarded-for': '9.9.9.9' }));
      expect(res.status).toBe(429);
    });

    it('a successful login clears the failure count for that address, resetting the budget', async () => {
      for (let i = 0; i < 7; i++) await POST(loginReq('wrong', { 'x-forwarded-for': '9.9.9.9' }));
      const ok = await POST(loginReq('correct-horse-battery-staple', { 'x-forwarded-for': '9.9.9.9' }));
      expect(ok.status).toBe(200);
      // If the count really reset, this address should be able to fail 7 more times
      // without being blocked — i.e. it isn't still sitting one attempt away from 429.
      for (let i = 0; i < 7; i++) {
        const res = await POST(loginReq('wrong', { 'x-forwarded-for': '9.9.9.9' }));
        expect(res.status).toBe(401);
      }
    });

    it('does not consume rate-limit budget on a successful login (only failures count)', async () => {
      const res = await POST(loginReq('correct-horse-battery-staple', { 'x-forwarded-for': '9.9.9.9' }));
      expect(res.status).toBe(200);
      for (let i = 0; i < 7; i++) {
        const r = await POST(loginReq('wrong', { 'x-forwarded-for': '9.9.9.9' }));
        expect(r.status).toBe(401);
      }
    });

    it('tracks separate addresses independently — one IP locked out does not affect another', async () => {
      for (let i = 0; i < 8; i++) await POST(loginReq('wrong', { 'x-forwarded-for': '1.1.1.1' }));
      const otherIp = await POST(loginReq('wrong', { 'x-forwarded-for': '2.2.2.2' }));
      expect(otherIp.status).toBe(401); // not 429
    });

    // This is the invariant clientIp()'s header-preference order exists to protect (see
    // README "Login rate limiting and IP trust" and the doc comment on clientIp()): once a
    // platform-set header (x-vercel-forwarded-for) is present, a client-supplied
    // x-forwarded-for must be ignored — otherwise an attacker could send a different
    // x-forwarded-for on every request and get unlimited guesses despite always hitting the
    // service from the same real address.
    it('keys the lockout on x-vercel-forwarded-for, not a spoofable client-supplied x-forwarded-for', async () => {
      for (let i = 0; i < 8; i++) {
        await POST(loginReq('wrong', {
          'x-vercel-forwarded-for': '3.3.3.3',
          'x-forwarded-for': `spoofed-value-${i}`, // attacker varies this every request
        }));
      }
      const res = await POST(loginReq('wrong', {
        'x-vercel-forwarded-for': '3.3.3.3',
        'x-forwarded-for': 'yet-another-spoofed-value',
      }));
      expect(res.status).toBe(429); // still locked out under the trusted IP despite the spoofing attempt
    });
  });
});
