import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { assignSubjectVariant } from '@/lib/recipients';

export const CAMPAIGNS_KEY = 'trackpitch:campaigns';

/** The old single-blob settings field this data used to live in, as one big JSON array. */
const LEGACY_STATE_FIELD = 'tp_campaigns';

export interface CampaignRecipient {
  email: string;
  artistName: string;
  managerName: string;
  avatarUrl: string;
  genres: string[];
  instagramHandle: string;
  spotifyFollowers: number;
}

export interface CampaignRecord {
  id: string;
  trackTitle: string;
  date: string;
  type: 'demos' | 'radio' | 'playlists';
  emails: string[];
  accountId?: string;
  responded?: string[];
  bounced?: string[];
  classifications?: Record<string, 'interested' | 'pass' | 'auto-reply' | 'unclassified'>;
  lastChecked?: number;
  recipients?: CampaignRecipient[];
  messageIds?: Record<string, string>;
  /** Present while a send is in progress or was interrupted, so it can be resumed.
   *  No numeric offset — resume re-derives its exclusion set from `emails`. */
  pendingSend?: { endpoint: string; payload: Record<string, unknown> };
  /** Needed to re-render the follow-up template later ({{driveLink}}/{{senderName}}); unused at send time. */
  driveLink?: string;
  senderName?: string;
  /** Lowercased addresses already sent an automatic follow-up for this campaign.
   *  Lets a multi-day cron run skip whoever a prior partial run already reached. Missing on older records = empty list. */
  followUpSent?: string[];
  /** Set once every eligible recipient has a `followUpSent` entry — campaign needs no more follow-up work.
   *  Older, pre-batching records already have this set from their single unbatched send. */
  followUpSentAt?: number;
  /** Follow-up template/subject as configured at send time, snapshotted so a later settings edit
   *  doesn't change what an already-sent campaign follows up with. `demos` campaigns only; missing on older records or a blank template, in which case the cron falls back to current settings. */
  followUpTemplate?: string;
  followUpSubject?: string;
  /** Raw subject-line A/B templates as configured at send time (DemosSection's "Test a second subject line"),
   *  snapshotted so a later template edit doesn't rewrite what a finished test compared. Non-blank `subjectB` marks a real test. */
  subjectA?: string;
  subjectB?: string;
  /** Lowercased recipient -> assigned variant ('A'/'B'), from lib/recipients.ts's assignSubjectVariant,
   *  so computeAnalyticsStats can attribute replies to the subject actually sent. Only set alongside subjectA/subjectB. */
  subjectVariants?: Record<string, 'A' | 'B'>;
  /** UTC epoch ms after which a send-window-queued campaign may start; only meaningful while
   *  `pendingSend` exists and `emails` is still empty. Ignored once the first batch has sent. */
  scheduledFor?: number;
}

// One Redis hash field per campaign (rather than one JSON blob for all history)
// so a send or reply-check only ever touches the record it changed.

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

function parseRecord(raw: unknown): CampaignRecord | null {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!value || typeof value !== 'object') return null;
  const rec = value as Partial<CampaignRecord>;
  if (!rec.id || !rec.trackTitle || !rec.type || !Array.isArray(rec.emails)) return null;
  return rec as CampaignRecord;
}

let migrationDone = false;

// One-time move of campaign history out of the settings blob. Runs server-side so
// it happens once no matter which device's browser hits the API first.
async function migrateLegacyCampaigns(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const redis = getRedis();
    const legacy = await redis.hget<unknown>(STATE_KEY, LEGACY_STATE_FIELD);
    if (legacy == null) return;

    const parsed = typeof legacy === 'string' ? safeParse(legacy) : legacy;
    if (Array.isArray(parsed)) {
      const entries: Record<string, string> = {};
      for (const entry of parsed) {
        const record = parseRecord(entry);
        if (record) entries[record.id] = JSON.stringify(record);
      }
      if (Object.keys(entries).length) await redis.hset(CAMPAIGNS_KEY, entries);
    }
    await redis.hdel(STATE_KEY, LEGACY_STATE_FIELD);
  } catch {
    migrationDone = false; // transient Redis failure: let the next request retry
  }
}

export async function listCampaigns(): Promise<CampaignRecord[]> {
  if (!isKvConfigured()) return [];
  await migrateLegacyCampaigns();
  const raw = (await getRedis().hgetall<Record<string, unknown>>(CAMPAIGNS_KEY)) ?? {};
  return Object.values(raw).map(parseRecord).filter((r): r is CampaignRecord => r !== null);
}

/**
 * What the dashboard's campaign list actually needs: everything except
 * `recipients`.
 *
 * `recipients` is by far the heaviest field on a record — one object per
 * address carrying artistName, managerName, a full-length avatar URL, a genres
 * array, an Instagram handle and a follower count, so roughly 250 bytes per
 * recipient against ~30 for the address itself in `emails`. On a 500-address
 * campaign that is ~125KB of the record, and the History tab only renders any
 * of it when a single row is expanded. Sending it for every campaign on every
 * dashboard load meant the whole history — which grows without bound — crossed
 * the wire each time, so this is the difference between a payload that scales
 * with campaign count and one that scales with campaign count times recipient
 * count.
 *
 * `messageIds` deliberately stays: threadIdsFor (useCampaignHistory.ts) reads it
 * synchronously across every campaign to thread a follow-up onto the original
 * pitch, so stripping it from the list would mean an async round trip on the
 * send path. It is ~95 bytes per recipient rather than ~250, and
 * pruneOldCampaignDetail below drops it once threading can no longer matter.
 */
export type CampaignSummary = Omit<CampaignRecord, 'recipients'>;

export function toCampaignSummary(campaign: CampaignRecord): CampaignSummary {
  const { recipients: _recipients, ...rest } = campaign;
  return rest;
}

export async function listCampaignSummaries(): Promise<CampaignSummary[]> {
  return (await listCampaigns()).map(toCampaignSummary);
}

/** One full record, including `recipients` — what the client hydrates with when a row is expanded. */
export async function getCampaign(id: string): Promise<CampaignRecord | null> {
  if (!isKvConfigured()) return null;
  await migrateLegacyCampaigns();
  const raw = await getRedis().hget<unknown>(CAMPAIGNS_KEY, id);
  return raw == null ? null : parseRecord(raw);
}

/**
 * Fields that listCampaignSummaries strips, and which a client holding a summary
 * therefore cannot send back. Absent from an incoming record means "I wasn't
 * given this", never "delete it" — see mergePreservingDetail.
 */
const DETAIL_FIELDS = ['recipients'] as const;

/**
 * Merges an incoming record over the stored one, preserving detail fields the
 * caller never had.
 *
 * This is what makes the summary payload safe. upsertCampaign in the browser
 * POSTs the *entire* record back on every write (after each send batch, after a
 * reply check), so a client working from a summary would otherwise overwrite the
 * stored `recipients` with nothing the first time it saved — silently destroying
 * the artist metadata for every past campaign. Treating an absent field as
 * "unchanged" rather than "cleared" is also the correct semantic on its own
 * terms: `recipients` is only ever added to, never emptied.
 *
 * A caller that genuinely holds the field (a hydrated row, or the send flow that
 * just built it) sends it and it replaces the stored value as normal.
 */
export function mergePreservingDetail(
  stored: CampaignRecord | null,
  incoming: CampaignRecord
): CampaignRecord {
  if (!stored) return incoming;
  const merged = { ...incoming };
  for (const field of DETAIL_FIELDS) {
    if (merged[field] === undefined && stored[field] !== undefined) {
      merged[field] = stored[field];
    }
  }
  return merged;
}

export async function saveCampaign(campaign: CampaignRecord): Promise<void> {
  if (!isKvConfigured()) throw new Error('Campaign history storage is not configured on the server.');
  await getRedis().hset(CAMPAIGNS_KEY, { [campaign.id]: JSON.stringify(campaign) });
}

/** saveCampaign, but without letting a client that only holds a summary erase the detail fields. */
export async function saveCampaignPreservingDetail(campaign: CampaignRecord): Promise<void> {
  if (!isKvConfigured()) throw new Error('Campaign history storage is not configured on the server.');
  const stored = await getCampaign(campaign.id);
  await saveCampaign(mergePreservingDetail(stored, campaign));
}

/**
 * How long a campaign keeps its per-recipient detail (`recipients`,
 * `messageIds`) before the daily cron drops it.
 *
 * Comfortably past both windows that can still read those fields:
 * REFRESH_WINDOW_DAYS (60, lib/refreshReplies.ts) after which no reply or bounce
 * is attributed to the campaign any more, and any realistic manual follow-up,
 * which threads onto `messageIds` via threadIdsFor. At six months, threading a
 * new pitch onto the original is not meaningful and the artist metadata is
 * re-derivable from `emails` on demand anyway — that is exactly what the
 * History tab's existing "Show artists sent to" backfill does.
 *
 * The record itself is never deleted; only the two bulky fields are. Totals,
 * reply rates and the A/B breakdown all read `emails`/`responded`/`bounced`,
 * which stay, so pruning changes nothing on the Overview tab.
 */
export const DETAIL_RETENTION_DAYS = 180;

/** Whether this record is old enough to drop its per-recipient detail, and still has any to drop. */
export function isDetailPrunable(
  campaign: CampaignRecord,
  nowMs: number,
  retentionDays: number = DETAIL_RETENTION_DAYS
): boolean {
  if (campaign.recipients === undefined && campaign.messageIds === undefined) return false;
  const sentAt = new Date(campaign.date).getTime();
  // An unparseable date can't be aged, and guessing would mean deleting data on
  // a record we understand least — leave it whole.
  if (!Number.isFinite(sentAt)) return false;
  return sentAt < nowMs - retentionDays * 24 * 60 * 60 * 1000;
}

export function withDetailPruned(campaign: CampaignRecord): CampaignRecord {
  const { recipients: _recipients, messageIds: _messageIds, ...rest } = campaign;
  return rest;
}

/** Drops per-recipient detail from every campaign past DETAIL_RETENTION_DAYS. Returns how many were pruned. */
export async function pruneOldCampaignDetail(
  nowMs: number,
  retentionDays: number = DETAIL_RETENTION_DAYS
): Promise<number> {
  if (!isKvConfigured()) return 0;
  const stale = (await listCampaigns()).filter(c => isDetailPrunable(c, nowMs, retentionDays));
  if (!stale.length) return 0;
  const entries: Record<string, string> = {};
  for (const campaign of stale) entries[campaign.id] = JSON.stringify(withDetailPruned(campaign));
  await getRedis().hset(CAMPAIGNS_KEY, entries);
  return stale.length;
}

export async function deleteCampaign(id: string): Promise<void> {
  if (!isKvConfigured()) return;
  await getRedis().hdel(CAMPAIGNS_KEY, id);
}

export async function clearCampaigns(): Promise<void> {
  if (!isKvConfigured()) return;
  const redis = getRedis();
  const raw = (await redis.hgetall<Record<string, unknown>>(CAMPAIGNS_KEY)) ?? {};
  const fields = Object.keys(raw);
  if (fields.length) await redis.hdel(CAMPAIGNS_KEY, ...fields);
}

/**
 * Merges one round of send results into a campaign record — the server-side
 * counterpart to useCampaignHistory's resumeSend, used by the send-window drain
 * cron to persist progress after each batch. Merges `emails`, recomputes
 * `subjectVariants` for a running A/B test, and swaps in the next `pendingSend`.
 * Doesn't touch `recipients`: the cron has no roster-lookup closure to draw
 * artist/manager names from, so those stay blank just as resumeSend leaves them.
 */
export function mergeSendResultsIntoCampaign(
  campaign: CampaignRecord,
  newlySentEmails: string[],
  newMessageIds: Record<string, string>,
  nextPendingSend: CampaignRecord['pendingSend']
): CampaignRecord {
  const emails = Array.from(new Set([...campaign.emails, ...newlySentEmails]));
  const subjectVariants = campaign.subjectB
    ? { ...(campaign.subjectVariants ?? {}), ...Object.fromEntries(newlySentEmails.map(email => [email.toLowerCase(), assignSubjectVariant(email)])) }
    : campaign.subjectVariants;
  return {
    ...campaign,
    emails,
    subjectVariants,
    messageIds: { ...(campaign.messageIds ?? {}), ...newMessageIds },
    pendingSend: nextPendingSend,
  };
}
