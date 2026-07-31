import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Real in-memory Redis set fake (same shape as lib/unsubscribe.test.ts) — deliberately
// NOT mocking lib/unsubscribe.ts itself, since the whole point of this route's tests is
// that a genuine HMAC token round-trips through the real signing/verification logic:
// a valid signed token unsubscribes, and a forged or stale one fails closed rather than
// unsubscribing the wrong (or any) address.
const setStore = new Map<string, Set<string>>();
const hashStore = new Map<string, Record<string, string>>();
let kvConfigured = true;

function hget(key: string, field: string) { return Promise.resolve(hashStore.get(key)?.[field]); }
function hdel(key: string, ...fields: string[]) {
  const hash = hashStore.get(key);
  if (!hash) return Promise.resolve(0);
  let removed = 0;
  for (const f of fields) if (f in hash) { delete hash[f]; removed++; }
  return Promise.resolve(removed);
}
function sadd(key: string, ...members: string[]) {
  const set = setStore.get(key) ?? new Set<string>();
  for (const m of members) set.add(m);
  setStore.set(key, set);
  return Promise.resolve(members.length);
}
function smembers(key: string) { return Promise.resolve(Array.from(setStore.get(key) ?? [])); }

vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hget, hdel, sadd, smembers }),
}));

import { GET, POST } from './route';
import { unsubscribeToken } from '@/lib/unsubscribe';

function unsubReq(method: 'GET' | 'POST', params: { email?: string; token?: string }) {
  const url = new URL('http://localhost/api/unsubscribe');
  if (params.email !== undefined) url.searchParams.set('email', params.email);
  if (params.token !== undefined) url.searchParams.set('token', params.token);
  return new NextRequest(url, { method });
}

describe('/api/unsubscribe', () => {
  beforeEach(() => {
    setStore.clear();
    hashStore.clear();
    kvConfigured = true;
    vi.stubEnv('SITE_PASSWORD', 'correct-horse-battery-staple');
    vi.stubEnv('ACCOUNTS_SECRET', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const method of ['GET', 'POST'] as const) {
    const handler = method === 'GET' ? GET : POST;

    describe(method, () => {
      it('unsubscribes the address when the token is valid and matches the email', async () => {
        const email = 'manager@example.com';
        const token = unsubscribeToken(email)!;
        const res = await handler(unsubReq(method, { email, token }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(setStore.get('trackpitch:blacklist')?.has('manager@example.com')).toBe(true);
      });

      it('rejects with 400 and does not unsubscribe when the token is forged (fails closed)', async () => {
        const email = 'manager@example.com';
        const res = await handler(unsubReq(method, { email, token: 'totally-forged-token-value' }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/invalid|missing/i);
        expect(setStore.get('trackpitch:blacklist')?.has('manager@example.com')).toBeFalsy();
      });

      it('rejects a token that is valid for a different address rather than unsubscribing this one', async () => {
        const tokenForSomeoneElse = unsubscribeToken('someone-else@example.com')!;
        const res = await handler(unsubReq(method, { email: 'manager@example.com', token: tokenForSomeoneElse }));
        expect(res.status).toBe(400);
        expect(setStore.get('trackpitch:blacklist')?.has('manager@example.com')).toBeFalsy();
      });

      // The "stale link after secret rotation" case the README's rotation gotcha describes:
      // a token signed under the previous secret must fail closed, not silently unsubscribe.
      it('rejects a stale token minted under a since-rotated secret', async () => {
        const email = 'manager@example.com';
        const staleToken = unsubscribeToken(email)!;
        vi.stubEnv('SITE_PASSWORD', 'a-newly-rotated-secret');
        const res = await handler(unsubReq(method, { email, token: staleToken }));
        expect(res.status).toBe(400);
        expect(setStore.get('trackpitch:blacklist')?.has('manager@example.com')).toBeFalsy();
      });

      it('rejects a request missing the token entirely', async () => {
        const res = await handler(unsubReq(method, { email: 'manager@example.com' }));
        expect(res.status).toBe(400);
      });

      it('rejects a request missing the email entirely', async () => {
        const res = await handler(unsubReq(method, { token: 'anything' }));
        expect(res.status).toBe(400);
      });

      it('is case-insensitive: a token minted for mixed-case email still verifies for the lowercased address', async () => {
        const token = unsubscribeToken('Manager@Example.com')!;
        const res = await handler(unsubReq(method, { email: 'manager@example.com', token }));
        expect(res.status).toBe(200);
      });
    });
  }
});
