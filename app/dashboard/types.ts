export interface SendResultEntry { to: string; success: boolean; error?: string; messageId?: string }
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

/**
 * What the browser knows about a saved account. The SMTP password deliberately
 * isn't here: it lives encrypted on the server and never comes back down, so a
 * send just names the account by id.
 */
export interface EmailAccount {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  /** Max sends per UTC day through this account specifically — a warmup-style limit independent of the global daily cap. 0/undefined = none. */
  dailyCap?: number;
}

/** The add-account form is the only place a password exists client-side, and only until it's submitted. */
export type NewAccountForm = Omit<EmailAccount, 'id'> & { smtpPass: string };

export interface CampaignRecipient {
  email: string;
  artistName: string;
  managerName: string;
  avatarUrl: string;
  genres: string[];
  instagramHandle: string;
  spotifyFollowers: number;
}

/** Mirrors lib/checkReplies.ts's ReplyClassification — redeclared here since that
 *  module pulls in imapflow (server-only) and can't be imported client-side. */
export type ReplyClassification = 'interested' | 'pass' | 'auto-reply' | 'unclassified';

export interface Campaign {
  id: string;
  trackTitle: string;
  date: string;
  type: 'demos' | 'radio' | 'playlists';
  emails: string[];
  accountId?: string;
  responded?: string[];
  /** Recipients a bounce/DSN message named as undeliverable; auto-added to the blacklist when detected. */
  bounced?: string[];
  /** Lowercased recipient -> best-effort classification of their most recent reply. */
  classifications?: Record<string, ReplyClassification>;
  lastChecked?: number;
  recipients?: CampaignRecipient[];
  /** Lowercased recipient -> Message-ID of the email they were sent, so a follow-up can reply into that thread. */
  messageIds?: Record<string, string>;
  /** Present while a send is still in progress (or was interrupted before finishing) — lets it be resumed from where it left off instead of restarted. */
  pendingSend?: PendingSend;
  /** Needed to re-render the follow-up template later. */
  driveLink?: string;
  senderName?: string;
  /** Set once the automatic follow-up cron has sent a follow-up for this campaign. */
  followUpSentAt?: number;
}

/**
 * Enough to redrive a batch loop from `endpoint`/`payload` alone — no numeric offset,
 * since paging is now done by excluding already-attempted addresses (see
 * app/dashboard/utils.ts's sendInBatches) rather than by index into a recipient
 * list that can shrink mid-send. Resume derives its exclusion set from the
 * campaign's own `emails` instead of anything stored here.
 */
export interface PendingSend {
  endpoint: string;
  payload: Record<string, unknown>;
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
  dmarc: boolean;
  dmarcRecord: string;
  dmarcPolicy: 'none' | 'quarantine' | 'reject' | '';
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

export interface RateBreakdown {
  label: string;
  sent: number;
  responded: number;
  replyRate: number;
}

export interface AnalyticsStats {
  totalCampaigns: number;
  totalEmailsSent: number;
  demosCampaignCount: number;
  radioCampaignCount: number;
  playlistCampaignCount: number;
  demosEmailsSent: number;
  radioEmailsSent: number;
  playlistEmailsSent: number;
  topTracks: [string, number][];
  last14Days: { date: string; count: number }[];
  maxDayCount: number;
  lastCampaignDate: string | null;

  totalResponded: number;
  totalBounced: number;
  replyRate: number;
  bounceRate: number;
  classificationCounts: { interested: number; pass: number; autoReply: number; unclassified: number };
  /** Reply rate per campaign type — always available (doesn't need recipient metadata). */
  byType: RateBreakdown[];
  /** Reply rate per genre, Demos campaigns only, ranked by volume — needs recipient metadata
   *  (present after a send, or "Show artists sent to" backfill in History), so campaigns sent
   *  before that data was tracked simply don't contribute here. */
  byGenre: RateBreakdown[];
  /** Reply rate per Spotify follower-count bracket, same data dependency as byGenre. */
  byFollowerTier: RateBreakdown[];
}
