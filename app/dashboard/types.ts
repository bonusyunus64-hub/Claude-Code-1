/**
 * `permanent` mirrors lib/mailSend.ts's SendResult.permanent: set when SMTP
 * rejected the address outright (5xx, bad envelope) rather than the send being
 * lost to a dropped connection. A synchronous rejection like that produces no
 * bounce message, so nothing downstream (lib/checkReplies.ts) would ever learn
 * the address is dead on its own — callers use this flag to auto-suppress it
 * (see useAccountSettings.ts's recordFailedEmails) and to record it on the
 * campaign's `bounced` list the same way lib/followUpSend.ts already does.
 */
export interface SendResultEntry { to: string; success: boolean; error?: string; messageId?: string; permanent?: boolean }
export type BatchProgress = { sent: number; failed: number; total: number };

/**
 * One address in the Account tab's "Potential False Emails" review list.
 * `permanent` distinguishes a confirmed-dead address (SendResultEntry.permanent,
 * already auto-added to Do Not Contact — see recordFailedEmails) from an
 * ordinary transient failure the user still has to triage by hand.
 */
export interface FailedEmailEntry { email: string; permanent: boolean }

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
  /** Lowercased addresses that already received an automatic follow-up — lets a
   *  campaign too large for one cron run's message budget or the daily cap be
   *  worked through in batches across several days without re-mailing anyone.
   *  Missing on older records; treated as an empty list. */
  followUpSent?: string[];
  /** Set once every recipient has an entry in `followUpSent` (or, for records from
   *  before this field existed, from the old all-or-nothing send) — i.e. this
   *  campaign needs no further automatic follow-up work. */
  followUpSentAt?: number;
  /** Follow-up template/subject as configured when this Song Demos campaign was
   *  sent — mirrors driveLink/senderName above, so a later edit to Account
   *  settings' follow-up fields can't retroactively change what an
   *  already-sent campaign follows up with. Missing on older records or when
   *  the follow-up template was blank at send time; the cron route falls back
   *  to current settings in either case. */
  followUpTemplate?: string;
  followUpSubject?: string;
  /** Present when this Song Demos send tested two subject lines
   *  (DemosSection's "Test a second subject line" toggle) — the raw templates
   *  as configured at send time. `subjectB` non-blank is what marks a
   *  campaign as having actually run a test. */
  subjectA?: string;
  subjectB?: string;
  /** Lowercased recipient -> which subject variant they were sent, assigned
   *  deterministically by address (lib/recipients.ts's assignSubjectVariant)
   *  so analytics can attribute a reply back to the subject that earned it.
   *  Only populated alongside subjectA/subjectB. */
  subjectVariants?: Record<string, 'A' | 'B'>;
  /** UTC epoch ms after which a send-window-queued campaign may actually start —
   *  set only alongside a `pendingSend` that hasn't sent anything yet (`emails`
   *  still empty). See lib/campaigns.ts's CampaignRecord.scheduledFor for the
   *  full reasoning; this mirrors it for the client-side shape. */
  scheduledFor?: number;
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
  /** The "Independent contacts only" reachability toggle — see
   *  app/dashboard/hooks/useDemosFlow.ts's REACHABILITY_MAX_COMPANY_SIZE for
   *  what it maps to underneath. Optional/missing on presets saved before
   *  this existed, which loadDemosPreset treats as off (its prior behavior). */
  reachableOnly?: boolean;
  /** The "search every genre" opt-in — see lib/roster.ts's getArtistsByGenres
   *  for why an empty `genres` selection needs an explicit flag rather than
   *  defaulting to "everyone." Optional/missing on older presets, treated as off. */
  matchAllGenres?: boolean;
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

/**
 * Same shape as RateBreakdown, extended with its own bounce dimension and a
 * small-sample flag. Used only by the "reply rate by who was contacted"
 * breakdown (app/dashboard/utils.ts's computeRosterTierStats) — the one place
 * bounce rate needs to be its own reported number rather than just excluded
 * from `sent` the way byGenre/byFollowerTier above already do (see that
 * function's header comment for why: this breakdown is meant to answer "sent,
 * reply rate, AND bounce rate," all three, per bucket).
 */
export interface TierBreakdown extends RateBreakdown {
  /** How many of `sent` bounced. `replyRate` still divides by sent minus this
   *  (i.e. delivered), matching the app-wide replyRate/bounceRate convention. */
  bounced: number;
  /** Divides by `sent` (every attempt), not delivered — same convention as
   *  the top-level bounceRate in AnalyticsStats. */
  bounceRate: number;
  /** True when there are too few delivered emails in this bucket for
   *  `replyRate` to mean anything (see app/dashboard/utils.ts's
   *  MIN_TIER_SAMPLE_SIZE) — OverviewSection uses this to visibly
   *  de-emphasise the row instead of presenting a misleading headline number. */
  lowSample: boolean;
}

/** Output of computeRosterTierStats: the "who was contacted" segmentation,
 *  bucketed two ways — see that function's header comment in
 *  app/dashboard/utils.ts for the full reasoning behind both axes. */
export interface RosterTierStats {
  byFollowerBand: TierBreakdown[];
  byCompanySize: TierBreakdown[];
}

/** One Song Demos campaign's subject-line A/B result, for the Overview tab.
 *  See app/dashboard/utils.ts's subjectTestWinner for how `winner` is decided
 *  (and why it's null well short of "the reply rates are literally equal"). */
export interface SubjectTestSummary {
  campaignId: string;
  trackTitle: string;
  date: string;
  subjectA: string;
  subjectB: string;
  sentA: number;
  respondedA: number;
  replyRateA: number;
  sentB: number;
  respondedB: number;
  replyRateB: number;
  /** null = too early to tell; otherwise the variant whose reply rate is far
   *  enough ahead, given both sample sizes, to trust. */
  winner: 'A' | 'B' | null;
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
  /** Denominator behind `replyRate`: total emails sent minus confirmed bounces
   *  (see app/dashboard/utils.ts's deliveredCount) — everyone a send actually
   *  reached, summed across campaigns. */
  totalDelivered: number;
  /** How many `responded` addresses were excluded from `totalResponded` (and
   *  therefore `replyRate`) because their reply was classified as an
   *  auto-reply / vacation responder. 0 for records with no classifications
   *  at all, not just genuinely zero auto-replies. */
  totalAutoReplies: number;
  replyRate: number;
  /** Bounce rate divides by every email attempted, not totalDelivered — it's
   *  legitimately "of everything we tried to send, how much bounced," a
   *  different question from replyRate's delivered-only denominator. */
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
  /** One entry per Song Demos campaign that ran a subject-line A/B test
   *  (has subjectB/subjectVariants), newest first. Empty when nothing has. */
  subjectTests: SubjectTestSummary[];
}
