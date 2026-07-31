import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Real in-memory Redis-set fake (mirrors lib/unsubscribe.test.ts's own store), not a
// stubbed lib/unsubscribe.ts — the point of this route is that it writes the atomic
// Redis SET (SADD/SREM/SMEMBERS), not the legacy JSON-blob settings field, so the test
// needs real set semantics underneath to catch a regression back to the blob.
const hashStore = new Map<string, Record<string, string>>();
const setStore = new Map<string, Set<string>>();
let kvConfigured = true;

function hget(key: string, field: string) { return Promise.resolve(hashStore.get(key)?.[field]); }
function hset(key: string, values: Record<string, string>) {
  const hash = hashStore.get(key) ?? {};
  Object.assign(hash, values);
  hashStore.set(key, hash);
  return Promise.resolve(1);
}
function hdel(key: string, ...fields: string[]) {
  const hash = hashStore.get(key);
  if (!hash) return Promise.resolve(0);
  let removed = 0;
  for (const f of fields) if (f in hash) { delete hash[f]; removed++; }
  return Promise.resolve(removed);
}
function sadd(key: string, ...members: string[]) {
  const set = setStore.get(key) ?? new Set<string>();
  const before = set.size;
  for (const m of members) set.add(m);
  setStore.set(key, set);
  return Promise.resolve(set.size - before);
}
function srem(key: string, ...members: string[]) {
  const set = setStore.get(key);
  if (!set) return Promise.resolve(0);
  let removed = 0;
  for (const m of members) if (set.delete(m)) removed++;
  return Promise.resolve(removed);
}
function smembers(key: string) { return Promise.resolve(Array.from(setStore.get(key) ?? [])); }

vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hget, hset, hdel, sadd, srem, smembers }),
}));

import { GET, POST, DELETE } from './route';

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/blacklist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function deleteReq(email?: string) {
  const url = new URL('http://localhost/api/blacklist');
  if (email !== undefined) url.searchParams.set('email', email);
  return new NextRequest(url, { method: 'DELETE' });
}

describe('/api/blacklist (Do Not Contact list)', () => {
  beforeEach(() => {
    hashStore.clear();
    setStore.clear();
    kvConfigured = true;
  });

  describe('GET', () => {
    it('returns an empty list when nothing is blacklisted', async () => {
      const res = await GET();
      expect(await res.json()).toEqual({ blacklist: [] });
    });

    it('returns the stored list, sorted', async () => {
      await sadd('trackpitch:blacklist', 'zed@example.com', 'ann@example.com');
      const res = await GET();
      expect(await res.json()).toEqual({ blacklist: ['ann@example.com', 'zed@example.com'] });
    });

    it('returns an empty list when KV is not configured, rather than erroring', async () => {
      kvConfigured = false;
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ blacklist: [] });
    });
  });

  describe('POST', () => {
    it('adds a single address via the `email` field', async () => {
      const res = await POST(postReq({ email: 'Manager@Example.com' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ blacklist: ['manager@example.com'] });
    });

    it('adds a batch of addresses via the `emails` field in one call', async () => {
      const res = await POST(postReq({ emails: ['a@example.com', 'b@example.com'] }));
      expect((await res.json()).blacklist).toEqual(['a@example.com', 'b@example.com']);
    });

    it('rejects a request with neither `email` nor `emails`', async () => {
      const res = await POST(postReq({}));
      expect(res.status).toBe(400);
    });

    it('rejects a request whose email fields are blank/whitespace only', async () => {
      const res = await POST(postReq({ email: '   ' }));
      expect(res.status).toBe(400);
    });

    it('writes to the Redis set, not the legacy settings blob field', async () => {
      await POST(postReq({ email: 'manager@example.com' }));
      expect(setStore.get('trackpitch:blacklist')?.has('manager@example.com')).toBe(true);
      // The legacy field this list used to live in must stay untouched by a fresh write.
      expect(hashStore.get('trackpitch:settings')?.tp_blacklist).toBeUndefined();
    });

    it('returns 500 with a clear error when KV is not configured (writes cannot be a silent no-op here)', async () => {
      kvConfigured = false;
      const res = await POST(postReq({ email: 'manager@example.com' }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    });
  });

  describe('DELETE', () => {
    it('removes a single address from the set', async () => {
      await sadd('trackpitch:blacklist', 'a@example.com', 'b@example.com');
      const res = await DELETE(deleteReq('a@example.com'));
      expect(await res.json()).toEqual({ blacklist: ['b@example.com'] });
    });

    it('rejects a request with no `email` query param', async () => {
      const res = await DELETE(deleteReq());
      expect(res.status).toBe(400);
    });

    it('returns 500 when KV is not configured', async () => {
      kvConfigured = false;
      const res = await DELETE(deleteReq('a@example.com'));
      expect(res.status).toBe(500);
    });
  });
});
