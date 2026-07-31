import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_COOKIE, getSessionToken } from '@/lib/auth';

const hashStore = new Map<string, Record<string, unknown>>();
let kvConfigured = true;

function hgetall(key: string) { return Promise.resolve({ ...(hashStore.get(key) ?? {}) }); }
function hset(key: string, values: Record<string, unknown>) {
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

vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  STATE_TOMBSTONES_KEY: 'trackpitch:settings:tombstones',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hgetall, hset, hdel }),
}));

import { GET, POST, DELETE } from './route';

function authedHeaders(): Record<string, string> {
  return { cookie: `${AUTH_COOKIE}=${getSessionToken()!}` };
}
function getReq(authed: boolean) {
  return new NextRequest('http://localhost/api/state', { headers: authed ? authedHeaders() : {} });
}
function postReq(body: unknown, authed = true) {
  return new NextRequest('http://localhost/api/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authed ? authedHeaders() : {}) },
    body: JSON.stringify(body),
  });
}
function deleteReq(key: string | undefined, authed = true) {
  const url = new URL('http://localhost/api/state');
  if (key !== undefined) url.searchParams.set('key', key);
  return new NextRequest(url, { method: 'DELETE', headers: authed ? authedHeaders() : {} });
}

describe('/api/state (cross-device settings sync)', () => {
  beforeEach(() => {
    hashStore.clear();
    kvConfigured = true;
    vi.stubEnv('SITE_PASSWORD', 'correct-horse-battery-staple');
  });
  afterEach(() => vi.unstubAllEnvs());

  describe('session gating', () => {
    it('GET rejects an unauthenticated request with 401', async () => {
      const res = await GET(getReq(false));
      expect(res.status).toBe(401);
    });

    it('POST rejects an unauthenticated request with 401 and does not write', async () => {
      const res = await POST(postReq({ key: 'foo', value: 'bar' }, false));
      expect(res.status).toBe(401);
      expect(hashStore.get('trackpitch:settings')?.foo).toBeUndefined();
    });

    it('DELETE rejects an unauthenticated request with 401', async () => {
      await hset('trackpitch:settings', { foo: 'bar' });
      const res = await DELETE(deleteReq('foo', false));
      expect(res.status).toBe(401);
      expect(hashStore.get('trackpitch:settings')?.foo).toBe('bar'); // untouched
    });
  });

  describe('GET', () => {
    it('returns empty state/tombstones when nothing is stored', async () => {
      const res = await GET(getReq(true));
      expect(await res.json()).toEqual({ state: {}, tombstones: {} });
    });

    it('flattens a non-string stored value back to a string (Upstash auto-parses JSON-looking values)', async () => {
      await hset('trackpitch:settings', { tp_template: 'plain text', tp_weird: { already: 'parsed-by-upstash' } });
      const res = await GET(getReq(true));
      const body = await res.json();
      expect(body.state.tp_template).toBe('plain text');
      expect(body.state.tp_weird).toBe(JSON.stringify({ already: 'parsed-by-upstash' }));
    });

    it('returns a live tombstone for a recently deleted key', async () => {
      await hset('trackpitch:settings:tombstones', { tp_old_key: String(Date.now() - 1000) });
      const res = await GET(getReq(true));
      const body = await res.json();
      expect(body.tombstones.tp_old_key).toBeTypeOf('number');
    });

    it('prunes a tombstone older than 90 days rather than returning it', async () => {
      const ninetyOneDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
      await hset('trackpitch:settings:tombstones', { tp_ancient: String(ninetyOneDaysAgo) });
      const res = await GET(getReq(true));
      const body = await res.json();
      expect(body.tombstones.tp_ancient).toBeUndefined();
    });

    it('returns empty state when KV is not configured', async () => {
      kvConfigured = false;
      const res = await GET(getReq(true));
      expect(await res.json()).toEqual({ state: {}, tombstones: {} });
    });
  });

  describe('POST', () => {
    it('writes a key/value pair', async () => {
      const res = await POST(postReq({ key: 'tp_template', value: 'hello' }));
      expect(res.status).toBe(200);
      expect(hashStore.get('trackpitch:settings')?.tp_template).toBe('hello');
    });

    it('rejects a request missing `key`', async () => {
      const res = await POST(postReq({ value: 'hello' }));
      expect(res.status).toBe(400);
    });

    it('rejects a request whose `value` is not a string', async () => {
      const res = await POST(postReq({ key: 'tp_template', value: 12345 }));
      expect(res.status).toBe(400);
    });

    // The 2MB cap exists so a buggy client write can't push megabytes into Redis (README:
    // "comfortably above the largest legitimate value, a signature image").
    it('rejects a value larger than the 2MB per-value cap', async () => {
      const bigValue = 'a'.repeat(2 * 1024 * 1024 + 1);
      const res = await POST(postReq({ key: 'tp_sign_off_image', value: bigValue }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/too large/i);
      expect(hashStore.get('trackpitch:settings')?.tp_sign_off_image).toBeUndefined();
    });

    it('accepts a value right at the 2MB cap', async () => {
      const exactValue = 'a'.repeat(2 * 1024 * 1024);
      const res = await POST(postReq({ key: 'tp_sign_off_image', value: exactValue }));
      expect(res.status).toBe(200);
    });

    it('a fresh write clears any existing tombstone for that key (a re-add supersedes the earlier delete)', async () => {
      await hset('trackpitch:settings:tombstones', { tp_template: String(Date.now()) });
      await POST(postReq({ key: 'tp_template', value: 'back again' }));
      const res = await GET(getReq(true));
      const body = await res.json();
      expect(body.tombstones.tp_template).toBeUndefined();
    });

    it('returns 500 when KV is not configured (a write cannot be a silent no-op)', async () => {
      kvConfigured = false;
      const res = await POST(postReq({ key: 'tp_template', value: 'hello' }));
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    it('removes the key and records a tombstone with the deletion time', async () => {
      await hset('trackpitch:settings', { tp_template: 'hello' });
      const before = Date.now();
      const res = await DELETE(deleteReq('tp_template'));
      expect(res.status).toBe(200);
      expect(hashStore.get('trackpitch:settings')?.tp_template).toBeUndefined();
      const tombstoneAt = Number(hashStore.get('trackpitch:settings:tombstones')?.tp_template);
      expect(tombstoneAt).toBeGreaterThanOrEqual(before);
    });

    it('rejects a request missing `key`', async () => {
      const res = await DELETE(deleteReq(undefined));
      expect(res.status).toBe(400);
    });

    it('returns 500 when KV is not configured', async () => {
      kvConfigured = false;
      const res = await DELETE(deleteReq('tp_template'));
      expect(res.status).toBe(500);
    });
  });
});
