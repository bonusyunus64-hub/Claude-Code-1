import type { GoalType, TargetCriteria, CampaignTarget } from './campaignTargets';

export interface Song {
  id: string;
  title: string;
  driveLink: string;
}

export type TargetStatus = 'not_contacted' | 'contacted' | 'responded';

export interface CampaignTargetState extends CampaignTarget {
  selected: boolean;
  status: TargetStatus;
  draft: string | null;
}

export interface OutreachCampaign {
  id: string;
  songId: string;
  songTitle: string;
  songDriveLink: string;
  goal: GoalType;
  criteria: TargetCriteria;
  createdAt: number;
  targets: CampaignTargetState[];
}

const SONGS_KEY = 'tp_songs';
const CAMPAIGNS_KEY = 'tp_outreach_campaigns';

export const SEED_SONGS: Song[] = [
  { id: 'song-neon-hearts', title: 'Neon Hearts', driveLink: 'https://drive.example.com/neon-hearts' },
  { id: 'song-slow-burn', title: 'Slow Burn', driveLink: 'https://drive.example.com/slow-burn' },
  { id: 'song-glasshouse', title: 'Glasshouse', driveLink: 'https://drive.example.com/glasshouse' },
];

function isBrowser() {
  return typeof window !== 'undefined';
}

export function loadSongs(): Song[] {
  if (!isBrowser()) return SEED_SONGS;
  const raw = window.localStorage.getItem(SONGS_KEY);
  if (!raw) {
    window.localStorage.setItem(SONGS_KEY, JSON.stringify(SEED_SONGS));
    return SEED_SONGS;
  }
  try {
    return JSON.parse(raw) as Song[];
  } catch {
    return SEED_SONGS;
  }
}

export function addSong(song: Omit<Song, 'id'>): Song {
  const songs = loadSongs();
  const newSong: Song = { ...song, id: `song-${Date.now()}` };
  const updated = [...songs, newSong];
  if (isBrowser()) window.localStorage.setItem(SONGS_KEY, JSON.stringify(updated));
  return newSong;
}

export function loadCampaigns(): OutreachCampaign[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(CAMPAIGNS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OutreachCampaign[];
  } catch {
    return [];
  }
}

export function saveCampaigns(campaigns: OutreachCampaign[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(campaigns));
}

export function getCampaign(id: string): OutreachCampaign | undefined {
  return loadCampaigns().find(c => c.id === id);
}

export function upsertCampaign(campaign: OutreachCampaign): void {
  const campaigns = loadCampaigns();
  const idx = campaigns.findIndex(c => c.id === campaign.id);
  if (idx === -1) {
    campaigns.push(campaign);
  } else {
    campaigns[idx] = campaign;
  }
  saveCampaigns(campaigns);
}

export function campaignProgress(campaign: OutreachCampaign): { found: number; contacted: number; responded: number } {
  const found = campaign.targets.length;
  const contacted = campaign.targets.filter(t => t.status === 'contacted' || t.status === 'responded').length;
  const responded = campaign.targets.filter(t => t.status === 'responded').length;
  return { found, contacted, responded };
}
