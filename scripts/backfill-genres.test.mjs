import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Mocked at the module level (hoisted by vitest above these imports) so the
// --discography integration tests below can control exactly what
// resolveByDiscography returns without also having to satisfy its real
// acceptance-rule math — that math is scripts/discography-match.test.mjs's
// job. Every OTHER test in this file passes discography: false (the
// default), so backfillGenres/tryFillOne never call this mock at all —
// which is itself part of what the "no Spotify fetcher without --discography"
// tests below are checking.
vi.mock('./discography-match.mjs', () => ({ resolveByDiscography: vi.fn() }));

import {
  backfillGenres, isExactNameMatch, normalizeItunesGenreTag, mapItunesGenre,
  uniqueEmailCount, ITUNES_GENRE_ALIASES, mergeProvenanceLog, loadExistingProvenanceLog,
  PERMANENT_SKIP_REASONS, validateRetryReasons, NON_MUSIC_GENRES, isNonMusicGenre,
  makeSpotifyFetcher, SpotifyQuotaExhaustedError, selectSoleRouteArtists,
} from './backfill-genres.mjs';
import { resolveByDiscography } from './discography-match.mjs';

// Fixtures for loadExistingProvenanceLog live in the OS temp dir, not the
// repo — cleaned up after every test.
let workDir;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'backfill-genres-test-'));
  resolveByDiscography.mockReset();
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
  // Targets of the 2026-08-21 alias additions (Part 2) — same reasoning.
  'Underground Hip Hop', 'Old School Hip Hop', 'West Coast Hip Hop', 'Southern Hip Hop',
  'Gangster Rap', 'Latin Hip Hop', 'Christian Hip Hop', 'K Rap', 'K Rock', 'Classical',
  'Desi', 'Bhangra', 'Brazilian Pop', 'Funk Carioca', 'Latin', 'Rock En Español',
  'Drum And Bass', 'Bass Music', 'Uk Garage', 'Pop Rock', 'Rock And Roll', 'Progressive Rock',
  'Gothic Rock', 'Death Metal', 'Psychedelic Rock', 'Americana', 'Blues', 'Faith Music',
  'Devotional', 'Dancehall', 'Christmas', 'Adult Standards', 'New Age', 'Classical Piano',
  'Score', 'Soundtrack',
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
    // "Punjabi" used to be in this bucket alongside "Arabic" — as of the
    // 2026-08-21 additions it has a real alias target ("Bhangra"), so it
    // moved to the describe block below. "Arabic" stays unmapped: see
    // ITUNES_GENRE_ALIASES's trailing market/format comment.
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

    it('leaves the remaining deliberately-unmapped tags unresolved (no alias added for them, on purpose)', () => {
      // "Worldwide" and "Self-Development" are evidence of a wrong iTunes
      // match (a podcast/audiobook sharing a musician's name), not a genre
      // gap; "Instrumental" has no honest equivalent in the roster
      // vocabulary. See ITUNES_GENRE_ALIASES's trailing comment in
      // backfill-genres.mjs for the full reasoning. "Easy Listening" used to
      // be in this group too — see the dedicated test below for why it
      // isn't anymore.
      expect(mapItunesGenre('Worldwide', rosterGenreByLower)).toBeNull();
      expect(mapItunesGenre('Instrumental', rosterGenreByLower)).toBeNull();
      expect(mapItunesGenre('Self-Development', rosterGenreByLower)).toBeNull();
    });
  });

  describe('the aliases added 2026-08-21, targeting a slice of the 894 skipped after the iTunes walk', () => {
    it('resolves a representative tag from each family to its documented target', () => {
      // Not exhaustive by hand — the "every alias table entry actually
      // resolves" test above already loops every entry in
      // ITUNES_GENRE_ALIASES, this alias table included. These spot-check
      // one per family so a family-level regression fails somewhere
      // legible, not just in the generic loop.
      expect(mapItunesGenre('Underground Rap', rosterGenreByLower)).toBe('Underground Hip Hop');
      expect(mapItunesGenre('Hardcore Rap', rosterGenreByLower)).toBe('Hip Hop & Rap');
      expect(mapItunesGenre('Korean Hip Hop', rosterGenreByLower)).toBe('K Rap');
      expect(mapItunesGenre('Korean Rock', rosterGenreByLower)).toBe('K Rock');
      expect(mapItunesGenre('Telugu', rosterGenreByLower)).toBe('Desi');
      expect(mapItunesGenre('Punjabi', rosterGenreByLower)).toBe('Bhangra');
      expect(mapItunesGenre('Brazilian', rosterGenreByLower)).toBe('Brazilian Pop');
      expect(mapItunesGenre('Bass', rosterGenreByLower)).toBe('Bass Music');
      expect(mapItunesGenre('Pop/Rock', rosterGenreByLower)).toBe('Pop Rock');
      expect(mapItunesGenre('New Acoustic', rosterGenreByLower)).toBe('Folk');
      expect(mapItunesGenre('Teen Pop', rosterGenreByLower)).toBe('Pop');
      expect(mapItunesGenre('Praise & Worship', rosterGenreByLower)).toBe('Faith Music');
      expect(mapItunesGenre('Holiday', rosterGenreByLower)).toBe('Christmas');
      expect(mapItunesGenre('Easy Listening', rosterGenreByLower)).toBe('Adult Standards');
      expect(mapItunesGenre('Piano', rosterGenreByLower)).toBe('Classical Piano');
    });

    it('maps "Punjabi" to "Bhangra" now that it has a real target, unlike "Arabic" which stays unmapped', () => {
      // The two used to be discussed as a pair with no defensible target.
      // Bhangra is a real, specific roster genre for Punjabi-language music;
      // nothing comparable exists for Arabic, so it's still deliberately
      // left off ITUNES_GENRE_ALIASES.
      expect(mapItunesGenre('Punjabi', rosterGenreByLower)).toBe('Bhangra');
      expect(mapItunesGenre('Arabic', rosterGenreByLower)).toBeNull();
    });

    it('leaves the market/format tags unresolved — they describe WHERE or in what FORM, not a genre', () => {
      const marketOrFormatTags = [
        'Worldwide', 'Instrumental', 'Vocal', 'Asia', 'Europe', 'France',
        'Israeli', 'Afrikaans', 'Farsi', 'Worldbeat', 'Arabic',
      ];
      for (const tag of marketOrFormatTags) {
        expect(mapItunesGenre(tag, rosterGenreByLower), `"${tag}" should stay unmapped`).toBeNull();
      }
    });
  });
});

describe('NON_MUSIC_GENRES / isNonMusicGenre', () => {
  it('recognises every documented non-music Store category', () => {
    for (const category of NON_MUSIC_GENRES) {
      expect(isNonMusicGenre(category)).toBe(true);
    }
  });

  it('compares case-insensitively — callers should never rely on iTunes casing staying fixed', () => {
    expect(isNonMusicGenre('fiction')).toBe(true);
    expect(isNonMusicGenre('FICTION')).toBe(true);
    expect(isNonMusicGenre('Historical Romance')).toBe(true);
    expect(isNonMusicGenre('historical romance')).toBe(true);
  });

  it('returns false for real music genres and for nullish/empty input', () => {
    expect(isNonMusicGenre('Pop')).toBe(false);
    expect(isNonMusicGenre('Alternative')).toBe(false);
    expect(isNonMusicGenre('')).toBe(false);
    expect(isNonMusicGenre(null)).toBe(false);
    expect(isNonMusicGenre(undefined)).toBe(false);
  });
});

describe('ITUNES_GENRE_ALIASES against the real roster vocabulary', () => {
  // The ROSTER_GENRES fixture above is a curated stand-in, not the real
  // thing — this reads the actual data/roster.json so a typo'd alias target
  // that happens to slip past the fixture (e.g. because the fixture was
  // hand-updated alongside the alias) still fails loudly here.
  it('every alias target exists verbatim in the real data/roster.json genres array', () => {
    const realRosterPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'roster.json');
    const realRoster = JSON.parse(readFileSync(realRosterPath, 'utf-8'));
    const realGenreSet = new Set(realRoster.genres);
    for (const [tag, target] of ITUNES_GENRE_ALIASES) {
      expect(realGenreSet.has(target), `alias "${tag}" -> "${target}" must exist verbatim in the real roster.json genres array`).toBe(true);
    }
  });
});

describe('isExactNameMatch', () => {
  it('matches names case-insensitively but not fuzzily', () => {
    expect(isExactNameMatch('SZA', 'sza')).toBe(true);
    expect(isExactNameMatch('SZA', 'SZA Official')).toBe(false);
  });
});

describe('selectSoleRouteArtists (the --only-unreachable selection)', () => {
  it('qualifies a genre-less artist whose manager inbox no OTHER artist reaches', () => {
    const solo = artist({ name: 'Solo Route', rostrUrl: 'https://www.rostr.cc/profile/solo-route', genres: [], managerEmails: ['solo@example.com'] });
    const { qualifyingUrls, inboxCount } = selectSoleRouteArtists([solo]);
    expect(qualifyingUrls.has(solo.rostrUrl)).toBe(true);
    expect(inboxCount).toBe(1);
  });

  it('does NOT qualify a genre-less artist whose inbox is already reached by a different, genre-tagged artist', () => {
    const tagged = artist({ name: 'Has A Genre', rostrUrl: 'https://www.rostr.cc/profile/has-a-genre', genres: ['Pop'], managerEmails: ['shared@example.com'] });
    const genreless = artist({ name: 'No Genre Yet', rostrUrl: 'https://www.rostr.cc/profile/no-genre-yet', genres: [], managerEmails: ['shared@example.com'] });
    const { qualifyingUrls, inboxCount } = selectSoleRouteArtists([tagged, genreless]);
    expect(qualifyingUrls.has(genreless.rostrUrl)).toBe(false);
    expect(inboxCount).toBe(0);
  });

  it('qualifies an artist with several manager addresses when ANY ONE of them is unreachable', () => {
    const tagged = artist({ name: 'Has A Genre', rostrUrl: 'https://www.rostr.cc/profile/has-a-genre', genres: ['Pop'], managerEmails: ['reachable@example.com'] });
    const multi = artist({
      name: 'Multi Address', rostrUrl: 'https://www.rostr.cc/profile/multi-address', genres: [],
      managerEmails: ['reachable@example.com', 'unreachable@example.com'],
    });
    const { qualifyingUrls, inboxCount } = selectSoleRouteArtists([tagged, multi]);
    expect(qualifyingUrls.has(multi.rostrUrl)).toBe(true);
    // Only the one genuinely-unreachable address counts toward inboxCount —
    // "reachable@example.com" is covered by the genre-tagged artist and does
    // not unlock anything new.
    expect(inboxCount).toBe(1);
  });

  it('normalises addresses with trim().toLowerCase() before comparing, so casing/whitespace differences do not create a false inbox', () => {
    const tagged = artist({ name: 'Has A Genre', rostrUrl: 'https://www.rostr.cc/profile/has-a-genre', genres: ['Pop'], managerEmails: ['Manager@Label.com'] });
    const genreless = artist({ name: 'No Genre Yet', rostrUrl: 'https://www.rostr.cc/profile/no-genre-yet', genres: [], managerEmails: [' manager@label.com '] });
    const { qualifyingUrls, inboxCount } = selectSoleRouteArtists([tagged, genreless]);
    // Same inbox under different casing/whitespace -> already reachable, so
    // the genre-less artist does not qualify.
    expect(qualifyingUrls.has(genreless.rostrUrl)).toBe(false);
    expect(inboxCount).toBe(0);
  });

  it('never qualifies an artist that already has a genre, even if its address is otherwise unique', () => {
    const tagged = artist({ name: 'Has A Genre', rostrUrl: 'https://www.rostr.cc/profile/has-a-genre', genres: ['Pop'], managerEmails: ['unique@example.com'] });
    const { qualifyingUrls, inboxCount } = selectSoleRouteArtists([tagged]);
    expect(qualifyingUrls.has(tagged.rostrUrl)).toBe(false);
    expect(inboxCount).toBe(0);
  });

  it('counts one inbox once even when several qualifying artists share the same unreachable address', () => {
    const a = artist({ name: 'Shares A', rostrUrl: 'https://www.rostr.cc/profile/shares-a', genres: [], managerEmails: ['shared-unreached@example.com'] });
    const b = artist({ name: 'Shares B', rostrUrl: 'https://www.rostr.cc/profile/shares-b', genres: [], managerEmails: ['shared-unreached@example.com'] });
    const { qualifyingUrls, inboxCount } = selectSoleRouteArtists([a, b]);
    expect(qualifyingUrls.has(a.rostrUrl)).toBe(true);
    expect(qualifyingUrls.has(b.rostrUrl)).toBe(true);
    expect(inboxCount).toBe(1);
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

  describe('non-music discard and map-then-compare agreement (2026-08-21)', () => {
    it('skips with onlyNonMusicMatches when every genre-bearing exact match is a non-music Store category', async () => {
      const target = artist({ name: 'James Newman' });
      const searchArtist = vi.fn(async () => ({
        results: [
          itunesArtist({ name: 'James Newman', artistId: 1, genre: 'Fiction' }),
          itunesArtist({ name: 'James Newman', artistId: 2, genre: 'Horror' }),
        ],
      }));

      const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
      expect(stats.skipped.onlyNonMusicMatches).toBe(1);
      expect(artists[0].genres).toEqual([]);
      const entry = log.skipped.find(e => e.reason === 'onlyNonMusicMatches');
      expect(entry).toMatchObject({ name: 'James Newman', rostrUrl: target.rostrUrl });
      expect(entry.candidateGenres.sort()).toEqual(['Fiction', 'Horror']);
    });

    it('fills as Pop when candidates are "Pop" and "Historical Romance" — the non-music candidate is discarded, not treated as a competing genre', async () => {
      const target = artist({ name: 'Will Jay' });
      const searchArtist = vi.fn(async () => ({
        results: [
          itunesArtist({ name: 'Will Jay', artistId: 1, genre: 'Pop' }),
          itunesArtist({ name: 'Will Jay', artistId: 2, genre: 'Historical Romance' }),
        ],
      }));

      const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
      expect(artists[0].genres).toEqual(['Pop']);
      expect(stats.filled).toBe(1);
      expect(stats.skipped.ambiguousName).toBe(0);
      expect(log.filled[0]).toMatchObject({ mappedGenre: 'Pop', matchType: 'unique', matchCount: 1 });
      expect(log.filled[0].discardedNonMusic).toEqual(['Historical Romance']);
      expect(log.filled[0].candidateGenres.sort()).toEqual(['Historical Romance', 'Pop']);
    });

    it('fills as Alternative when candidates are "Alternative" and "Worldwide" — "Worldwide" never maps, so it drops out rather than counting as a conflict', async () => {
      const target = artist({ name: 'Peter Fenn' });
      const searchArtist = vi.fn(async () => ({
        results: [
          itunesArtist({ name: 'Peter Fenn', artistId: 1, genre: 'Alternative' }),
          itunesArtist({ name: 'Peter Fenn', artistId: 2, genre: 'Worldwide' }),
        ],
      }));

      const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
      expect(artists[0].genres).toEqual(['Alternative']);
      expect(stats.filled).toBe(1);
      expect(stats.skipped.ambiguousName).toBe(0);
      expect(log.filled[0]).toMatchObject({ mappedGenre: 'Alternative', matchType: 'unique', matchCount: 1 });
      expect(log.filled[0].discardedUnmappable).toEqual(['Worldwide']);
      // "Worldwide" is a real genre tag, not a Store category — it's
      // discarded at the mapping step, not the non-music step.
      expect(log.filled[0].discardedNonMusic).toEqual([]);
    });

    it('treats two different raw spellings that map to the same roster genre as agreement (unanimous), not ambiguousName', async () => {
      const target = artist({ name: 'DJ Kappa' });
      const searchArtist = vi.fn(async () => ({
        results: [
          itunesArtist({ name: 'DJ Kappa', artistId: 1, genre: 'Hip-Hop/Rap' }), // aliased
          itunesArtist({ name: 'DJ Kappa', artistId: 2, genre: 'Hip Hop & Rap' }), // direct match
        ],
      }));

      const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
      expect(artists[0].genres).toEqual(['Hip Hop & Rap']);
      expect(stats.filled).toBe(1);
      expect(stats.skipped.ambiguousName).toBe(0);
      expect(log.filled[0].matchType).toBe('unanimous');
      expect(log.filled[0].matchCount).toBe(2);
      expect(log.filled[0].candidateGenres.sort()).toEqual(['Hip Hop & Rap', 'Hip-Hop/Rap']);
    });

    it('still skips as ambiguousName when distinct MAPPED genres survive, even after discarding non-music and unmappable candidates', async () => {
      const target = artist({ name: 'Multi Match' });
      const searchArtist = vi.fn(async () => ({
        results: [
          itunesArtist({ name: 'Multi Match', artistId: 1, genre: 'Pop' }),
          itunesArtist({ name: 'Multi Match', artistId: 2, genre: 'Fiction' }), // discarded: non-music
          itunesArtist({ name: 'Multi Match', artistId: 3, genre: 'Worldwide' }), // discarded: unmappable
          itunesArtist({ name: 'Multi Match', artistId: 4, genre: 'Rock' }),
        ],
      }));

      const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
      expect(artists[0].genres).toEqual([]);
      expect(stats.skipped.ambiguousName).toBe(1);
      const entry = log.skipped.find(e => e.reason === 'ambiguousName');
      expect(entry.competingGenres.sort()).toEqual(['Pop', 'Rock']);
      expect(entry.matchCount).toBe(4); // exactMatches.length, unchanged from before this rule existed
      // Audit-parity fix (2026-08-21): an ambiguousName entry now carries the
      // same raw-candidate provenance a filled or unmappableGenre entry does.
      expect(entry.candidateGenres.sort()).toEqual(['Fiction', 'Pop', 'Rock', 'Worldwide']);
      expect(entry.discardedNonMusic).toEqual(['Fiction']);
      expect(entry.discardedUnmappable).toEqual(['Worldwide']);
    });

    it('skips with unmappableGenre, carrying discardedNonMusic/discardedUnmappable provenance, when survivors exist but none map', async () => {
      const target = artist({ name: 'Untaggable Two' });
      const searchArtist = vi.fn(async () => ({
        results: [
          itunesArtist({ name: 'Untaggable Two', artistId: 1, genre: 'Worldwide' }),
          itunesArtist({ name: 'Untaggable Two', artistId: 2, genre: 'Fiction' }),
        ],
      }));

      const { stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
      expect(stats.skipped.unmappableGenre).toBe(1);
      expect(stats.unmappedGenres.get('Worldwide')).toBe(1);
      const entry = log.skipped.find(e => e.reason === 'unmappableGenre');
      expect(entry.candidateGenres.sort()).toEqual(['Fiction', 'Worldwide']);
      expect(entry.discardedNonMusic).toEqual(['Fiction']);
      expect(entry.discardedUnmappable).toEqual(['Worldwide']);
    });
  });

  describe('--discography (2026-08-21) — wiring into the ambiguousName tie only', () => {
    // resolveByDiscography itself is mocked at the top of this file, so
    // these tests exercise ONLY the wiring in tryFillOne/backfillGenres —
    // whether it's called at all, with what arguments, and how its return
    // value becomes a fill or a specific skip reason. The acceptance-rule
    // math (avatar/name thresholds, the 3x margin, batching, the truncation
    // guard) is scripts/discography-match.test.mjs's job.
    function ambiguousArtist(name = 'Multi Match') {
      return artist({ name });
    }
    function ambiguousSearchArtist(name = 'Multi Match') {
      return vi.fn(async () => ({
        results: [
          itunesArtist({ name, artistId: 1, genre: 'Pop' }),
          itunesArtist({ name, artistId: 2, genre: 'Rock' }),
        ],
      }));
    }

    it('never calls resolveByDiscography, and no discography-only reason can appear, when discography is false (the default)', async () => {
      const target = ambiguousArtist();
      const searchArtist = ambiguousSearchArtist();

      const { stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
      expect(resolveByDiscography).not.toHaveBeenCalled();
      expect(stats.skipped.ambiguousName).toBe(1);
      expect(stats.skipped.spotifyArtistNotFound).toBe(0);
      expect(stats.skipped.noSpotifyReleases).toBe(0);
      expect(stats.skipped.discographyInconclusive).toBe(0);
    });

    it('never calls resolveByDiscography when there is no ambiguousName tie to break, even with discography: true', async () => {
      const target = artist({ name: 'Nova Rivers' });
      const searchArtist = vi.fn(async () => ({ results: [itunesArtist({ name: 'Nova Rivers', genre: 'Pop' })] }));

      const { artists } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist, discography: true, discographyDeps: {} });
      expect(resolveByDiscography).not.toHaveBeenCalled();
      expect(artists[0].genres).toEqual(['Pop']);
    });

    it('fills with matchType "discography" and the full provenance when resolveByDiscography resolves', async () => {
      const target = ambiguousArtist();
      const searchArtist = ambiguousSearchArtist();
      const scoreboard = [
        { artistId: 1, rawGenre: 'Pop', mappedGenre: 'Pop', releaseCount: 12, overlap: 9 },
        { artistId: 2, rawGenre: 'Rock', mappedGenre: 'Rock', releaseCount: 5, overlap: 1 },
      ];
      resolveByDiscography.mockResolvedValueOnce({
        resolved: true,
        winner: { item: { artistId: 1, primaryGenreName: 'Pop', artistLinkUrl: 'https://music.apple.com/artist/1' }, mapped: 'Pop' },
        pinMethod: 'avatar',
        spotifyArtistId: 'sp-123',
        ourReleaseCount: 12,
        scoreboard,
      });
      const discographyDeps = { spotifySearchArtist: vi.fn(), spotifyArtistAlbums: vi.fn(), itunesLookupAlbums: vi.fn() };

      const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist, discography: true, discographyDeps });

      expect(resolveByDiscography).toHaveBeenCalledTimes(1);
      // Called with the roster artist and the surviving mapped candidates —
      // not the raw exact-match list, and with the injected deps untouched.
      const [calledArtist, calledCandidates, calledDeps] = resolveByDiscography.mock.calls[0];
      expect(calledArtist.name).toBe('Multi Match');
      expect(calledCandidates).toHaveLength(2);
      expect(calledDeps).toBe(discographyDeps);

      expect(artists[0].genres).toEqual(['Pop']);
      expect(stats.filled).toBe(1);
      expect(stats.skipped.ambiguousName).toBe(0);
      expect(log.filled).toHaveLength(1);
      expect(log.filled[0]).toMatchObject({
        name: 'Multi Match',
        mappedGenre: 'Pop',
        matchType: 'discography',
        matchCount: 1,
        artistId: 1,
        pinMethod: 'avatar',
        spotifyArtistId: 'sp-123',
        ourReleaseCount: 12,
      });
      expect(log.filled[0].scoreboard).toEqual(scoreboard);
      expect(log.filled[0].candidateGenres.sort()).toEqual(['Pop', 'Rock']);
    });

    it.each(['spotifyArtistNotFound', 'noSpotifyReleases', 'discographyInconclusive'])(
      'skips with reason %s (not ambiguousName) when resolveByDiscography returns that reason, carrying candidateGenres/discardedNonMusic/discardedUnmappable',
      async reason => {
        const target = ambiguousArtist();
        const searchArtist = ambiguousSearchArtist();
        const scoreboard = reason === 'discographyInconclusive'
          ? [{ artistId: 1, rawGenre: 'Pop', mappedGenre: 'Pop', releaseCount: 3, overlap: 1 }, { artistId: 2, rawGenre: 'Rock', mappedGenre: 'Rock', releaseCount: 2, overlap: 1 }]
          : [];
        resolveByDiscography.mockResolvedValueOnce({ resolved: false, reason, scoreboard });
        const discographyDeps = { spotifySearchArtist: vi.fn(), spotifyArtistAlbums: vi.fn(), itunesLookupAlbums: vi.fn() };

        const { artists, stats, log } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist, discography: true, discographyDeps });

        expect(artists[0].genres).toEqual([]);
        expect(stats.skipped[reason]).toBe(1);
        expect(stats.skipped.ambiguousName).toBe(0); // NOT counted as ambiguousName — see PERMANENT_SKIP_REASONS
        const entry = log.skipped.find(e => e.reason === reason);
        expect(entry).toBeTruthy();
        expect(entry.competingGenres.sort()).toEqual(['Pop', 'Rock']);
        expect(entry.candidateGenres.sort()).toEqual(['Pop', 'Rock']);
        expect(entry.discardedNonMusic).toEqual([]);
        expect(entry.discardedUnmappable).toEqual([]);
        expect(entry.scoreboard).toEqual(scoreboard);
      }
    );
  });
});

describe('backfillGenres — progress reporting (onProgress)', () => {
  it('emits nothing at all when no onProgress is supplied — the default for every other test in this file', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const targets = [artist({ name: 'Will Fill' }), artist({ name: 'Will Skip' })];
    const searchArtist = vi.fn(async name => {
      if (name === 'Will Fill') return { results: [itunesArtist({ name, genre: 'Pop' })] };
      return { results: [] };
    });

    const { stats } = await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist });

    expect(stats.attempted).toBe(2); // the run itself still happened normally
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('emits one "attempt" event per attempted artist, carrying position/total and the fill/skip outcome', async () => {
    const targets = [
      artist({ name: 'Will Fill', rostrUrl: 'https://www.rostr.cc/profile/will-fill' }),
      artist({ name: 'Will Skip', rostrUrl: 'https://www.rostr.cc/profile/will-skip' }),
    ];
    const searchArtist = vi.fn(async name => {
      if (name === 'Will Fill') return { results: [itunesArtist({ name, genre: 'Pop' })] };
      return { results: [] };
    });
    const events = [];

    await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist, onProgress: e => events.push(e) });

    const attempts = events.filter(e => e.type === 'attempt');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      index: 1, total: 2, name: 'Will Fill', filled: true, genre: 'Pop', reason: null, discography: false, winningOverlap: null,
    });
    expect(attempts[1]).toMatchObject({
      index: 2, total: 2, name: 'Will Skip', filled: false, genre: null, reason: 'noNameMatch', discography: false, winningOverlap: null,
    });
  });

  it('never fires an "attempt" event for an artist skipped as already-permanently-skipped or over the --limit — those are never attempted', async () => {
    const excluded = artist({ name: 'Excluded', rostrUrl: 'https://www.rostr.cc/profile/excluded' });
    const overLimit = artist({ name: 'Over Limit', rostrUrl: 'https://www.rostr.cc/profile/over-limit' });
    const attempted = artist({ name: 'Attempted', rostrUrl: 'https://www.rostr.cc/profile/attempted' });
    const existingLog = {
      source: 'itunes', runs: [], filled: [],
      skipped: [{ name: 'Excluded', rostrUrl: excluded.rostrUrl, reason: 'ambiguousName', competingGenres: ['Pop', 'Rock'], matchCount: 2 }],
    };
    const searchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, genre: 'Pop' })] }));
    const events = [];

    await backfillGenres(
      { artists: [excluded, attempted, overLimit], genres: ROSTER_GENRES },
      { searchArtist, existingLog, limit: 1, onProgress: e => events.push(e) }
    );

    const attempts = events.filter(e => e.type === 'attempt');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ index: 1, total: 1, name: 'Attempted' });
  });

  it('reports the discography resolution and the winning candidate\'s overlap for a discography-resolved fill', async () => {
    const target = artist({ name: 'Multi Match' });
    const searchArtist = vi.fn(async () => ({
      results: [
        itunesArtist({ name: 'Multi Match', artistId: 1, genre: 'Pop' }),
        itunesArtist({ name: 'Multi Match', artistId: 2, genre: 'Rock' }),
      ],
    }));
    resolveByDiscography.mockResolvedValueOnce({
      resolved: true,
      winner: { item: { artistId: 1, primaryGenreName: 'Pop', artistLinkUrl: 'https://music.apple.com/artist/1' }, mapped: 'Pop' },
      pinMethod: 'avatar',
      spotifyArtistId: 'sp-1',
      ourReleaseCount: 12,
      scoreboard: [
        { artistId: 1, rawGenre: 'Pop', mappedGenre: 'Pop', releaseCount: 12, overlap: 9 },
        { artistId: 2, rawGenre: 'Rock', mappedGenre: 'Rock', releaseCount: 5, overlap: 1 },
      ],
    });
    const discographyDeps = { spotifySearchArtist: vi.fn(), spotifyArtistAlbums: vi.fn(), itunesLookupAlbums: vi.fn() };
    const events = [];

    await backfillGenres(
      { artists: [target], genres: ROSTER_GENRES },
      { searchArtist, discography: true, discographyDeps, onProgress: e => events.push(e) }
    );

    const attempt = events.find(e => e.type === 'attempt');
    expect(attempt).toMatchObject({ filled: true, genre: 'Pop', discography: true, winningOverlap: 9 });
  });

  it('emits a "rate" event every 25 attempts, with the measured completed/total/elapsed/rate/projected finish', async () => {
    const targets = Array.from({ length: 50 }, (_, i) =>
      artist({ name: `Artist ${i}`, rostrUrl: `https://www.rostr.cc/profile/artist-${i}` })
    );
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    // Advances the mocked clock on every lookup so elapsedMs/perMinute are
    // non-trivial and deterministic, rather than depending on real wall time.
    const searchArtist = vi.fn(async name => { now += 100; return { results: [itunesArtist({ name, genre: 'Pop' })] }; });
    const events = [];

    await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist, onProgress: e => events.push(e) });
    nowSpy.mockRestore();

    const rateEvents = events.filter(e => e.type === 'rate');
    expect(rateEvents).toHaveLength(2); // fires at attempt 25 and attempt 50, never at 1-24 or 26-49
    expect(rateEvents[0]).toMatchObject({ completed: 25, total: 50 });
    expect(rateEvents[1]).toMatchObject({ completed: 50, total: 50 });
    expect(rateEvents[0].elapsedMs).toBe(2500); // 25 lookups * 100ms mocked advance each
    expect(rateEvents[0].perMinute).toBeCloseTo(600, 0); // 25 artists / 2500ms * 60000
    expect(rateEvents[0].projectedFinishAt).toBeInstanceOf(Date);
  });

  it('does not emit a "rate" event at all when fewer than 25 artists are attempted', async () => {
    const targets = Array.from({ length: 5 }, (_, i) => artist({ name: `Artist ${i}`, rostrUrl: `https://www.rostr.cc/profile/artist-${i}` }));
    const searchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, genre: 'Pop' })] }));
    const events = [];

    await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist, onProgress: e => events.push(e) });

    expect(events.filter(e => e.type === 'rate')).toHaveLength(0);
    expect(events.filter(e => e.type === 'attempt')).toHaveLength(5);
  });
});

describe('makeSpotifyFetcher — retry/timeout/ceiling/consecutive-429 abort (2026-08-22)', () => {
  // Fixes a real incident: a --discography --write run hung for 5h12m
  // (zero CPU, zero open sockets) because a Spotify 429's Retry-After had
  // no ceiling and Spotify hands an exhausted-quota client-credentials app
  // a Retry-After measured in HOURS. These tests exercise the retry logic
  // directly via an injected `fetchImpl` — no network, and fake timers
  // stand in for delay()'s real setTimeout so nothing here actually waits.
  const TOKEN_BODY = { access_token: 'fake-token', expires_in: 3600 };

  function fakeResponse({ ok = true, status = 200, statusText = 'OK', headers = {}, body = {} } = {}) {
    return { ok, status, statusText, headers: { get: name => headers[name] ?? null }, json: async () => body };
  }

  function fetcher(fetchImpl) {
    return makeSpotifyFetcher({ fetchImpl, clientId: 'test-client-id', clientSecret: 'test-client-secret' });
  }

  let warnSpy;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('sleeps and retries when Retry-After is exactly at the 60s ceiling, then succeeds', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ body: TOKEN_BODY }))
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '60' } }))
      .mockResolvedValueOnce(fakeResponse({ body: { artists: { items: [] } } }));
    const { searchArtist } = fetcher(fetchImpl);

    const promise = searchArtist('Some Artist', 0);
    // Needs to clear the 60s Retry-After sleep AND the smaller
    // SPOTIFY_CALL_SPACING_MS pause chained after the successful retry —
    // advancing by exactly 60_000 stops short of that second, later-
    // scheduled timer and leaves the promise pending.
    await vi.advanceTimersByTimeAsync(65_000);
    const result = await promise;

    expect(result).toEqual({ artists: { items: [] } });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // token, the 429, the retry that succeeds
    expect(warnSpy).toHaveBeenCalledTimes(1); // every 429 logged the moment it arrives
    expect(warnSpy.mock.calls[0][0]).toContain('Retry-After 60s');
  });

  it('throws SpotifyQuotaExhaustedError immediately — no sleep — when Retry-After exceeds the 60s ceiling, naming the offending value', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ body: TOKEN_BODY }))
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '7200' } }));
    const { searchArtist } = fetcher(fetchImpl);

    const err = await searchArtist('Some Artist', 0).catch(e => e);

    expect(err).toBeInstanceOf(SpotifyQuotaExhaustedError);
    expect(err.message).toContain('7200'); // names the offending value
    expect(err.message).toMatch(/quota/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // token + the single 429 — thrown, not slept through
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('retries a rejected fetch (e.g. a request timeout) as a transient failure, not a fatal one', async () => {
    vi.useFakeTimers();
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ body: TOKEN_BODY }))
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(fakeResponse({ body: { artists: { items: [] } } }));
    const { searchArtist } = fetcher(fetchImpl);

    const promise = searchArtist('Some Artist', 0);
    await vi.advanceTimersByTimeAsync(5_000); // covers the bounded exponential backoff wait
    const result = await promise;

    expect(result).toEqual({ artists: { items: [] } });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // token, the timed-out attempt, the successful retry
  });

  it('aborts with SpotifyQuotaExhaustedError after 3 consecutive 429s, even though each individual Retry-After is well under the ceiling', async () => {
    vi.useFakeTimers();
    const small429 = fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '1' } });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ body: TOKEN_BODY }))
      .mockResolvedValueOnce(small429)
      .mockResolvedValueOnce(small429)
      .mockResolvedValueOnce(small429);
    const { searchArtist } = fetcher(fetchImpl);

    // .catch() attached in the same tick as the call, before the fake-timer
    // advance below lets it actually reject — otherwise Node flags it as an
    // unhandled rejection first and only retroactively sees it "handled".
    const errPromise = searchArtist('Some Artist', 0).catch(e => e);
    await vi.advanceTimersByTimeAsync(10_000); // covers the 2 sleeps before the 3rd (aborting) 429
    const err = await errPromise;

    expect(err).toBeInstanceOf(SpotifyQuotaExhaustedError);
    expect(err.message).toMatch(/3 consecutive Spotify 429s/);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // token + 3 consecutive 429s, no 4th attempt
    expect(warnSpy).toHaveBeenCalledTimes(3); // every one of the 3 logged individually
  });

  it('resets the consecutive-429 count on a successful response — an isolated 429 does not abort the run', async () => {
    vi.useFakeTimers();
    const small429 = fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '1' } });
    const ok = fakeResponse({ body: { artists: { items: [] } } });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ body: TOKEN_BODY }))
      .mockResolvedValueOnce(small429).mockResolvedValueOnce(ok) // 1st call: one 429, then succeeds
      .mockResolvedValueOnce(small429).mockResolvedValueOnce(ok) // 2nd call: one 429, then succeeds
      .mockResolvedValueOnce(small429).mockResolvedValueOnce(ok); // 3rd call: one 429, then succeeds — never 3 IN A ROW
    const { searchArtist } = fetcher(fetchImpl);

    for (let i = 0; i < 3; i += 1) {
      const promise = searchArtist('Some Artist', 0);
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;
      expect(result).toEqual({ artists: { items: [] } });
    }
    expect(warnSpy).toHaveBeenCalledTimes(3); // one 429 per call — never aborted
  });
});

describe('PERMANENT_SKIP_REASONS', () => {
  it('contains exactly the eight reasons that are safe to never re-attempt, and neither lookupFailed nor overLimit', () => {
    expect([...PERMANENT_SKIP_REASONS].sort()).toEqual(
      [
        'ambiguousName', 'noGenreOnRecord', 'noNameMatch', 'onlyNonMusicMatches', 'unmappableGenre',
        // Added 2026-08-21 for --discography — see scripts/discography-match.mjs.
        'spotifyArtistNotFound', 'noSpotifyReleases', 'discographyInconclusive',
      ].sort()
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

  it('accepts the new onlyNonMusicMatches reason (2026-08-21) as a valid permanent-skip reason', () => {
    expect(validateRetryReasons('onlyNonMusicMatches')).toEqual(new Set(['onlyNonMusicMatches']));
  });

  it('accepts the three --discography skip reasons (2026-08-21) as valid permanent-skip reasons', () => {
    expect(validateRetryReasons('spotifyArtistNotFound,noSpotifyReleases,discographyInconclusive')).toEqual(
      new Set(['spotifyArtistNotFound', 'noSpotifyReleases', 'discographyInconclusive'])
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

describe('backfillGenres — --only-unreachable (onlyUnreachable)', () => {
  it('attempts only the sole-route artist, leaving a reachable-elsewhere artist completely untouched and uncounted against --limit', async () => {
    const tagged = artist({ name: 'Has A Genre', rostrUrl: 'https://www.rostr.cc/profile/has-a-genre', genres: ['Pop'], managerEmails: ['shared@example.com'] });
    const reachableElsewhere = artist({ name: 'Reachable Elsewhere', rostrUrl: 'https://www.rostr.cc/profile/reachable-elsewhere', genres: [], managerEmails: ['shared@example.com'] });
    const soleRoute = artist({ name: 'Sole Route', rostrUrl: 'https://www.rostr.cc/profile/sole-route', genres: [], managerEmails: ['sole@example.com'] });
    const searchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, genre: 'Rock' })] }));

    const { artists, stats } = await backfillGenres(
      { artists: [tagged, reachableElsewhere, soleRoute], genres: ROSTER_GENRES },
      { searchArtist, onlyUnreachable: true }
    );

    // Only the sole-route artist was ever looked up.
    expect(searchArtist).toHaveBeenCalledTimes(1);
    expect(searchArtist).toHaveBeenCalledWith('Sole Route');
    expect(artists.find(a => a.rostrUrl === soleRoute.rostrUrl).genres).toEqual(['Rock']);
    // The reachable-elsewhere artist comes out byte-identical — not attempted,
    // not logged, not counted against --limit.
    expect(artists.find(a => a.rostrUrl === reachableElsewhere.rostrUrl)).toBe(reachableElsewhere);

    expect(stats.eligible).toBe(2); // both genre-less artists
    expect(stats.attempted).toBe(1);
    expect(stats.notSoleRoute).toBe(1);
    expect(stats.soleRouteQualifying).toBe(1);
    expect(stats.soleRouteInboxes).toBe(1);
  });

  it('reports soleRouteQualifying/soleRouteInboxes as 0 and notSoleRoute as 0 when the flag is off — today’s behaviour, unchanged', async () => {
    const reachableElsewhere = artist({ name: 'Reachable Elsewhere', rostrUrl: 'https://www.rostr.cc/profile/reachable-elsewhere', genres: [], managerEmails: ['shared@example.com'] });
    const searchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, genre: 'Rock' })] }));

    const { stats } = await backfillGenres({ artists: [reachableElsewhere], genres: ROSTER_GENRES }, { searchArtist });

    expect(searchArtist).toHaveBeenCalledTimes(1); // attempted normally — nothing excludes it without the flag
    expect(stats.notSoleRoute).toBe(0);
    expect(stats.soleRouteQualifying).toBe(0);
    expect(stats.soleRouteInboxes).toBe(0);
  });

  it('composes with --retry-reasons by intersection: an artist must clear BOTH narrowings to be attempted', async () => {
    // "Was Unmappable" cleared its previous permanent skip (retryReasons
    // includes unmappableGenre) AND is a sole route -> attempted.
    const wasUnmappableSoleRoute = artist({
      name: 'Was Unmappable Sole Route', rostrUrl: 'https://www.rostr.cc/profile/was-unmappable-sole-route',
      genres: [], managerEmails: ['sole@example.com'],
    });
    // "Was Unmappable But Reachable" also clears the retry-reasons narrowing,
    // but its only address is already reached by a genre-tagged artist ->
    // --only-unreachable excludes it even though --retry-reasons would have
    // let it through.
    const tagged = artist({ name: 'Has A Genre', rostrUrl: 'https://www.rostr.cc/profile/has-a-genre', genres: ['Pop'], managerEmails: ['shared@example.com'] });
    const wasUnmappableReachable = artist({
      name: 'Was Unmappable But Reachable', rostrUrl: 'https://www.rostr.cc/profile/was-unmappable-but-reachable',
      genres: [], managerEmails: ['shared@example.com'],
    });
    // "Was Ambiguous" is a sole route, but its permanent skip reason
    // (ambiguousName) is NOT in retryReasons -> stays excluded by the
    // provenance-log narrowing regardless of --only-unreachable.
    const wasAmbiguousSoleRoute = artist({
      name: 'Was Ambiguous Sole Route', rostrUrl: 'https://www.rostr.cc/profile/was-ambiguous-sole-route',
      genres: [], managerEmails: ['ambiguous-sole@example.com'],
    });

    const existingLog = {
      source: 'itunes',
      runs: [],
      filled: [],
      skipped: [
        { name: wasUnmappableSoleRoute.name, rostrUrl: wasUnmappableSoleRoute.rostrUrl, reason: 'unmappableGenre' },
        { name: wasUnmappableReachable.name, rostrUrl: wasUnmappableReachable.rostrUrl, reason: 'unmappableGenre' },
        { name: wasAmbiguousSoleRoute.name, rostrUrl: wasAmbiguousSoleRoute.rostrUrl, reason: 'ambiguousName', competingGenres: ['Pop', 'Rock'], matchCount: 2 },
      ],
    };
    const searchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, genre: 'Rock' })] }));

    const { stats } = await backfillGenres(
      { artists: [tagged, wasUnmappableSoleRoute, wasUnmappableReachable, wasAmbiguousSoleRoute], genres: ROSTER_GENRES },
      { searchArtist, existingLog, retryReasons: new Set(['unmappableGenre']), onlyUnreachable: true }
    );

    // Only the artist that clears BOTH the retry-reasons re-eligibility AND
    // the sole-route qualification is attempted.
    expect(searchArtist).toHaveBeenCalledTimes(1);
    expect(searchArtist).toHaveBeenCalledWith('Was Unmappable Sole Route');
    expect(stats.attempted).toBe(1);
    expect(stats.filled).toBe(1);
    // wasUnmappableReachable: cleared by --retry-reasons, excluded by --only-unreachable.
    // wasAmbiguousSoleRoute: sole route, but never cleared by --retry-reasons.
    // Both come out as "not attempted this run" via their respective
    // exclusion counters, never sharing searchArtist calls with the winner.
    expect(stats.alreadySkipped).toBe(1); // wasAmbiguousSoleRoute — provenance exclusion never lifted
    expect(stats.notSoleRoute).toBe(1); // wasUnmappableReachable — lifted from provenance, still not a sole route
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

// Regression coverage for the 2026-08-22/2026-08-25 incidents: a
// SpotifyQuotaExhaustedError mid-chunk used to propagate all the way out of
// backfillGenres and get caught in main(), which printed "Aborting:" and
// exited WITHOUT writing anything — discarding every fill the run had
// already completed (19 artists, then 56). backfillGenres now catches that
// one error itself, stops its own walk, and returns its ordinary
// { artists, stats, log } shape (plus aborted/abortReason) so main() takes
// its normal write path instead of a lost chunk. See resolveByDiscography's
// mock at the top of this file — it's how these tests fire a fake abort at
// a chosen artist without any real Spotify call.
describe('backfillGenres — Spotify quota abort mid-run', () => {
  // Four genre-less artists in roster order, each with a distinct manager
  // email so uniqueEmailCount actually varies if anything goes wrong:
  // - Filled First: fills cleanly via a unique iTunes match, no discography
  //   call at all — this is the fill that must survive the abort.
  // - Aborts Here: an ambiguousName tie that engages --discography; the
  //   mocked resolveByDiscography is the one that throws.
  // - Never Reached A/B: later in roster order, never attempted once the
  //   abort fires.
  function makeAbortRoster() {
    return [
      artist({ name: 'Filled First', rostrUrl: 'https://www.rostr.cc/profile/filled-first', managerEmails: ['a@example.com'] }),
      artist({ name: 'Aborts Here', rostrUrl: 'https://www.rostr.cc/profile/aborts-here', managerEmails: ['b@example.com'] }),
      artist({ name: 'Never Reached A', rostrUrl: 'https://www.rostr.cc/profile/never-reached-a', managerEmails: ['c@example.com'] }),
      artist({ name: 'Never Reached B', rostrUrl: 'https://www.rostr.cc/profile/never-reached-b', managerEmails: ['d@example.com'] }),
    ];
  }

  function makeAbortSearchArtist() {
    return vi.fn(async name => {
      if (name === 'Aborts Here') {
        // A genuine ambiguousName tie — this is what makes tryFillOne call
        // resolveByDiscography at all.
        return {
          results: [
            itunesArtist({ name, artistId: 1, genre: 'Pop' }),
            itunesArtist({ name, artistId: 2, genre: 'Rock' }),
          ],
        };
      }
      // Filled First, and (if ever called) Never Reached A/B — all fill
      // cleanly on a unique match.
      return { results: [itunesArtist({ name, artistId: 1, genre: 'Pop' })] };
    });
  }

  function makeAbortDiscographyDeps() {
    return { spotifySearchArtist: vi.fn(), spotifyArtistAlbums: vi.fn(), itunesLookupAlbums: vi.fn() };
  }

  it('returns the fills completed before the abort instead of discarding the whole chunk', async () => {
    const [filledFirst, abortsHere, neverReachedA, neverReachedB] = makeAbortRoster();
    const searchArtist = makeAbortSearchArtist();
    const discographyDeps = makeAbortDiscographyDeps();
    resolveByDiscography.mockRejectedValueOnce(new SpotifyQuotaExhaustedError('3 consecutive 429s from Spotify — aborting'));

    const { artists, stats, log, aborted, abortReason } = await backfillGenres(
      { artists: [filledFirst, abortsHere, neverReachedA, neverReachedB], genres: ROSTER_GENRES },
      { searchArtist, discography: true, discographyDeps }
    );

    expect(aborted).toBe(true);
    expect(abortReason).toMatch(/429/);

    // The fill completed BEFORE the abort survived — this is exactly the
    // regression that would have saved the 56 lost artists.
    expect(artists[0].genres).toEqual(['Pop']);
    expect(stats.filled).toBe(1);
    expect(log.filled).toHaveLength(1);
    expect(log.filled[0].rostrUrl).toBe(filledFirst.rostrUrl);

    // The aborting artist and everything after it come back as the exact
    // SAME (untouched) object references that went in — never a
    // `{ ...original }` copy, since their genres were never actually
    // resolved.
    expect(artists[1]).toBe(abortsHere);
    expect(artists[2]).toBe(neverReachedA);
    expect(artists[3]).toBe(neverReachedB);
    expect(artists[1].genres).toEqual([]);

    // stats.attempted only counts artists that got an actual verdict — the
    // aborting artist's earlier bump is rolled back, so it must NOT be
    // counted as attempted alongside zero fills/skips to show for it.
    expect(stats.attempted).toBe(1);
    expect(stats.filled + Object.values(stats.skipped).reduce((a, b) => a + b, 0)).toBe(stats.attempted);

    // Never-reached artists produced no searchArtist call at all.
    expect(searchArtist).toHaveBeenCalledTimes(2); // Filled First, then Aborts Here
    expect(searchArtist).not.toHaveBeenCalledWith('Never Reached A');
    expect(searchArtist).not.toHaveBeenCalledWith('Never Reached B');
  });

  it('does not log the aborting artist or any un-attempted artist as skipped, and all three remain eligible on a later run', async () => {
    const [filledFirst, abortsHere, neverReachedA, neverReachedB] = makeAbortRoster();
    const searchArtist = makeAbortSearchArtist();
    const discographyDeps = makeAbortDiscographyDeps();
    resolveByDiscography.mockRejectedValueOnce(new SpotifyQuotaExhaustedError('quota exhausted'));

    const firstRun = await backfillGenres(
      { artists: [filledFirst, abortsHere, neverReachedA, neverReachedB], genres: ROSTER_GENRES },
      { searchArtist, discography: true, discographyDeps }
    );

    // Nothing at all was logged for the aborting artist or either
    // never-reached artist — not under any PERMANENT_SKIP_REASONS reason,
    // not under any reason.
    expect(firstRun.log.skipped).toHaveLength(0);
    expect(firstRun.log.skipped.find(e => e.rostrUrl === abortsHere.rostrUrl)).toBeUndefined();
    expect(firstRun.log.skipped.find(e => e.rostrUrl === neverReachedA.rostrUrl)).toBeUndefined();
    expect(firstRun.log.skipped.find(e => e.rostrUrl === neverReachedB.rostrUrl)).toBeUndefined();

    // Style-matched with "backfillGenres — resuming from an existing
    // provenance log" above: feed this run's log back in as existingLog and
    // confirm none of the three get excluded from a resumed run — a
    // permanent-skip exclusion would have silently dropped them forever.
    const existingLog = {
      source: 'itunes',
      runs: [{
        generatedAt: 'run-1', source: 'itunes',
        aborted: firstRun.aborted, abortReason: firstRun.abortReason,
        stats: firstRun.stats, unmappedGenres: {},
      }],
      filled: firstRun.log.filled,
      skipped: firstRun.log.skipped,
    };

    const resumeSearchArtist = vi.fn(async name => ({ results: [itunesArtist({ name, artistId: 9, genre: 'Pop' })] }));
    const { stats: resumeStats } = await backfillGenres(
      // Re-run against fresh genre-less copies — mirrors how main() would
      // reload the (still-genre-less, for these three) roster.json on the
      // next chunk.
      { artists: makeAbortRoster(), genres: ROSTER_GENRES },
      { searchArtist: resumeSearchArtist, existingLog }
    );

    expect(resumeStats.alreadySkipped).toBe(0);
    expect(resumeSearchArtist).toHaveBeenCalledWith('Aborts Here');
    expect(resumeSearchArtist).toHaveBeenCalledWith('Never Reached A');
    expect(resumeSearchArtist).toHaveBeenCalledWith('Never Reached B');
  });

  it('keeps the artist count and unique-email count identical across an aborted run — the artistsLost/emailsLost guard in main() must never trip', async () => {
    const roster = { artists: makeAbortRoster(), genres: ROSTER_GENRES };
    const before = { artists: roster.artists.length, emails: uniqueEmailCount(roster.artists) };
    const searchArtist = makeAbortSearchArtist();
    const discographyDeps = makeAbortDiscographyDeps();
    resolveByDiscography.mockRejectedValueOnce(new SpotifyQuotaExhaustedError('quota exhausted'));

    const { artists, aborted } = await backfillGenres(roster, { searchArtist, discography: true, discographyDeps });

    expect(aborted).toBe(true);
    expect(artists.length).toBe(before.artists);
    expect(uniqueEmailCount(artists)).toBe(before.emails);
  });

  it('lets a non-quota error propagate out of backfillGenres uncaught, exactly as before', async () => {
    const [filledFirst, abortsHere, neverReachedA, neverReachedB] = makeAbortRoster();
    const searchArtist = makeAbortSearchArtist();
    const discographyDeps = makeAbortDiscographyDeps();
    const boom = new Error('discography-match.mjs: unexpected Spotify 500');
    resolveByDiscography.mockRejectedValueOnce(boom);

    // A rejected promise is what "writes nothing" reduces to here: main()
    // only reaches its roster/log writeFileSync calls after
    // `await backfillGenres(...)` resolves (see main()'s call site) — a
    // thrown, non-SpotifyQuotaExhaustedError here never lets that happen,
    // exactly like today's behaviour for any other unexpected error.
    await expect(
      backfillGenres(
        { artists: [filledFirst, abortsHere, neverReachedA, neverReachedB], genres: ROSTER_GENRES },
        { searchArtist, discography: true, discographyDeps }
      )
    ).rejects.toBe(boom);
  });

  it('resolves (never throws) with the ordinary result shape on an abort — the same shape main()\'s existing dry-run gate already handles for every non-aborted call', async () => {
    const [filledFirst, abortsHere, neverReachedA, neverReachedB] = makeAbortRoster();
    const searchArtist = makeAbortSearchArtist();
    const discographyDeps = makeAbortDiscographyDeps();
    resolveByDiscography.mockRejectedValueOnce(new SpotifyQuotaExhaustedError('quota exhausted'));

    // backfillGenres has no --write / dry-run concept of its own — that flag
    // lives entirely in main(), which gates the roster writeFileSync behind
    // `if (!write) { ...; return; }` BEFORE ever reaching it, independent of
    // `aborted`. There is no second, aborted-only return path here that
    // could slip past that gate: an aborted call resolves with the exact
    // same { artists, stats, log, aborted, abortReason } shape as any other
    // call, so a dry run (--write omitted) still writes nothing, aborted or
    // not.
    const result = await backfillGenres(
      { artists: [filledFirst, abortsHere, neverReachedA, neverReachedB], genres: ROSTER_GENRES },
      { searchArtist, discography: true, discographyDeps }
    );

    expect(result.aborted).toBe(true);
    expect(result).toHaveProperty('artists');
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('log');
  });
});
