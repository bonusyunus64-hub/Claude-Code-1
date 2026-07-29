import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, number>();
const ttls = new Map<string, number>();

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

let kvConfigured = true;

import { checkLoginRateLimit, recordFailedLogin, clearLoginAttempts, clientIp } from './rateLimit';

describe('login rate limiting', () => {
  beforeEach(() => {
    store.clear();
    ttls.clear();
    kvConfigured = true;
  });

  it('allows attempts under the threshold', async () => {
    for (let i = 0; i < 7; i++) await recordFailedLogin('1.2.3.4');
    const result = await checkLoginRateLimit('1.2.3.4');
    expect(result.blocked).toBe(false);
  });

  it('blocks once attempts reach the threshold', async () => {
    for (let i = 0; i < 8; i++) await recordFailedLogin('1.2.3.4');
    const result = await checkLoginRateLimit('1.2.3.4');
    expect(result.blocked).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks each address independently', async () => {
    for (let i = 0; i < 8; i++) await recordFailedLogin('1.2.3.4');
    const other = await checkLoginRateLimit('5.6.7.8');
    expect(other.blocked).toBe(false);
  });

  it('clearing attempts (a successful login) resets the block', async () => {
    for (let i = 0; i < 8; i++) await recordFailedLogin('1.2.3.4');
    await clearLoginAttempts('1.2.3.4');
    const result = await checkLoginRateLimit('1.2.3.4');
    expect(result.blocked).toBe(false);
  });

  it('never blocks when KV is not configured', async () => {
    kvConfigured = false;
    for (let i = 0; i < 20; i++) await recordFailedLogin('1.2.3.4');
    const result = await checkLoginRateLimit('1.2.3.4');
    expect(result.blocked).toBe(false);
  });
});

describe('clientIp', () => {
  function fakeReq(headers: Record<string, string>) {
    return { headers: { get: (k: string) => headers[k] ?? null } } as unknown as Parameters<typeof clientIp>[0];
  }

  it('takes the left-most address from x-forwarded-for', () => {
    expect(clientIp(fakeReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(fakeReq({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('falls back to "unknown" with no identifying headers', () => {
    expect(clientIp(fakeReq({}))).toBe('unknown');
  });
});
