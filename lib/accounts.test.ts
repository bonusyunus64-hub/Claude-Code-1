import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from './accounts';
import type { StoredAccount } from './accounts';

describe('encrypt/decrypt', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_PASSWORD', 'correct-horse-battery-staple');
    vi.stubEnv('ACCOUNTS_SECRET', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips a plaintext password', () => {
    const encrypted = encrypt('hunter2');
    expect(encrypted).not.toContain('hunter2');
    expect(decrypt(encrypted)).toBe('hunter2');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    expect(encrypt('hunter2')).not.toBe(encrypt('hunter2'));
  });

  it('fails to decrypt under a different secret, rather than returning garbage', () => {
    const encrypted = encrypt('hunter2');
    vi.stubEnv('SITE_PASSWORD', 'a-different-secret');
    expect(decrypt(encrypted)).toBeNull();
  });

  it('rejects tampered ciphertext instead of returning corrupted plaintext', () => {
    const encrypted = encrypt('hunter2');
    const parts = encrypted.split(':');
    // Flip a hex character in the ciphertext segment — GCM's auth tag should reject this.
    parts[3] = (parts[3][0] === '0' ? '1' : '0') + parts[3].slice(1);
    expect(decrypt(parts.join(':'))).toBeNull();
  });

  it('returns null for a payload that is not in the expected v1 format', () => {
    expect(decrypt('not-a-valid-payload')).toBeNull();
  });

  it('throws when encrypting with no secret configured at all', () => {
    vi.unstubAllEnvs();
    expect(() => encrypt('hunter2')).toThrow();
  });
});

// --- account store round trip ---
// Follows the same in-memory-Redis mocking pattern as lib/campaigns.test.ts.

const store = new Map<string, Record<string, string>>();
let kvConfigured = true;

function hgetall(key: string) {
  return Promise.resolve(store.get(key) ?? {});
}
function hget(key: string, field: string) {
  return Promise.resolve(store.get(key)?.[field]);
}
function hset(key: string, values: Record<string, string>) {
  const hash = store.get(key) ?? {};
  Object.assign(hash, values);
  store.set(key, hash);
  return Promise.resolve(1);
}
function hdel(key: string, ...fields: string[]) {
  const hash = store.get(key);
  if (!hash) return Promise.resolve(0);
  let removed = 0;
  for (const f of fields) if (f in hash) { delete hash[f]; removed++; }
  return Promise.resolve(removed);
}

vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hgetall, hget, hset, hdel }),
}));

// The module keeps its one-time legacy-migration flag as internal state, so each
// test needs a fresh module instance — otherwise whichever test runs first marks
// the migration done for every test that follows it in this file.
async function freshAccountsModule() {
  vi.resetModules();
  return import('./accounts');
}

function sampleAccount(id: string, overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id,
    name: 'Test Account',
    email: 'a@example.com',
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    smtpUser: 'user',
    smtpPass: 'hunter2',
    ...overrides,
  };
}

describe('account store', () => {
  beforeEach(() => {
    store.clear();
    kvConfigured = true;
    vi.stubEnv('SITE_PASSWORD', 'correct-horse-battery-staple');
    vi.stubEnv('ACCOUNTS_SECRET', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('never exposes the SMTP password to listAccounts callers', async () => {
    const { saveAccount, listAccounts } = await freshAccountsModule();
    await saveAccount(sampleAccount('1'));
    const all = await listAccounts();
    expect(all).toHaveLength(1);
    // Both the plaintext and the at-rest field must be absent — this is the
    // boundary that keeps a mailbox password out of an API response.
    expect(JSON.stringify(all)).not.toContain('hunter2');
    expect(JSON.stringify(all)).not.toContain('encryptedPass');
  });

  it('stores the password encrypted at rest, not in plaintext', async () => {
    const { saveAccount } = await freshAccountsModule();
    await saveAccount(sampleAccount('1'));
    expect(JSON.stringify([...store.entries()])).not.toContain('hunter2');
  });

  it('getAccount returns the decrypted password for server-side use', async () => {
    const { saveAccount, getAccount } = await freshAccountsModule();
    await saveAccount(sampleAccount('1'));
    expect((await getAccount('1'))?.smtpPass).toBe('hunter2');
  });

  it('getAccount returns null for an id that was never saved', async () => {
    const { getAccount } = await freshAccountsModule();
    expect(await getAccount('nope')).toBeNull();
  });

  it('getAccount throws AccountUndecryptableError after the encryption key changes', async () => {
    const { saveAccount, getAccount, AccountUndecryptableError } = await freshAccountsModule();
    await saveAccount(sampleAccount('1'));
    // Simulates rotating SITE_PASSWORD while accounts encrypted under the old one
    // are still stored — must be distinguishable from "no such account" so the UI
    // can say "re-enter the password" rather than "re-add the account".
    vi.stubEnv('SITE_PASSWORD', 'a-different-secret');
    await expect(getAccount('1')).rejects.toBeInstanceOf(AccountUndecryptableError);
  });

  it('getAccountDailyCap reads the cap without needing the password to decrypt', async () => {
    const { saveAccount, getAccountDailyCap } = await freshAccountsModule();
    await saveAccount(sampleAccount('1', { dailyCap: 40 }));
    vi.stubEnv('SITE_PASSWORD', 'a-different-secret');
    // Still readable under a rotated key: an account nobody can send from should
    // still enforce its cap rather than silently becoming unlimited.
    expect(await getAccountDailyCap('1')).toBe(40);
  });

  it('reports no per-account cap as 0 rather than undefined', async () => {
    const { saveAccount, getAccountDailyCap } = await freshAccountsModule();
    await saveAccount(sampleAccount('1'));
    expect(await getAccountDailyCap('1')).toBe(0);
  });

  it('deleteAccount removes the account from subsequent reads', async () => {
    const { saveAccount, deleteAccount, listAccounts } = await freshAccountsModule();
    await saveAccount(sampleAccount('1'));
    await deleteAccount('1');
    expect(await listAccounts()).toEqual([]);
  });

  it('returns an empty list when KV is not configured, rather than throwing', async () => {
    kvConfigured = false;
    const { listAccounts } = await freshAccountsModule();
    expect(await listAccounts()).toEqual([]);
  });
});
