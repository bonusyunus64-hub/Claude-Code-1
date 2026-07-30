import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';

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
  /**
   * Present while a send is still in progress (or was interrupted before finishing) —
   * lets it be resumed instead of restarted. No numeric offset: resume re-derives its
   * exclusion set from `emails` (see app/dashboard/hooks/useCampaignHistory.ts's
   * resumeSend), which every record — including ones written before this field
   * changed shape — already has. A record persisted by an older build may still have
   * a leftover `offset` property in Redis; it's simply ignored on read.
   */
  pendingSend?: { endpoint: string; payload: Record<string, unknown> };
  /** Needed to re-render the follow-up template later (lib/emailTemplate.ts's {{driveLink}}/{{senderName}}) — not used for anything at send time itself. */
  driveLink?: string;
  senderName?: string;
  /**
   * Addresses (lowercased) that have already received an automatic follow-up for
   * this campaign. A campaign whose non-responded recipient count exceeds one cron
   * run's message budget (lib/autoFollowUp.ts's computeFollowUpBudget) or the daily
   * send cap gets worked through a batch at a time across several days'
   * app/api/cron/auto-followup runs; this is what lets nonRespondedRecipients()
   * skip whoever a previous partial run already reached, instead of re-sending the
   * whole campaign. Missing on records saved before this field existed — treated
   * as an empty list, so old records behave exactly as before.
   */
  followUpSent?: string[];
  /**
   * Set once every non-responded/non-bounced/non-blacklisted recipient in `emails`
   * has an entry in `followUpSent` — i.e. this campaign needs no further automatic
   * follow-up work, ever. A campaign still partway through (some, but not all,
   * recipients in `followUpSent`) has no followUpSentAt yet, so
   * isCampaignDueForFollowUp keeps returning it on future runs until it's finished.
   * Records saved under the old all-or-nothing behaviour already have this set
   * from a single unbatched send — they're left alone and stay done.
   */
  followUpSentAt?: number;
}

// Campaign history used to live as one JSON array under a single settings field,
// rewritten in full on every send and every reply-check. That gets slower and
// heavier the longer a user's history grows, and risks the whole history if one
// write is interrupted. Storing one Redis hash field per campaign means a single
// send or reply-check only ever touches the one record it changed.

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
