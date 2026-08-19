import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/remoteSync', () => ({
  syncStorage: { setItem: vi.fn(), removeItem: vi.fn() },
}));

import { usePromotionChannel, PromotionChannelConfig } from './usePromotionChannel';
import { MAX_CAMPAIGN_RECIPIENTS } from '@/lib/sendLimits';
import type { Campaign } from '../types';

interface TestTarget { name: string; emails: string[] }

/**
 * template/subject are controlled props (owned by the parent in real usage, see
 * PromotionChannelConfig's doc comment) — this harness owns them the same way
 * page.tsx does, so loadTemplateFromLibrary etc. can be observed across renders.
 */
function useHarness(overrides: Partial<PromotionChannelConfig> & { upsertCampaign: (c: Campaign) => void }) {
  const [template, setTemplate] = useState('Hi {{stationName}}, check out {{trackTitle}}: {{driveLink}}');
  const [subject, setSubject] = useState('Submission: {{trackTitle}}');
  const config: PromotionChannelConfig = {
    campaignType: 'radio',
    genresEndpoint: '/api/radio-genres',
    previewEndpoint: '/api/radio-preview',
    sendEndpoint: '/api/radio-send',
    resultsKey: 'stations',
    secondaryFilterKey: 'locations',
    nameVar: 'stationName',
    trackTitle: 'Track', driveLink: 'https://drive.example.com/x', senderName: 'Sender',
    template, subject, setTemplate, setSubject,
    signOff: '', signOffImage: null, selectedAccountId: 'acct-1', sendDelay: 0, blacklist: [],
    dailySendCap: 0, sendsToday: 0,
    accountCapError: () => null,
    refreshSendsToday: () => {},
    recordFailedEmails: () => {},
    pitchedEmailMap: new Map(),
    lastContactedMap: new Map(),
    // Off by default so existing tests aren't affected by the new cooldown warning —
    // see the 'derived values' describe block below for tests that turn it on.
    contactCooldownDays: 0,
    // Disabled by default so existing tests exercise the same immediate-send
    // behavior as before this feature existed — see the 'send window' describe
    // block below for tests that turn it on.
    sendWindowSettings: { enabled: false, startHour: 9, endHour: 17, timezone: 'UTC' },
    ...overrides,
  };
  return usePromotionChannel<TestTarget>(config);
}

function renderChannel(overrides: Partial<PromotionChannelConfig> = {}) {
  const upsertCampaign = vi.fn();
  return renderHook((props: Partial<PromotionChannelConfig>) => useHarness({ upsertCampaign, ...props }), {
    initialProps: overrides,
  });
}

describe('usePromotionChannel', () => {
  // The hook fetches its own genres list on mount (see usePromotionChannel.ts) —
  // every test needs at least a default response for that, even ones that don't
  // care about genres, or the mount-time effect crashes on an unstubbed fetch.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ genres: [] }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('genre selection', () => {
    it('toggles a genre on and off', () => {
      const { result } = renderChannel();
      act(() => result.current.toggleGenre('Pop'));
      expect(result.current.selectedGenres).toEqual(['Pop']);
      act(() => result.current.toggleGenre('Pop'));
      expect(result.current.selectedGenres).toEqual([]);
    });

    it('resets preview/send state when a genre is toggled', async () => {
      const { result } = renderChannel();
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) })));
      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.previewDone).toBe(true);

      act(() => result.current.toggleGenre('Pop'));
      expect(result.current.previewDone).toBe(false);
    });
  });

  describe('handlePreview', () => {
    it('fetches results and flags invalid emails', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/radio-preview') {
          return { json: async () => ({ stations: [{ name: 'Station A', emails: ['a@example.com', 'bad@nodomain.invalid'] }] }) };
        }
        if (url === '/api/mx-check') {
          return { ok: true, json: async () => ({ malformed: [], noMx: ['bad@nodomain.invalid'] }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderChannel();
      await act(async () => { await result.current.handlePreview(); });

      expect(result.current.previewDone).toBe(true);
      expect(result.current.results).toEqual([{ name: 'Station A', emails: ['a@example.com', 'bad@nodomain.invalid'] }]);
      await waitFor(() => expect(result.current.invalidEmails).toEqual(['bad@nodomain.invalid']));
    });
  });

  describe('handleSend — send-cap enforcement', () => {
    it('blocks the send when the global daily cap would be exceeded, without calling fetch', async () => {
      const { result } = renderChannel({ dailySendCap: 5, sendsToday: 4 });

      // Give it two recipients (> the 1 remaining) via a preview.
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com', 'b@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(sendFetch).not.toHaveBeenCalled();
      expect(result.current.sendError).toMatch(/Daily send limit reached/);
    });

    it('blocks the send when the per-account cap rejects it, without calling fetch', async () => {
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const accountCapError = vi.fn(() => 'This account has reached its daily limit');
      const { result } = renderChannel({ accountCapError });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(accountCapError).toHaveBeenCalledWith('acct-1', 1);
      expect(sendFetch).not.toHaveBeenCalled();
      expect(result.current.sendError).toBe('This account has reached its daily limit');
    });

    it('does not block when under both caps, and proceeds to send', async () => {
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const { result } = renderChannel({ dailySendCap: 100, sendsToday: 0 });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ results: [{ to: 'a@x.com', success: true, messageId: '<m1>' }], total: 1, nextOffset: null }),
      }));
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(sendFetch).toHaveBeenCalled();
      expect(result.current.sendResult).toEqual({ sent: 1, failed: 0, total: 1 });
    });

    it('blocks the send when the matched audience exceeds MAX_CAMPAIGN_RECIPIENTS, naming stations', async () => {
      const stations = Array.from({ length: MAX_CAMPAIGN_RECIPIENTS + 1 }, (_, i) => ({ name: `Station ${i}`, emails: [`station${i}@x.com`] }));
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations }) }));
      vi.stubGlobal('fetch', previewFetch);
      const { result } = renderChannel();
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(sendFetch).not.toHaveBeenCalled();
      expect(result.current.sendError).toContain(String(MAX_CAMPAIGN_RECIPIENTS + 1));
      expect(result.current.sendError).toContain('stations');
    });

    it('blocks the send when the matched audience exceeds MAX_CAMPAIGN_RECIPIENTS, naming curators', async () => {
      const curators = Array.from({ length: MAX_CAMPAIGN_RECIPIENTS + 1 }, (_, i) => ({ name: `Curator ${i}`, emails: [`curator${i}@x.com`] }));
      const previewFetch = vi.fn(async () => ({ json: async () => ({ curators }) }));
      vi.stubGlobal('fetch', previewFetch);
      const { result } = renderChannel({
        campaignType: 'playlists', previewEndpoint: '/api/playlist-preview', resultsKey: 'curators',
        secondaryFilterKey: 'platforms', nameVar: 'curatorName',
      });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(sendFetch).not.toHaveBeenCalled();
      expect(result.current.sendError).toContain('curators');
    });
  });

  describe('handleSend — outcome handling', () => {
    it('records failed recipients and does not refresh the send counter when everything fails', async () => {
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const recordFailedEmails = vi.fn();
      const refreshSendsToday = vi.fn();
      const { result } = renderChannel({ recordFailedEmails, refreshSendsToday });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ results: [{ to: 'a@x.com', success: false, error: 'bounced' }], total: 1, nextOffset: null }),
      }));
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(recordFailedEmails).toHaveBeenCalledWith([{ email: 'a@x.com', permanent: false }]);
      expect(refreshSendsToday).not.toHaveBeenCalled();
      expect(result.current.sendFailedEmails).toEqual(['a@x.com']);
    });

    it('flags a permanently-rejected failure as such to recordFailedEmails, and records it on the campaign\'s bounced list', async () => {
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const upsertCampaign = vi.fn();
      const recordFailedEmails = vi.fn();
      const { result } = renderChannel({ upsertCampaign, recordFailedEmails });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ results: [{ to: 'a@x.com', success: false, permanent: true, error: '550 no such user' }], total: 1, nextOffset: null }),
      }));
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(recordFailedEmails).toHaveBeenCalledWith([{ email: 'a@x.com', permanent: true }]);
      const upserted = upsertCampaign.mock.calls[upsertCampaign.mock.calls.length - 1][0] as Campaign;
      expect(upserted.bounced).toEqual(['a@x.com']);
    });

    it('POSTs the signature image but strips it from the pendingSend payload written to campaign history', async () => {
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const upsertCampaign = vi.fn();
      const { result } = renderChannel({ upsertCampaign, signOffImage: 'data:image/png;base64,AAAA' });
      await act(async () => { await result.current.handlePreview(); });

      // Round 1 reports more work remaining, so a pendingSend gets written; round 2
      // finishes the send.
      let call = 0;
      const sendFetch = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()
        .mockImplementation(async () => {
          call++;
          if (call === 1) return { ok: true, json: async () => ({ results: [{ to: 'a@x.com', success: true }], total: 2, nextOffset: 1 }) };
          return { ok: true, json: async () => ({ results: [], total: 2, nextOffset: null }) };
        });
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      const firstRequestBody = JSON.parse((sendFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(firstRequestBody.signOffImage).toBe('data:image/png;base64,AAAA');

      const firstUpsert = upsertCampaign.mock.calls[0][0] as Campaign;
      expect(firstUpsert.pendingSend).toBeDefined();
      expect('signOffImage' in (firstUpsert.pendingSend?.payload ?? {})).toBe(false);
    });

    it('upserts a campaign record on send progress', async () => {
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const upsertCampaign = vi.fn();
      const { result } = renderChannel({ upsertCampaign });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ results: [{ to: 'a@x.com', success: true, messageId: '<m1>' }], total: 1, nextOffset: null }),
      }));
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(upsertCampaign).toHaveBeenCalledWith(expect.objectContaining({
        type: 'radio', trackTitle: 'Track', emails: ['a@x.com'], accountId: 'acct-1',
      }));
    });

    it('does nothing when trackTitle or driveLink is missing', async () => {
      const { result } = renderChannel({ trackTitle: '' });
      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });
      expect(sendFetch).not.toHaveBeenCalled();
    });
  });

  describe('send window', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('queues instead of sending when "now" falls outside the window, and never touches the send endpoint', async () => {
      vi.setSystemTime(Date.UTC(2026, 0, 1, 3, 0, 0)); // 3am UTC, outside a 9-17 window
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const upsertCampaign = vi.fn();
      const sendWindowSettings = { enabled: true, startHour: 9, endHour: 17, timezone: 'UTC' };
      const { result } = renderChannel({ upsertCampaign, sendWindowSettings });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(sendFetch).not.toHaveBeenCalled();
      const queued = upsertCampaign.mock.calls[0][0] as Campaign;
      expect(queued.emails).toEqual([]);
      expect(queued.pendingSend).toBeDefined();
      expect(queued.scheduledFor).toBe(Date.UTC(2026, 0, 1, 9, 0, 0));
      expect(result.current.sending).toBe(false);
    });

    it('sends immediately when "now" already falls inside the window', async () => {
      vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 0, 0)); // noon UTC, inside a 9-17 window
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const sendWindowSettings = { enabled: true, startHour: 9, endHour: 17, timezone: 'UTC' };
      const { result } = renderChannel({ sendWindowSettings });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn(async () => ({
        ok: true, json: async () => ({ results: [{ to: 'a@x.com', success: true }], total: 1, nextOffset: null }),
      }));
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(sendFetch).toHaveBeenCalled();
    });
  });

  describe('presets', () => {
    it('saves, loads, and deletes a filter preset', () => {
      const { result } = renderChannel();
      act(() => {
        result.current.toggleGenre('Pop');
        result.current.setSelectedSecondary(['NSW']);
        result.current.setMatchMode('all');
      });
      act(() => result.current.setNewPresetName('My Preset'));
      act(() => result.current.savePreset());

      expect(result.current.presets).toHaveLength(1);
      const preset = result.current.presets[0];
      expect(preset.name).toBe('My Preset');
      expect(preset.genres).toEqual(['Pop']);
      expect(preset.locations).toEqual(['NSW']);
      expect(preset.matchMode).toBe('all');
      expect(result.current.newPresetName).toBe('');

      act(() => {
        result.current.setSelectedGenres([]);
        result.current.setSelectedSecondary([]);
        result.current.setMatchMode('any');
      });
      act(() => result.current.loadPreset(preset));
      expect(result.current.selectedGenres).toEqual(['Pop']);
      expect(result.current.selectedSecondary).toEqual(['NSW']);
      expect(result.current.matchMode).toBe('all');

      act(() => result.current.deletePreset(preset.id));
      expect(result.current.presets).toEqual([]);
    });

    it('does not save a preset with a blank name', () => {
      const { result } = renderChannel();
      act(() => result.current.savePreset());
      expect(result.current.presets).toEqual([]);
    });
  });

  describe('template library', () => {
    it('saves the current template/subject, then loads it back into the controlled fields', () => {
      const { result } = renderChannel();
      act(() => result.current.setNewTemplateName('Indie Stations'));
      act(() => result.current.saveTemplateToLibrary());

      expect(result.current.templateLibrary).toHaveLength(1);
      const saved = result.current.templateLibrary[0];
      expect(saved.name).toBe('Indie Stations');
      expect(saved.body).toBe(result.current.template);

      act(() => result.current.setTemplate('changed'));
      expect(result.current.template).toBe('changed');

      act(() => result.current.loadTemplateFromLibrary(saved));
      expect(result.current.template).toBe(saved.body);
      expect(result.current.subject).toBe(saved.subject);

      act(() => result.current.deleteTemplateFromLibrary(saved.id));
      expect(result.current.templateLibrary).toEqual([]);
    });
  });

  describe('derived values', () => {
    it('canSend requires a track title, drive link, and a completed preview', async () => {
      const { result } = renderChannel({ trackTitle: '' });
      expect(result.current.canSend).toBe(false);
    });

    it('flags duplicate recipients already pitched this track', async () => {
      const pitchedEmailMap = new Map([['a@x.com', ['Track']]]);
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com', 'b@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const { result } = renderChannel({ pitchedEmailMap });
      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.duplicateRecipients).toEqual(['a@x.com']);
    });

    it('excludes a blacklisted recipient from totalEmails and reports it as excludedByBlacklist', async () => {
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com', 'b@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const { result } = renderChannel({ blacklist: ['a@x.com'] });
      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.totalEmails).toBe(1);
      expect(result.current.excludedByBlacklist).toBe(1);
    });

    it('flags recipients contacted recently under a different track', async () => {
      const lastContactedMap = new Map([['a@x.com', Date.now() - 5 * 24 * 60 * 60 * 1000]]);
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com', 'b@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const { result } = renderChannel({ lastContactedMap, contactCooldownDays: 30 });
      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.cooldownRecipients).toEqual(['a@x.com']);
    });

    it('does not flag anyone when contactCooldownDays is 0 (disabled)', async () => {
      const lastContactedMap = new Map([['a@x.com', Date.now()]]);
      const previewFetch = vi.fn(async () => ({ json: async () => ({ stations: [{ name: 'S', emails: ['a@x.com'] }] }) }));
      vi.stubGlobal('fetch', previewFetch);
      const { result } = renderChannel({ lastContactedMap, contactCooldownDays: 0 });
      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.cooldownRecipients).toEqual([]);
    });
  });
});
