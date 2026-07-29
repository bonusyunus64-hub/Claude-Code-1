export interface SendResultEntry { to: string; success: boolean; error?: string }
export type BatchProgress = { sent: number; failed: number; total: number };

export interface Artist {
  name: string;
  genres: string[];
  spotifyFollowers: number;
  managementCompany: string;
  managerNames: string[];
  managerEmails: string[];
  labels: string;
  instagramHandle: string;
  avatarUrl: string;
  gender: string;
  type: string;
}

export interface RadioStation {
  name: string;
  region: string;
  genres: string[];
  emails: string[];
  phone?: string;
}

export interface PlaylistCurator {
  name: string;
  platform: string;
  genres: string[];
  emails: string[];
  followers?: number;
}

export interface EmailAccount {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
}

export interface CampaignRecipient {
  email: string;
  artistName: string;
  managerName: string;
  avatarUrl: string;
  genres: string[];
  instagramHandle: string;
  spotifyFollowers: number;
}

export interface Campaign {
  id: string;
  trackTitle: string;
  date: string;
  type: 'demos' | 'radio' | 'playlists';
  emails: string[];
  accountId?: string;
  responded?: string[];
  lastChecked?: number;
  recipients?: CampaignRecipient[];
}

export interface CustomContact {
  id: string;
  artistName: string;
  managerName: string;
  managerEmail: string;
}

export interface DeliverabilityResult {
  domain: string;
  spf: boolean;
  spfRecord: string;
  dkim: boolean;
  dkimSelector: string;
  mx: boolean;
  mxRecords: string[];
}

export interface DemosFilterPreset {
  id: string;
  name: string;
  genres: string[];
  minAudience: number;
  maxAudience: number;
  gender: string;
  artistType: string;
  minInstagram: number;
  maxInstagram: number;
  matchMode: 'any' | 'all';
}

export interface RadioFilterPreset {
  id: string;
  name: string;
  genres: string[];
  locations: string[];
  matchMode: 'any' | 'all';
}

export interface PlaylistFilterPreset {
  id: string;
  name: string;
  genres: string[];
  platforms: string[];
  matchMode: 'any' | 'all';
}

export interface SavedTemplate {
  id: string;
  name: string;
  body: string;
  subject?: string;
}
