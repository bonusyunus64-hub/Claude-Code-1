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
}

interface RosterData {
  artists: Artist[];
  genres: string[];
}

let cached: RosterData | null = null;

export function getRoster(): RosterData {
  if (cached) return cached;
  const filePath = join(process.cwd(), 'data', 'roster.json');
  const raw = readFileSync(filePath, 'utf-8');
  cached = JSON.parse(raw) as RosterData;
  return cached;
}

export function getArtistsByGenres(
  selectedGenres: string[],
  minFollowers = 0,
  maxFollowers = 0,
  gender = ''
): Artist[] {
  const { artists } = getRoster();
  if (!selectedGenres.length) return [];

  const lower = selectedGenres.map(g => g.toLowerCase());
  return artists.filter(a => {
    if (!a.managerEmails.length) return false;
    if (!a.genres.some(g => lower.includes(g.toLowerCase()))) return false;
    const followers = a.spotifyFollowers ?? 0;
    if (minFollowers > 0 && followers < minFollowers) return false;
    if (maxFollowers > 0 && followers > maxFollowers) return false;
    if (gender && a.gender !== gender) return false;
    return true;
  });
}
