// Client-safe types and helpers for the campaign target-fetching workflow.
// No Node APIs here — this file is imported directly into 'use client' pages.

export type GoalType = 'collaborator' | 'radio' | 'playlist' | 'label';

export const GOAL_META: Record<GoalType, { label: string; verb: string; description: string }> = {
  collaborator: {
    label: 'Find a collaborator',
    verb: 'Collaborators',
    description: 'Producers, vocalists, songwriters and other artists to work with.',
  },
  radio: {
    label: 'Get radio play',
    verb: 'Radio stations',
    description: 'Stations that might add your track to rotation.',
  },
  playlist: {
    label: 'Get playlist placement',
    verb: 'Playlist curators',
    description: 'Curators who could add your track to a playlist.',
  },
  label: {
    label: 'Pitch a label',
    verb: 'Labels',
    description: 'Labels that might be a fit for a signing or release.',
  },
};

export interface TargetCriteria {
  genres: string[];
  locations: string[];
  subtypes: string[];
  matchMode: 'any' | 'all';
}

export interface CampaignMeta {
  genres: string[];
  locations: string[];
  subtypes: string[];
  locationLabel: string | null;
  subtypeLabel: string | null;
}

export interface CampaignTarget {
  id: string;
  name: string;
  subtitle: string;
  genres: string[];
  email: string;
  meta?: string;
}

export async function fetchCampaignMeta(goal: GoalType): Promise<CampaignMeta> {
  const res = await fetch(`/api/campaign-meta?goal=${goal}`);
  if (!res.ok) throw new Error('Failed to fetch campaign meta');
  return res.json();
}

/**
 * BOUNDARY — fetch-on-demand target assembly for a campaign.
 *
 * This is the single, isolated entry point for "find targets matching this
 * criteria." Today it calls /api/campaign-targets, which assembles the list
 * from local mock JSON at request time (no stored directory, nothing cached
 * beyond a single campaign's lifetime). Swap the implementation inside the
 * API route — or point this function at a different endpoint entirely — to
 * wire in live data sources or an AI-driven search, without touching any
 * caller.
 */
export async function fetchCampaignTargets(goal: GoalType, criteria: TargetCriteria): Promise<CampaignTarget[]> {
  const res = await fetch('/api/campaign-targets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, criteria }),
  });
  if (!res.ok) throw new Error('Failed to fetch targets');
  const data = await res.json();
  return data.targets as CampaignTarget[];
}
