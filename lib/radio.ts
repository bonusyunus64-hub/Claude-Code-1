import { readFileSync } from 'fs';
import { join } from 'path';

export interface RadioStation {
  name: string;
  region: string;
  genres: string[];
  emails: string[];
  phone?: string;
}

interface RadioData {
  stations: RadioStation[];
}

let cached: RadioData | null = null;

export function getRadioData(): RadioData {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(join(process.cwd(), 'data', 'radio.json'), 'utf-8'));
  return cached!;
}

export function filterRadioStations(genres: string[], locations: string[]): RadioStation[] {
  const { stations } = getRadioData();
  const lowerGenres = genres.map(g => g.toLowerCase());
  return stations.filter(s => {
    if (genres.length && !s.genres.some(g => lowerGenres.includes(g.toLowerCase()))) return false;
    if (locations.length) {
      const isIntl = locations.includes('International');
      const matchesRegion = locations.some(l => l !== 'International' && s.region === l);
      const matchesIntl = isIntl && s.region.startsWith('International');
      if (!matchesRegion && !matchesIntl) return false;
    }
    return true;
  });
}

export function getAllRadioGenres(): string[] {
  const { stations } = getRadioData();
  const set = new Set<string>();
  stations.forEach(s => s.genres.forEach(g => set.add(g)));
  return Array.from(set).sort();
}

export function getAllRadioRegions(): string[] {
  const { stations } = getRadioData();
  const set = new Set<string>();
  stations.forEach(s => {
    if (s.region.startsWith('International')) {
      set.add('International');
    } else {
      set.add(s.region);
    }
  });
  return Array.from(set).sort();
}
