import { describe, it, expect } from 'vitest';
import {
  NAMED_ARTIST_CAP, genreFitScore, rankArtistsForPitch, groupArtistsByManagerEmail,
  buildArtistNameVars, managersOverNamingCap, type ArtistFitInput,
} from './artistFit';

// Minimal ArtistFitInput builder — real Artist objects (lib/roster.ts) carry a
// dozen more fields this module never reads; tests only need the ones it does.
function artist(overrides: Partial<ArtistFitInput> & { name: string }): ArtistFitInput {
  return {
    genres: [],
    spotifyFollowers: 0,
    managerNames: [],
    managerEmails: [],
    ...overrides,
  };
}

describe('genreFitScore', () => {
  it('counts how many selected genres the artist covers', () => {
    const a = artist({ name: 'A', genres: ['Pop', 'Rock', 'Indie'] });
    expect(genreFitScore(a, ['Pop', 'Rock'])).toBe(2);
    expect(genreFitScore(a, ['Pop', 'Jazz'])).toBe(1);
    expect(genreFitScore(a, ['Jazz', 'Metal'])).toBe(0);
  });

  it('is case-insensitive and trims whitespace on both sides', () => {
    const a = artist({ name: 'A', genres: [' Pop ', 'ROCK'] });
    expect(genreFitScore(a, ['pop', ' rock '])).toBe(2);
    expect(genreFitScore(a, ['POP', 'Rock'])).toBe(2);
  });

  it('counts each selected genre at most once, even if the artist lists it twice', () => {
    const a = artist({ name: 'A', genres: ['Pop', 'pop', 'Rock'] });
    expect(genreFitScore(a, ['Pop', 'Pop'])).toBe(2);
  });

  it('returns 0 when selectedGenres is empty, regardless of the artist\'s own genres', () => {
    const a = artist({ name: 'A', genres: ['Pop', 'Rock'] });
    expect(genreFitScore(a, [])).toBe(0);
  });

  it('returns 0 for an artist with no genres at all', () => {
    const a = artist({ name: 'A', genres: [] });
    expect(genreFitScore(a, ['Pop'])).toBe(0);
  });
});

describe('rankArtistsForPitch', () => {
  it('orders by genreFitScore descending', () => {
    const low = artist({ name: 'Low', genres: ['Pop'], spotifyFollowers: 1000 });
    const high = artist({ name: 'High', genres: ['Pop', 'Rock'], spotifyFollowers: 10 });
    const result = rankArtistsForPitch([low, high], ['Pop', 'Rock']);
    expect(result.map(a => a.name)).toEqual(['High', 'Low']);
  });

  it('breaks a fit-score tie by spotifyFollowers descending', () => {
    const small = artist({ name: 'Small', genres: ['Pop'], spotifyFollowers: 100 });
    const big = artist({ name: 'Big', genres: ['Pop'], spotifyFollowers: 90000 });
    const result = rankArtistsForPitch([small, big], ['Pop']);
    expect(result.map(a => a.name)).toEqual(['Big', 'Small']);
  });

  it('keeps original input order for a remaining tie (score AND followers equal) — relies on stable sort', () => {
    const a1 = artist({ name: 'First', genres: ['Pop'], spotifyFollowers: 500 });
    const a2 = artist({ name: 'Second', genres: ['Pop'], spotifyFollowers: 500 });
    const a3 = artist({ name: 'Third', genres: ['Pop'], spotifyFollowers: 500 });
    const result = rankArtistsForPitch([a1, a2, a3], ['Pop']);
    expect(result.map(a => a.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('does not mutate the input array', () => {
    const input = [
      artist({ name: 'Z', spotifyFollowers: 1 }),
      artist({ name: 'A', spotifyFollowers: 9999 }),
    ];
    const originalOrder = input.map(a => a.name);
    rankArtistsForPitch(input, []);
    expect(input.map(a => a.name)).toEqual(originalOrder);
  });

  it('degenerate case: empty selectedGenres collapses to pure follower-descending order', () => {
    const artists = [
      artist({ name: 'Small', genres: ['Pop'], spotifyFollowers: 10 }),
      artist({ name: 'Big', genres: ['Rock'], spotifyFollowers: 90000 }),
      artist({ name: 'Medium', genres: [], spotifyFollowers: 500 }),
    ];
    const result = rankArtistsForPitch(artists, []);
    expect(result.map(a => a.name)).toEqual(['Big', 'Medium', 'Small']);
  });

  it('degenerate case: matchMode "all" semantics (every candidate covers every selected genre) also collapses to pure follower order', () => {
    // Simulates what getArtistsByGenres({ matchMode: 'all' }) guarantees: every
    // artist reaching this function already covers the full selected-genre set,
    // so every genreFitScore ties and only followers decide order.
    const selectedGenres = ['Pop', 'Rock'];
    const artists = [
      artist({ name: 'Small', genres: ['Pop', 'Rock'], spotifyFollowers: 10 }),
      artist({ name: 'Big', genres: ['Pop', 'Rock', 'Indie'], spotifyFollowers: 90000 }),
      artist({ name: 'Medium', genres: ['Rock', 'Pop'], spotifyFollowers: 500 }),
    ];
    const result = rankArtistsForPitch(artists, selectedGenres);
    expect(result.map(a => a.name)).toEqual(['Big', 'Medium', 'Small']);
  });
});

describe('groupArtistsByManagerEmail', () => {
  it('collapses the same address, case-insensitively, into one group', () => {
    const a1 = artist({ name: 'A1', managerEmails: ['Manager@Example.com'], managerNames: ['Jo'] });
    const a2 = artist({ name: 'A2', managerEmails: ['manager@example.com'], managerNames: ['Jo'] });
    const groups = groupArtistsByManagerEmail([a1, a2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].artists.map(a => a.name)).toEqual(['A1', 'A2']);
  });

  it('sends to the address as originally cased, not the lowercased key', () => {
    const a1 = artist({ name: 'A1', managerEmails: ['Manager@Example.com'], managerNames: ['Jo'] });
    const groups = groupArtistsByManagerEmail([a1]);
    expect(groups[0].email).toBe('Manager@Example.com');
  });

  it('puts one artist with several managers into each of those managers\' groups', () => {
    const a = artist({
      name: 'MultiManaged',
      managerEmails: ['first@example.com', 'second@example.com'],
      managerNames: ['Alex', 'Sam'],
    });
    const groups = groupArtistsByManagerEmail([a]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.email)).toEqual(['first@example.com', 'second@example.com']);
    expect(groups[0].artists).toEqual([a]);
    expect(groups[1].artists).toEqual([a]);
  });

  it('leaves managerName blank (not defaulted) when managerNames[i] is missing', () => {
    const a = artist({ name: 'A', managerEmails: ['manager@example.com'], managerNames: [] });
    const groups = groupArtistsByManagerEmail([a]);
    expect(groups[0].managerName).toBe('');
  });

  it('prefers the name attached to the highest-ranked (first-passed) artist when names disagree', () => {
    const ranked = [
      artist({ name: 'Lead', managerEmails: ['manager@example.com'], managerNames: ['Preferred Name'] }),
      artist({ name: 'Second', managerEmails: ['manager@example.com'], managerNames: ['Other Name'] }),
    ];
    const groups = groupArtistsByManagerEmail(ranked);
    expect(groups[0].managerName).toBe('Preferred Name');
  });

  it('falls back to a lower-ranked artist\'s name when the highest-ranked one supplied none', () => {
    const ranked = [
      artist({ name: 'Lead', managerEmails: ['manager@example.com'], managerNames: [''] }),
      artist({ name: 'Second', managerEmails: ['manager@example.com'], managerNames: ['Backup Name'] }),
    ];
    const groups = groupArtistsByManagerEmail(ranked);
    expect(groups[0].managerName).toBe('Backup Name');
  });

  it('preserves first-seen insertion order of addresses', () => {
    const artists = [
      artist({ name: 'A', managerEmails: ['z@example.com'] }),
      artist({ name: 'B', managerEmails: ['a@example.com'] }),
      artist({ name: 'C', managerEmails: ['z@example.com'] }),
    ];
    const groups = groupArtistsByManagerEmail(artists);
    expect(groups.map(g => g.email)).toEqual(['z@example.com', 'a@example.com']);
  });

  it('skips a blank manager email rather than grouping it under an empty-string key', () => {
    const a = artist({ name: 'A', managerEmails: ['', 'real@example.com'], managerNames: ['', 'Real'] });
    const groups = groupArtistsByManagerEmail([a]);
    expect(groups.map(g => g.email)).toEqual(['real@example.com']);
  });
});

describe('buildArtistNameVars', () => {
  it('formats 1 name with no conjunction', () => {
    const artists = [artist({ name: 'Alice' })];
    expect(buildArtistNameVars(artists).artistNames).toBe('Alice');
    expect(buildArtistNameVars(artists).allArtistNames).toBe('Alice');
  });

  it('formats 2 names as "A and B"', () => {
    const artists = [artist({ name: 'Alice' }), artist({ name: 'Bob' })];
    expect(buildArtistNameVars(artists).artistNames).toBe('Alice and Bob');
  });

  it('formats 3 names as "A, B and C" — no Oxford comma', () => {
    const artists = [artist({ name: 'Alice' }), artist({ name: 'Bob' }), artist({ name: 'Cara' })];
    expect(buildArtistNameVars(artists).artistNames).toBe('Alice, Bob and Cara');
  });

  it('formats 7 names (uncapped, via allArtistNames) the same prose way', () => {
    const names = ['Alice', 'Bob', 'Cara', 'Dee', 'Eve', 'Fay', 'Gus'];
    const artists = names.map(name => artist({ name }));
    expect(buildArtistNameVars(artists, 7).allArtistNames).toBe('Alice, Bob, Cara, Dee, Eve, Fay and Gus');
  });

  it('caps artistNames at NAMED_ARTIST_CAP and reports the rest via otherCount, while allArtistNames stays uncapped', () => {
    const names = ['Alice', 'Bob', 'Cara', 'Dee', 'Eve'];
    const artists = names.map(name => artist({ name }));
    const vars = buildArtistNameVars(artists); // default cap = NAMED_ARTIST_CAP (3)
    expect(vars.artistNames).toBe('Alice, Bob and Cara');
    expect(vars.artistCount).toBe('5');
    expect(vars.otherCount).toBe('2');
    expect(vars.allArtistNames).toBe('Alice, Bob, Cara, Dee and Eve');
  });

  it('reports otherCount as "0" (string) when the group is at or under the cap', () => {
    const artists = [artist({ name: 'Alice' }), artist({ name: 'Bob' })];
    const vars = buildArtistNameVars(artists);
    expect(vars.otherCount).toBe('0');
    expect(vars.artistCount).toBe('2');
  });

  it('exposes the lead artist itself (the first, highest-ranked one) for single-artist template vars', () => {
    const lead = artist({ name: 'Alice', spotifyFollowers: 12345 });
    const vars = buildArtistNameVars([lead, artist({ name: 'Bob' })]);
    expect(vars.leadArtist).toBe(lead);
  });

  it('respects an explicit cap override', () => {
    const names = ['Alice', 'Bob', 'Cara', 'Dee'];
    const artists = names.map(name => artist({ name }));
    const vars = buildArtistNameVars(artists, 1);
    expect(vars.artistNames).toBe('Alice');
    expect(vars.otherCount).toBe('3');
  });

  describe('artistSummary', () => {
    // Using Nori/Cayo/Rence throughout — the exact names from the brief's worked
    // examples — so these assertions read as a direct check against the spec.

    it('is just the plain 1-name list when there is only 1 artist (should not be reached in practice — a single-artist manager gets the ordinary template — but must not produce something broken)', () => {
      const vars = buildArtistNameVars([artist({ name: 'Nori' })]);
      expect(vars.artistSummary).toBe('Nori');
    });

    it('is the plain 2-name list — nothing to summarize', () => {
      const artists = [artist({ name: 'Nori' }), artist({ name: 'Cayo' })];
      expect(buildArtistNameVars(artists).artistSummary).toBe('Nori and Cayo');
    });

    it('is the plain 3-name list at exactly the cap — nothing truncated', () => {
      const artists = [artist({ name: 'Nori' }), artist({ name: 'Cayo' }), artist({ name: 'Rence' })];
      expect(buildArtistNameVars(artists).artistSummary).toBe('Nori, Cayo and Rence');
    });

    it('states the overflow with the SINGULAR "other" for exactly 1 artist over the cap', () => {
      const artists = ['Nori', 'Cayo', 'Rence', 'Dee'].map(name => artist({ name }));
      expect(buildArtistNameVars(artists).artistSummary).toBe('Nori, Cayo, Rence and 1 other');
    });

    it('states the overflow with the PLURAL "others" for more than 1 artist over the cap', () => {
      const artists = ['Nori', 'Cayo', 'Rence', 'Dee', 'Eve', 'Fay', 'Gus'].map(name => artist({ name }));
      expect(buildArtistNameVars(artists).artistSummary).toBe('Nori, Cayo, Rence and 4 others');
    });

    it('respects an explicit cap override, singular boundary included', () => {
      const artists = ['Nori', 'Cayo', 'Rence'].map(name => artist({ name }));
      expect(buildArtistNameVars(artists, 2).artistSummary).toBe('Nori, Cayo and 1 other');
    });

    it('leaves artistNames, otherCount, artistCount and allArtistNames unaffected by artistSummary', () => {
      const artists = ['Nori', 'Cayo', 'Rence', 'Dee'].map(name => artist({ name }));
      const vars = buildArtistNameVars(artists);
      expect(vars.artistNames).toBe('Nori, Cayo and Rence');
      expect(vars.otherCount).toBe('1');
      expect(vars.artistCount).toBe('4');
      expect(vars.allArtistNames).toBe('Nori, Cayo, Rence and Dee');
      expect(vars.artistSummary).toBe('Nori, Cayo, Rence and 1 other');
    });
  });
});

describe('managersOverNamingCap', () => {
  function groupWithArtistCount(email: string, count: number) {
    const artists = Array.from({ length: count }, (_, i) => artist({ name: `Artist${i}`, managerEmails: [email] }));
    return groupArtistsByManagerEmail(artists)[0];
  }

  it('does NOT flag a group holding exactly NAMED_ARTIST_CAP artists', () => {
    const group = groupWithArtistCount('manager@example.com', NAMED_ARTIST_CAP);
    expect(managersOverNamingCap([group])).toEqual([]);
  });

  it('DOES flag a group holding NAMED_ARTIST_CAP + 1 artists', () => {
    const group = groupWithArtistCount('manager@example.com', NAMED_ARTIST_CAP + 1);
    expect(managersOverNamingCap([group])).toEqual([group]);
  });

  it('sorts flagged groups by artist count descending', () => {
    const small = groupWithArtistCount('small@example.com', NAMED_ARTIST_CAP + 1);
    const big = groupWithArtistCount('big@example.com', NAMED_ARTIST_CAP + 5);
    const result = managersOverNamingCap([small, big]);
    expect(result.map(g => g.email)).toEqual(['big@example.com', 'small@example.com']);
  });

  it('respects an explicit cap override', () => {
    const group = groupWithArtistCount('manager@example.com', 2);
    expect(managersOverNamingCap([group], 1)).toEqual([group]);
    expect(managersOverNamingCap([group], 2)).toEqual([]);
  });
});
