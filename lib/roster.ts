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

export function getArtistsByGenres(selectedGenres: string[]): Artist[] {
  const { artists } = getRoster();
  if (!selectedGenres.length) return [];

  const lower = selectedGenres.map(g => g.toLowerCase());
  return artists.filter(a =>
    a.managerEmails.length > 0 &&
    a.genres.some(g => lower.includes(g.toLowerCase()))
  );
}
