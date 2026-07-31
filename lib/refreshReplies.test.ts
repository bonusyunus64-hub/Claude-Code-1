import { describe, it, expect, vi } from 'vitest';
import type { CampaignRecord } from './campaigns';
import type { StoredAccount } from './accounts';
import type { CheckRepliesResult, ImapConfig } from './checkReplies';
import {
  REFRESH_WINDOW_DAYS, MAX_ACCOUNTS_PER_RUN, ACCOUNT_TIME_BUDGET_MS,
  isCampaignFullyResolved, selectCampaignsForRefresh, groupCampaignsByAccount,
  oldestSince, unionEmails, attributeToCampaign, mergeRefreshResultIntoCampaign,
  refreshReplies, type RefreshRepliesDeps,
} from './refreshReplies';

const NOW = Date.parse('2026-07-31T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

function campaign(id: string, overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id, trackTitle: `Track ${id}`, date: daysAgo(10), type: 'demos',
    emails: ['a@example.com', 'b@example.com'], accountId: 'acct-1',
    ...overrides,
  };
}

function account(overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id: 'acct-1', name: 'Main', email: 'me@example.com',
    smtpHost: 'smtp.zoho.com', smtpPort: 465,
    smtpUser: 'me@example.com', smtpPass: 'secret',
    ...overrides,
  };
}

function emptyResult(overrides: Partial<CheckRepliesResult> = {}): CheckRepliesResult {
  return { responded: [], bounced: [], classifications: {}, ...overrides };
}

describe('isCampaignFullyResolved', () => {
  it('is false when some recipients have neither responded nor bounced', () => {
    expect(isCampaignFullyResolved(campaign('1', { responded: ['a@example.com'] }))).toBe(false);
  });

  it('is true once every recipient is either responded or bounced', () => {
    expect(isCampaignFullyResolved(campaign('1', { responded: ['a@example.com'], bounced: ['b@example.com'] }))).toBe(true);
  });

  it('is true for a campaign with no recipients', () => {
    expect(isCampaignFullyResolved(campaign('1', { emails: [] }))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCampaignFullyResolved(campaign('1', {
      emails: ['A@Example.com', 'B@Example.com'],
      responded: ['a@example.com'], bounced: ['b@example.com'],
    }))).toBe(true);
  });
});

describe('selectCampaignsForRefresh', () => {
  it('selects a campaign with an account, recipients, sent recently, not fully resolved', () => {
    const c = campaign('1');
    expect(selectCampaignsForRefresh([c], NOW)).toEqual([c]);
  });

  it('excludes campaigns without an accountId', () => {
    expect(selectCampaignsForRefresh([campaign('1', { accountId: undefined })], NOW)).toEqual([]);
  });

  it('excludes campaigns with no recipients', () => {
    expect(selectCampaignsForRefresh([campaign('1', { emails: [] })], NOW)).toEqual([]);
  });

  it('excludes campaigns sent beyond the reply window', () => {
    const old = campaign('1', { date: daysAgo(REFRESH_WINDOW_DAYS + 1) });
    expect(selectCampaignsForRefresh([old], NOW)).toEqual([]);
  });

  it('includes a campaign right at the edge of the window', () => {
    const edge = campaign('1', { date: daysAgo(REFRESH_WINDOW_DAYS) });
    expect(selectCampaignsForRefresh([edge], NOW)).toEqual([edge]);
  });

  it('excludes campaigns that are already fully resolved', () => {
    const resolved = campaign('1', { responded: ['a@example.com'], bounced: ['b@example.com'] });
    expect(selectCampaignsForRefresh([resolved], NOW)).toEqual([]);
  });
});

describe('groupCampaignsByAccount', () => {
  it('groups campaigns sharing an accountId together', () => {
    const c1 = campaign('1', { accountId: 'acct-1' });
    const c2 = campaign('2', { accountId: 'acct-1' });
    const c3 = campaign('3', { accountId: 'acct-2' });
    const groups = groupCampaignsByAccount([c1, c2, c3]);
    expect(groups.size).toBe(2);
    expect(groups.get('acct-1')).toEqual([c1, c2]);
    expect(groups.get('acct-2')).toEqual([c3]);
  });
});

describe('oldestSince', () => {
  it('picks the earliest date among a group', () => {
    const c1 = campaign('1', { date: daysAgo(5) });
    const c2 = campaign('2', { date: daysAgo(20) });
    expect(oldestSince([c1, c2]).getTime()).toBe(new Date(daysAgo(20)).getTime());
  });
});

describe('unionEmails', () => {
  it('dedupes case-insensitively across campaigns, keeping first-seen casing', () => {
    const c1 = campaign('1', { emails: ['A@Example.com', 'c@example.com'] });
    const c2 = campaign('2', { emails: ['a@example.com', 'd@example.com'] });
    expect(unionEmails([c1, c2]).sort()).toEqual(['A@Example.com', 'c@example.com', 'd@example.com'].sort());
  });
});

describe('attributeToCampaign', () => {
  it('scopes an account-wide result down to just this campaign\'s own recipients', () => {
    const c = campaign('1', { emails: ['a@example.com', 'b@example.com'] });
    const result = emptyResult({
      responded: ['a@example.com', 'x@example.com'],
      bounced: ['y@example.com'],
      classifications: { 'a@example.com': 'interested', 'x@example.com': 'pass' },
    });
    const attributed = attributeToCampaign(c, result);
    expect(attributed.responded).toEqual(['a@example.com']);
    expect(attributed.bounced).toEqual([]);
    expect(attributed.classifications).toEqual({ 'a@example.com': 'interested' });
  });

  it('does not leak a reply belonging to a different campaign on the same account', () => {
    const c1 = campaign('1', { emails: ['a@example.com'] });
    const c2 = campaign('2', { emails: ['b@example.com'] });
    const result = emptyResult({ responded: ['a@example.com'] });
    expect(attributeToCampaign(c1, result).responded).toEqual(['a@example.com']);
    expect(attributeToCampaign(c2, result).responded).toEqual([]);
  });

  it('outputs using the campaign\'s own casing, not the union\'s', () => {
    const c = campaign('1', { emails: ['A@Example.com'] });
    const result = emptyResult({ responded: ['a@example.com'] });
    expect(attributeToCampaign(c, result).responded).toEqual(['A@Example.com']);
  });
});

describe('mergeRefreshResultIntoCampaign', () => {
  it('unions responded/bounced, merges classifications, and stamps lastChecked', () => {
    const c = campaign('1', { responded: ['a@example.com'], classifications: { 'a@example.com': 'interested' } });
    const attributed = emptyResult({ responded: ['a@example.com', 'b@example.com'], classifications: { 'b@example.com': 'pass' } });
    const updated = mergeRefreshResultIntoCampaign(c, attributed, 12345);
    expect(updated.responded).toEqual(['a@example.com', 'b@example.com']);
    expect(updated.classifications).toEqual({ 'a@example.com': 'interested', 'b@example.com': 'pass' });
    expect(updated.lastChecked).toBe(12345);
  });
});

describe('refreshReplies', () => {
  function buildDeps(overrides: Partial<RefreshRepliesDeps> = {}): RefreshRepliesDeps {
    return {
      listCampaigns: vi.fn(async () => []),
      getAccount: vi.fn(async (id: string) => account({ id })),
      findResponders: vi.fn(async () => emptyResult()),
      resolveImapConfig: vi.fn((smtpHost: string, user: string, pass: string): ImapConfig => ({ host: smtpHost.replace(/^smtp\./, 'imap.'), port: 993, user, pass })),
      saveCampaign: vi.fn(async () => {}),
      addManyToBlacklistServerSide: vi.fn(async () => {}),
      now: () => NOW,
      ...overrides,
    };
  }

  it('opens exactly one findResponders call for two campaigns on the same account, using the union of addresses and the older since', async () => {
    const c1 = campaign('1', { accountId: 'acct-1', emails: ['a@example.com', 'b@example.com'], date: daysAgo(5) });
    const c2 = campaign('2', { accountId: 'acct-1', emails: ['b@example.com', 'c@example.com'], date: daysAgo(20) });
    const findResponders = vi.fn(async (_config: ImapConfig, _emails: string[], _since: Date) => emptyResult());
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1, c2]), findResponders });

    const summary = await refreshReplies(deps);

    expect(findResponders).toHaveBeenCalledTimes(1);
    const [, emails, since] = findResponders.mock.calls[0];
    expect(emails.slice().sort()).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
    expect(since.getTime()).toBe(new Date(daysAgo(20)).getTime());
    expect(summary.accountsSelected).toBe(1);
    expect(summary.accountsChecked).toBe(1);
    expect(summary.campaignsSelected).toBe(2);
    expect(summary.campaignsUpdated).toBe(2);
  });

  it('attributes results back to the right campaign without leaking across campaigns sharing an account', async () => {
    const c1 = campaign('1', { accountId: 'acct-1', emails: ['a@example.com'] });
    const c2 = campaign('2', { accountId: 'acct-1', emails: ['b@example.com'] });
    const findResponders = vi.fn(async () => emptyResult({ responded: ['a@example.com'] }));
    const saveCampaign = vi.fn(async (_c: CampaignRecord) => {});
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1, c2]), findResponders, saveCampaign });

    await refreshReplies(deps);

    const saved = saveCampaign.mock.calls.map(call => call[0]);
    const saved1 = saved.find(s => s.id === '1')!;
    const saved2 = saved.find(s => s.id === '2')!;
    expect(saved1.responded).toEqual(['a@example.com']);
    expect(saved2.responded ?? []).toEqual([]);
  });

  it('opens a separate connection for a campaign on a different account', async () => {
    const c1 = campaign('1', { accountId: 'acct-1' });
    const c2 = campaign('2', { accountId: 'acct-2' });
    const findResponders = vi.fn(async () => emptyResult());
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1, c2]), findResponders });

    const summary = await refreshReplies(deps);

    expect(findResponders).toHaveBeenCalledTimes(2);
    expect(summary.accountsSelected).toBe(2);
    expect(summary.accountsChecked).toBe(2);
  });

  it('adds a newly bounced address to the Do Not Contact list', async () => {
    const c1 = campaign('1', { emails: ['dead@example.com', 'a@example.com'] });
    const findResponders = vi.fn(async () => emptyResult({ bounced: ['dead@example.com'] }));
    const addManyToBlacklistServerSide = vi.fn(async () => {});
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1]), findResponders, addManyToBlacklistServerSide });

    const summary = await refreshReplies(deps);

    expect(addManyToBlacklistServerSide).toHaveBeenCalledWith(['dead@example.com']);
    expect(summary.newlyBounced).toBe(1);
  });

  it('does not re-add an address already recorded as bounced', async () => {
    const c1 = campaign('1', { emails: ['dead@example.com', 'a@example.com'], bounced: ['dead@example.com'] });
    const findResponders = vi.fn(async () => emptyResult({ bounced: ['dead@example.com'] }));
    const addManyToBlacklistServerSide = vi.fn(async () => {});
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1]), findResponders, addManyToBlacklistServerSide });

    await refreshReplies(deps);

    expect(addManyToBlacklistServerSide).not.toHaveBeenCalled();
  });

  it('does not abort the whole run when one account fails — other accounts still get checked', async () => {
    const c1 = campaign('1', { accountId: 'acct-bad', emails: ['a@example.com'] });
    const c2 = campaign('2', { accountId: 'acct-good', emails: ['b@example.com'] });
    const findResponders = vi.fn(async (config: ImapConfig) => {
      if (config.host.includes('bad')) throw new Error('Could not connect to inbox');
      return emptyResult();
    });
    const getAccount = vi.fn(async (id: string) => account({ id, smtpHost: id === 'acct-bad' ? 'smtp.bad-host.com' : 'smtp.zoho.com' }));
    const saveCampaign = vi.fn(async (_c: CampaignRecord) => {});
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1, c2]), findResponders, getAccount, saveCampaign });

    const summary = await refreshReplies(deps);

    expect(summary.accountErrors).toHaveLength(1);
    expect(summary.accountErrors[0].accountId).toBe('acct-bad');
    expect(summary.campaignsUpdated).toBe(1);
    expect(saveCampaign).toHaveBeenCalledTimes(1);
    expect(saveCampaign.mock.calls[0][0].id).toBe('2');
  });

  it('records a per-account error without recording it for others when getAccount is missing', async () => {
    const c1 = campaign('1', { accountId: 'gone' });
    const getAccount = vi.fn(async () => null);
    const findResponders = vi.fn(async () => emptyResult());
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1]), getAccount, findResponders });

    const summary = await refreshReplies(deps);

    expect(findResponders).not.toHaveBeenCalled();
    expect(summary.accountErrors).toEqual([{ accountId: 'gone', error: 'Account no longer available' }]);
  });

  it('skips campaigns older than the reply window entirely, never grouping or checking them', async () => {
    const old = campaign('1', { date: daysAgo(REFRESH_WINDOW_DAYS + 1) });
    const findResponders = vi.fn(async () => emptyResult());
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [old]), findResponders });

    const summary = await refreshReplies(deps);

    expect(findResponders).not.toHaveBeenCalled();
    expect(summary.campaignsSelected).toBe(0);
    expect(summary.accountsChecked).toBe(0);
  });

  it('stops after MAX_ACCOUNTS_PER_RUN accounts and reports stoppedEarly', async () => {
    const campaigns = Array.from({ length: MAX_ACCOUNTS_PER_RUN + 1 }, (_, i) => campaign(`${i}`, { accountId: `acct-${i}` }));
    const findResponders = vi.fn(async () => emptyResult());
    const deps = buildDeps({ listCampaigns: vi.fn(async () => campaigns), findResponders });

    const summary = await refreshReplies(deps);

    expect(findResponders).toHaveBeenCalledTimes(MAX_ACCOUNTS_PER_RUN);
    expect(summary.accountsChecked).toBe(MAX_ACCOUNTS_PER_RUN);
    expect(summary.accountsSelected).toBe(MAX_ACCOUNTS_PER_RUN + 1);
    expect(summary.stoppedEarly).toBe(true);
  });

  it('does not report stoppedEarly when every selected account was reached', async () => {
    const c1 = campaign('1', { accountId: 'acct-1' });
    const findResponders = vi.fn(async () => emptyResult());
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1]), findResponders });

    const summary = await refreshReplies(deps);

    expect(summary.stoppedEarly).toBe(false);
  });

  it('stops early on the cumulative time budget even before the account-count cap is reached', async () => {
    const c1 = campaign('1', { accountId: 'acct-1' });
    const c2 = campaign('2', { accountId: 'acct-2' });
    const findResponders = vi.fn(async () => emptyResult());
    // Sequence: startedAt, iter1 elapsed-check (still within budget), checkedAt
    // for account 1, iter2 elapsed-check (now past the budget) -> stop before a
    // second findResponders call even though only 1 of MAX_ACCOUNTS_PER_RUN (3)
    // accounts has been used.
    const times = [0, 0, 100, MAX_ACCOUNTS_PER_RUN * ACCOUNT_TIME_BUDGET_MS + 1];
    let i = 0;
    const now = () => (i < times.length ? times[i++] : times[times.length - 1]);
    const deps = buildDeps({ listCampaigns: vi.fn(async () => [c1, c2]), findResponders, now });

    const summary = await refreshReplies(deps);

    expect(findResponders).toHaveBeenCalledTimes(1);
    expect(summary.accountsChecked).toBe(1);
    expect(summary.stoppedEarly).toBe(true);
  });

  it('never calls sendMessages-shaped functions — only findResponders, saveCampaign, and blacklist additions', async () => {
    // Regression guard for the core safety requirement: this module must be
    // incapable of sending mail. There is no send function in RefreshRepliesDeps
    // at all, so this just pins the deps shape stays that way.
    const deps = buildDeps();
    expect(Object.keys(deps).sort()).toEqual([
      'addManyToBlacklistServerSide', 'findResponders', 'getAccount', 'listCampaigns', 'now', 'resolveImapConfig', 'saveCampaign',
    ]);
  });
});
