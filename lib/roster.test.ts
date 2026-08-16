import { describe, it, expect, vi } from 'vitest';
import type { Artist } from './roster';

const FIXTURE_ARTISTS: Artist[] = [
  {
    name: 'Solo Pop Artist', rostrUrl: '', genres: ['Pop'], type: 'Solo', gender: 'FEMALE',
    spotifyFollowers: 10000, instagramFollowers: 5000, youtubeSubscribers: 0,
    managementCompany: 'Big Agency', agencies: '', labels: '', publishers: '',
    managerNames: ['Alex'], managerEmails: ['alex@example.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    name: 'Rock Band', rostrUrl: '', genres: ['Rock', 'Pop'], type: 'Group', gender: '',
    spotifyFollowers: 100000, instagramFollowers: 50000, youtubeSubscribers: 0,
    managementCompany: 'Big Agency', agencies: '', labels: '', publishers: '',
    managerNames: ['Jamie'], managerEmails: ['jamie@example.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    name: 'No Manager Artist', rostrUrl: '', genres: ['Pop'], type: 'Solo', gender: 'MALE',
    spotifyFollowers: 1000, instagramFollowers: 500, youtubeSubscribers: 0,
    managementCompany: 'Big Agency', agencies: '', labels: '', publishers: '',
    managerNames: [], managerEmails: [], instagramHandle: '', avatarUrl: '',
  },
  {
    // Mirrors a real data slip (e.g. Kygo in data/roster.json): the same manager
    // email listed twice, which used to reach a React list keyed by email and
    // collide. 'Indie' is otherwise unused by this fixture so it can't skew any
    // of the getArtistsByGenres assertions above.
    name: 'Duplicate Manager Artist', rostrUrl: '', genres: ['Indie'], type: 'Solo', gender: '',
    spotifyFollowers: 1000, instagramFollowers: 500, youtubeSubscribers: 0,
    managementCompany: 'Small Co', agencies: '', labels: '', publishers: '',
    managerNames: ['Myles', 'Mike', 'Myles'],
    managerEmails: ['myles@example.com', 'mike@example.com', 'Myles@Example.com'],
    instagramHandle: '', avatarUrl: '',
  },
  {
    // No genre tag at all — this is the shape 41.6% of the real roster is in
    // (a gap in the rostr.cc data, not a parsing bug). Exercises the "empty
    // genre selection = no genre constraint" path in getArtistsByGenres, and
    // is otherwise findable only that way since it shares no genre with
    // anything else in this fixture.
    name: 'Genreless Artist', rostrUrl: '', genres: [], type: 'Solo', gender: 'MALE',
    spotifyFollowers: 2000, instagramFollowers: 100, youtubeSubscribers: 0,
    managementCompany: 'Solo Manager Co', agencies: '', labels: '', publishers: '',
    managerNames: ['Robin'], managerEmails: ['robin@gmail.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    // Manager on a freemail domain, and a management company distinct from
    // every other fixture artist so it's a "company of one" for the company-size filter.
    name: 'Freemail Managed Artist', rostrUrl: '', genres: ['Pop'], type: 'Solo', gender: 'FEMALE',
    spotifyFollowers: 3000, instagramFollowers: 200, youtubeSubscribers: 0,
    managementCompany: 'Tiny Management', agencies: '', labels: '', publishers: '',
    managerNames: ['Casey'], managerEmails: ['casey@yahoo.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    // No managementCompany listed at all (25 such artists in the real roster) —
    // must never pass a maxCompanySize filter, since there's no company size
    // to check it against.
    name: 'No Company Artist', rostrUrl: '', genres: ['Pop'], type: 'Solo', gender: '',
    spotifyFollowers: 4000, instagramFollowers: 300, youtubeSubscribers: 0,
    managementCompany: '', agencies: '', labels: '', publishers: '',
    managerNames: ['Drew'], managerEmails: ['drew@example.com'], instagramHandle: '', avatarUrl: '',
  },
  // The five fixtures below exist only for the getEmailTiers describe block —
  // they exercise "one manager email shared across artists at two different
  // companies," which nothing above provides. All genres: [] (so they can
  // never affect a genre-scoped assertion elsewhere in this file), all
  // followers under 3000 (so they can never appear in the ungated
  // `minFollowers: 3000` assertion above), and both companies have 2+ members
  // (so neither can appear in the `maxCompanySize: 1` reachability assertions
  // above either) — added to be inert everywhere except getEmailTiers.
  {
    name: 'Multi-Artist Manager A1', rostrUrl: '', genres: [], type: 'Solo', gender: '',
    spotifyFollowers: 500, instagramFollowers: 0, youtubeSubscribers: 0,
    managementCompany: 'Small Multi Co', agencies: '', labels: '', publishers: '',
    managerNames: ['Robin2'], managerEmails: ['multi@example.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    name: 'Multi-Artist Manager A2 Sibling', rostrUrl: '', genres: [], type: 'Solo', gender: '',
    spotifyFollowers: 100, instagramFollowers: 0, youtubeSubscribers: 0,
    managementCompany: 'Small Multi Co', agencies: '', labels: '', publishers: '',
    managerNames: ['Robin3'], managerEmails: ['smallsibling@example.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    // Shares multi@example.com with A1 above, at a company with one more
    // member (3 vs 2) and a higher follower count (1500 vs 500) — the case
    // getEmailTiers' "take the max across every artist this address
    // represents" rule exists for.
    name: 'Multi-Artist Manager B1', rostrUrl: '', genres: [], type: 'Solo', gender: '',
    spotifyFollowers: 1500, instagramFollowers: 0, youtubeSubscribers: 0,
    managementCompany: 'Big Multi Co', agencies: '', labels: '', publishers: '',
    managerNames: ['Robin4'], managerEmails: ['multi@example.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    name: 'Multi-Artist Manager B2 Sibling', rostrUrl: '', genres: [], type: 'Solo', gender: '',
    spotifyFollowers: 200, instagramFollowers: 0, youtubeSubscribers: 0,
    managementCompany: 'Big Multi Co', agencies: '', labels: '', publishers: '',
    managerNames: ['Robin5'], managerEmails: ['bigsibling1@example.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    name: 'Multi-Artist Manager B3 Sibling', rostrUrl: '', genres: [], type: 'Solo', gender: '',
    spotifyFollowers: 300, instagramFollowers: 0, youtubeSubscribers: 0,
    managementCompany: 'Big Multi Co', agencies: '', labels: '', publishers: '',
    managerNames: ['Robin6'], managerEmails: ['bigsibling2@example.com'], instagramHandle: '', avatarUrl: '',
  },
];

vi.mock('fs', () => {
  const readFileSync = () => JSON.stringify({ artists: FIXTURE_ARTISTS, genres: ['Pop', 'Rock', 'Indie'] });
  // The fixture above has no generatedAt, so getIndexedRoster falls back to
  // statSync(...).mtime — stub it so that fallback path doesn't hit the real
  // filesystem for a path that doesn't exist in the test environment.
  const statSync = () => ({ mtime: new Date('2024-01-01T00:00:00.000Z') });
  return { readFileSync, statSync, default: { readFileSync, statSync } };
});

const { getArtistsByGenres, getTopGenres, searchArtistsByName, getRosterGeneratedAt, getEmailTiers } = await import('./roster');

describe('getArtistsByGenres', () => {
  it('excludes artists with no manager emails', () => {
    const result = getArtistsByGenres({ genres: ['Pop'] });
    expect(result.map(a => a.name)).not.toContain('No Manager Artist');
  });

  it('matches "any" mode when an artist has at least one selected genre', () => {
    const result = getArtistsByGenres({ genres: ['Rock'] });
    expect(result.map(a => a.name)).toEqual(['Rock Band']);
  });

  it('requires every selected genre in "all" mode', () => {
    const result = getArtistsByGenres({ genres: ['Pop', 'Rock'], matchMode: 'all' });
    expect(result.map(a => a.name)).toEqual(['Rock Band']);
  });

  it('filters by minimum and maximum Spotify followers', () => {
    const result = getArtistsByGenres({ genres: ['Pop'], minFollowers: 5000, maxFollowers: 50000 });
    expect(result.map(a => a.name)).toEqual(['Solo Pop Artist']);
  });

  it('filters by gender and artist type', () => {
    expect(getArtistsByGenres({ genres: ['Pop'], gender: 'FEMALE' }).map(a => a.name))
      .toEqual(['Solo Pop Artist', 'Freemail Managed Artist']);
    expect(getArtistsByGenres({ genres: ['Pop', 'Rock'], artistType: 'Group' }).map(a => a.name)).toEqual(['Rock Band']);
  });

  it('filters by Instagram follower range', () => {
    const result = getArtistsByGenres({ genres: ['Pop'], minInstagram: 10000 });
    expect(result.map(a => a.name)).toEqual(['Rock Band']);
  });

  it('returns every artist (subject to the other filters) when no genres are selected — an empty selection is "no genre constraint," not "no results"', () => {
    const result = getArtistsByGenres({});
    expect(result.map(a => a.name)).toEqual(
      FIXTURE_ARTISTS.filter(a => a.managerEmails.length > 0).map(a => a.name)
    );
  });

  it('an empty genre selection still applies the other filters (e.g. follower range)', () => {
    const result = getArtistsByGenres({ minFollowers: 3000 });
    expect(result.map(a => a.name)).toEqual(['Solo Pop Artist', 'Rock Band', 'Freemail Managed Artist', 'No Company Artist']);
  });

  it('an empty genre selection is the only way to reach a genreless artist', () => {
    const result = getArtistsByGenres({});
    expect(result.map(a => a.name)).toContain('Genreless Artist');
    // Confirms it's genuinely unreachable through any genre-scoped query.
    expect(getArtistsByGenres({ genres: ['Pop', 'Rock', 'Indie'], matchMode: 'any' }).map(a => a.name))
      .not.toContain('Genreless Artist');
  });

  it('does not duplicate an artist matching more than one selected genre in "any" mode', () => {
    // Rock Band has both Rock and Pop; selecting both should still return it once.
    const result = getArtistsByGenres({ genres: ['Rock', 'Pop'] });
    expect(result.filter(a => a.name === 'Rock Band')).toHaveLength(1);
  });

  it('preserves original roster order regardless of genre selection order', () => {
    const result = getArtistsByGenres({ genres: ['Rock', 'Pop'] });
    expect(result.map(a => a.name)).toEqual(['Solo Pop Artist', 'Rock Band', 'Freemail Managed Artist', 'No Company Artist']);
  });

  it('matches genres case-insensitively', () => {
    expect(getArtistsByGenres({ genres: ['rock'] }).map(a => a.name)).toEqual(['Rock Band']);
  });

  it('returns nothing in "all" mode when one of the genres has no matches at all', () => {
    expect(getArtistsByGenres({ genres: ['Pop', 'Jazz'], matchMode: 'all' })).toEqual([]);
  });

  describe('reachability filters (management company size / freemail domain)', () => {
    it('maxCompanySize keeps only artists whose company represents at most N roster artists', () => {
      // "Big Agency" has 3 artists in the fixture (2 with emails); "Small Co"/
      // "Tiny Management" have 1 each.
      const result = getArtistsByGenres({ maxCompanySize: 1 });
      expect(result.map(a => a.name).sort()).toEqual(['Duplicate Manager Artist', 'Freemail Managed Artist', 'Genreless Artist'].sort());
    });

    it('excludes an artist with no managementCompany listed even when maxCompanySize is on', () => {
      const result = getArtistsByGenres({ maxCompanySize: 1 });
      expect(result.map(a => a.name)).not.toContain('No Company Artist');
    });

    it('freemailOnly keeps only artists with a manager on a consumer email domain', () => {
      const result = getArtistsByGenres({ freemailOnly: true });
      expect(result.map(a => a.name).sort()).toEqual(['Freemail Managed Artist', 'Genreless Artist'].sort());
    });

    it('combines maxCompanySize and freemailOnly with OR, not AND', () => {
      // "Duplicate Manager Artist" is a small company (1) but not freemail;
      // "Freemail Managed Artist" is freemail AND a small company (1) —
      // both should pass under OR. An AND reading would drop the first.
      const result = getArtistsByGenres({ maxCompanySize: 1, freemailOnly: true });
      expect(result.map(a => a.name).sort()).toEqual(
        ['Duplicate Manager Artist', 'Freemail Managed Artist', 'Genreless Artist'].sort()
      );
    });

    it('still applies genre and other filters alongside the reachability filter', () => {
      const result = getArtistsByGenres({ genres: ['Pop'], freemailOnly: true });
      expect(result.map(a => a.name)).toEqual(['Freemail Managed Artist']);
    });

    it('is off by default (0 / false), matching every other pre-existing filter', () => {
      expect(getArtistsByGenres({ genres: ['Pop'] }).map(a => a.name)).toEqual(
        ['Solo Pop Artist', 'Rock Band', 'Freemail Managed Artist', 'No Company Artist']
      );
    });
  });
});

describe('getTopGenres', () => {
  it('orders genres by frequency, ties broken alphabetically', () => {
    // Pop: 5 artists tagged (getTopGenres doesn't filter by manager email, unlike
    // getArtistsByGenres — so this includes 'No Manager Artist' too). Rock and
    // Indie: 1 artist each — tie broken alphabetically.
    expect(getTopGenres()).toEqual(['Pop', 'Indie', 'Rock']);
  });
});

describe('searchArtistsByName', () => {
  it('matches case-insensitively and excludes artists without managers', () => {
    const result = searchArtistsByName('rock');
    expect(result.map(a => a.name)).toEqual(['Rock Band']);
  });

  it('returns an empty array for a blank query', () => {
    expect(searchArtistsByName('  ')).toEqual([]);
  });

  it('dedupes a manager email listed twice for the same artist, case-insensitively, keeping names in sync', () => {
    const [artist] = searchArtistsByName('Duplicate Manager Artist');
    expect(artist.managerEmails).toEqual(['myles@example.com', 'mike@example.com']);
    expect(artist.managerNames).toEqual(['Myles', 'Mike']);
  });
});

describe('getRosterGeneratedAt', () => {
  it('falls back to the file mtime when roster.json has no generatedAt field', () => {
    // The fixture's readFileSync mock above returns no generatedAt, so this
    // exercises the statSync(...).mtime fallback rather than the happy path.
    expect(getRosterGeneratedAt()).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('getEmailTiers', () => {
  it("maps a single-artist manager email to that artist's own follower count and company size", () => {
    // 'Big Agency' has 3 members in the fixture (Solo Pop Artist, Rock Band,
    // No Manager Artist) — alex@example.com belongs only to Solo Pop Artist.
    const tiers = getEmailTiers(['alex@example.com']);
    expect(tiers.get('alex@example.com')).toEqual({ maxSpotifyFollowers: 10000, companySize: 3, artistCount: 1 });
  });

  it('is case- and whitespace-insensitive on the lookup key, matching how it indexes manager emails', () => {
    const tiers = getEmailTiers(['  Alex@Example.COM  ']);
    expect(tiers.get('alex@example.com')).toEqual({ maxSpotifyFollowers: 10000, companySize: 3, artistCount: 1 });
  });

  it('maps to null (never dropped, never a fabricated zero) for an address with no roster entry at all', () => {
    const tiers = getEmailTiers(['not-in-roster@example.com']);
    expect(tiers.has('not-in-roster@example.com')).toBe(true);
    expect(tiers.get('not-in-roster@example.com')).toBeNull();
  });

  it('uses 0 as the "no managementCompany listed" sentinel rather than Infinity or a false "small company" reading', () => {
    const tiers = getEmailTiers(['drew@example.com']);
    expect(tiers.get('drew@example.com')).toEqual({ maxSpotifyFollowers: 4000, companySize: 0, artistCount: 1 });
  });

  it('takes the MAX Spotify followers and MAX company size across every artist a shared manager email represents', () => {
    // multi@example.com is listed for two artists: one at a 2-artist company
    // with 500 followers, one at a 3-artist company with 1500 followers. Both
    // numbers should come from the bigger side, not the smaller, an average,
    // or whichever artist the index happened to see first — see the "why max"
    // reasoning on buildEmailTierIndex.
    const tiers = getEmailTiers(['multi@example.com']);
    expect(tiers.get('multi@example.com')).toEqual({ maxSpotifyFollowers: 1500, companySize: 3, artistCount: 2 });
  });

  it('dedupes a repeated address (any casing) in the input list to one map entry', () => {
    const tiers = getEmailTiers(['alex@example.com', 'ALEX@EXAMPLE.COM', 'alex@example.com']);
    expect(tiers.size).toBe(1);
  });
});
