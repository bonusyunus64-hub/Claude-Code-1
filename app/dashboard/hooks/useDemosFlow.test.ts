import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/remoteSync', () => ({
  syncStorage: { setItem: vi.fn(), removeItem: vi.fn() },
}));

import { useDemosFlow, DemosFlowConfig } from './useDemosFlow';
import type { Artist, Campaign, CustomContact } from '../types';

function artist(overrides: Partial<Artist> = {}): Artist {
  return {
    name: 'Nova', genres: ['Pop'], spotifyFollowers: 10_000, managementCompany: '',
    managerNames: ['Sam'], managerEmails: ['sam@example.com'], labels: '',
    instagramHandle: '', avatarUrl: '', gender: '', type: 'Person',
    ...overrides,
  };
}

/** template/subject pairs are controlled props owned by the parent in real usage — this
 *  harness owns them the same way page.tsx does, so loadTemplateFromLibrary etc. round-trip. */
function useHarness(overrides: Partial<DemosFlowConfig> & { upsertCampaign: (c: Campaign) => void }) {
  const [demosTemplate, setDemosTemplate] = useState('Hi {{managerName}}, check out {{trackTitle}}: {{driveLink}}');
  const [demosSubject, setDemosSubject] = useState('Submission: {{trackTitle}}');
  const [demosFollowUpTemplate, setDemosFollowUpTemplate] = useState('Following up on {{trackTitle}}');
  const [demosFollowUpSubject, setDemosFollowUpSubject] = useState('Following Up: {{trackTitle}}');
  const config: DemosFlowConfig = {
    trackTitle: 'Track', driveLink: 'https://drive.example.com/x', senderName: 'Sender',
    demosTemplate, demosSubject, setDemosTemplate, setDemosSubject,
    demosFollowUpTemplate, demosFollowUpSubject, setDemosFollowUpTemplate, setDemosFollowUpSubject,
    signOff: '', signOffImage: null, selectedAccountId: 'acct-1', sendDelay: 0, blacklist: [],
    dailySendCap: 0, sendsToday: 0,
    accountCapError: () => null,
    refreshSendsToday: () => {},
    recordFailedEmails: () => {},
    pitchedEmailMap: new Map(),
    threadIdsFor: () => ({}),
    customContacts: [],
    ...overrides,
  };
  return useDemosFlow(config);
}

function renderDemos(overrides: Partial<DemosFlowConfig> = {}) {
  const upsertCampaign = vi.fn();
  return renderHook((props: Partial<DemosFlowConfig>) => useHarness({ upsertCampaign, ...props }), {
    initialProps: overrides,
  });
}

describe('useDemosFlow', () => {
  // The hook fetches its own genres list on mount — stub a harmless default so
  // every test's initial render doesn't crash on an unstubbed fetch.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ genres: [], topGenres: [] }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('genre selection', () => {
    it('toggles a genre on and off, resetting preview state', async () => {
      const { result } = renderDemos();
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist()] }) })));
      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.previewDone).toBe(true);

      act(() => result.current.toggleGenre('Pop'));
      expect(result.current.selectedGenres).toEqual(['Pop']);
      expect(result.current.previewDone).toBe(false);

      act(() => result.current.toggleGenre('Pop'));
      expect(result.current.selectedGenres).toEqual([]);
    });
  });

  describe('handlePreview', () => {
    it('loads artists, clears exclusions, and flags invalid emails', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/genres') return { ok: true, json: async () => ({ genres: [], topGenres: [] }) };
        if (url === '/api/preview') return { json: async () => ({ artists: [artist({ name: 'Nova' }), artist({ name: 'Rock Band', managerEmails: ['bad@nodomain.invalid'] })] }) };
        if (url === '/api/mx-check') return { ok: true, json: async () => ({ malformed: [], noMx: ['bad@nodomain.invalid'] }) };
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderDemos();
      act(() => result.current.setExcludedArtistNames(new Set(['Nova'])));
      await act(async () => { await result.current.handlePreview(); });

      expect(result.current.previewArtists.map(a => a.name)).toEqual(['Nova', 'Rock Band']);
      expect(result.current.excludedArtistNames.size).toBe(0);
      await waitFor(() => expect(result.current.demosInvalidEmails).toEqual(['bad@nodomain.invalid']));
    });
  });

  describe('toggleGenreFromPreview', () => {
    it('adds the genre, switches match mode to "all", and re-runs preview', async () => {
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ json: () => Promise<unknown> }>>()
        .mockImplementation(async () => ({ json: async () => ({ artists: [artist()] }) }));
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderDemos();

      await act(async () => { result.current.toggleGenreFromPreview('Indie'); });

      expect(result.current.selectedGenres).toEqual(['Indie']);
      expect(result.current.demosMatchMode).toBe('all');
      const previewCall = fetchMock.mock.calls.find(([url]) => url === '/api/preview');
      expect(previewCall).toBeDefined();
      const body = JSON.parse((previewCall![1] as RequestInit).body as string);
      expect(body.genres).toEqual(['Indie']);
      expect(body.matchMode).toBe('all');
    });

    it('does not force match mode to "all" when removing a genre', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [] }) })));
      const { result } = renderDemos();
      act(() => result.current.setSelectedGenres(['Indie', 'Pop']));
      act(() => result.current.setDemosMatchMode('all'));

      await act(async () => { result.current.toggleGenreFromPreview('Indie'); });
      expect(result.current.selectedGenres).toEqual(['Pop']);
    });
  });

  describe('artist exclusion', () => {
    it('toggles an artist in and out of the excluded set', () => {
      const { result } = renderDemos();
      act(() => result.current.toggleArtistExclusion('Nova'));
      expect(result.current.excludedArtistNames.has('Nova')).toBe(true);
      act(() => result.current.toggleArtistExclusion('Nova'));
      expect(result.current.excludedArtistNames.has('Nova')).toBe(false);
    });

    it('excludes an artist from includedArtists/totalEmails without removing it from previewArtists', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist({ name: 'Nova' }), artist({ name: 'Rock Band', managerEmails: ['jamie@example.com'] })] }) })));
      const { result } = renderDemos();
      await act(async () => { await result.current.handlePreview(); });
      act(() => result.current.toggleArtistExclusion('Nova'));

      expect(result.current.previewArtists).toHaveLength(2);
      expect(result.current.includedArtists.map(a => a.name)).toEqual(['Rock Band']);
      expect(result.current.totalEmails).toBe(1);
    });
  });

  describe('derived send eligibility', () => {
    it('canSend requires a completed preview when genres are selected', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist()] }) })));
      const { result } = renderDemos();
      act(() => result.current.setSelectedGenres(['Pop']));
      expect(result.current.canSend).toBe(false);

      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.canSend).toBe(true);
    });

    it('canSend is true from custom contacts alone, with no genres selected', () => {
      const customContacts: CustomContact[] = [{ id: '1', artistName: 'Indie Act', managerName: 'Sam', managerEmail: 'sam@x.com' }];
      const { result } = renderDemos({ customContacts });
      expect(result.current.canSend).toBe(true);
      expect(result.current.totalEmails).toBe(1);
    });

    it('flags recipients already pitched this track, across both artists and custom contacts', async () => {
      const pitchedEmailMap = new Map([['sam@example.com', ['Track']], ['manager@x.com', ['Track']]]);
      const customContacts: CustomContact[] = [{ id: '1', artistName: 'Indie Act', managerName: 'M', managerEmail: 'manager@x.com' }];
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist()] }) })));
      const { result } = renderDemos({ pitchedEmailMap, customContacts });
      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.demosDuplicateRecipients.sort()).toEqual(['manager@x.com', 'sam@example.com']);
    });
  });

  describe('handleSend — send-cap enforcement', () => {
    it('blocks the send when the global daily cap would be exceeded, without calling fetch', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist(), artist({ name: 'B', managerEmails: ['b@x.com'] })] }) })));
      const { result } = renderDemos({ dailySendCap: 1, sendsToday: 1 });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(sendFetch).not.toHaveBeenCalled();
      expect(result.current.sendError).toMatch(/Daily send limit reached/);
    });

    it('blocks the send when the per-account cap rejects it, without calling fetch', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist()] }) })));
      const accountCapError = vi.fn(() => 'This account has reached its daily limit');
      const { result } = renderDemos({ accountCapError });
      await act(async () => { await result.current.handlePreview(); });

      const sendFetch = vi.fn();
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      expect(accountCapError).toHaveBeenCalledWith('acct-1', 1);
      expect(sendFetch).not.toHaveBeenCalled();
    });
  });

  describe('handleSend — outcome handling', () => {
    it('sends the initial-pitch template by default, and the follow-up template + threadIds when useFollowUp is on', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist()] }) })));
      const threadIdsFor = vi.fn(() => ({ 'sam@example.com': '<original@mail>' }));
      const { result } = renderDemos({ threadIdsFor });
      await act(async () => { await result.current.handlePreview(); });
      act(() => result.current.setUseFollowUp(true));

      const sendFetch = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()
        .mockImplementation(async () => ({ ok: true, json: async () => ({ results: [{ to: 'sam@example.com', success: true }], total: 1, nextOffset: null }) }));
      vi.stubGlobal('fetch', sendFetch);
      await act(async () => { await result.current.handleSend(); });

      const [, init] = sendFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.emailTemplate).toBe(result.current.demosFollowUpTemplate);
      expect(body.threadIds).toEqual({ 'sam@example.com': '<original@mail>' });
      expect(threadIdsFor).toHaveBeenCalledWith('demos', 'Track');
    });

    it('POSTs the signature image but strips it from the pendingSend payload written to campaign history', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist()] }) })));
      const upsertCampaign = vi.fn();
      const { result } = renderDemos({ upsertCampaign, signOffImage: 'data:image/png;base64,AAAA' });
      await act(async () => { await result.current.handlePreview(); });

      // Round 1 reports more work remaining, so a pendingSend gets written; round 2
      // finishes the send.
      let call = 0;
      const sendFetch = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()
        .mockImplementation(async () => {
          call++;
          if (call === 1) return { ok: true, json: async () => ({ results: [{ to: 'sam@example.com', success: true }], total: 2, nextOffset: 1 }) };
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

    it('upserts a demos campaign record and records any failed recipients', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ artists: [artist()] }) })));
      const upsertCampaign = vi.fn();
      const recordFailedEmails = vi.fn();
      const { result } = renderDemos({ upsertCampaign, recordFailedEmails });
      await act(async () => { await result.current.handlePreview(); });

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ results: [{ to: 'sam@example.com', success: false, error: 'bounced' }], total: 1, nextOffset: null }),
      })));
      await act(async () => { await result.current.handleSend(); });

      expect(upsertCampaign).toHaveBeenCalledWith(expect.objectContaining({ type: 'demos', trackTitle: 'Track' }));
      expect(recordFailedEmails).toHaveBeenCalledWith(['sam@example.com']);
    });
  });

  describe('sortedArtists / visibleArtists', () => {
    it('sorts by descending Spotify followers by default', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        json: async () => ({ artists: [artist({ name: 'Small', spotifyFollowers: 100 }), artist({ name: 'Big', spotifyFollowers: 100_000 })] }),
      })));
      const { result } = renderDemos();
      await act(async () => { await result.current.handlePreview(); });
      expect(result.current.sortedArtists.map(a => a.name)).toEqual(['Big', 'Small']);
    });

    it('filters visibleArtists by the recipient search term', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        json: async () => ({ artists: [artist({ name: 'Nova' }), artist({ name: 'Rock Band', managerEmails: ['jamie@example.com'] })] }),
      })));
      const { result } = renderDemos();
      await act(async () => { await result.current.handlePreview(); });
      act(() => result.current.setRecipientSearch('rock'));
      expect(result.current.visibleArtists.map(a => a.name)).toEqual(['Rock Band']);
    });
  });

  describe('handleOutsideSearch', () => {
    it('populates outside search results', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) =>
        url === '/api/artist-search'
          ? { json: async () => ({ artists: [artist({ name: 'Found Artist' })] }) }
          : { json: async () => ({ genres: [], topGenres: [] }) }
      ));
      const { result } = renderDemos();
      await act(async () => { await result.current.handleOutsideSearch('nova'); });
      expect(result.current.outsideResults.map(a => a.name)).toEqual(['Found Artist']);
      expect(result.current.outsideResultsQuery).toBe('nova');
    });
  });

  describe('presets', () => {
    it('saves, loads, and deletes a filter preset', () => {
      const { result } = renderDemos();
      act(() => {
        result.current.setSelectedGenres(['Pop']);
        result.current.setMinAudience(1000);
        result.current.setGender('FEMALE');
      });
      act(() => result.current.setNewDemosPresetName('My Preset'));
      act(() => result.current.saveDemosPreset());

      expect(result.current.demosPresets).toHaveLength(1);
      const preset = result.current.demosPresets[0];
      expect(preset.genres).toEqual(['Pop']);
      expect(preset.minAudience).toBe(1000);

      act(() => { result.current.setSelectedGenres([]); result.current.setMinAudience(0); });
      act(() => result.current.loadDemosPreset(preset));
      expect(result.current.selectedGenres).toEqual(['Pop']);
      expect(result.current.minAudience).toBe(1000);
      expect(result.current.gender).toBe('FEMALE');

      act(() => result.current.deleteDemosPreset(preset.id));
      expect(result.current.demosPresets).toEqual([]);
    });
  });

  describe('template libraries', () => {
    it('the initial-pitch library saves/loads independently of the follow-up library', () => {
      const { result } = renderDemos();
      act(() => result.current.setNewDemosTemplateName('Pitch A'));
      act(() => result.current.saveDemosTemplateToLibrary());
      act(() => result.current.setNewFollowUpTemplateName('Follow-up A'));
      act(() => result.current.saveFollowUpTemplateToLibrary());

      expect(result.current.demosTemplateLibrary).toHaveLength(1);
      expect(result.current.followUpTemplateLibrary).toHaveLength(1);

      const savedPitch = result.current.demosTemplateLibrary[0];
      act(() => result.current.setDemosTemplate('changed'));
      act(() => result.current.loadDemosTemplateFromLibrary(savedPitch));
      expect(result.current.demosTemplate).toBe(savedPitch.body);
      // Loading the initial-pitch template must not touch the follow-up pair.
      expect(result.current.followUpTemplateLibrary).toHaveLength(1);

      act(() => result.current.deleteDemosTemplateFromLibrary(savedPitch.id));
      act(() => result.current.deleteFollowUpTemplateFromLibrary(result.current.followUpTemplateLibrary[0].id));
      expect(result.current.demosTemplateLibrary).toEqual([]);
      expect(result.current.followUpTemplateLibrary).toEqual([]);
    });
  });
});
