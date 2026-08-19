import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  backfillGenres, isExactNameMatch, normalizeItunesGenreTag, mapItunesGenre,
  uniqueEmailCount, ITUNES_GENRE_ALIASES, mergeProvenanceLog, loadExistingProvenanceLog,
  PERMANENT_SKIP_REASONS, validateRetryReasons,
} from './backfill-genres.mjs';

// Fixtures for loadExistingProvenanceLog live in the OS temp dir, not the
// repo — cleaned up after every test.
let workDir;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'backfill-genres-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// Roster-shaped artist fixture — mirrors the shape lib/roster.ts's Artist
// interface expects (and what scripts/merge-roster.test.mjs's fixture uses).
function artist(overrides = {}) {
  return {
    name: 'Some Artist',
    rostrUrl: 'https://www.rostr.cc/profile/some-artist',
    genres: [],
    type: 'Person',
    gender: '',
    spotifyFollowers: 100_000,
    instagramFollowers: 0,
    youtubeSubscribers: 0,
    managementCompany: 'Some Management',
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

const ROSTER_GENRES = [
  'Hip Hop', 'Hip Hop & Rap', 'Metalcore', 'Indie', 'K Pop', 'Pop', 'Rap', 'Rock', 'Rap Metal',
  'Dance / Edm', 'Singer Songwriter', 'Pop Singer Songwriter', 'Afro Pop', 'Afropop', 'Alternative',
  // Targets of the 2026-08-19 alias additions (Part 1) — must be present
  // verbatim for those aliases (and the "every alias target exists"
  // guard test below) to resolve.
  'Folk', 'Latin Pop', 'Jazz', 'Country', 'Alternative Hip Hop', 'Afrobeat', 'Afrobeats',
];

function itunesArtist({ name, artistId, genre }) {
  return {
    artistName: name,
    artistId: artistId ?? 1,
    primaryGenreName: genre,
    artistLinkUrl: `https://music.apple.com/us/artist/${encodeURIComponent(name)}/${artistId ?? 1}`,
  };
}

describe('normalizeItunesGenreTag', () => {
  it('lowercases, trims, and turns hyphens into spaces', () => {
    expect(normalizeItunesGenreTag('Hip Hop')).toBe('hip hop');
    expect(normalizeItunesGenreTag('K-Pop')).toBe('k pop');
    expect(normalizeItunesGenreTag('Afro-Pop')).toBe('afro pop');
    expect(normalizeItunesGenreTag('  Alternative  ')).toBe('alternative');
  });

  it('leaves slashes and ampersands alone — they are meaningful separators, not typographic variance', () => {
    expect(normalizeItunesGenreTag('R&B/Soul')).toBe('r&b/soul');
    expect(normalizeItunesGenreTag('Hip-Hop/Rap')).toBe('hip hop/rap');
    expect(normalizeItunesGenreTag('Singer/Songwriter')).toBe('singer/songwriter');
  });

  it('handles empty/nullish input without throwing', () => {
    expect(normalizeItunesGenreTag('')).toBe('');
    expect(normalizeItunesGenreTag(null)).toBe('');
    expect(normalizeItunesGenreTag(undefined)).toBe('');
  });
});

describe('mapItunesGenre', () => {
  const rosterGenreByLower = new Map(ROSTER_GENRES.map(g => [g.toLowerCase(), g]));

  it('resolves direct matches for plain tags already in the roster vocabulary', () => {
    expect(mapItunesGenre('Hip Hop', rosterGenreByLower)).toBe('Hip Hop');
    expect(mapItunesGenre('Pop', rosterGenreByLower)).toBe('Pop');
    expect(mapItunesGenre('Rock', rosterGenreByLower)).toBe('Rock');
  });

  it('resolves K-Pop and Afro-Pop via hyphen-to-space normalisation, with no alias table entry needed', () => {
    expect(mapItunesGenre('K-Pop', rosterGenreByLower)).toBe('K Pop');
    // The roster vocabulary has a literal "Afro Pop" entry (with a space),
    // distinct from "Afropop" (no space) — normalisation resolves iTunes'
    // "Afro-Pop" to the former without needing an alias, and must NOT land
    // on the latter.
    expect(mapItunesGenre('Afro-Pop', rosterGenreByLower)).toBe('Afro Pop');
  });

  it('resolves an aliased tag to its documented target genre', () => {
    expect(mapItunesGenre('Hip-Hop/Rap', rosterGenreByLower)).toBe('Hip Hop & Rap');
    expect(mapItunesGenre('Dance', rosterGenreByLower)).toBe('Dance / Edm');
    expect(mapItunesGenre('Singer/Songwriter', rosterGenreByLower)).toBe('Singer Songwriter');
  });

  it('every alias table entry actually resolves against the roster vocabulary it targets', () => {
    // Guards against a typo'd alias target silently becoming "unmapped"
    // forever instead of failing loudly in a test — also implicitly asserts
    // every alias target string exists verbatim in the roster genre list.
    for (const [tag, target] of ITUNES_GENRE_ALIASES) {
      expect(ROSTER_GENRES).toContain(target);
      expect(mapItunesGenre(tag, rosterGenreByLower), `alias "${tag}" -> "${target}"`).toBe(target);
    }
  });

  it('returns null for a tag with no direct match and no alias, rather than guessing', () => {
    expect(mapItunesGenre('Worldwide', rosterGenreByLower)).toBeNull();
    expect(mapItunesGenre('Punjabi', rosterGenreByLower)).toBeNull();
    expect(mapItunesGenre('Arabic', rosterGenreByLower)).toBeNull();
  });

  describe('the seven aliases added 2026-08-19 for previously-unmappableGenre artists', () => {
    it('resolves each of the seven to its documented target', () => {
      expect(mapItunesGenre('Alternative Folk', rosterGenreByLower)).toBe('Folk');
      expect(mapItunesGenre('Pop Latino', rosterGenreByLower)).toBe('Latin Pop');
      expect(mapItunesGenre('Contemporary Jazz', rosterGenreByLower)).toBe('Jazz');
      expect(mapItunesGenre('Contemporary Country', rosterGenreByLower)).toBe('Country');
      expect(mapItunesGenre('Alternative Rap', rosterGenreByLower)).toBe('Alternative Hip Hop');
      expect(mapItunesGenre('Adult Contemporary', rosterGenreByLower)).toBe('Pop');
      expect(mapItunesGenre('African', rosterGenreByLower)).toBe('Afrobeat');
    });

    it('maps "African" to "Afrobeat" specifically, not the distinct "Afrobeats" entry', () => {
      // Both "Afrobeat" and "Afrobeats" are real, separate roster genres —
      // asserting the exact string here guards against a future edit
      // silently drifting onto the wrong one of the two.
      const mapped = mapItunesGenre('African', rosterGenreByLower);
      expect(mapped).toBe('Afrobeat');
      expect(mapped).not.toBe('Afrobeats');
    });

    it('leaves the four deliberately-unmapped tags unresolved (no alias added for them, on purpose)', () => {
      // "Worldwide" and "Self-Development" are evidence of a wrong iTunes
      // match (a podcast/audiobook sharing a musician's name), not a genre
      // gap; "Instrumental" and "Easy Listening" have no honest equivalent
      // in the roster vocabulary. See ITUNES_GENRE_ALIASES's trailing
      // comment in backfill-genres.mjs for the full reasoning.
      expect(mapItunesGenre('Worldwide', rosterGenreByLower)).toBeNull();
      expect(mapItunesGenre('Instrumental', rosterGenreByLower)).toBeNull();
      expect(mapItunesGenre('Easy Listening', rosterGenreByLower)).toBeNull();
      expect(mapItunesGenre('Self-Development', rosterGenreByLower)).toBeNull();
    });
  });
});

describe('isExactNameMatch', () => {
  it('matches names case-insensitively but not fuzzily', () => {
    expect(isExactNameMatch('SZA', 'sza')).toBe(true);
    expect(isExactNameMatch('SZA', 'SZA Official')).toBe(false);
  });
});

describe('backfillGenres', () => {
  it('never touches an artist that already has genres, even if it would otherwise match', async () => {
    const withGenres = artist({ name: 'Has Genres', genres: ['Pop'] });
    const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'Has Genres', genre: 'Hip Hop' })] }));

    const { artists, stats } = await backfillGenres({ artists: [withGenres], genres: ROSTER_GENRES }, { searchArtist });

    expect(artists[0]).toBe(withGenres); // same reference — not even copied
    expect(artists[0].genres).toEqual(['Pop']);
    expect(searchArtist).not.toHaveBeenCalled();
    expect(stats.eligible).toBe(0);
    expect(stats.filled).toBe(0);
  });

  it('fills genres on a unique exact match, and records the fill in the provenance log', async () => {
    const target = artist({ name: 'Nova Rivers', genres: [] });
    const searchArtist = vi.fn(async name => {
      expect(name).toBe('Nova Rivers');
      return { results: [itunesArtist({ name: 'Nova Rivers', artistId: 42, genre: 'Alternative' })] };
    });

    const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });

    expect(artists[0].genres).toEqual(['Alternative']);
    expect(stats.filled).toBe(1);
    expect(stats.eligible).toBe(1);
    expect(stats.attempted).toBe(1);
    expect(log.filled).toHaveLength(1);
    expect(log.filled[0]).toMatchObject({
      name: 'Nova Rivers',
      rostrUrl: target.rostrUrl,
      primaryGenreName: 'Alternative',
      mappedGenre: 'Alternative',
      matchType: 'unique',
      matchCount: 1,
      artistId: 42,
    });
  });

  it('fills genres via alias resolution and hyphen normalisation', async () => {
    const target = artist({ name: 'DJ Kappa', genres: [] });
    const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'DJ Kappa', genre: 'Hip-Hop/Rap' })] }));

    const { artists } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(artists[0].genres).toEqual(['Hip Hop & Rap']);
  });

  it('accepts multiple exact-name matches when they unanimously agree on genre', async () => {
    const target = artist({ name: 'Harpy', genres: [] });
    const searchArtist = vi.fn(async () => ({
      results: [
        itunesArtist({ name: 'Harpy', artistId: 1, genre: 'Rock' }),
        itunesArtist({ name: 'Harpy', artistId: 2, genre: 'Rock' }),
        itunesArtist({ name: 'Harpy', artistId: 3, genre: 'Rock' }),
      ],
    }));

    const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(artists[0].genres).toEqual(['Rock']);
    expect(stats.filled).toBe(1);
    expect(log.filled[0].matchType).toBe('unanimous');
    expect(log.filled[0].matchCount).toBe(3);
  });

  it('skips with noNameMatch when nothing returned is an exact name match', async () => {
    const target = artist({ name: 'Exact Name' });
    const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'Exact Name Official', genre: 'Pop' })] }));

    const { stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.noNameMatch).toBe(1);
    expect(log.skipped).toContainEqual({ name: 'Exact Name', rostrUrl: target.rostrUrl, reason: 'noNameMatch' });
  });

  it('skips with noNameMatch when iTunes returns no results at all', async () => {
    const target = artist({ name: 'Nobody Found' });
    const searchArtist = vi.fn(async () => ({ results: [] }));

    const { stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.noNameMatch).toBe(1);
    expect(stats.filled).toBe(0);
  });

  it('skips with noGenreOnRecord when exact matches exist but none carry a primaryGenreName', async () => {
    const target = artist({ name: 'No Genre Here' });
    const searchArtist = vi.fn(async () => ({
      results: [itunesArtist({ name: 'No Genre Here', genre: undefined })],
    }));

    const { stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.noGenreOnRecord).toBe(1);
  });

  it('skips with ambiguousName when multiple exact-name matches disagree on genre, and logs the competing genres', async () => {
    const target = artist({ name: 'SOFY' });
    const searchArtist = vi.fn(async () => ({
      results: [
        itunesArtist({ name: 'SOFY', artistId: 1, genre: 'Pop' }),
        itunesArtist({ name: 'SOFY', artistId: 2, genre: 'Rock' }),
        itunesArtist({ name: 'SOFY', artistId: 3, genre: 'Pop' }),
      ],
    }));

    const { stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.ambiguousName).toBe(1);
    const entry = log.skipped.find(e => e.reason === 'ambiguousName');
    expect(entry).toMatchObject({ name: 'SOFY', rostrUrl: target.rostrUrl, matchCount: 3 });
    expect(entry.competingGenres.sort()).toEqual(['Pop', 'Rock']);
  });

  it('skips with unmappableGenre when the matched genre does not resolve into the roster vocabulary', async () => {
    const target = artist({ name: 'Untaggable' });
    const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'Untaggable', genre: 'Worldwide' })] }));

    const { artists, stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.unmappableGenre).toBe(1);
    expect(artists[0].genres).toEqual([]);
    expect(stats.unmappedGenres.get('Worldwide')).toBe(1);
  });

  it('skips with lookupFailed, without aborting the run, when searchArtist throws', async () => {
    const targets = [artist({ name: 'Will Fail' }), artist({ name: 'Will Fill' })];
    const searchArtist = vi.fn(async name => {
      if (name === 'Will Fail') throw new Error('network exploded');
      return { results: [itunesArtist({ name, genre: 'Pop' })] };
    });

    const { artists, stats, log } = await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.lookupFailed).toBe(1);
    expect(stats.filled).toBe(1);
    expect(artists[0].genres).toEqual([]);
    expect(artists[1].genres).toEqual(['Pop']);
    const failEntry = log.skipped.find(e => e.reason === 'lookupFailed');
    expect(failEntry.name).toBe('Will Fail');
    expect(failEntry.error).toContain('network exploded');
  });

  it('respects --limit, leaving artists beyond it untouched and counted as overLimit', async () => {
    const targets = [artist({ name: 'A' }), artist({ name: 'B' }), artist({ name: 'C' })];
    const searchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, genre: 'Pop' })] }));

    const { artists, stats, log } = await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist, limit: 1 });
    expect(stats.eligible).toBe(3);
    expect(stats.attempted).toBe(1);
    expect(stats.skipped.overLimit).toBe(2);
    expect(searchArtist).toHaveBeenCalledTimes(1);
    expect(artists[0].genres).toEqual(['Pop']);
    expect(artists[1].genres).toEqual([]);
    expect(artists[2].genres).toEqual([]);
    // overLimit is counted in stats (asserted above) but deliberately not
    // logged per-artist — it would dominate the file in exactly the chunked
    // runs this counter exists to support.
    expect(log.skipped.filter(e => e.reason === 'overLimit')).toHaveLength(0);
    expect(log.skipped).toHaveLength(0);
  });

  it('never changes artist count or the unique-email set — the same non-destructive guarantee merge-roster.mjs asserts', async () => {
    const roster = {
      artists: [
        artist({ name: 'Has Genres', genres: ['Pop'], managerEmails: ['a@example.com'] }),
        artist({ name: 'Will Fill', managerEmails: ['b@example.com'] }),
        artist({ name: 'Will Skip', managerEmails: ['c@example.com'] }),
      ],
      genres: ROSTER_GENRES,
    };
    const searchArtist = vi.fn(async name => {
      if (name === 'Will Fill') return { results: [itunesArtist({ name, genre: 'Pop' })] };
      return { results: [] };
    });

    const before = { artists: roster.artists.length, emails: uniqueEmailCount(roster.artists) };
    const { artists } = await backfillGenres(roster, { searchArtist });
    const after = { artists: artists.length, emails: uniqueEmailCount(artists) };

    expect(after).toEqual(before);
    // Only the `genres` field moved; nothing else about any record changed.
    expect(artists.map(a => ({ ...a, genres: undefined }))).toEqual(
      roster.artists.map(a => ({ ...a, genres: undefined }))
    );
  });

  it('never touches managerEmails/managerNames/spotifyFollowers/managementCompany on a filled artist', async () => {
    const target = artist({
      name: 'Will Fill',
      genres: [],
      managerEmails: ['b@example.com'],
      managerNames: ['Bea'],
      spotifyFollowers: 12_345,
      managementCompany: 'Bea Management',
    });
    const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'Will Fill', genre: 'Pop' })] }));

    const { artists } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(artists[0].managerEmails).toEqual(['b@example.com']);
    expect(artists[0].managerNames).toEqual(['Bea']);
    expect(artists[0].spotifyFollowers).toBe(12_345);
    expect(artists[0].managementCompany).toBe('Bea Management');
    expect(artists[0].genres).toEqual(['Pop']);
  });
});

describe('PERMANENT_SKIP_REASONS', () => {
  it('contains exactly the four reasons that are safe to never re-attempt, and neither lookupFailed nor overLimit', () => {
    expect([...PERMANENT_SKIP_REASONS].sort()).toEqual(
      ['ambiguousName', 'noGenreOnRecord', 'noNameMatch', 'unmappableGenre'].sort()
    );
    expect(PERMANENT_SKIP_REASONS.has('lookupFailed')).toBe(false);
    expect(PERMANENT_SKIP_REASONS.has('overLimit')).toBe(false);
  });
});

describe('validateRetryReasons', () => {
  it('parses a single reason into a one-element Set', () => {
    expect(validateRetryReasons('unmappableGenre')).toEqual(new Set(['unmappableGenre']));
  });

  it('parses comma-separated reasons, trimming whitespace', () => {
    expect(validateRetryReasons('unmappableGenre, noNameMatch')).toEqual(
      new Set(['unmappableGenre', 'noNameMatch'])
    );
  });

  it('throws, listing the valid reasons, on an unrecognised reason', () => {
    expect(() => validateRetryReasons('nonsense')).toThrow(/unrecognised reason.*"nonsense"/);
    expect(() => validateRetryReasons('nonsense')).toThrow(/ambiguousName/); // valid reasons listed in the message
  });

  it('throws on a mix of valid and invalid reasons, rather than silently keeping only the valid ones', () => {
    expect(() => validateRetryReasons('unmappableGenre,nonsense')).toThrow(/"nonsense"/);
  });

  it('throws on reasons that are real skip reasons but not permanent ones (lookupFailed, overLimit) — retrying them via this flag would silently match nothing', () => {
    expect(() => validateRetryReasons('lookupFailed')).toThrow(/unrecognised reason.*"lookupFailed"/);
    expect(() => validateRetryReasons('overLimit')).toThrow(/unrecognised reason.*"overLimit"/);
  });

  it('throws on empty input rather than matching everything or nothing silently', () => {
    expect(() => validateRetryReasons('')).toThrow(/at least one reason/);
    expect(() => validateRetryReasons(',,')).toThrow(/at least one reason/);
  });
});

describe('backfillGenres — resuming from an existing provenance log', () => {
  it('does not re-attempt (no searchArtist call for) an artist previously skipped as ambiguousName', async () => {
    const skippedBefore = artist({ name: 'Harpy', rostrUrl: 'https://www.rostr.cc/profile/harpy' });
    const existingLog = {
      source: 'itunes',
      runs: [],
      filled: [],
      skipped: [{ name: 'Harpy', rostrUrl: skippedBefore.rostrUrl, reason: 'ambiguousName', competingGenres: ['Pop', 'Rock'], matchCount: 2 }],
    };
    const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'Harpy', genre: 'Rock' })] }));

    const { artists, stats } = await backfillGenres({ artists: [skippedBefore], genres: ROSTER_GENRES }, { searchArtist, existingLog });

    expect(searchArtist).not.toHaveBeenCalled();
    expect(artists[0].genres).toEqual([]); // untouched — still exactly as it came in
    expect(stats.alreadySkipped).toBe(1);
    expect(stats.eligible).toBe(1); // still true: it started with genres: []
    expect(stats.attempted).toBe(0);
  });

  it('DOES re-attempt an artist whose most recent logged skip was lookupFailed — that reason is transient, not permanent', async () => {
    const target = artist({ name: 'Flaky Lookup', rostrUrl: 'https://www.rostr.cc/profile/flaky-lookup' });
    const existingLog = {
      source: 'itunes',
      runs: [],
      filled: [],
      skipped: [{ name: 'Flaky Lookup', rostrUrl: target.rostrUrl, reason: 'lookupFailed', error: 'network exploded' }],
    };
    const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'Flaky Lookup', genre: 'Pop' })] }));

    const { artists, stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist, existingLog });

    expect(searchArtist).toHaveBeenCalledTimes(1);
    expect(artists[0].genres).toEqual(['Pop']);
    expect(stats.alreadySkipped).toBe(0);
    expect(stats.attempted).toBe(1);
    expect(stats.filled).toBe(1);
  });

  it('excluding previously-skipped artists does not consume the --limit budget — a limit-N chunk still reaches N genuinely new artists', async () => {
    const excludedCount = 3;
    const newCount = 2;
    const excluded = Array.from({ length: excludedCount }, (_, i) =>
      artist({ name: `Excluded ${i}`, rostrUrl: `https://www.rostr.cc/profile/excluded-${i}` })
    );
    const fresh = Array.from({ length: newCount }, (_, i) =>
      artist({ name: `Fresh ${i}`, rostrUrl: `https://www.rostr.cc/profile/fresh-${i}` })
    );
    const existingLog = {
      source: 'itunes',
      runs: [],
      filled: [],
      skipped: excluded.map(a => ({ name: a.name, rostrUrl: a.rostrUrl, reason: 'ambiguousName', competingGenres: ['Pop', 'Rock'], matchCount: 2 })),
    };
    // Excluded artists come first in roster order — exactly the pathological
    // ordering the real roster hits, since a skip never drops out of the
    // genre-less walk the way a fill does.
    const searchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, genre: 'Pop' })] }));

    const { stats } = await backfillGenres(
      { artists: [...excluded, ...fresh], genres: ROSTER_GENRES },
      { searchArtist, existingLog, limit: newCount }
    );

    expect(stats.alreadySkipped).toBe(excludedCount);
    expect(stats.attempted).toBe(newCount);
    expect(stats.filled).toBe(newCount);
    expect(searchArtist).toHaveBeenCalledTimes(newCount);
    expect(stats.skipped.overLimit).toBe(0);
  });

  it('--retry-skipped (retrySkipped: true) re-attempts artists the exclusion would otherwise defer', async () => {
    const target = artist({ name: 'Harpy', rostrUrl: 'https://www.rostr.cc/profile/harpy' });
    const existingLog = {
      source: 'itunes',
      runs: [],
      filled: [],
      skipped: [{ name: 'Harpy', rostrUrl: target.rostrUrl, reason: 'ambiguousName', competingGenres: ['Pop', 'Rock'], matchCount: 2 }],
    };
    const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'Harpy', genre: 'Rock' })] }));

    const { artists, stats } = await backfillGenres(
      { artists: [target], genres: ROSTER_GENRES },
      { searchArtist, existingLog, retrySkipped: true }
    );

    expect(searchArtist).toHaveBeenCalledTimes(1);
    expect(artists[0].genres).toEqual(['Rock']);
    expect(stats.alreadySkipped).toBe(0);
    expect(stats.attempted).toBe(1);
  });

  it('--retry-reasons re-attempts only artists most recently skipped under a listed reason, leaving other permanent skips excluded', async () => {
    const unmappable = artist({ name: 'Was Unmappable', rostrUrl: 'https://www.rostr.cc/profile/was-unmappable' });
    const ambiguous = artist({ name: 'Was Ambiguous', rostrUrl: 'https://www.rostr.cc/profile/was-ambiguous' });
    const existingLog = {
      source: 'itunes',
      runs: [],
      filled: [],
      skipped: [
        { name: 'Was Unmappable', rostrUrl: unmappable.rostrUrl, reason: 'unmappableGenre' },
        { name: 'Was Ambiguous', rostrUrl: ambiguous.rostrUrl, reason: 'ambiguousName', competingGenres: ['Pop', 'Rock'], matchCount: 2 },
      ],
    };
    const searchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, genre: 'Pop' })] }));

    const { artists, stats } = await backfillGenres(
      { artists: [unmappable, ambiguous], genres: ROSTER_GENRES },
      { searchArtist, existingLog, retryReasons: new Set(['unmappableGenre']) }
    );

    // Only the unmappableGenre artist was re-attempted.
    expect(searchArtist).toHaveBeenCalledTimes(1);
    expect(searchArtist).toHaveBeenCalledWith('Was Unmappable');
    expect(artists[0].genres).toEqual(['Pop']);
    // The ambiguousName artist stayed excluded, untouched.
    expect(artists[1].genres).toEqual([]);
    expect(stats.attempted).toBe(1);
    expect(stats.alreadySkipped).toBe(1);
  });

  it('behaves exactly as before when there is no existing log (fresh start, existingLog: null / omitted)', async () => {
    const targets = [artist({ name: 'Will Fill' }), artist({ name: 'Will Skip' })];
    const searchArtist = vi.fn(async name => {
      if (name === 'Will Fill') return { results: [itunesArtist({ name, genre: 'Pop' })] };
      return { results: [] };
    });

    const withNullLog = await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist, existingLog: null });
    expect(withNullLog.stats.alreadySkipped).toBe(0);
    expect(withNullLog.stats.attempted).toBe(2);
    expect(withNullLog.stats.filled).toBe(1);
    expect(withNullLog.stats.skipped.noNameMatch).toBe(1);

    const withOmittedLog = await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist });
    expect(withOmittedLog.stats.alreadySkipped).toBe(0);
    expect(withOmittedLog.stats.attempted).toBe(2);
  });
});

function filledEntry(overrides = {}) {
  return {
    name: 'Nova Rivers',
    rostrUrl: 'https://www.rostr.cc/profile/nova-rivers',
    primaryGenreName: 'Alternative',
    mappedGenre: 'Alternative',
    matchType: 'unique',
    matchCount: 1,
    artistId: 1,
    artistLinkUrl: 'https://music.apple.com/us/artist/nova-rivers/1',
    ...overrides,
  };
}

function skippedEntry(overrides = {}) {
  return {
    name: 'Ambiguous Artist',
    rostrUrl: 'https://www.rostr.cc/profile/ambiguous-artist',
    reason: 'ambiguousName',
    competingGenres: ['Pop', 'Rock'],
    matchCount: 2,
    ...overrides,
  };
}

function runMeta(overrides = {}) {
  return {
    generatedAt: '2026-08-17T00:00:00.000Z',
    source: 'itunes',
    stats: { totalArtists: 7230, eligible: 3010, attempted: 500, filled: 350, skipped: {} },
    unmappedGenres: {},
    ...overrides,
  };
}

describe('mergeProvenanceLog', () => {
  it('starts a fresh log when there is no existing one', () => {
    const merged = mergeProvenanceLog(null, runMeta(), { filled: [filledEntry()], skipped: [skippedEntry()] });
    expect(merged.source).toBe('itunes');
    expect(merged.runs).toEqual([runMeta()]);
    expect(merged.filled).toEqual([filledEntry()]);
    expect(merged.skipped).toEqual([skippedEntry()]);
  });

  it('appends a new run to an existing run history without disturbing prior runs', () => {
    const run1 = mergeProvenanceLog(null, runMeta({ generatedAt: 'run-1' }), { filled: [], skipped: [] });
    const run2 = mergeProvenanceLog(run1, runMeta({ generatedAt: 'run-2' }), { filled: [], skipped: [] });
    expect(run2.runs.map(r => r.generatedAt)).toEqual(['run-1', 'run-2']);
  });

  it('does not duplicate an artist that appears in consecutive runs — the later run wins', () => {
    const chunk1 = { filled: [filledEntry({ mappedGenre: 'Alternative' })], skipped: [] };
    const merged1 = mergeProvenanceLog(null, runMeta({ generatedAt: 'run-1' }), chunk1);

    // Same rostrUrl re-examined in a later run (e.g. a rerun after an alias
    // fix) with a different result — must replace, not duplicate.
    const chunk2 = { filled: [filledEntry({ mappedGenre: 'Rock', matchType: 'unanimous', matchCount: 3 })], skipped: [] };
    const merged2 = mergeProvenanceLog(merged1, runMeta({ generatedAt: 'run-2' }), chunk2);

    expect(merged2.filled).toHaveLength(1);
    expect(merged2.filled[0].mappedGenre).toBe('Rock');
    expect(merged2.filled[0].matchType).toBe('unanimous');
  });

  it('moves an artist from skipped to filled across runs, leaving no stale skipped entry behind', () => {
    const chunk1 = { filled: [], skipped: [skippedEntry({ rostrUrl: 'https://www.rostr.cc/profile/harpy', reason: 'ambiguousName' })] };
    const merged1 = mergeProvenanceLog(null, runMeta({ generatedAt: 'run-1' }), chunk1);
    expect(merged1.skipped).toHaveLength(1);
    expect(merged1.filled).toHaveLength(0);

    const chunk2 = { filled: [filledEntry({ rostrUrl: 'https://www.rostr.cc/profile/harpy', name: 'Harpy', mappedGenre: 'Rock' })], skipped: [] };
    const merged2 = mergeProvenanceLog(merged1, runMeta({ generatedAt: 'run-2' }), chunk2);

    expect(merged2.filled).toHaveLength(1);
    expect(merged2.filled[0].rostrUrl).toBe('https://www.rostr.cc/profile/harpy');
    expect(merged2.skipped).toHaveLength(0);
  });

  it('moves an artist from filled to skipped across runs just as readily (the reverse direction also must not double up)', () => {
    const chunk1 = { filled: [filledEntry({ rostrUrl: 'https://www.rostr.cc/profile/x' })], skipped: [] };
    const merged1 = mergeProvenanceLog(null, runMeta({ generatedAt: 'run-1' }), chunk1);

    const chunk2 = { filled: [], skipped: [skippedEntry({ rostrUrl: 'https://www.rostr.cc/profile/x', reason: 'unmappableGenre' })] };
    const merged2 = mergeProvenanceLog(merged1, runMeta({ generatedAt: 'run-2' }), chunk2);

    expect(merged2.filled).toHaveLength(0);
    expect(merged2.skipped).toHaveLength(1);
    expect(merged2.skipped[0].reason).toBe('unmappableGenre');
  });

  it('preserves unrelated artists from earlier runs untouched', () => {
    const chunk1 = {
      filled: [filledEntry({ rostrUrl: 'https://www.rostr.cc/profile/a', name: 'A' })],
      skipped: [skippedEntry({ rostrUrl: 'https://www.rostr.cc/profile/b', name: 'B' })],
    };
    const merged1 = mergeProvenanceLog(null, runMeta({ generatedAt: 'run-1' }), chunk1);

    const chunk2 = { filled: [filledEntry({ rostrUrl: 'https://www.rostr.cc/profile/c', name: 'C' })], skipped: [] };
    const merged2 = mergeProvenanceLog(merged1, runMeta({ generatedAt: 'run-2' }), chunk2);

    expect(merged2.filled.map(e => e.name).sort()).toEqual(['A', 'C']);
    expect(merged2.skipped.map(e => e.name)).toEqual(['B']);
  });
});

describe('loadExistingProvenanceLog', () => {
  it('returns null when no file exists yet — the normal first-run case', () => {
    expect(loadExistingProvenanceLog(join(workDir, 'nope.json'))).toBeNull();
  });

  it('reads and returns a valid existing log', () => {
    const logPath = join(workDir, 'log.json');
    const existing = { source: 'itunes', runs: [runMeta()], filled: [filledEntry()], skipped: [] };
    writeFileSync(logPath, JSON.stringify(existing));

    expect(loadExistingProvenanceLog(logPath)).toEqual(existing);
  });

  it('throws rather than silently discarding when the file is not valid JSON', () => {
    const logPath = join(workDir, 'corrupt.json');
    writeFileSync(logPath, '{ this is not json');

    expect(() => loadExistingProvenanceLog(logPath)).toThrow(/not valid JSON/);
  });

  it('throws when the file is valid JSON but does not match the expected shape', () => {
    const logPath = join(workDir, 'wrong-shape.json');
    writeFileSync(logPath, JSON.stringify({ some: 'other thing' }));

    expect(() => loadExistingProvenanceLog(logPath)).toThrow(/expected shape/);
  });
});
