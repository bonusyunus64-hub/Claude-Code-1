import { describe, it, expect } from 'vitest';
import { buildPreviewEntries, buildDemosPreviewEntries, type PreviewCandidate, type DemosPreviewInput } from './previewEntries';
import { rankArtistsForPitch } from '@/lib/artistFit';
import type { Artist, CustomContact } from './types';

// The email-preview modal has to agree with what the server will actually send:
// dedupeByRecipient (lib/mailSend.ts) collapses every message to the same address
// down to one, keeping the highest `rank` (ties keep the first seen). These tests
// exercise buildPreviewEntries against that same contract directly, without needing
// to render the Dashboard component or any templates.

function candidate(overrides: Partial<PreviewCandidate> & { to: string }): PreviewCandidate {
  return {
    subject: '', body: '', label: overrides.to, vars: {},
    ...overrides,
  };
}

const passthroughRender = (vars: Record<string, string>) => ({ subject: `subject:${vars.id ?? ''}`, body: `body:${vars.id ?? ''}` });

describe('buildPreviewEntries', () => {
  it('collapses several messages to the same address into one, keeping the highest rank', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'manager@label.com', rank: 500, label: 'Small Artist', vars: { id: 'small' } }),
      candidate({ to: 'manager@label.com', rank: 900000, label: 'Big Artist', vars: { id: 'big' } }),
      candidate({ to: 'manager@label.com', rank: 12000, label: 'Medium Artist', vars: { id: 'medium' } }),
    ];
    const { entries, total } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(total).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Big Artist');
    expect(entries[0].subject).toBe('subject:big');
  });

  it('address matching is case-insensitive, matching dedupeByRecipient', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'Manager@Label.com', rank: 10, label: 'A' }),
      candidate({ to: 'manager@label.com', rank: 20, label: 'B' }),
    ];
    const { total, entries } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(total).toBe(1);
    expect(entries[0].label).toBe('B');
  });

  it('keeps the first-seen entry when ranks tie, same as dedupeByRecipient', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'x@y.com', rank: 100, label: 'first' }),
      candidate({ to: 'x@y.com', rank: 100, label: 'second' }),
    ];
    const { entries } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(entries[0].label).toBe('first');
  });

  it('treats missing rank as 0, same as dedupeByRecipient\'s (msg.rank ?? 0)', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'x@y.com', label: 'no-rank' }),
      candidate({ to: 'x@y.com', rank: 1, label: 'has-rank' }),
    ];
    const { entries } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(entries[0].label).toBe('has-rank');
  });

  it('total is the deduped count, not the raw candidate count', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'a@x.com', label: 'a1' }),
      candidate({ to: 'a@x.com', label: 'a2' }),
      candidate({ to: 'b@x.com', label: 'b1' }),
    ];
    const { total } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(total).toBe(2);
  });

  it('applies the cap after dedup, not before', () => {
    // Three distinct addresses collapse to two after dedup; capping at 1 before
    // dedup would wrongly drop b@x.com from the total.
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'a@x.com', rank: 1, label: 'a-low' }),
      candidate({ to: 'a@x.com', rank: 2, label: 'a-high' }),
      candidate({ to: 'b@x.com', label: 'b' }),
    ];
    const { entries, total } = buildPreviewEntries(candidates, 1, passthroughRender);
    expect(total).toBe(2);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('a-high');
  });

  it('only calls render for candidates surviving dedup and the cap', () => {
    let renderCalls = 0;
    const countingRender = (vars: Record<string, string>) => { renderCalls++; return passthroughRender(vars); };
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'a@x.com', rank: 1 }),
      candidate({ to: 'a@x.com', rank: 2 }), // dedup drops this one's twin, not itself
      candidate({ to: 'b@x.com' }),
      candidate({ to: 'c@x.com' }),
    ];
    buildPreviewEntries(candidates, 2, countingRender);
    // 3 distinct addresses total, capped at 2 -> render should run exactly twice.
    expect(renderCalls).toBe(2);
  });

  it('returns an empty result for an empty candidate list', () => {
    expect(buildPreviewEntries([], 20, passthroughRender)).toEqual({ entries: [], total: 0, excludedByBlacklist: 0 });
  });

  it('passes the deduped recipient\'s address to render, not just their vars', () => {
    // Needed for subject-line A/B testing (lib/recipients.ts's subjectTemplateFor):
    // a caller has to know which address it's rendering for to pick the same
    // subject variant the server will actually send.
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'a@x.com', rank: 1 }),
      candidate({ to: 'b@x.com' }),
    ];
    const seenAddresses: string[] = [];
    const recordingRender = (vars: Record<string, string>, to: string) => { seenAddresses.push(to); return passthroughRender(vars); };
    buildPreviewEntries(candidates, 20, recordingRender);
    expect(seenAddresses.sort()).toEqual(['a@x.com', 'b@x.com']);
  });

  describe('blacklist filtering', () => {
    it('drops a blacklisted address from both entries and total, and reports it as excluded', () => {
      const candidates: PreviewCandidate[] = [
        candidate({ to: 'a@x.com', label: 'A' }),
        candidate({ to: 'b@x.com', label: 'B' }),
      ];
      const { entries, total, excludedByBlacklist } = buildPreviewEntries(candidates, 20, passthroughRender, ['b@x.com']);
      expect(entries.map(e => e.to)).toEqual(['a@x.com']);
      expect(total).toBe(1);
      expect(excludedByBlacklist).toBe(1);
    });

    it('matches the blacklist case-insensitively', () => {
      const candidates: PreviewCandidate[] = [candidate({ to: 'Manager@Label.com', label: 'M' })];
      const { entries, total, excludedByBlacklist } = buildPreviewEntries(candidates, 20, passthroughRender, ['manager@label.com']);
      expect(entries).toEqual([]);
      expect(total).toBe(0);
      expect(excludedByBlacklist).toBe(1);
    });

    it('filters before dedup collapses to the final address, so a blacklisted duplicate is not double-counted', () => {
      const candidates: PreviewCandidate[] = [
        candidate({ to: 'a@x.com', rank: 1, label: 'a-low' }),
        candidate({ to: 'a@x.com', rank: 2, label: 'a-high' }),
      ];
      const { total, excludedByBlacklist } = buildPreviewEntries(candidates, 20, passthroughRender, ['a@x.com']);
      expect(total).toBe(0);
      expect(excludedByBlacklist).toBe(1);
    });

    it('defaults to no filtering when no blacklist is passed, matching pre-existing callers', () => {
      const candidates: PreviewCandidate[] = [candidate({ to: 'a@x.com' })];
      const { total, excludedByBlacklist } = buildPreviewEntries(candidates, 20, passthroughRender);
      expect(total).toBe(1);
      expect(excludedByBlacklist).toBe(0);
    });
  });
});

// buildDemosPreviewEntries is the demos preview modal's client-side mirror of
// lib/demosSend.ts's sendDemos: rank the matched artists, group them by manager
// address, and give a group of 2+ the shared-manager copy only when there's
// real copy for it and this isn't a follow-up. These tests exercise that
// grouping directly, without rendering the Dashboard component or its dozen
// other hooks.
describe('buildDemosPreviewEntries', () => {
  function artist(overrides: Partial<Artist> = {}): Artist {
    return {
      name: 'Nova', genres: ['Pop'], spotifyFollowers: 10_000, managementCompany: 'Acme Mgmt',
      managerNames: ['Sam'], managerEmails: ['sam@example.com'], labels: '',
      instagramHandle: '', avatarUrl: '', gender: 'FEMALE', type: 'Person',
      ...overrides,
    };
  }

  // Builds an artist sharing one manager address with any others given the same
  // helper — the shape needed to exercise groupArtistsByManagerEmail's "one
  // manager, several matched artists" grouping.
  function sharedArtist(name: string, followers: number, overrides: Partial<Artist> = {}): Artist {
    return artist({
      name, spotifyFollowers: followers,
      managerNames: ['Shared Manager'], managerEmails: ['shared@example.com'],
      ...overrides,
    });
  }

  const baseInput: DemosPreviewInput = {
    includedArtists: [],
    selectedGenres: ['Pop'],
    customContacts: [],
    demosTemplate: 'Hi {{managerName}}, check out {{artistName}}: {{trackTitle}} {{driveLink}}',
    demosSubject: '{{trackTitle}} for {{artistName}}',
    demosSubjectB: '',
    demosFollowUpTemplate: 'Following up on {{trackTitle}} for {{artistName}}',
    demosFollowUpSubject: 'Re: {{trackTitle}} for {{artistName}}',
    demosMultiArtistTemplate: 'Hi {{managerName}}, sharing {{artistNames}} ({{artistSummary}}): {{trackTitle}} {{driveLink}}',
    demosMultiArtistSubject: '{{trackTitle}} for {{artistNames}}',
    useFollowUp: false,
    subjectTestEnabled: false,
    signOff: '',
    blacklist: [],
    trackTitle: 'Track',
    driveLink: 'https://drive.example.com/x',
    senderName: 'Sender',
  };

  it('previews a manager repping a single matched artist exactly as today (single-artist email)', () => {
    const solo = artist({ name: 'Solo', managerNames: ['Solo Mgr'], managerEmails: ['solo@example.com'] });
    const { entries, total } = buildDemosPreviewEntries({ ...baseInput, includedArtists: [solo] });
    expect(total).toBe(1);
    expect(entries[0].to).toBe('solo@example.com');
    expect(entries[0].label).toBe('Solo (Solo Mgr) <solo@example.com>');
    expect(entries[0].subject).toBe('Track for Solo');
    expect(entries[0].body).toContain('Hi Solo Mgr, check out Solo');
  });

  it('previews a manager repping 2+ matched artists as a single multi-artist row', () => {
    const nori = sharedArtist('Nori', 500);
    const cayo = sharedArtist('Cayo', 2000); // same genre, so followers break the tie: Cayo leads
    const { entries, total } = buildDemosPreviewEntries({ ...baseInput, includedArtists: [nori, cayo] });
    expect(total).toBe(1);
    const [entry] = entries;
    expect(entry.to).toBe('shared@example.com');
    expect(entry.label).toBe('Cayo +1 other (Shared Manager) <shared@example.com>');
    expect(entry.subject).toBe('Track for Cayo and Nori');
    expect(entry.body).toContain('sharing Cayo and Nori (Cayo and Nori)');
  });

  it('falls back to the single-artist email when the multi-artist template is blank/whitespace-only', () => {
    const nori = sharedArtist('Nori', 500);
    const cayo = sharedArtist('Cayo', 2000);
    const { entries } = buildDemosPreviewEntries({ ...baseInput, includedArtists: [nori, cayo], demosMultiArtistTemplate: '   \n\t  ' });
    expect(entries).toHaveLength(1);
    expect(entries[0].subject).toBe('Track for Cayo');
    expect(entries[0].body).not.toContain('Nori');
  });

  it('falls back to the single-artist email on a follow-up send, even with real multi-artist copy configured', () => {
    const nori = sharedArtist('Nori', 500);
    const cayo = sharedArtist('Cayo', 2000);
    const { entries } = buildDemosPreviewEntries({ ...baseInput, includedArtists: [nori, cayo], useFollowUp: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].subject).toBe('Re: Track for Cayo');
    expect(entries[0].body).not.toContain('Nori');
  });

  it('previews the same lead artist lib/demosSend.ts would pick for the same input (genre fit, not raw followers)', () => {
    // Rence's genre fit beats Cayo's higher follower count for the selected genre.
    const cayo = sharedArtist('Cayo', 5000, { genres: ['Rock'] });
    const rence = sharedArtist('Rence', 1000, { genres: ['Pop'] });
    const { entries } = buildDemosPreviewEntries({ ...baseInput, includedArtists: [cayo, rence], selectedGenres: ['Pop'] });
    const [expectedLead] = rankArtistsForPitch([cayo, rence], ['Pop']);
    expect(entries[0].label).toContain(expectedLead.name);
    expect(entries[0].subject).toContain(expectedLead.name);
  });

  it('a hand-added custom contact still outranks a colliding roster manager address', () => {
    const nori = sharedArtist('Nori', 500, { managerEmails: ['collide@example.com'] });
    const cc: CustomContact = { id: '1', artistName: 'Custom Artist', managerName: 'Custom Mgr', managerEmail: 'collide@example.com' };
    const { entries } = buildDemosPreviewEntries({ ...baseInput, includedArtists: [nori], customContacts: [cc] });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toContain('[Custom]');
    expect(entries[0].body).toContain('Custom Artist');
  });

  it('a custom contact colliding with a 2+-artist manager group forces that address to single-artist copy, never the multi-artist one', () => {
    // Two matched artists behind the SAME address a custom contact also
    // claims — the case the single-artist collision test above can't exercise,
    // since a group of exactly 1 was never eligible for multi-artist copy to
    // begin with. The custom contact still has to win (CUSTOM_CONTACT_RANK),
    // and the surviving row must render as the ordinary single-artist email —
    // never the multi-artist template/subject, which the custom contact's own
    // vars (no artistSummary/artistNames) can't fill in.
    const nori = sharedArtist('Nori', 500, { managerEmails: ['collide@example.com'] });
    const cayo = sharedArtist('Cayo', 2000, { managerEmails: ['collide@example.com'] });
    const cc: CustomContact = { id: '1', artistName: 'Custom Artist', managerName: 'Custom Mgr', managerEmail: 'collide@example.com' };
    const { entries } = buildDemosPreviewEntries({ ...baseInput, includedArtists: [nori, cayo], customContacts: [cc] });

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.label).toContain('[Custom]');
    expect(entry.subject).toBe('Track for Custom Artist');
    expect(entry.body).toContain('Hi Custom Mgr, check out Custom Artist');
    // No unrendered {{...}} placeholder may ever leak into a previewed email —
    // which is exactly what a custom contact's vars (missing artistSummary/
    // artistNames) rendered through the multi-artist template would produce.
    expect(entry.subject).not.toMatch(/\{\{/);
    expect(entry.body).not.toMatch(/\{\{/);
  });
});
