import { describe, it, expect } from 'vitest';
import { canonicalRostrUrl, mergeMappedArtists, idFromRostrUrl } from './merge-roster.mjs';

// Artist in the roster.json shape (what mergeMappedArtists consumes on both
// sides — already mapped, not raw collector JSON).
function artist(overrides = {}) {
  return {
    name: 'Some Artist',
    rostrUrl: 'https://www.rostr.cc/profile/some-artist',
    genres: ['Pop'],
    type: 'Person',
    gender: '',
    spotifyFollowers: 0,
    instagramFollowers: 0,
    youtubeSubscribers: 0,
    managementCompany: '',
    agencies: '',
    labels: '',
    publishers: '',
    managerNames: ['Manager'],
    managerEmails: ['manager@example.com'],
    instagramHandle: '',
    avatarUrl: '',
    ...overrides,
  };
}

describe('canonicalRostrUrl', () => {
  it('rewrites the dead plural /artists/ route to /profile/', () => {
    expect(canonicalRostrUrl('https://www.rostr.cc/artists/brunomars'))
      .toBe('https://www.rostr.cc/profile/brunomars');
  });

  it('rewrites the singular /artist/ route to /profile/', () => {
    expect(canonicalRostrUrl('https://www.rostr.cc/artist/sza'))
      .toBe('https://www.rostr.cc/profile/sza');
  });

  it('normalises the host while leaving an already-correct path alone', () => {
    expect(canonicalRostrUrl('https://api.rostr.cc/profile/sza'))
      .toBe('https://www.rostr.cc/profile/sza');
  });

  // The SALOME case: a bare slug with no route segment at all, which
  // idFromRostrUrl can't parse by design.
  it('rewrites a bare rostr.cc slug that has no route segment', () => {
    expect(idFromRostrUrl('https://www.rostr.cc/salome')).toBeNull();
    expect(canonicalRostrUrl('https://www.rostr.cc/salome'))
      .toBe('https://www.rostr.cc/profile/salome');
  });

  it('leaves a multi-segment rostr.cc path untouched rather than guessing', () => {
    const url = 'https://www.rostr.cc/search/results';
    expect(canonicalRostrUrl(url)).toBe(url);
  });

  it('leaves non-rostr hosts untouched even when single-segment', () => {
    const url = 'https://open.spotify.com/salome';
    expect(canonicalRostrUrl(url)).toBe(url);
  });

  it('returns empty and unparseable input unchanged instead of throwing', () => {
    expect(canonicalRostrUrl('')).toBe('');
    expect(canonicalRostrUrl(null)).toBe('');
    expect(canonicalRostrUrl(undefined)).toBe('');
    expect(canonicalRostrUrl('not a url')).toBe('not a url');
  });
});

describe('mergeMappedArtists retained-artist URLs', () => {
  it('canonicalises the URL of an artist the new collection did not find', () => {
    const existing = [artist({ name: 'SALOME', rostrUrl: 'https://www.rostr.cc/salome' })];

    const { merged, stats } = mergeMappedArtists([], existing);

    expect(stats.retained).toBe(1);
    expect(merged).toHaveLength(1);
    expect(merged[0].rostrUrl).toBe('https://www.rostr.cc/profile/salome');
  });

  it('retains the artist without mutating the previous roster record', () => {
    const prior = artist({ name: 'SALOME', rostrUrl: 'https://www.rostr.cc/salome' });
    const existing = [prior];

    const { merged } = mergeMappedArtists([], existing);

    expect(merged[0]).not.toBe(prior);
    expect(prior.rostrUrl).toBe('https://www.rostr.cc/salome');
  });

  it('carries every other field of a retained artist through untouched', () => {
    const prior = artist({
      name: 'SALOME',
      rostrUrl: 'https://www.rostr.cc/salome',
      managerEmails: ['agnese.ghinassi@newspaces.studio'],
      managerNames: ['Agnese Ghinassi'],
      spotifyFollowers: 450453,
    });

    const { merged } = mergeMappedArtists([], [prior]);

    expect(merged[0]).toEqual({ ...prior, rostrUrl: 'https://www.rostr.cc/profile/salome' });
  });

  it('still drops a retained artist with no reachable email', () => {
    const existing = [artist({ rostrUrl: 'https://www.rostr.cc/nobody', managerEmails: [] })];

    const { merged, stats } = mergeMappedArtists([], existing);

    expect(stats.retained).toBe(0);
    expect(merged).toHaveLength(0);
  });

  it('leaves matched artists on the new-collection URL, not the retain path', () => {
    const existing = [artist({ name: 'SZA', rostrUrl: 'https://www.rostr.cc/artists/sza' })];
    const fresh = artist({ name: 'SZA', rostrUrl: 'https://www.rostr.cc/profile/sza' });

    const { merged, stats } = mergeMappedArtists([fresh], existing);

    expect(stats.retained).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].rostrUrl).toBe('https://www.rostr.cc/profile/sza');
  });
});
