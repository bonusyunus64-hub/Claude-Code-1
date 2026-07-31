import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CampaignRecord } from './campaigns';
import { assignSubjectVariant } from './recipients';

const store = new Map<string, Record<string, string>>();

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

let kvConfigured = true;

vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hgetall, hget, hset, hdel }),
}));

function sample(id: string, overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return { id, trackTitle: 'My Track', date: '2026-01-01T00:00:00.000Z', type: 'demos', emails: ['a@example.com'], ...overrides };
}

// The module keeps a one-time "have I already migrated" flag as internal state, so
// each test needs a fresh module instance — otherwise whichever test runs first
// consumes the migration for every test that follows it in this file.
async function freshCampaignsModule() {
  vi.resetModules();
  return import('./campaigns');
}

describe('campaigns store', () => {
  beforeEach(() => {
    store.clear();
    kvConfigured = true;
  });

  it('round-trips a saved campaign', async () => {
    const { saveCampaign, listCampaigns } = await freshCampaignsModule();
    await saveCampaign(sample('1'));
    expect(await listCampaigns()).toEqual([sample('1')]);
  });

  it('updating a campaign overwrites the same record rather than duplicating it', async () => {
    const { saveCampaign, listCampaigns } = await freshCampaignsModule();
    await saveCampaign(sample('1'));
    await saveCampaign(sample('1', { responded: ['a@example.com'] }));
    const all = await listCampaigns();
    expect(all).toHaveLength(1);
    expect(all[0].responded).toEqual(['a@example.com']);
  });

  it('deletes a single campaign without touching others', async () => {
    const { saveCampaign, deleteCampaign, listCampaigns } = await freshCampaignsModule();
    await saveCampaign(sample('1'));
    await saveCampaign(sample('2'));
    await deleteCampaign('1');
    const all = await listCampaigns();
    expect(all.map(c => c.id)).toEqual(['2']);
  });

  it('clears every campaign', async () => {
    const { saveCampaign, clearCampaigns, listCampaigns } = await freshCampaignsModule();
    await saveCampaign(sample('1'));
    await saveCampaign(sample('2'));
    await clearCampaigns();
    expect(await listCampaigns()).toEqual([]);
  });

  it('migrates the legacy tp_campaigns array from the settings blob on first read', async () => {
    await hset('trackpitch:settings', { tp_campaigns: JSON.stringify([sample('legacy-1'), sample('legacy-2')]) });
    const { listCampaigns } = await freshCampaignsModule();
    const all = await listCampaigns();
    expect(all.map(c => c.id).sort()).toEqual(['legacy-1', 'legacy-2']);
    // The plaintext blob field should be gone after migration.
    expect(await hget('trackpitch:settings', 'tp_campaigns')).toBeUndefined();
  });

  it('returns nothing when KV is not configured', async () => {
    kvConfigured = false;
    const { listCampaigns } = await freshCampaignsModule();
    expect(await listCampaigns()).toEqual([]);
  });
});

describe('mergeSendResultsIntoCampaign', () => {
  it('folds newly-sent addresses into a still-empty campaign (the send-window-queued case)', async () => {
    const { mergeSendResultsIntoCampaign } = await freshCampaignsModule();
    const queued = sample('1', { emails: [], pendingSend: { endpoint: '/api/send', payload: {} }, scheduledFor: 123 });
    const merged = mergeSendResultsIntoCampaign(queued, ['a@example.com'], { 'a@example.com': '<m1>' }, undefined);
    expect(merged.emails).toEqual(['a@example.com']);
    expect(merged.messageIds).toEqual({ 'a@example.com': '<m1>' });
    expect(merged.pendingSend).toBeUndefined();
  });

  it('keeps pendingSend when more work remains', async () => {
    const { mergeSendResultsIntoCampaign } = await freshCampaignsModule();
    const pending = { endpoint: '/api/send', payload: { trackTitle: 'Track' } };
    const queued = sample('1', { emails: [], pendingSend: pending });
    const merged = mergeSendResultsIntoCampaign(queued, ['a@example.com'], {}, pending);
    expect(merged.pendingSend).toEqual(pending);
  });

  it('deduplicates addresses already recorded as sent', async () => {
    const { mergeSendResultsIntoCampaign } = await freshCampaignsModule();
    const existing = sample('1', { emails: ['a@example.com'] });
    const merged = mergeSendResultsIntoCampaign(existing, ['a@example.com', 'b@example.com'], {}, undefined);
    expect(merged.emails.sort()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('merges newly-sent addresses into subjectVariants when a subject test is running, without recomputing existing ones', async () => {
    const { mergeSendResultsIntoCampaign } = await freshCampaignsModule();
    const existing = sample('1', {
      emails: ['a@example.com'],
      subjectA: 'A', subjectB: 'B',
      subjectVariants: { 'a@example.com': assignSubjectVariant('a@example.com') },
    });
    const merged = mergeSendResultsIntoCampaign(existing, ['b@example.com'], {}, undefined);
    expect(merged.subjectVariants).toEqual({
      'a@example.com': assignSubjectVariant('a@example.com'),
      'b@example.com': assignSubjectVariant('b@example.com'),
    });
  });

  it('leaves subjectVariants untouched (undefined) for a campaign that never ran a subject test', async () => {
    const { mergeSendResultsIntoCampaign } = await freshCampaignsModule();
    const existing = sample('1', { emails: [] });
    const merged = mergeSendResultsIntoCampaign(existing, ['a@example.com'], {}, undefined);
    expect(merged.subjectVariants).toBeUndefined();
  });
});
