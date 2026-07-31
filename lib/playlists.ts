import { readFileSync } from 'fs';
import { join } from 'path';

export interface PlaylistCurator {
  name: string;
  platform: string;
  genres: string[];
  emails: string[];
  followers?: number;
}

interface PlaylistData {
  curators: PlaylistCurator[];
}

let cached: PlaylistData | null = null;

export function getPlaylistData(): PlaylistData {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(join(process.cwd(), 'data', 'playlists.json'), 'utf-8'));
  return cached!;
}

export function filterPlaylistCurators(genres: string[], platforms: string[], matchMode: 'any' | 'all' = 'any'): PlaylistCurator[] {
  const { curators } = getPlaylistData();
  const lowerGenres = genres.map(g => g.toLowerCase());
  return curators.filter(c => {
    if (genres.length) {
      const check = matchMode === 'all'
        ? lowerGenres.every(g => c.genres.some(cg => cg.toLowerCase() === g))
        : c.genres.some(g => lowerGenres.includes(g.toLowerCase()));
      if (!check) return false;
    }
    if (platforms.length && !platforms.includes(c.platform)) return false;
    return true;
  });
}

export function getAllPlaylistGenres(): string[] {
  const { curators } = getPlaylistData();
  const set = new Set<string>();
  curators.forEach(c => c.genres.forEach(g => set.add(g)));
  return Array.from(set).sort();
}

export function getAllPlaylistPlatforms(): string[] {
  const { curators } = getPlaylistData();
  const set = new Set<string>();
  curators.forEach(c => set.add(c.platform));
  return Array.from(set).sort();
}

/**
 * Drives the "Coming soon" gate on the Playlist Curators tab (see
 * PromotionSection.tsx): data/playlists.json currently ships with zero curator
 * records, so the tab is disabled whenever this is 0 and lights back up on its
 * own — no code change needed — the day curator records are added there.
 */
export function getPlaylistCuratorCount(): number {
  return getPlaylistData().curators.length;
}
