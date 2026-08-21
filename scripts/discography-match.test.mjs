import { describe, it, expect, vi } from 'vitest';
import { normalizeReleaseTitle, resolveByDiscography } from './discography-match.mjs';

describe('normalizeReleaseTitle', () => {
  it('lowercases and collapses punctuation to single spaces', () => {
    expect(normalizeReleaseTitle('Song Title')).toBe('song title');
    expect(normalizeReleaseTitle("Don't Stop")).toBe('don t stop');
    expect(normalizeReleaseTitle('Song - Reprise')).toBe('song reprise');
  });

  it('strips parenthesised and bracketed segments as whole units, not just the marker words inside them', () => {
    expect(normalizeReleaseTitle('Album (Deluxe Edition)')).toBe('album');
    expect(normalizeReleaseTitle('Track [Remastered 2011]')).toBe('track');
    expect(normalizeReleaseTitle('Song (feat. Someone Else)')).toBe('song'); // arbitrary parenthesised content, not just stop-words
  });

  it('removes deluxe/remaster(ed)/edition/version/single/ep/live/explicit as standalone words', () => {
    expect(normalizeReleaseTitle('Greatest Hits Deluxe')).toBe('greatest hits');
    expect(normalizeReleaseTitle('Remastered Album')).toBe('album');
    expect(normalizeReleaseTitle('Remaster Album')).toBe('album');
    expect(normalizeReleaseTitle('Anniversary Edition')).toBe('anniversary');
    expect(normalizeReleaseTitle('Acoustic Version')).toBe('acoustic');
    expect(normalizeReleaseTitle('Big Hit Single')).toBe('big hit');
    expect(normalizeReleaseTitle('Sessions EP')).toBe('sessions');
    expect(normalizeReleaseTitle('Live at the Arena')).toBe('at the arena');
    expect(normalizeReleaseTitle('Explicit Version')).toBe('');
  });

  it('makes a Spotify "Album (Deluxe Edition)" and an iTunes "Album" collapse to the same normalised key', () => {
    expect(normalizeReleaseTitle('Album (Deluxe Edition)')).toBe(normalizeReleaseTitle('Album'));
  });

  it('discards titles that normalise to nothing', () => {
    expect(normalizeReleaseTitle('Deluxe')).toBe('');
    expect(normalizeReleaseTitle('(Live)')).toBe('');
    expect(normalizeReleaseTitle('')).toBe('');
    expect(normalizeReleaseTitle(null)).toBe('');
  });
});

// --- resolveByDiscography fixtures ---

function rosterArtist(overrides = {}) {
  return { name: 'Nova Rivers', avatarUrl: 'https://i.scdn.co/image/avatar123', ...overrides };
}

function spotifySearchItem({ id, name, avatarUrl }) {
  return { id, name, images: avatarUrl ? [{ url: avatarUrl }] : [] };
}

function itunesCandidate({ artistId, genre = 'Alternative', mapped = 'Alternative' }) {
  return { item: { artistId, artistName: 'Nova Rivers', primaryGenreName: genre, artistLinkUrl: `https://music.apple.com/artist/${artistId}` }, mapped };
}

// A page-fetcher stub: `pages` maps offset -> the raw page object. Missing
// offsets return an empty page, which is what makes the pagination loop
// stop after however many offsets are actually provided.
function pagedFetcher(pages, itemsKey) {
  return vi.fn(async (_arg, offset) => pages[offset] ?? (itemsKey === 'artists' ? { artists: { items: [] } } : { items: [] }));
}

function searchPages(pages) {
  const wrapped = {};
  for (const [offset, items] of Object.entries(pages)) wrapped[offset] = { artists: { items } };
  return pagedFetcher(wrapped, 'artists');
}

function albumPages(pages) {
  const wrapped = {};
  for (const [offset, items] of Object.entries(pages)) wrapped[offset] = { items };
  return pagedFetcher(wrapped, 'items');
}

function albumItem(name) {
  return { name };
}

// Fixed set of 9 titles our roster artist "released" on Spotify, used across
// several tests below to build overlap counts deliberately.
const NINE_TITLES = Array.from({ length: 9 }, (_, i) => `Real Release ${i + 1}`);

describe('resolveByDiscography — pinning', () => {
  it('pins via avatar match when a search result\'s images[] contains the exact roster avatarUrl (pinMethod: "avatar")', async () => {
    const artist = rosterArtist();
    const deps = {
      spotifySearchArtist: searchPages({
        0: [
          spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: artist.avatarUrl }),
          spotifySearchItem({ id: 'sp-namesake', name: 'Nova Rivers', avatarUrl: 'https://i.scdn.co/image/different' }),
        ],
      }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async () => ({ resultCount: 9, results: [] })),
    };
    const candidates = [itunesCandidate({ artistId: 1 })];

    const result = await resolveByDiscography(artist, candidates, deps);
    expect(result.pinMethod).toBe('avatar');
    expect(result.spotifyArtistId).toBe('sp-real');
  });

  it('falls back to a case-insensitive exact name match when no avatar matches (pinMethod: "name")', async () => {
    const artist = rosterArtist({ avatarUrl: 'https://i.scdn.co/image/avatar123' });
    const deps = {
      spotifySearchArtist: searchPages({
        0: [spotifySearchItem({ id: 'sp-namesake', name: 'nova rivers', avatarUrl: 'https://i.scdn.co/image/unrelated' })],
      }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async () => ({ resultCount: 0, results: [] })),
    };
    const candidates = [itunesCandidate({ artistId: 1 })];

    const result = await resolveByDiscography(artist, candidates, deps);
    expect(result.pinMethod).toBe('name');
    expect(result.spotifyArtistId).toBe('sp-namesake');
  });

  it('never checks avatars when the roster artist has no avatarUrl, going straight to name fallback', async () => {
    const artist = rosterArtist({ avatarUrl: '' });
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-1', name: 'Nova Rivers', avatarUrl: '' })] }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async () => ({ resultCount: 0, results: [] })),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(result.pinMethod).toBe('name');
  });

  it('returns unresolved with reason spotifyArtistNotFound when neither avatar nor name matches anything, across all pages searched', async () => {
    const artist = rosterArtist();
    const deps = {
      spotifySearchArtist: searchPages({
        0: Array.from({ length: 10 }, (_, i) => spotifySearchItem({ id: `sp-${i}`, name: 'Someone Else', avatarUrl: 'https://x/y' })),
        10: [spotifySearchItem({ id: 'sp-10', name: 'Someone Else', avatarUrl: 'https://x/y' })], // <10 items — pagination stops here
      }),
      spotifyArtistAlbums: vi.fn(),
      itunesLookupAlbums: vi.fn(),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('spotifyArtistNotFound');
    expect(result.scoreboard).toEqual([]);
    expect(deps.spotifyArtistAlbums).not.toHaveBeenCalled();
    expect(deps.itunesLookupAlbums).not.toHaveBeenCalled();
  });

  // Call-volume cut, 2026-08-22: a real run's Spotify quota was exhausted
  // by ~6 calls/ambiguous-artist (3 search pages + 3 album pages, always
  // fetched up front regardless of whether pinning already succeeded). The
  // search step now checks after EVERY page whether it can pin and stops
  // the moment it can, rather than always collecting all 3 pages first.

  it('pins on the first page without fetching a second, even when that page is full (10 items)', async () => {
    const artist = rosterArtist();
    const search = searchPages({
      0: [
        spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: artist.avatarUrl }),
        ...Array.from({ length: 9 }, (_, i) => spotifySearchItem({ id: `sp-other-${i}`, name: 'Someone Else', avatarUrl: 'https://x/y' })),
      ],
    });
    const deps = {
      spotifySearchArtist: search,
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async () => ({ resultCount: 0, results: [] })),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(search).toHaveBeenCalledTimes(1); // pinned on the first page — a full page never triggers a second fetch
    expect(result.pinMethod).toBe('avatar');
    expect(result.spotifyArtistId).toBe('sp-real');
  });

  it('fetches a second search page only when the first page does not pin, and pins there', async () => {
    const artist = rosterArtist();
    const search = searchPages({
      0: Array.from({ length: 10 }, (_, i) => spotifySearchItem({ id: `sp-other-${i}`, name: 'Someone Else', avatarUrl: 'https://x/y' })),
      10: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: artist.avatarUrl })],
    });
    const deps = {
      spotifySearchArtist: search,
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async () => ({ resultCount: 0, results: [] })),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.pinMethod).toBe('avatar');
    expect(result.spotifyArtistId).toBe('sp-real');
  });

  it('still stops paginating once a page comes back short, even if that page did not pin either', async () => {
    const artist = rosterArtist();
    const search = searchPages({
      0: Array.from({ length: 10 }, (_, i) => spotifySearchItem({ id: `sp-other-${i}`, name: 'Someone Else', avatarUrl: 'https://x/y' })),
      10: [spotifySearchItem({ id: 'sp-other-10', name: 'Someone Else', avatarUrl: 'https://x/y' })], // short (1 item), still no match
      20: [spotifySearchItem({ id: 'sp-should-not-be-seen', name: 'Nova Rivers', avatarUrl: artist.avatarUrl })],
    });
    const deps = { spotifySearchArtist: search, spotifyArtistAlbums: vi.fn(), itunesLookupAlbums: vi.fn() };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(search).toHaveBeenCalledTimes(2); // offset 0 and 10, never 20
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('spotifyArtistNotFound');
  });

  it('accepts a page-1 NAME pin without ever fetching the page-2 AVATAR match — the documented call-volume tradeoff', async () => {
    // Page 1 contains only a namesake (no avatar match, but the name
    // matches) — the real avatar match sits on page 2, which pinning
    // immediately on page 1 means this never fetches. Deliberate: see
    // discography-match.mjs's "SPOTIFY CALL VOLUME" doc comment.
    const artist = rosterArtist();
    const search = searchPages({
      0: [spotifySearchItem({ id: 'sp-namesake', name: 'Nova Rivers', avatarUrl: 'https://different/url' })],
      10: [spotifySearchItem({ id: 'sp-real-avatar', name: 'Nova Rivers', avatarUrl: artist.avatarUrl })],
    });
    const deps = {
      spotifySearchArtist: search,
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async () => ({ resultCount: 0, results: [] })),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.pinMethod).toBe('name');
    expect(result.spotifyArtistId).toBe('sp-namesake');
  });

  it('caps album collection at 2 pages (20 titles) even when both pages come back full', async () => {
    const artist = rosterArtist();
    const albums = albumPages({
      0: Array.from({ length: 10 }, (_, i) => albumItem(`Title ${i}`)),
      10: Array.from({ length: 10 }, (_, i) => albumItem(`Title ${i + 10}`)),
      20: Array.from({ length: 10 }, (_, i) => albumItem(`Should Not Be Seen ${i}`)),
    });
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: artist.avatarUrl })] }),
      spotifyArtistAlbums: albums,
      itunesLookupAlbums: vi.fn(async () => ({ resultCount: 0, results: [] })),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(albums).toHaveBeenCalledTimes(2); // offset 0 and 10, never 20
    expect(result.ourReleaseCount).toBe(20);
  });

  it('returns unresolved with reason noSpotifyReleases when our pinned artist has no albums on any page', async () => {
    const artist = rosterArtist();
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: artist.avatarUrl })] }),
      spotifyArtistAlbums: albumPages({ 0: [] }),
      itunesLookupAlbums: vi.fn(),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('noSpotifyReleases');
    expect(result.pinMethod).toBe('avatar');
    expect(result.spotifyArtistId).toBe('sp-real');
    expect(result.scoreboard).toEqual([]);
    expect(deps.itunesLookupAlbums).not.toHaveBeenCalled();
  });

  it('discards titles that normalise to empty when counting "our" releases — a Spotify listing of only "(Live)" counts as no releases', async () => {
    const artist = rosterArtist();
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: artist.avatarUrl })] }),
      spotifyArtistAlbums: albumPages({ 0: [albumItem('(Live)'), albumItem('Deluxe')] }),
      itunesLookupAlbums: vi.fn(),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 1 })], deps);
    expect(result.reason).toBe('noSpotifyReleases');
  });
});

describe('resolveByDiscography — scoring and the acceptance rule', () => {
  function pinnedDeps({ ourTitles = NINE_TITLES, lookupResponses }) {
    return {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: 'https://i.scdn.co/image/avatar123' })] }),
      spotifyArtistAlbums: albumPages({ 0: ourTitles.map(albumItem) }),
      itunesLookupAlbums: vi.fn().mockImplementation(async () => lookupResponses.shift()),
    };
  }

  function itunesLookupResult(entries) {
    // entries: [{ artistId, titles }] -> raw iTunes /lookup shape
    return {
      resultCount: entries.reduce((n, e) => n + e.titles.length, 0),
      results: entries.flatMap(e => e.titles.map(name => ({ wrapperType: 'collection', artistId: e.artistId, collectionName: name }))),
    };
  }

  it('accepts an avatar-pinned winner with 9 overlapping releases against a 2-overlap runner-up (measured "James Newman" shape)', async () => {
    const winnerTitles = [...NINE_TITLES]; // all 9 overlap
    const impostorTitles = [NINE_TITLES[0], NINE_TITLES[1], 'Impostor Only Release']; // 2 overlap
    const deps = pinnedDeps({
      lookupResponses: [itunesLookupResult([{ artistId: 101, titles: winnerTitles }, { artistId: 102, titles: impostorTitles }])],
    });
    const candidates = [itunesCandidate({ artistId: 101, genre: 'Alternative', mapped: 'Alternative' }), itunesCandidate({ artistId: 102, genre: 'Pop', mapped: 'Pop' })];

    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(result.resolved).toBe(true);
    expect(result.winner.item.artistId).toBe(101);
    expect(result.winner.mapped).toBe('Alternative');
    expect(result.pinMethod).toBe('avatar');
    const winnerRow = result.scoreboard.find(r => r.artistId === 101);
    const runnerRow = result.scoreboard.find(r => r.artistId === 102);
    expect(winnerRow.overlap).toBe(9);
    expect(runnerRow.overlap).toBe(2);
  });

  it('rejects a 3-vs-2 case on the margin rule even though the absolute floor (>=2) is cleared — this is why the 3x margin exists', async () => {
    const titleA = [NINE_TITLES[0], NINE_TITLES[1], NINE_TITLES[2]]; // overlap 3
    const titleB = [NINE_TITLES[3], NINE_TITLES[4]]; // overlap 2
    const deps = pinnedDeps({
      lookupResponses: [itunesLookupResult([{ artistId: 201, titles: titleA }, { artistId: 202, titles: titleB }])],
    });
    const candidates = [itunesCandidate({ artistId: 201, mapped: 'Alternative' }), itunesCandidate({ artistId: 202, mapped: 'Pop' })];

    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('discographyInconclusive');
    expect(result.scoreboard.find(r => r.artistId === 201).overlap).toBe(3);
  });

  it('accepts an avatar-pinned winner right at the floor (overlap 2, runner-up 0)', async () => {
    const deps = pinnedDeps({
      lookupResponses: [itunesLookupResult([{ artistId: 301, titles: [NINE_TITLES[0], NINE_TITLES[1]] }, { artistId: 302, titles: [] }])],
    });
    const candidates = [itunesCandidate({ artistId: 301, mapped: 'Alternative' }), itunesCandidate({ artistId: 302, mapped: 'Pop' })];
    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(result.resolved).toBe(true);
    expect(result.winner.item.artistId).toBe(301);
  });

  it('rejects an avatar-pinned winner one below the floor (overlap 1, runner-up 0) even with an infinite ratio', async () => {
    const deps = pinnedDeps({
      lookupResponses: [itunesLookupResult([{ artistId: 401, titles: [NINE_TITLES[0]] }, { artistId: 402, titles: [] }])],
    });
    const candidates = [itunesCandidate({ artistId: 401, mapped: 'Alternative' }), itunesCandidate({ artistId: 402, mapped: 'Pop' })];
    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('discographyInconclusive');
  });

  it('accepts exactly at the 3x margin boundary (overlap 6, runner-up 2)', async () => {
    const winnerTitles = NINE_TITLES.slice(0, 6);
    const runnerTitles = NINE_TITLES.slice(6, 8);
    const deps = pinnedDeps({
      lookupResponses: [itunesLookupResult([{ artistId: 501, titles: winnerTitles }, { artistId: 502, titles: runnerTitles }])],
    });
    const candidates = [itunesCandidate({ artistId: 501, mapped: 'Alternative' }), itunesCandidate({ artistId: 502, mapped: 'Pop' })];
    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(result.resolved).toBe(true);
  });

  it('rejects just past the 3x margin boundary (overlap 5, runner-up 2)', async () => {
    const winnerTitles = NINE_TITLES.slice(0, 5);
    const runnerTitles = NINE_TITLES.slice(5, 7);
    const deps = pinnedDeps({
      lookupResponses: [itunesLookupResult([{ artistId: 601, titles: winnerTitles }, { artistId: 602, titles: runnerTitles }])],
    });
    const candidates = [itunesCandidate({ artistId: 601, mapped: 'Alternative' }), itunesCandidate({ artistId: 602, mapped: 'Pop' })];
    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('discographyInconclusive');
  });

  it('holds a name-pinned winner to the higher floor (>=5) and margin, rejecting a 4-overlap winner an avatar pin would\'ve needed only 2 for', async () => {
    const artist = rosterArtist({ avatarUrl: 'https://i.scdn.co/image/avatar123' });
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-namesake', name: 'Nova Rivers', avatarUrl: 'https://different/url' })] }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn().mockImplementation(async () => itunesLookupResult([{ artistId: 701, titles: NINE_TITLES.slice(0, 4) }])),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 701, mapped: 'Alternative' })], deps);
    expect(result.pinMethod).toBe('name');
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('discographyInconclusive');
  });

  it('accepts a name-pinned winner at exactly overlap 5 with no runner-up', async () => {
    const artist = rosterArtist();
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-namesake', name: 'Nova Rivers', avatarUrl: 'https://different/url' })] }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn().mockImplementation(async () => itunesLookupResult([{ artistId: 801, titles: NINE_TITLES.slice(0, 5) }])),
    };
    const result = await resolveByDiscography(artist, [itunesCandidate({ artistId: 801, mapped: 'Alternative' })], deps);
    expect(result.pinMethod).toBe('name');
    expect(result.resolved).toBe(true);
  });
});

describe('resolveByDiscography — batching and the truncation guard', () => {
  it('batches candidate ids 6 at a time, keeping each collection under its own requesting artistId', async () => {
    const candidateIds = [1, 2, 3, 4, 5, 6, 7]; // 7 -> two batches: [1..6], [7]
    const candidates = candidateIds.map(id => itunesCandidate({ artistId: id, mapped: id === 7 ? 'Alternative' : 'Pop' }));
    const lookupCalls = [];
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: 'https://i.scdn.co/image/avatar123' })] }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async ids => {
        lookupCalls.push([...ids]);
        // id 7 (the sole member of the second batch) gets our artist's exact
        // releases so it wins clearly; everyone else gets nothing.
        if (ids.includes('7')) {
          return { resultCount: 9, results: NINE_TITLES.map(name => ({ wrapperType: 'collection', artistId: 7, collectionName: name })) };
        }
        return { resultCount: 0, results: [] };
      }),
    };

    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(lookupCalls).toEqual([['1', '2', '3', '4', '5', '6'], ['7']]);
    expect(result.resolved).toBe(true);
    expect(result.winner.item.artistId).toBe(7);
  });

  it('splits a batch into halves, recursively, when resultCount looks truncated (>= 195), down to single-id batches', async () => {
    // A 2-id batch whose first response looks truncated must be re-run as
    // two separate single-id lookups rather than trusted as-is.
    const candidates = [itunesCandidate({ artistId: 11, mapped: 'Alternative' }), itunesCandidate({ artistId: 12, mapped: 'Pop' })];
    const lookupCalls = [];
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: 'https://i.scdn.co/image/avatar123' })] }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async ids => {
        lookupCalls.push([...ids]);
        if (ids.length === 2) {
          // Looks truncated — triggers the split, and its own (bogus,
          // truncated) results must be discarded in favour of the split.
          return { resultCount: 195, results: [{ wrapperType: 'collection', artistId: 11, collectionName: 'Should Be Discarded' }] };
        }
        if (ids[0] === '11') {
          return { resultCount: 9, results: NINE_TITLES.map(name => ({ wrapperType: 'collection', artistId: 11, collectionName: name })) };
        }
        return { resultCount: 0, results: [] };
      }),
    };

    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(lookupCalls).toEqual([['11', '12'], ['11'], ['12']]);
    expect(result.resolved).toBe(true);
    expect(result.winner.item.artistId).toBe(11);
    // The truncated 2-id response's bogus single result must not have leaked
    // into the final scoreboard (it would have shown up as an 11 with only 1
    // release and 0 overlap, not the real 9-release/9-overlap picture).
    expect(result.scoreboard.find(r => r.artistId === 11).releaseCount).toBe(9);
  });

  it('does not recurse past single-id batches even if a lone id\'s response still looks truncated', async () => {
    const candidates = [itunesCandidate({ artistId: 21, mapped: 'Alternative' })];
    const lookupCalls = [];
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: 'https://i.scdn.co/image/avatar123' })] }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async ids => {
        lookupCalls.push([...ids]);
        return { resultCount: 200, results: NINE_TITLES.map(name => ({ wrapperType: 'collection', artistId: 21, collectionName: name })) };
      }),
    };
    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    expect(lookupCalls).toEqual([['21']]); // one call, no infinite/further recursion
    expect(result.resolved).toBe(true);
  });

  it('keeps only results for artistIds actually requested in that batch, and ignores non-collection rows', async () => {
    const candidates = [itunesCandidate({ artistId: 31, mapped: 'Alternative' })];
    const deps = {
      spotifySearchArtist: searchPages({ 0: [spotifySearchItem({ id: 'sp-real', name: 'Nova Rivers', avatarUrl: 'https://i.scdn.co/image/avatar123' })] }),
      spotifyArtistAlbums: albumPages({ 0: NINE_TITLES.map(albumItem) }),
      itunesLookupAlbums: vi.fn(async () => ({
        resultCount: 3,
        results: [
          { wrapperType: 'artist', artistId: 31, artistName: 'Nova Rivers' }, // not a collection — ignored
          { wrapperType: 'collection', artistId: 999, collectionName: 'Not Requested' }, // wrong artistId — ignored
          { wrapperType: 'collection', artistId: 31, collectionName: NINE_TITLES[0] },
        ],
      })),
    };
    const result = await resolveByDiscography(rosterArtist(), candidates, deps);
    const row = result.scoreboard.find(r => r.artistId === 31);
    expect(row.releaseCount).toBe(1);
    expect(row.overlap).toBe(1);
  });
});
