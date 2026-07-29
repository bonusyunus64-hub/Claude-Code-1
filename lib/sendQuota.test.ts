import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the Upstash client so the cap logic can be tested without
// live Redis. Mocked at the module boundary (lib/kv) rather than reaching into
// @upstash/redis internals.
const store = new Map<string, Record<string, string>>();

function hgetall(key: string) {
  return Promise.resolve(store.get(key) ?? {});
}
function hget(key: string, field: string) {
  return Promise.resolve(store.get(key)?.[field]);
}
function hincrby(key: string, field: string, n: number) {
  const hash = store.get(key) ?? {};
  hash[field] = String((Number(hash[field]) || 0) + n);
  store.set(key, hash);
  return Promise.resolve(Number(hash[field]));
}
function hset(key: string, values: Record<string, string>) {
  const hash = store.get(key) ?? {};
  Object.assign(hash, values);
  store.set(key, hash);
  return Promise.resolve(1);
}
function expireMock() {
  return Promise.resolve(1);
}

let kvConfigured = true;

vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hgetall, hget, hincrby, hset, expire: expireMock }),
}));

import { checkCapAllows, getSendsToday, recordSends, getDailyCap, todayKey } from './sendQuota';

describe('sendQuota', () => {
  beforeEach(() => {
    store.clear();
    kvConfigured = true;
  });

  it('imposes no limit when the cap is unset (0)', async () => {
    await hset('trackpitch:settings', { tp_daily_cap: '0' });
    const result = await checkCapAllows(1000);
    expect(result.ok).toBe(true);
  });

  it('blocks a batch that would push the day past the cap', async () => {
    await hset('trackpitch:settings', { tp_daily_cap: '50' });
    await recordSends(45);
    const result = await checkCapAllows(10);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('45/50') });
  });

  it('allows a batch that lands exactly on the cap', async () => {
    await hset('trackpitch:settings', { tp_daily_cap: '50' });
    await recordSends(40);
    const result = await checkCapAllows(10);
    expect(result.ok).toBe(true);
  });

  it('tracks per-account totals alongside the overall total', async () => {
    await recordSends(5, 'acct-1');
    await recordSends(3, 'acct-2');
    await recordSends(2, 'acct-1');
    const { count, byAccount } = await getSendsToday();
    expect(count).toBe(10);
    expect(byAccount).toEqual({ 'acct-1': 7, 'acct-2': 3 });
  });

  it('never blocks when KV is not configured', async () => {
    kvConfigured = false;
    const result = await checkCapAllows(1_000_000);
    expect(result.ok).toBe(true);
    expect(await getDailyCap()).toBe(0);
  });

  it('keys the counter to the current UTC day', () => {
    expect(todayKey()).toBe(new Date().toISOString().slice(0, 10));
  });
});
