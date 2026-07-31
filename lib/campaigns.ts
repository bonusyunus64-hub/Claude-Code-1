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

export async function saveCampaign(campaign: CampaignRecord): Promise<void> {
  if (!isKvConfigured()) throw new Error('Campaign history storage is not configured on the server.');
  await getRedis().hset(CAMPAIGNS_KEY, { [campaign.id]: JSON.stringify(campaign) });
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
