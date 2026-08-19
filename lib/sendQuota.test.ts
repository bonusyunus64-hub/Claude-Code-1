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
import { DEFAULT_DAILY_CAP } from './sendLimits';

function storeAccount(id: string, dailyCap?: number) {
  return hset('trackpitch:accounts', { [id]: JSON.stringify({ id, encryptedPass: 'irrelevant-for-cap-checks', smtpUser: `${id}@example.com`, dailyCap }) });
}

describe('sendQuota', () => {
  beforeEach(() => {
    store.clear();
    kvConfigured = true;
  });

  it('imposes no limit when the cap is unset (0) — allowed equals the full batch size', async () => {
    await hset('trackpitch:settings', { tp_daily_cap: '0' });
    const result = await checkCapAllows(1000);
    expect(result).toEqual({ allowed: 1000 });
  });

  it('grants only the remaining headroom instead of refusing the whole batch', async () => {
    // 45/50 sent, batch of 10 — there are still 5 sends of room today, so this
    // should NOT refuse outright (the old behavior); it should hand back exactly
    // what's left.
    await hset('trackpitch:settings', { tp_daily_cap: '50' });
    await recordSends(45);
    const result = await checkCapAllows(10);
    expect(result).toEqual({ allowed: 5 });
  });

  it('allows a batch that lands exactly on the cap', async () => {
    await hset('trackpitch:settings', { tp_daily_cap: '50' });
    await recordSends(40);
    const result = await checkCapAllows(10);
    expect(result).toEqual({ allowed: 10 });
  });

  it('allows 0 with a named-cap error once the global cap is genuinely exhausted', async () => {
    await hset('trackpitch:settings', { tp_daily_cap: '50' });
    await recordSends(50);
    const result = await checkCapAllows(10);
    expect(result.allowed).toBe(0);
    expect(result.error).toEqual(expect.stringContaining('50/50'));
  });

  it('tracks per-account totals alongside the overall total', async () => {
    await recordSends(5, 'acct-1');
    await recordSends(3, 'acct-2');
    await recordSends(2, 'acct-1');
    const { count, byAccount } = await getSendsToday();
    expect(count).toBe(10);
    expect(byAccount).toEqual({ 'acct-1': 7, 'acct-2': 3 });
  });

  it('never limits when KV is not configured', async () => {
    kvConfigured = false;
    const result = await checkCapAllows(1_000_000);
    expect(result).toEqual({ allowed: 1_000_000 });
    expect(await getDailyCap()).toBe(0);
  });

  it('keys the counter to the current UTC day', () => {
    expect(todayKey()).toBe(new Date().toISOString().slice(0, 10));
  });

  it('floors the allowance at 0 rather than going negative when the counter has overshot the cap', async () => {
    // Can happen if the cap was lowered after some sends already went out today.
    await hset('trackpitch:settings', { tp_daily_cap: '50' });
    await recordSends(60);
    const result = await checkCapAllows(10);
    expect(result.allowed).toBe(0);
    expect(result.error).toEqual(expect.stringContaining('60/50'));
  });

  describe('per-account caps', () => {
    it('grants only the remaining per-account headroom, even with no global cap set', async () => {
      await storeAccount('acct-1', 20);
      await recordSends(18, 'acct-1');
      const result = await checkCapAllows(5, 'acct-1');
      expect(result).toEqual({ allowed: 2 });
    });

    it('returns 0 with a named account-cap error once the account cap is genuinely exhausted', async () => {
      await storeAccount('acct-1', 20);
      await recordSends(20, 'acct-1');
      const result = await checkCapAllows(5, 'acct-1');
      expect(result.allowed).toBe(0);
      expect(result.error).toEqual(expect.stringContaining('20/20'));
      expect(result.error).toEqual(expect.stringContaining('This account'));
    });

    it('does not limit a different account sharing the same day', async () => {
      await storeAccount('acct-1', 20);
      await storeAccount('acct-2', 20);
      await recordSends(18, 'acct-1');
      const result = await checkCapAllows(5, 'acct-2');
      expect(result).toEqual({ allowed: 5 });
    });

    it('imposes no per-account limit when the account has none set', async () => {
      // Pinned to explicit "None" so this test isolates the per-account cap it's
      // actually about — since Part B, an untouched tp_daily_cap now defaults to
      // DEFAULT_DAILY_CAP (50) rather than unlimited (see the 'getDailyCap default'
      // describe block below), so leaving it unset here would make the *global*
      // cap the thing that binds at 1000 sends, not the (absent) account cap.
      await hset('trackpitch:settings', { tp_daily_cap: '0' });
      await storeAccount('acct-1', undefined);
      await recordSends(1000, 'acct-1');
      const result = await checkCapAllows(1000, 'acct-1');
      expect(result).toEqual({ allowed: 1000 });
    });

    it('the global cap binds tighter than the per-account cap: allowance and error reflect the global numbers', async () => {
      await hset('trackpitch:settings', { tp_daily_cap: '50' });
      await storeAccount('acct-1', 1000);
      await recordSends(45, 'acct-1');
      const result = await checkCapAllows(10, 'acct-1');
      // Global: 45/50 -> 5 left. Account: 45/1000 -> plenty left. Global binds.
      expect(result).toEqual({ allowed: 5 });
    });

    it('the account cap binds tighter than the global cap: allowance and error reflect the account numbers', async () => {
      await hset('trackpitch:settings', { tp_daily_cap: '1000' });
      await storeAccount('acct-1', 20);
      await recordSends(18, 'acct-1');
      const result = await checkCapAllows(10, 'acct-1');
      // Global: 18/1000 -> plenty left. Account: 18/20 -> 2 left. Account binds.
      expect(result).toEqual({ allowed: 2 });
    });

    it('reports the account-cap error (not the global one) when the account cap is the one exhausted', async () => {
      await hset('trackpitch:settings', { tp_daily_cap: '1000' });
      await storeAccount('acct-1', 20);
      await recordSends(20, 'acct-1');
      const result = await checkCapAllows(5, 'acct-1');
      expect(result.allowed).toBe(0);
      expect(result.error).toEqual(expect.stringContaining('20/20'));
      expect(result.error).toEqual(expect.stringContaining('This account'));
    });

    it('is a no-op when no accountId is passed', async () => {
      // Pinned to explicit "None" for the same reason as the test above — an
      // unset tp_daily_cap now defaults to 50, which would otherwise bind here
      // instead of demonstrating the per-account check is skipped.
      await hset('trackpitch:settings', { tp_daily_cap: '0' });
      await storeAccount('acct-1', 5);
      await recordSends(5, 'acct-1');
      const result = await checkCapAllows(1000);
      expect(result).toEqual({ allowed: 1000 });
    });
  });

  describe('getDailyCap default (Part B)', () => {
    it('defaults to DEFAULT_DAILY_CAP when tp_daily_cap has never been stored', async () => {
      // Nothing hset for tp_daily_cap in this test — the "never touched the
      // setting" case, distinct from an explicitly stored "0".
      expect(await getDailyCap()).toBe(DEFAULT_DAILY_CAP);
    });

    it('honours an explicitly stored "0" as None (unlimited), not the default', async () => {
      await hset('trackpitch:settings', { tp_daily_cap: '0' });
      expect(await getDailyCap()).toBe(0);
    });

    it('honours an explicitly stored non-zero value', async () => {
      await hset('trackpitch:settings', { tp_daily_cap: '200' });
      expect(await getDailyCap()).toBe(200);
    });
  });
});
