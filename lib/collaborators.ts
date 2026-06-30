import { readFileSync } from 'fs';
import { join } from 'path';

export interface Collaborator {
  name: string;
  role: string;
  genres: string[];
  location: string;
  email: string;
  credits?: string;
}

interface CollaboratorData {
  collaborators: Collaborator[];
}

let cached: CollaboratorData | null = null;

export function getCollaboratorData(): CollaboratorData {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(join(process.cwd(), 'data', 'collaborators.json'), 'utf-8'));
  return cached!;
}

export function filterCollaborators(genres: string[], locations: string[], roles: string[], matchMode: 'any' | 'all' = 'any'): Collaborator[] {
  const { collaborators } = getCollaboratorData();
  const lowerGenres = genres.map(g => g.toLowerCase());
  return collaborators.filter(c => {
    if (genres.length) {
      const check = matchMode === 'all'
        ? lowerGenres.every(g => c.genres.some(cg => cg.toLowerCase() === g))
        : c.genres.some(g => lowerGenres.includes(g.toLowerCase()));
      if (!check) return false;
    }
    if (locations.length) {
      if (!locations.some(l => c.location === l)) return false;
    }
    if (roles.length) {
      if (!roles.some(r => c.role === r)) return false;
    }
    return true;
  });
}

export function getAllCollaboratorGenres(): string[] {
  const { collaborators } = getCollaboratorData();
  const set = new Set<string>();
  collaborators.forEach(c => c.genres.forEach(g => set.add(g)));
  return Array.from(set).sort();
}

export function getAllCollaboratorLocations(): string[] {
  const { collaborators } = getCollaboratorData();
  const set = new Set<string>();
  collaborators.forEach(c => set.add(c.location));
  return Array.from(set).sort();
}

export function getAllCollaboratorRoles(): string[] {
  const { collaborators } = getCollaboratorData();
  const set = new Set<string>();
  collaborators.forEach(c => set.add(c.role));
  return Array.from(set).sort();
}
