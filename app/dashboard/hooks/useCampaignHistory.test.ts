import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const downloadCsv = vi.hoisted(() => vi.fn());
vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return { ...actual, downloadCsv };
});

import { useCampaignHistory } from './useCampaignHistory';
import { assignSubjectVariant } from '@/lib/recipients';
import type { Campaign, EmailAccount, CustomContact } from '../types';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return { id: '1', trackTitle: 'Track', date: '2026-01-01T00:00:00.000Z', type: 'demos', emails: ['a@example.com'], ...overrides };
}

function renderHistory(overrides: { emailAccounts?: EmailAccount[]; customContacts?: CustomContact[]; addFailedToBlacklist?: (e: string[]) => void; refreshSendsToday?: () => void; signOffImage?: string | null; signOff?: string; sendDelay?: number } = {}) {
  const addFailedToBlacklist = vi.fn();
  const refreshSendsToday = vi.fn();
  const hook = renderHook(() => useCampaignHistory({
    emailAccounts: [], customContacts: [], addFailedToBlacklist, refreshSendsToday, signOffImage: null, signOff: '', sendDelay: 0, ...overrides,
  }));
  return { ...hook, mocks: { addFailedToBlacklist, refreshSendsToday } };
}

describe('useCampaignHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('mount', () => {
    it('fetches campaign history on mount', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [campaign()] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([campaign()]));
    });
  });

  describe('upsertCampaign', () => {
    it('adds a new campaign and posts it to the server', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      const postFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal('fetch', postFetch);
      act(() => result.current.upsertCampaign(campaign()));

      expect(result.current.campaigns).toEqual([campaign()]);
      expect(postFetch).toHaveBeenCalledWith('/api/campaigns', expect.objectContaining({ method: 'POST' }));
    });

    it('updates an existing campaign in place rather than duplicating it', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [campaign()] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toHaveLength(1));

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
      act(() => result.current.upsertCampaign(campaign({ responded: ['a@example.com'] })));

      expect(result.current.campaigns).toHaveLength(1);
      expect(result.current.campaigns[0].responded).toEqual(['a@example.com']);
    });
  });

  describe('clearCampaignHistory', () => {
    it('clears local state and tells the server to delete everything', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [campaign()] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toHaveLength(1));

      const deleteFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal('fetch', deleteFetch);
      act(() => result.current.clearCampaignHistory());

      expect(result.current.campaigns).toEqual([]);
      expect(deleteFetch).toHaveBeenCalledWith('/api/campaigns?all=true', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  describe('exportCampaignsCsv', () => {
    it('builds a CSV with a header row and one row per campaign', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      act(() => result.current.exportCampaignsCsv([campaign({ emails: ['a@x.com', 'b@x.com'] })]));

      expect(downloadCsv).toHaveBeenCalledWith('campaign-history.csv', expect.arrayContaining([
        ['Date', 'Type', 'Track', 'Recipients', 'Emails'],
      ]));
      const rows = downloadCsv.mock.calls[0][1] as string[][];
      expect(rows[1][2]).toBe('Track');
      expect(rows[1][3]).toBe('2');
    });
  });

  describe('threadIdsFor', () => {
    it('collects Message-IDs from prior campaigns of the same type and track', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        json: async () => ({
          campaigns: [
            campaign({ id: '1', type: 'demos', trackTitle: 'My Track', messageIds: { 'a@x.com': '<m1>' } }),
            campaign({ id: '2', type: 'demos', trackTitle: 'Other Track', messageIds: { 'b@x.com': '<m2>' } }),
            campaign({ id: '3', type: 'radio', trackTitle: 'My Track', messageIds: { 'c@x.com': '<m3>' } }),
          ],
        }),
      })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toHaveLength(3));

      expect(result.current.threadIdsFor('demos', '  My Track  ')).toEqual({ 'a@x.com': '<m1>' });
    });
  });

  describe('filteredCampaigns', () => {
    it('filters by type, title search, and date range together', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        json: async () => ({
          campaigns: [
            campaign({ id: '1', type: 'demos', trackTitle: 'Alpha', date: '2026-01-01T00:00:00.000Z' }),
            campaign({ id: '2', type: 'radio', trackTitle: 'Alpha', date: '2026-01-05T00:00:00.000Z' }),
            campaign({ id: '3', type: 'demos', trackTitle: 'Beta', date: '2026-02-01T00:00:00.000Z' }),
          ],
        }),
      })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toHaveLength(3));

      act(() => result.current.setHistoryTypeFilter('demos'));
      expect(result.current.filteredCampaigns.map(c => c.id)).toEqual(['1', '3']);

      act(() => result.current.setHistorySearch('alpha'));
      expect(result.current.filteredCampaigns.map(c => c.id)).toEqual(['1']);

      act(() => { result.current.setHistorySearch(''); result.current.setHistoryDateFrom('2026-01-15'); });
      expect(result.current.filteredCampaigns.map(c => c.id)).toEqual(['3']);
    });
  });

  describe('demosSendoutGroups', () => {
    it('groups only Demos campaigns by track title, in send order', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        json: async () => ({
          campaigns: [
            campaign({ id: '1', type: 'demos', trackTitle: 'Track', date: '2026-01-01T00:00:00.000Z' }),
            campaign({ id: '2', type: 'radio', trackTitle: 'Track', date: '2026-01-02T00:00:00.000Z' }),
            campaign({ id: '3', type: 'demos', trackTitle: 'Track', date: '2026-01-03T00:00:00.000Z' }),
          ],
        }),
      })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toHaveLength(3));

      const group = result.current.demosSendoutGroups.get('track');
      expect(group?.map(c => c.id)).toEqual(['1', '3']);
    });
  });

  describe('checkReplies', () => {
    it('errors immediately when the sending account is no longer available', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory({ emailAccounts: [] });
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      await act(async () => { await result.current.checkReplies(campaign({ accountId: 'missing' })); });
      expect(result.current.replyCheckError).toMatch(/no longer available/);
    });

    it('merges new replies/bounces, auto-blacklists bounced addresses, and upserts the campaign', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result, mocks } = renderHistory({ emailAccounts: [{ id: 'acct-1', name: 'A', email: 'a@x.com', smtpHost: '', smtpPort: '465', smtpUser: '' }] });
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ responded: ['a@example.com'], bounced: ['dead@example.com'], classifications: { 'a@example.com': 'interested' } }),
      })));
      const c = campaign({ accountId: 'acct-1', emails: ['a@example.com', 'dead@example.com'] });
      await act(async () => { await result.current.checkReplies(c); });

      expect(mocks.addFailedToBlacklist).toHaveBeenCalledWith(['dead@example.com']);
      expect(result.current.replyCheckResult).toEqual({ campaignId: '1', newCount: 1, totalCount: 1, newBounceCount: 1 });
      expect(result.current.campaigns[0].bounced).toEqual(['dead@example.com']);
    });

    it('surfaces a server error without upserting', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory({ emailAccounts: [{ id: 'acct-1', name: 'A', email: 'a@x.com', smtpHost: '', smtpPort: '465', smtpUser: '' }] });
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'IMAP login failed.' }) })));
      await act(async () => { await result.current.checkReplies(campaign({ accountId: 'acct-1' })); });

      expect(result.current.replyCheckError).toBe('IMAP login failed.');
      expect(result.current.campaigns).toEqual([]);
    });
  });

  describe('backfillRecipients', () => {
    it('fills in recipient names from a custom contact when the API returns none', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const customContacts: CustomContact[] = [{ id: '1', artistName: 'Indie Act', managerName: 'Sam', managerEmail: 'a@example.com' }];
      const { result } = renderHistory({ customContacts });
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ recipients: [{ email: 'a@example.com', artistName: '', managerName: '', avatarUrl: '', genres: [], instagramHandle: '', spotifyFollowers: 0 }] }),
      })));
      await act(async () => { await result.current.backfillRecipients(campaign()); });

      expect(result.current.campaigns[0].recipients?.[0]).toMatchObject({ artistName: 'Indie Act', managerName: 'Sam' });
    });

    it('surfaces an error when the request fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Roster unavailable.' }) })));
      await act(async () => { await result.current.backfillRecipients(campaign()); });
      expect(result.current.backfillError).toBe('Roster unavailable.');
    });
  });

  describe('resumeSend', () => {
    it('does nothing when the campaign has no pending send', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.resumeSend(campaign()); });
      expect(sendFetch).not.toHaveBeenCalled();
    });

    it('resumes by excluding addresses already recorded as sent, and refreshes the send counter on success', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result, mocks } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      const sendFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.offset).toBe(0);
        expect(body.excludeEmails).toEqual(['a@example.com']);
        return { ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true, messageId: '<m1>' }], total: 1, nextOffset: null }) };
      });
      vi.stubGlobal('fetch', sendFetch);

      // c.emails ('a@example.com') is what a pre-existing record already has to go
      // on — no offset survives an interruption any more, so resume derives its
      // exclusion set from there instead.
      const pending = campaign({
        emails: ['a@example.com'],
        pendingSend: { endpoint: '/api/send', payload: {} },
      });
      await act(async () => { await result.current.resumeSend(pending); });

      expect(mocks.refreshSendsToday).toHaveBeenCalled();
      expect(result.current.campaigns[0].pendingSend).toBeUndefined();
      expect(result.current.campaigns[0].messageIds).toEqual({ 'b@example.com': '<m1>' });
    });

    it('injects the current signature image into the resumed send, even though pendingSend.payload never carries one', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory({ signOffImage: 'data:image/png;base64,CURRENT' });
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      const sendFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.signOffImage).toBe('data:image/png;base64,CURRENT');
        expect(body.trackTitle).toBe('Track');
        return { ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true }], total: 1, nextOffset: null }) };
      });
      vi.stubGlobal('fetch', sendFetch);

      const pending = campaign({
        emails: ['a@example.com'],
        pendingSend: { endpoint: '/api/send', payload: { trackTitle: 'Track' } },
      });
      await act(async () => { await result.current.resumeSend(pending); });
      expect(sendFetch).toHaveBeenCalled();
    });

    it('omits signOffImage from the resumed request entirely when there is no current image', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory({ signOffImage: null });
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      const sendFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse((init as RequestInit).body as string);
        // JSON.stringify drops keys whose value is undefined, so an absent signature
        // must mean the key itself is gone — not present-but-null.
        expect('signOffImage' in body).toBe(false);
        return { ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true }], total: 1, nextOffset: null }) };
      });
      vi.stubGlobal('fetch', sendFetch);

      const pending = campaign({
        emails: ['a@example.com'],
        pendingSend: { endpoint: '/api/send', payload: { trackTitle: 'Track' } },
      });
      await act(async () => { await result.current.resumeSend(pending); });
      expect(sendFetch).toHaveBeenCalled();
    });

    it('overrides a legacy record\'s embedded signOffImage with the current setting rather than resending the stale one', async () => {
      // Simulates a CampaignRecord written before this change, whose pendingSend.payload
      // still has the full base64 image baked in from the original send.
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory({ signOffImage: 'data:image/png;base64,CURRENT' });
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      const sendFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.signOffImage).toBe('data:image/png;base64,CURRENT');
        return { ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true }], total: 1, nextOffset: null }) };
      });
      vi.stubGlobal('fetch', sendFetch);

      const pending = campaign({
        emails: ['a@example.com'],
        pendingSend: { endpoint: '/api/send', payload: { trackTitle: 'Track', signOffImage: 'data:image/png;base64,STALE' } },
      });
      await act(async () => { await result.current.resumeSend(pending); });
      expect(sendFetch).toHaveBeenCalled();
      // Resolved, so no pendingSend is left around carrying the stale image forward.
      expect(result.current.campaigns[0].pendingSend).toBeUndefined();
    });

    it('still works from an old-shaped pendingSend record left over from before the offset field was dropped', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      const sendFetch = vi.fn(async () => ({
        ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true }], total: 1, nextOffset: null }),
      }));
      vi.stubGlobal('fetch', sendFetch);

      // Simulates a CampaignRecord fetched from Redis before this change shipped —
      // pendingSend still carries a leftover `offset`. resumeSend never reads it, so
      // it's harmless.
      const pending = campaign({
        emails: ['a@example.com'],
        pendingSend: { endpoint: '/api/send', payload: {}, offset: 5 } as unknown as Campaign['pendingSend'],
      });
      await act(async () => { await result.current.resumeSend(pending); });

      expect(result.current.campaigns[0].pendingSend).toBeUndefined();
    });

    it('merges newly-sent addresses into subjectVariants when the original send ran a subject test', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      const sendFetch = vi.fn(async () => ({
        ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true }], total: 1, nextOffset: null }),
      }));
      vi.stubGlobal('fetch', sendFetch);

      const pending = campaign({
        emails: ['a@example.com'],
        subjectA: 'Subject A', subjectB: 'Subject B',
        subjectVariants: { 'a@example.com': assignSubjectVariant('a@example.com') },
        pendingSend: { endpoint: '/api/send', payload: { subjectTemplate: 'Subject A', subjectTemplateB: 'Subject B' } },
      });
      await act(async () => { await result.current.resumeSend(pending); });

      // The newly-sent recipient from this resume gets the exact same variant
      // assignSubjectVariant would give them anywhere else — a resume can't move
      // anyone between variants, only add whoever's newly sent to the map.
      expect(result.current.campaigns[0].subjectVariants).toEqual({
        'a@example.com': assignSubjectVariant('a@example.com'),
        'b@example.com': assignSubjectVariant('b@example.com'),
      });
    });

    it('leaves subjectVariants untouched for a campaign that never ran a subject test', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toEqual([]));

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true }], total: 1, nextOffset: null }),
      })));

      const pending = campaign({ emails: ['a@example.com'], pendingSend: { endpoint: '/api/send', payload: {} } });
      await act(async () => { await result.current.resumeSend(pending); });

      expect(result.current.campaigns[0].subjectVariants).toBeUndefined();
    });
  });

  describe('send-window queue draining', () => {
    it('drains a queued campaign the instant it loads, when its scheduledFor has already passed', async () => {
      const queued = campaign({
        id: 'q1', emails: [], scheduledFor: Date.now() - 1000,
        pendingSend: { endpoint: '/api/send', payload: {} },
      });
      // One mock handles both the initial campaigns load and the drain's own
      // send request — the drain effect fires the instant `campaigns` state
      // updates (i.e. as soon as the load resolves), which is too fast to swap
      // in a second mock afterwards without racing it.
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/campaigns') return { json: async () => ({ campaigns: [queued] }) };
        if (url === '/api/send') return { ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true }], total: 1, nextOffset: null }) };
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHistory();

      await waitFor(() => expect(result.current.campaigns[0]?.emails).toEqual(['b@example.com']));
      // Drained via the same resumeSend machinery an interrupted send uses —
      // pendingSend is cleared the same way once nothing's left to send.
      expect(result.current.campaigns[0].pendingSend).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith('/api/send', expect.anything());
    });

    it('does not drain a queued campaign whose scheduledFor is still in the future', async () => {
      const queued = campaign({
        id: 'q1', emails: [], scheduledFor: Date.now() + 60 * 60 * 1000,
        pendingSend: { endpoint: '/api/send', payload: {} },
      });
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [queued] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toHaveLength(1));

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      // Give any (incorrect) immediate drain a chance to fire before asserting it didn't.
      await act(async () => { await Promise.resolve(); });
      expect(sendFetch).not.toHaveBeenCalled();
    });

    it('does not auto-drain an interrupted (already partially sent) campaign — only "resume" applies to those', async () => {
      const interrupted = campaign({
        id: 'q1', emails: ['a@example.com'], scheduledFor: Date.now() - 1000,
        pendingSend: { endpoint: '/api/send', payload: {} },
      });
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [interrupted] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toHaveLength(1));

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await Promise.resolve(); });
      expect(sendFetch).not.toHaveBeenCalled();
    });

    it('eventually picks up a still-future queued campaign once the periodic check catches up to its scheduledFor', async () => {
      vi.useFakeTimers();
      try {
        const queued = campaign({
          id: 'q1', emails: [], scheduledFor: Date.now() + 30_000,
          pendingSend: { endpoint: '/api/send', payload: {} },
        });
        vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [queued] }) })));
        const { result } = renderHistory();
        // Flushes the initial campaigns fetch and its immediate (finds-nothing-due-yet) drain check.
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(result.current.campaigns).toHaveLength(1);

        const sendFetch = vi.fn(async () => ({
          ok: true, json: async () => ({ results: [{ to: 'b@example.com', success: true }], total: 1, nextOffset: null }),
        }));
        vi.stubGlobal('fetch', sendFetch);

        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(sendFetch).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('cancelQueuedSend', () => {
    it('removes a queued campaign locally and tells the server to delete it outright', async () => {
      const queued = campaign({
        id: 'q1', emails: [], scheduledFor: Date.now() + 60 * 60 * 1000,
        pendingSend: { endpoint: '/api/send', payload: {} },
      });
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ campaigns: [queued] }) })));
      const { result } = renderHistory();
      await waitFor(() => expect(result.current.campaigns).toHaveLength(1));

      const deleteFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal('fetch', deleteFetch);
      act(() => result.current.cancelQueuedSend(queued));

      expect(result.current.campaigns).toEqual([]);
      expect(deleteFetch).toHaveBeenCalledWith('/api/campaigns?id=q1', expect.objectContaining({ method: 'DELETE' }));
    });
  });
});
