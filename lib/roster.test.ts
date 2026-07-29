import { describe, it, expect, vi } from 'vitest';
import type { Artist } from './roster';

const FIXTURE_ARTISTS: Artist[] = [
  {
    name: 'Solo Pop Artist', rostrUrl: '', genres: ['Pop'], type: 'Solo', gender: 'FEMALE',
    spotifyFollowers: 10000, instagramFollowers: 5000, youtubeSubscribers: 0,
    managementCompany: '', agencies: '', labels: '', publishers: '',
    managerNames: ['Alex'], managerEmails: ['alex@example.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    name: 'Rock Band', rostrUrl: '', genres: ['Rock', 'Pop'], type: 'Group', gender: '',
    spotifyFollowers: 100000, instagramFollowers: 50000, youtubeSubscribers: 0,
    managementCompany: '', agencies: '', labels: '', publishers: '',
    managerNames: ['Jamie'], managerEmails: ['jamie@example.com'], instagramHandle: '', avatarUrl: '',
  },
  {
    name: 'No Manager Artist', rostrUrl: '', genres: ['Pop'], type: 'Solo', gender: 'MALE',
    spotifyFollowers: 1000, instagramFollowers: 500, youtubeSubscribers: 0,
    managementCompany: '', agencies: '', labels: '', publishers: '',
    managerNames: [], managerEmails: [], instagramHandle: '', avatarUrl: '',
  },
];

vi.mock('fs', () => ({
  readFileSync: () => JSON.stringify({ artists: FIXTURE_ARTISTS, genres: ['Pop', 'Rock'] }),
}));

const { getArtistsByGenres, getTopGenres, searchArtistsByName } = await import('./roster');

describe('getArtistsByGenres', () => {
  it('excludes artists with no manager emails', () => {
    const result = getArtistsByGenres(['Pop']);
    expect(result.map(a => a.name)).not.toContain('No Manager Artist');
  });

  it('matches "any" mode when an artist has at least one selected genre', () => {
    const result = getArtistsByGenres(['Rock']);
    expect(result.map(a => a.name)).toEqual(['Rock Band']);
  });

  it('requires every selected genre in "all" mode', () => {
    const result = getArtistsByGenres(['Pop', 'Rock'], 0, 0, '', '', 0, 0, 'all');
    expect(result.map(a => a.name)).toEqual(['Rock Band']);
  });

  it('filters by minimum and maximum Spotify followers', () => {
    const result = getArtistsByGenres(['Pop'], 5000, 50000);
    expect(result.map(a => a.name)).toEqual(['Solo Pop Artist']);
  });

  it('filters by gender and artist type', () => {
    expect(getArtistsByGenres(['Pop'], 0, 0, 'FEMALE').map(a => a.name)).toEqual(['Solo Pop Artist']);
    expect(getArtistsByGenres(['Pop', 'Rock'], 0, 0, '', 'Group').map(a => a.name)).toEqual(['Rock Band']);
  });

  it('filters by Instagram follower range', () => {
    const result = getArtistsByGenres(['Pop'], 0, 0, '', '', 10000, 0);
    expect(result.map(a => a.name)).toEqual(['Rock Band']);
  });

  it('returns nothing when no genres are selected', () => {
    expect(getArtistsByGenres([])).toEqual([]);
  });
});

describe('getTopGenres', () => {
  it('orders genres by frequency', () => {
    expect(getTopGenres()).toEqual(['Pop', 'Rock']);
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
});
