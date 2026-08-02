import { describe, it, expect, vi, beforeEach } from 'vitest';

const hashStore = new Map<string, Record<string, string>>();
const setStore = new Map<string, Set<string>>();

function hget(key: string, field: string) {
  return Promise.resolve(hashStore.get(key)?.[field]);
}
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
// Real set semantics (not just stubbed to return empty) since the whole point of moving
// the blacklist to a Redis set is atomicity/dedup that a fake return value can't exercise —
// adding the same member twice must only ever result in one entry.
function sadd(key: string, ...members: string[]) {
  const set = setStore.get(key) ?? new Set<string>();
  const before = set.size;
  for (const m of members) set.add(m);
  setStore.set(key, set);
  return Promise.resolve(set.size - before); // Redis returns the count of newly-added members
}
function srem(key: string, ...members: string[]) {
  const set = setStore.get(key);
  if (!set) return Promise.resolve(0);
  let removed = 0;
  for (const m of members) if (set.delete(m)) removed++;
  return Promise.resolve(removed);
}
function smembers(key: string) {
  return Promise.resolve(Array.from(setStore.get(key) ?? []));
}

let kvConfigured = true;

vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hget, hset, hdel, sadd, srem, smembers }),
}));

// The module keeps a one-time "have I already migrated" flag as internal state (same
// shape as migrateLegacyAccounts()/migrateLegacyCampaigns()), so each test needs a fresh
// module instance — otherwise whichever test runs first consumes the migration for every
// test that follows it in this file. Mirrors the pattern in lib/campaigns.test.ts.
async function freshDoNotContactModule() {
  vi.resetModules();
  return import('./doNotContact');
}

describe('the Do Not Contact set (SADD/SREM/SMEMBERS)', () => {
  beforeEach(() => {
    hashStore.clear();
    setStore.clear();
    kvConfigured = true;
  });

  describe('adding a single address', () => {
    it('adds a new, lowercased/trimmed address', async () => {
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await addManyToBlacklistServerSide(['  Manager@Example.com  ']);
      expect(await getBlacklist()).toEqual(new Set(['manager@example.com']));
    });

    it('adding the same address twice only stores it once — this is the whole point of using a set', async () => {
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await addManyToBlacklistServerSide(['manager@example.com']);
      await addManyToBlacklistServerSide(['Manager@Example.com']); // same address, different casing
      expect(await getBlacklist()).toEqual(new Set(['manager@example.com']));
      expect(Array.from(setStore.get('trackpitch:blacklist') ?? [])).toHaveLength(1);
    });

    it('two "concurrent" adds for different addresses both land — the race the old read/modify/write blob lost', async () => {
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      // Fire both without sequencing them — this is exactly the interleaving that lost a
      // write under the old "read whole array, push, write whole array back" scheme.
      await Promise.all([
        addManyToBlacklistServerSide(['a@example.com']),
        addManyToBlacklistServerSide(['b@example.com']),
      ]);
      expect(await getBlacklist()).toEqual(new Set(['a@example.com', 'b@example.com']));
    });

    it('is a no-op when KV is not configured', async () => {
      kvConfigured = false;
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await addManyToBlacklistServerSide(['manager@example.com']);
      expect(await getBlacklist()).toEqual(new Set());
    });
  });

  describe('removeFromBlacklistServerSide', () => {
    it('removes a single address without touching the rest of the set', async () => {
      const { addManyToBlacklistServerSide, removeFromBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await addManyToBlacklistServerSide(['a@example.com']);
      await addManyToBlacklistServerSide(['b@example.com']);
      await removeFromBlacklistServerSide('A@Example.com');
      expect(await getBlacklist()).toEqual(new Set(['b@example.com']));
    });

    it('is a no-op removing an address that was never on the list', async () => {
      const { removeFromBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await removeFromBlacklistServerSide('nobody@example.com');
      expect(await getBlacklist()).toEqual(new Set());
    });
  });

  describe('adding a batch in one call', () => {
    it('adds a whole batch in one call, lowercased/trimmed and deduped', async () => {
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await addManyToBlacklistServerSide(['A@Example.com', 'b@example.com', 'a@example.com', '  ']);
      expect(await getBlacklist()).toEqual(new Set(['a@example.com', 'b@example.com']));
    });

    it('is a no-op on an empty (or all-blank) list', async () => {
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await addManyToBlacklistServerSide([]);
      await addManyToBlacklistServerSide(['   ']);
      expect(await getBlacklist()).toEqual(new Set());
    });
  });

  describe('getBlacklist', () => {
    it('returns a lowercased set of the stored members', async () => {
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await addManyToBlacklistServerSide(['Manager@Example.com']);
      expect(await getBlacklist()).toEqual(new Set(['manager@example.com']));
    });

    it('returns an empty set when nothing is stored', async () => {
      const { getBlacklist } = await freshDoNotContactModule();
      expect(await getBlacklist()).toEqual(new Set());
    });

    it('returns an empty set when KV is not configured', async () => {
      kvConfigured = false;
      const { getBlacklist } = await freshDoNotContactModule();
      expect(await getBlacklist()).toEqual(new Set());
    });
  });

  describe('legacy tp_blacklist migration', () => {
    it('migrates the legacy JSON array from the settings blob into the set on first use, then purges the old field', async () => {
      await hset('trackpitch:settings', { tp_blacklist: JSON.stringify(['Legacy1@Example.com', 'legacy2@example.com', 'legacy1@example.com']) });
      const { getBlacklist } = await freshDoNotContactModule();

      expect(await getBlacklist()).toEqual(new Set(['legacy1@example.com', 'legacy2@example.com']));
      // The plaintext blob field should be gone after migration.
      expect(await hget('trackpitch:settings', 'tp_blacklist')).toBeUndefined();
    });

    it('runs once per module instance: a later add lands alongside the migrated addresses, not instead of them', async () => {
      await hset('trackpitch:settings', { tp_blacklist: JSON.stringify(['legacy@example.com']) });
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();

      await getBlacklist(); // triggers migration
      await addManyToBlacklistServerSide(['new@example.com']);
      expect(await getBlacklist()).toEqual(new Set(['legacy@example.com', 'new@example.com']));
    });

    it('is harmless when there is nothing legacy to migrate', async () => {
      const { addManyToBlacklistServerSide, getBlacklist } = await freshDoNotContactModule();
      await addManyToBlacklistServerSide(['a@example.com']);
      expect(await getBlacklist()).toEqual(new Set(['a@example.com']));
    });
  });
});
