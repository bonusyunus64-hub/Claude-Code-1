import { readFileSync } from 'fs';
import { join } from 'path';

export interface Artist {
  name: string;
  rostrUrl: string;
  genres: string[];
  type: string;
  gender: string;
  spotifyFollowers: number;
  instagramFollowers: number;
  youtubeSubscribers: number;
  managementCompany: string;
  agencies: string;
  labels: string;
  publishers: string;
  managerNames: string[];
  managerEmails: string[];
  instagramHandle: string;
  avatarUrl: string;
}

interface RosterData {
  artists: Artist[];
  genres: string[];
}

interface IndexedRoster extends RosterData {
  /** Lowercased genre -> ascending artist indices, built once so a genre filter
   *  is a lookup instead of a full scan over every artist on every request. */
  genreIndex: Map<string, number[]>;
}

let cached: IndexedRoster | null = null;

/**
 * Some roster records list the same manager email twice for one artist (a data
 * entry slip, not two distinct managers) — left as-is, that duplicate flows all
 * the way to a React list keyed by email and collides. Drop it here, once, at
 * load time, keeping managerNames in sync by index rather than filtering the
 * arrays independently.
 */
function dedupeManagerContacts(artist: Artist): Artist {
  const seen = new Set<string>();
  const managerEmails: string[] = [];
  const managerNames: string[] = [];
  artist.managerEmails.forEach((email, i) => {
    const key = email.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    managerEmails.push(email);
    managerNames.push(artist.managerNames[i] ?? '');
  });
  return managerEmails.length === artist.managerEmails.length ? artist : { ...artist, managerEmails, managerNames };
}

function buildGenreIndex(artists: Artist[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  artists.forEach((artist, i) => {
    artist.genres.forEach(genre => {
      const key = genre.toLowerCase();
      const indices = index.get(key);
      if (indices) indices.push(i); else index.set(key, [i]);
    });
  });
  return index;
}

function getIndexedRoster(): IndexedRoster {
  if (cached) return cached;
  const filePath = join(process.cwd(), 'data', 'roster.json');
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw) as RosterData;
  const artists = data.artists.map(dedupeManagerContacts);
  cached = { ...data, artists, genreIndex: buildGenreIndex(artists) };
  return cached;
}

export function getRoster(): RosterData {
  return getIndexedRoster();
}

export function getTopGenres(limit = 20): string[] {
  const { artists } = getRoster();
  const counts = new Map<string, number>();
  artists.forEach(a => a.genres.forEach(g => counts.set(g, (counts.get(g) ?? 0) + 1)));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([genre]) => genre);
}

/** Candidate artist indices for the selected genres, in ascending (original roster) order. */
function candidateIndices(genreIndex: Map<string, number[]>, lowerGenres: string[], matchMode: 'any' | 'all'): number[] {
  if (matchMode === 'all') {
    const lists = lowerGenres.map(g => genreIndex.get(g) ?? []);
    if (lists.some(list => list.length === 0)) return [];
    let common = new Set(lists[0]);
    for (let i = 1; i < lists.length; i++) {
      const next = lists[i];
      const nextSet = new Set(next);
      common = new Set([...common].filter(idx => nextSet.has(idx)));
      if (common.size === 0) break;
    }
    return Array.from(common).sort((a, b) => a - b);
  }
  const union = new Set<number>();
  lowerGenres.forEach(g => (genreIndex.get(g) ?? []).forEach(idx => union.add(idx)));
  return Array.from(union).sort((a, b) => a - b);
}

export function getArtistsByGenres(
  selectedGenres: string[],
  minFollowers = 0,
  maxFollowers = 0,
  gender = '',
  artistType = '',
  minInstagram = 0,
  maxInstagram = 0,
  matchMode: 'any' | 'all' = 'any'
): Artist[] {
  const { artists, genreIndex } = getIndexedRoster();
  if (!selectedGenres.length) return [];

  const lower = selectedGenres.map(g => g.toLowerCase());
  const indices = candidateIndices(genreIndex, lower, matchMode);

  const result: Artist[] = [];
  for (const idx of indices) {
    const a = artists[idx];
    if (!a.managerEmails.length) continue;
    const spotify = a.spotifyFollowers ?? 0;
    if (minFollowers > 0 && spotify < minFollowers) continue;
    if (maxFollowers > 0 && spotify > maxFollowers) continue;
    if (gender && a.gender !== gender) continue;
    if (artistType && a.type !== artistType) continue;
    const instagram = a.instagramFollowers ?? 0;
    if (minInstagram > 0 && instagram < minInstagram) continue;
    if (maxInstagram > 0 && instagram > maxInstagram) continue;
    result.push(a);
  }
  return result;
}

export function searchArtistsByName(query: string, limit = 20): Artist[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { artists } = getRoster();
  return artists.filter(a => a.managerEmails.length > 0 && a.name.toLowerCase().includes(q)).slice(0, limit);
}
