import { describe, it, expect, vi } from 'vitest';
import {
  backfillGenres, isExactNameMatch, withinFollowerTolerance, normalizeSpotifyGenreTag, mapSpotifyGenre,
  uniqueEmailCount, SPOTIFY_GENRE_ALIASES, FOLLOWER_TOLERANCE_RATIO, FOLLOWER_TOLERANCE_FLOOR,
} from './backfill-genres.mjs';

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

const ROSTER_GENRES = ['Hip Hop', 'Metalcore', 'Indie', 'K Pop', 'Pop', 'Rap', 'Rock', 'Rap Metal'];

function spotifyArtist({ name, followers, genres }) {
  return { name, followers: { total: followers }, genres };
}

describe('normalizeSpotifyGenreTag', () => {
  it('lowercases, strips a leading "pov: " prefix, and turns hyphens into spaces', () => {
    expect(normalizeSpotifyGenreTag('Hip Hop')).toBe('hip hop');
    expect(normalizeSpotifyGenreTag('pov: indie')).toBe('indie');
    expect(normalizeSpotifyGenreTag('k-pop')).toBe('k pop');
    expect(normalizeSpotifyGenreTag('  lo-fi   house  ')).toBe('lo fi house');
  });

  it('handles empty/nullish input without throwing', () => {
    expect(normalizeSpotifyGenreTag('')).toBe('');
    expect(normalizeSpotifyGenreTag(null)).toBe('');
    expect(normalizeSpotifyGenreTag(undefined)).toBe('');
  });
});

describe('mapSpotifyGenre', () => {
  const rosterGenreByLower = new Map(ROSTER_GENRES.map(g => [g.toLowerCase(), g]));

  it('resolves a direct case/hyphen/prefix-normalised match without needing an alias', () => {
    expect(mapSpotifyGenre('hip hop', rosterGenreByLower)).toBe('Hip Hop');
    expect(mapSpotifyGenre('k-pop', rosterGenreByLower)).toBe('K Pop');
    expect(mapSpotifyGenre('pov: indie', rosterGenreByLower)).toBe('Indie');
  });

  it('resolves an aliased tag to its documented parent genre', () => {
    expect(mapSpotifyGenre('melodic metalcore', rosterGenreByLower)).toBe('Metalcore');
    expect(mapSpotifyGenre('pop rap', rosterGenreByLower)).toBe('Rap');
  });

  it('every alias table entry actually resolves against the roster vocabulary it targets', () => {
    // Guards against a typo'd alias target silently becoming "unmapped"
    // forever instead of failing loudly in a test.
    for (const [tag, target] of SPOTIFY_GENRE_ALIASES) {
      expect(mapSpotifyGenre(tag, rosterGenreByLower), `alias "${tag}" -> "${target}"`).toBe(target);
    }
  });

  it('returns null for a tag with no direct match and no alias, rather than guessing', () => {
    expect(mapSpotifyGenre('sad sierreno', rosterGenreByLower)).toBeNull();
    expect(mapSpotifyGenre('uk drill', rosterGenreByLower)).toBeNull();
  });
});

describe('isExactNameMatch / withinFollowerTolerance', () => {
  it('matches names case-insensitively but not fuzzily', () => {
    expect(isExactNameMatch('SZA', 'sza')).toBe(true);
    expect(isExactNameMatch('SZA', 'SZA Official')).toBe(false);
  });

  it('accepts a follower count within the tolerance band', () => {
    expect(withinFollowerTolerance(110_000, 100_000)).toBe(true); // 10% drift
    expect(withinFollowerTolerance(100_000 * (1 + FOLLOWER_TOLERANCE_RATIO), 100_000)).toBe(true); // exactly at the ratio boundary
  });

  it('rejects a follower count outside the tolerance band', () => {
    expect(withinFollowerTolerance(500_000, 100_000)).toBe(false);
  });

  it('uses the floor rather than the ratio for a small roster follower count', () => {
    // 35% of 1,000 is 350 — far tighter than real short-term movement for a
    // small artist would survive — so the 25,000 floor applies instead.
    expect(withinFollowerTolerance(20_000, 1_000)).toBe(true);
    expect(withinFollowerTolerance(1_000 + FOLLOWER_TOLERANCE_FLOOR + 1, 1_000)).toBe(false);
  });
});

describe('backfillGenres', () => {
  it('never touches an artist that already has genres, even if it would otherwise match', async () => {
    const withGenres = artist({ name: 'Has Genres', genres: ['Pop'] });
    const searchArtist = vi.fn(async () => ({ artists: { items: [spotifyArtist({ name: 'Has Genres', followers: 100_000, genres: ['hip hop'] })] } }));

    const { artists, stats } = await backfillGenres({ artists: [withGenres], genres: ROSTER_GENRES }, { searchArtist });

    expect(artists[0]).toBe(withGenres); // same reference — not even copied
    expect(artists[0].genres).toEqual(['Pop']);
    expect(searchArtist).not.toHaveBeenCalled();
    expect(stats.eligible).toBe(0);
    expect(stats.filled).toBe(0);
  });

  it('fills genres for a strong match: exact name, follower count in range, tags resolve via normalisation and alias', async () => {
    const target = artist({ name: 'Nova Rivers', spotifyFollowers: 200_000, genres: [] });
    const searchArtist = vi.fn(async name => {
      expect(name).toBe('Nova Rivers');
      return {
        artists: {
          items: [
            spotifyArtist({ name: 'Nova Rivers', followers: 210_000, genres: ['hip hop', 'pov: indie', 'melodic metalcore', 'some totally unknown microgenre'] }),
          ],
        },
      };
    });

    const { artists, stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });

    expect(artists[0].genres).toEqual(['Hip Hop', 'Indie', 'Metalcore'].sort());
    expect(stats.filled).toBe(1);
    expect(stats.eligible).toBe(1);
    expect(stats.attempted).toBe(1);
    expect(stats.unmappedTags.get('some totally unknown microgenre')).toBe(1);
  });

  it('skips with noSpotifyMatch when Spotify returns nothing', async () => {
    const target = artist({ name: 'Nobody Found' });
    const searchArtist = vi.fn(async () => ({ artists: { items: [] } }));

    const { stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.noSpotifyMatch).toBe(1);
    expect(stats.filled).toBe(0);
  });

  it('skips with nameMismatch when nothing returned is an exact name match', async () => {
    const target = artist({ name: 'Exact Name' });
    const searchArtist = vi.fn(async () => ({ artists: { items: [spotifyArtist({ name: 'Exact Name Official', followers: 100_000, genres: ['pop'] })] } }));

    const { stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.nameMismatch).toBe(1);
  });

  it('skips with noRosterFollowerCount when the roster has no follower count to verify against', async () => {
    const target = artist({ name: 'No Baseline', spotifyFollowers: 0 });
    const searchArtist = vi.fn(async () => ({ artists: { items: [spotifyArtist({ name: 'No Baseline', followers: 500_000, genres: ['pop'] })] } }));

    const { stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.noRosterFollowerCount).toBe(1);
  });

  it('skips with followerMismatch when the exact-name match has a wildly different follower count', async () => {
    const target = artist({ name: 'Wrong Scale', spotifyFollowers: 5_000 });
    const searchArtist = vi.fn(async () => ({ artists: { items: [spotifyArtist({ name: 'Wrong Scale', followers: 8_000_000, genres: ['pop'] })] } }));

    const { stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.followerMismatch).toBe(1);
  });

  it('skips with ambiguousMatch when two exact-name results both fall within follower tolerance', async () => {
    const target = artist({ name: 'Common Name', spotifyFollowers: 100_000 });
    const searchArtist = vi.fn(async () => ({
      artists: {
        items: [
          spotifyArtist({ name: 'Common Name', followers: 105_000, genres: ['pop'] }),
          spotifyArtist({ name: 'Common Name', followers: 95_000, genres: ['rock'] }),
        ],
      },
    }));

    const { stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.ambiguousMatch).toBe(1);
  });

  it('disambiguates two exact-name results when only one is within follower tolerance', async () => {
    const target = artist({ name: 'Common Name', spotifyFollowers: 100_000, genres: [] });
    const searchArtist = vi.fn(async () => ({
      artists: {
        items: [
          spotifyArtist({ name: 'Common Name', followers: 105_000, genres: ['hip hop'] }),
          spotifyArtist({ name: 'Common Name', followers: 9_000_000, genres: ['rock'] }),
        ],
      },
    }));

    const { artists, stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.ambiguousMatch).toBe(0);
    expect(artists[0].genres).toEqual(['Hip Hop']);
  });

  it('skips with noMappableGenres when the verified match has genre tags but none resolve', async () => {
    const target = artist({ name: 'Untaggable', spotifyFollowers: 100_000 });
    const searchArtist = vi.fn(async () => ({ artists: { items: [spotifyArtist({ name: 'Untaggable', followers: 100_000, genres: ['sad sierreno', 'uk drill'] })] } }));

    const { artists, stats } = await backfillGenres({ artists: [target], genres: ROSTER_GENRES }, { searchArtist });
    expect(stats.skipped.noMappableGenres).toBe(1);
    expect(artists[0].genres).toEqual([]);
    expect(stats.unmappedTags.get('sad sierreno')).toBe(1);
    expect(stats.unmappedTags.get('uk drill')).toBe(1);
  });

  it('respects --limit, leaving artists beyond it untouched and counted as overLimit', async () => {
    const targets = [artist({ name: 'A' }), artist({ name: 'B' }), artist({ name: 'C' })];
    const searchArtist = vi.fn(async name => ({ artists: { items: [spotifyArtist({ name, followers: 100_000, genres: ['pop'] })] } }));

    const { artists, stats } = await backfillGenres({ artists: targets, genres: ROSTER_GENRES }, { searchArtist, limit: 1 });
    expect(stats.eligible).toBe(3);
    expect(stats.attempted).toBe(1);
    expect(stats.skipped.overLimit).toBe(2);
    expect(searchArtist).toHaveBeenCalledTimes(1);
    expect(artists[0].genres).toEqual(['Pop']);
    expect(artists[1].genres).toEqual([]);
    expect(artists[2].genres).toEqual([]);
  });

  it('never changes artist count or the unique-email set — the same non-destructive guarantee merge-roster.mjs asserts', async () => {
    const roster = {
      artists: [
        artist({ name: 'Has Genres', genres: ['Pop'], managerEmails: ['a@example.com'] }),
        artist({ name: 'Will Fill', spotifyFollowers: 100_000, managerEmails: ['b@example.com'] }),
        artist({ name: 'Will Skip', spotifyFollowers: 100_000, managerEmails: ['c@example.com'] }),
      ],
      genres: ROSTER_GENRES,
    };
    const searchArtist = vi.fn(async name => {
      if (name === 'Will Fill') return { artists: { items: [spotifyArtist({ name, followers: 100_000, genres: ['pop'] })] } };
      return { artists: { items: [] } };
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
});
