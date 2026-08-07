import { describe, it, expect } from 'vitest';
import { buildRoster, mapArtist, buildRostrUrl, extractInstagramHandle } from './build-roster.mjs';

// Full happy-path artist, shaped like the raw collection file the browser
// collector produces (see the build-roster.mjs header comment).
const SZA = {
  rostrId: 'sza',
  entity: { name: ' SZA ', profileUrl: '/profile/sza' },
  avatar: { imageUrl: 'https://img.example.com/sza.jpg' },
  genre: ['R&B/Soul', 'R&B', ''],
  type: 'Person',
  gender: 'FEMALE',
  age: 36,
  spMetric: 66700000,
  igMetric: 23100000,
  ytMetric: 6720000,
  fbMetric: 0,
  spUrl: 'https://open.spotify.com/artist/abc',
  igUrl: 'https://www.instagram.com/sza/',
  management: [{ name: ' Top Dawg Entertainment (TDE) ', rostrId: 'topdawg' }],
  agencies: [{ name: 'WME' }],
  labels: [{ name: 'RCA' }],
  publishers: [{ name: 'Sony' }],
  managers: [
    { name: ' Moosa Tiffith ', email: ' Moosa@TXDXE.com ', role: 'MANAGER', companyName: 'Top Dawg Entertainment (TDE)' },
  ],
};

function artist(overrides = {}) {
  return {
    rostrId: 'artist-id',
    entity: { name: 'Some Artist', profileUrl: '/profile/artist-id' },
    avatar: { imageUrl: '' },
    genre: ['Pop'],
    type: 'Person',
    gender: '',
    spMetric: 0,
    igMetric: 0,
    ytMetric: 0,
    management: [],
    agencies: [],
    labels: [],
    publishers: [],
    managers: [{ name: 'Manager', email: 'manager@example.com' }],
    ...overrides,
  };
}

describe('mapArtist', () => {
  it('maps every field on the full happy-path example', () => {
    const result = mapArtist(SZA);
    expect(result).toEqual({
      name: 'SZA',
      rostrUrl: 'https://www.rostr.cc/profile/sza',
      genres: ['R&B/Soul', 'R&B'],
      type: 'Person',
      gender: 'FEMALE',
      spotifyFollowers: 66700000,
      instagramFollowers: 23100000,
      youtubeSubscribers: 6720000,
      managementCompany: 'Top Dawg Entertainment (TDE)',
      agencies: 'WME',
      labels: 'RCA',
      publishers: 'Sony',
      managerNames: ['Moosa Tiffith'],
      managerEmails: ['moosa@txdxe.com'],
      instagramHandle: 'sza',
      avatarUrl: 'https://img.example.com/sza.jpg',
    });
  });

  it('joins multiple agencies/labels/publishers with ", "', () => {
    const result = mapArtist(artist({
      agencies: [{ name: 'WME' }, { name: 'CAA' }],
      labels: [{ name: 'RCA' }, { name: 'Sony' }],
      publishers: [{ name: 'Sony' }, { name: 'Universal' }],
    }));
    expect(result.agencies).toBe('WME, CAA');
    expect(result.labels).toBe('RCA, Sony');
    expect(result.publishers).toBe('Sony, Universal');
  });

  it('defaults numeric metrics to 0, never null/NaN', () => {
    const result = mapArtist(artist({ spMetric: null, igMetric: undefined, ytMetric: 'not-a-number' }));
    expect(result.spotifyFollowers).toBe(0);
    expect(result.instagramFollowers).toBe(0);
    expect(result.youtubeSubscribers).toBe(0);
  });

  it('dedupes manager emails case-insensitively within one artist', () => {
    const result = mapArtist(artist({
      managers: [
        { name: 'Alex', email: 'alex@example.com' },
        { name: 'Alex Dup', email: 'Alex@Example.com' },
        { name: 'Blank Email', email: '' },
        { name: 'Null Email', email: null },
      ],
    }));
    expect(result.managerEmails).toEqual(['alex@example.com']);
  });

  it('drops manager names/emails that are blank or missing', () => {
    const result = mapArtist(artist({
      managers: [
        { name: '  ', email: 'valid@example.com' },
        { name: 'No Email', email: '' },
      ],
    }));
    expect(result.managerNames).toEqual(['No Email']);
    expect(result.managerEmails).toEqual(['valid@example.com']);
  });
});

describe('buildRostrUrl', () => {
  it('normalises a relative profileUrl using rostrId', () => {
    expect(buildRostrUrl({ rostrId: 'sza', entity: { profileUrl: '/profile/sza' } }))
      .toBe('https://www.rostr.cc/profile/sza');
  });

  it('normalises an absolute www profileUrl', () => {
    expect(buildRostrUrl({ rostrId: 'sza', entity: { profileUrl: 'https://www.rostr.cc/profile/sza' } }))
      .toBe('https://www.rostr.cc/profile/sza');
  });

  it('normalises an absolute api-hosted profileUrl', () => {
    expect(buildRostrUrl({ rostrId: 'sza', entity: { profileUrl: 'https://api.rostr.cc/profile/sza' } }))
      .toBe('https://www.rostr.cc/profile/sza');
  });

  it('falls back to extracting the id from profileUrl when rostrId is missing', () => {
    expect(buildRostrUrl({ entity: { profileUrl: 'https://api.rostr.cc/profile/sza' } }))
      .toBe('https://www.rostr.cc/profile/sza');
  });

  it('returns an empty string when neither rostrId nor a parseable profileUrl exist', () => {
    expect(buildRostrUrl({ entity: {} })).toBe('');
    expect(buildRostrUrl({})).toBe('');
  });
});

describe('extractInstagramHandle', () => {
  it('extracts the handle from a normal profile URL', () => {
    expect(extractInstagramHandle('https://www.instagram.com/sza/')).toBe('sza');
  });

  it('strips a query string', () => {
    expect(extractInstagramHandle('https://www.instagram.com/sza?hl=en')).toBe('sza');
  });

  it('handles a URL with no trailing slash', () => {
    expect(extractInstagramHandle('https://www.instagram.com/sza')).toBe('sza');
  });

  it('strips a leading @ if present', () => {
    expect(extractInstagramHandle('https://www.instagram.com/@sza/')).toBe('sza');
  });

  it('defaults to an empty string when igUrl is missing', () => {
    expect(extractInstagramHandle(undefined)).toBe('');
    expect(extractInstagramHandle(null)).toBe('');
    expect(extractInstagramHandle('')).toBe('');
  });

  it('defaults to an empty string when igUrl is unparseable', () => {
    expect(extractInstagramHandle('not a url')).toBe('');
  });
});

describe('buildRoster', () => {
  it('drops artists with missing managers, empty managers array, or only null/blank emails', () => {
    const raw = {
      collectedAt: '2026-08-07T12:00:00.000Z',
      artists: [
        artist({ rostrId: 'a1', entity: { name: 'No Managers Key' }, managers: undefined }),
        artist({ rostrId: 'a2', entity: { name: 'Empty Managers' }, managers: [] }),
        artist({
          rostrId: 'a3',
          entity: { name: 'Null/Blank Emails Only' },
          managers: [{ name: 'A', email: null }, { name: 'B', email: '' }, { name: 'C', email: '   ' }],
        }),
        artist({ rostrId: 'a4', entity: { name: 'Has Email' } }),
      ],
    };

    const { output, stats } = buildRoster(raw);

    expect(output.artists.map(a => a.name)).toEqual(['Has Email']);
    expect(stats.parsedCount).toBe(4);
    expect(stats.keptCount).toBe(1);
    expect(stats.droppedCount).toBe(3);
  });

  it('dedupes artists by rostrId across buckets, keeping the first occurrence', () => {
    const first = artist({ rostrId: 'dup', entity: { name: 'First Occurrence' }, genre: ['Pop'] });
    const second = artist({ rostrId: 'dup', entity: { name: 'Second Occurrence' }, genre: ['Rock'] });
    const raw = { collectedAt: '2026-08-07T12:00:00.000Z', artists: [first, second] };

    const { output, stats } = buildRoster(raw);

    expect(output.artists).toHaveLength(1);
    expect(output.artists[0].name).toBe('First Occurrence');
    expect(output.artists[0].genres).toEqual(['Pop']);
    expect(stats.duplicateCount).toBe(1);
  });

  it('excludes genres that only appeared on dropped (no-email) artists', () => {
    const raw = {
      collectedAt: '2026-08-07T12:00:00.000Z',
      artists: [
        artist({ rostrId: 'kept', entity: { name: 'Kept' }, genre: ['Pop'] }),
        artist({ rostrId: 'dropped', entity: { name: 'Dropped' }, genre: ['Jazz'], managers: [] }),
      ],
    };

    const { output } = buildRoster(raw);

    expect(output.genres).toEqual(['Pop']);
  });

  it('sorts the top-level genres list', () => {
    const raw = {
      collectedAt: '2026-08-07T12:00:00.000Z',
      artists: [
        artist({ rostrId: 'z', entity: { name: 'Z' }, genre: ['Rock'] }),
        artist({ rostrId: 'a', entity: { name: 'A' }, genre: ['Blues'] }),
      ],
    };

    const { output } = buildRoster(raw);

    expect(output.genres).toEqual(['Blues', 'Rock']);
  });

  it('uses collectedAt as generatedAt when present', () => {
    const raw = { collectedAt: '2026-08-07T12:00:00.000Z', artists: [artist()] };
    const { output } = buildRoster(raw);
    expect(output.generatedAt).toBe('2026-08-07T12:00:00.000Z');
  });

  it('falls back to the current time when collectedAt is missing', () => {
    const before = Date.now();
    const raw = { artists: [artist()] };
    const { output } = buildRoster(raw);
    const generatedAtMs = new Date(output.generatedAt).getTime();
    expect(generatedAtMs).toBeGreaterThanOrEqual(before);
    expect(generatedAtMs).toBeLessThanOrEqual(Date.now());
  });

  it('handles a missing/non-array artists field gracefully', () => {
    const { output, stats } = buildRoster({ collectedAt: '2026-08-07T12:00:00.000Z' });
    expect(output.artists).toEqual([]);
    expect(output.genres).toEqual([]);
    expect(stats.rawCount).toBe(0);
  });
});
