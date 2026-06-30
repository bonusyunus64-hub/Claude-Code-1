import { readFileSync } from 'fs';
import { join } from 'path';

export interface Label {
  name: string;
  type: string;
  genres: string[];
  region: string;
  submissionEmail: string;
  notes?: string;
}

interface LabelData {
  labels: Label[];
}

let cached: LabelData | null = null;

export function getLabelData(): LabelData {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(join(process.cwd(), 'data', 'labels.json'), 'utf-8'));
  return cached!;
}

export function filterLabels(genres: string[], regions: string[], types: string[], matchMode: 'any' | 'all' = 'any'): Label[] {
  const { labels } = getLabelData();
  const lowerGenres = genres.map(g => g.toLowerCase());
  return labels.filter(l => {
    if (genres.length) {
      const check = matchMode === 'all'
        ? lowerGenres.every(g => l.genres.some(lg => lg.toLowerCase() === g))
        : l.genres.some(g => lowerGenres.includes(g.toLowerCase()));
      if (!check) return false;
    }
    if (regions.length) {
      if (!regions.some(r => l.region === r)) return false;
    }
    if (types.length) {
      if (!types.some(t => l.type === t)) return false;
    }
    return true;
  });
}

export function getAllLabelGenres(): string[] {
  const { labels } = getLabelData();
  const set = new Set<string>();
  labels.forEach(l => l.genres.forEach(g => set.add(g)));
  return Array.from(set).sort();
}

export function getAllLabelRegions(): string[] {
  const { labels } = getLabelData();
  const set = new Set<string>();
  labels.forEach(l => set.add(l.region));
  return Array.from(set).sort();
}

export function getAllLabelTypes(): string[] {
  const { labels } = getLabelData();
  const set = new Set<string>();
  labels.forEach(l => set.add(l.type));
  return Array.from(set).sort();
}
