import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = new Map<string, Record<string, string>>();

function hget(key: string, field: string) {
  return Promise.resolve(store.get(key)?.[field]);
}
function hset(key: string, values: Record<string, string>) {
  const hash = store.get(key) ?? {};
  Object.assign(hash, values);
  store.set(key, hash);
  return Promise.resolve(1);
}

let kvConfigured = true;

vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hget, hset }),
}));

import { unsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl, buildUnsubscribeApiUrl, addToBlacklistServerSide, getBlacklist } from './unsubscribe';

describe('unsubscribeToken / verifyUnsubscribeToken', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_PASSWORD', 'correct-horse-battery-staple');
    vi.stubEnv('ACCOUNTS_SECRET', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('produces a verifiable token for an address', () => {
    const token = unsubscribeToken('manager@example.com');
    expect(token).not.toBeNull();
    expect(verifyUnsubscribeToken('manager@example.com', token!)).toBe(true);
  });

  it('is case-insensitive on the email', () => {
    const token = unsubscribeToken('Manager@Example.com');
    expect(verifyUnsubscribeToken('manager@example.com', token!)).toBe(true);
  });

  it('rejects a token for a different address', () => {
    const token = unsubscribeToken('manager@example.com');
    expect(verifyUnsubscribeToken('other@example.com', token!)).toBe(false);
  });

  it('rejects a token minted under a different secret', () => {
    const token = unsubscribeToken('manager@example.com');
    vi.stubEnv('SITE_PASSWORD', 'a-different-secret');
    expect(verifyUnsubscribeToken('manager@example.com', token!)).toBe(false);
  });

  it('rejects an empty or garbage token', () => {
    expect(verifyUnsubscribeToken('manager@example.com', '')).toBe(false);
    expect(verifyUnsubscribeToken('manager@example.com', 'not-a-real-token')).toBe(false);
  });

  it('returns null when no secret is configured at all', () => {
    vi.unstubAllEnvs();
    expect(unsubscribeToken('manager@example.com')).toBeNull();
  });
});

describe('buildUnsubscribeUrl / buildUnsubscribeApiUrl', () => {
  beforeEach(() => vi.stubEnv('SITE_PASSWORD', 'secret'));
  afterEach(() => vi.unstubAllEnvs());

  it('builds a human-facing /unsubscribe URL with email and token', () => {
    const url = buildUnsubscribeUrl('https://example.com', 'manager@example.com');
    expect(url).toMatch(/^https:\/\/example\.com\/unsubscribe\?email=manager%40example\.com&token=[0-9a-f]+$/);
  });

  it('builds a machine-facing /api/unsubscribe URL with the same token', () => {
    const pageUrl = new URL(buildUnsubscribeUrl('https://example.com', 'manager@example.com')!);
    const apiUrl = new URL(buildUnsubscribeApiUrl('https://example.com', 'manager@example.com')!);
    expect(apiUrl.pathname).toBe('/api/unsubscribe');
    expect(apiUrl.searchParams.get('token')).toBe(pageUrl.searchParams.get('token'));
  });

  it('returns null when no secret is configured', () => {
    vi.unstubAllEnvs();
    expect(buildUnsubscribeUrl('https://example.com', 'manager@example.com')).toBeNull();
  });
});

describe('addToBlacklistServerSide', () => {
  beforeEach(() => {
    store.clear();
    kvConfigured = true;
  });

  it('adds a new address to an empty blacklist', async () => {
    await addToBlacklistServerSide('Manager@Example.com');
    const raw = await hget('trackpitch:settings', 'tp_blacklist');
    expect(JSON.parse(raw!)).toEqual(['manager@example.com']);
  });

  it('appends to an existing blacklist without duplicating', async () => {
    await hset('trackpitch:settings', { tp_blacklist: JSON.stringify(['existing@example.com']) });
    await addToBlacklistServerSide('new@example.com');
    await addToBlacklistServerSide('existing@example.com');
    const raw = await hget('trackpitch:settings', 'tp_blacklist');
    expect(JSON.parse(raw!)).toEqual(['existing@example.com', 'new@example.com']);
  });

  it('is a no-op when KV is not configured', async () => {
    kvConfigured = false;
    await addToBlacklistServerSide('manager@example.com');
    expect(await hget('trackpitch:settings', 'tp_blacklist')).toBeUndefined();
  });
});

describe('getBlacklist', () => {
  beforeEach(() => {
    store.clear();
    kvConfigured = true;
  });

  it('returns a lowercased set of the stored list', async () => {
    await hset('trackpitch:settings', { tp_blacklist: JSON.stringify(['Manager@Example.com']) });
    expect(await getBlacklist()).toEqual(new Set(['manager@example.com']));
  });

  it('returns an empty set when nothing is stored', async () => {
    expect(await getBlacklist()).toEqual(new Set());
  });

  it('returns an empty set when KV is not configured', async () => {
    kvConfigured = false;
    expect(await getBlacklist()).toEqual(new Set());
  });
});
