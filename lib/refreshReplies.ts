import { listCampaigns, saveCampaign, type CampaignRecord } from '@/lib/campaigns';
import { getAccount, type StoredAccount } from '@/lib/accounts';
import { findResponders, resolveImapConfig, type CheckRepliesResult, type ReplyClassification, type ImapConfig } from '@/lib/checkReplies';
import { addManyToBlacklistServerSide } from '@/lib/unsubscribe';

/**
 * Campaigns older than this are treated as done, not just "not checked yet" —
 * a reply that hasn't shown up after this long isn't coming, so there's no point
 * spending an IMAP round trip on it every single day forever.
 */
export const REFRESH_WINDOW_DAYS = 60;

/**
 * How many distinct sending accounts one invocation will open an IMAP connection
 * for. Accounts not reached this run are simply picked up by tomorrow's — see
 * `stoppedEarly` on the summary this module returns.
 */
export const MAX_ACCOUNTS_PER_RUN = 3;

/**
 * Wall-clock budget per account connection, checked cumulatively (not reset per
 * account) against the time elapsed since the run started. findResponders already
 * bounds a single connection's own worst case (greeting 10s + connection 15s +
 * socket 30s), but a run with several accounts still needs its own ceiling so a
 * slow-but-not-quite-timed-out mailbox can't eat the whole 60s maxDuration and
 * starve every account queued behind it. MAX_ACCOUNTS_PER_RUN * this value (30s)
 * leaves comfortable headroom under the route's 60s ceiling for the
 * listCampaigns/saveCampaign/blacklist Redis work on top.
 */
export const ACCOUNT_TIME_BUDGET_MS = 10_000;

/**
 * Cheaply (no IMAP call) determines whether a campaign has nothing left to learn
 * from a reply check — every recipient already accounted for as either responded
 * or bounced. Skipping these keeps a run's account groups (and therefore its
 * `since`/email-union) focused on campaigns that can actually still change.
 */
export function isCampaignFullyResolved(campaign: CampaignRecord): boolean {
  if (!campaign.emails.length) return true;
  const responded = new Set((campaign.responded ?? []).map(e => e.trim().toLowerCase()));
  const bounced = new Set((campaign.bounced ?? []).map(e => e.trim().toLowerCase()));
  return campaign.emails.every(e => {
    const lower = e.trim().toLowerCase();
    return responded.has(lower) || bounced.has(lower);
  });
}

/**
 * Campaigns worth spending an IMAP check on this run: sent from a known account,
 * has recipients, sent within the reply window, and not already fully resolved.
 */
export function selectCampaignsForRefresh(
  campaigns: CampaignRecord[],
  nowMs: number,
  windowDays: number = REFRESH_WINDOW_DAYS
): CampaignRecord[] {
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000;
  return campaigns.filter(c => {
    if (!c.accountId) return false;
    if (!c.emails?.length) return false;
    const sentAt = new Date(c.date).getTime();
    if (!Number.isFinite(sentAt) || sentAt < cutoff) return false;
    return !isCampaignFullyResolved(c);
  });
}

/** Groups campaigns by sending account, so each account gets exactly one IMAP connection. */
export function groupCampaignsByAccount(campaigns: CampaignRecord[]): Map<string, CampaignRecord[]> {
  const groups = new Map<string, CampaignRecord[]>();
  for (const c of campaigns) {
    const key = c.accountId!;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  return groups;
}

/** The earliest `date` among a group of campaigns — the `since` bound for one findResponders call covering all of them. */
export function oldestSince(campaigns: CampaignRecord[]): Date {
  let min = Infinity;
  for (const c of campaigns) {
    const t = new Date(c.date).getTime();
    if (Number.isFinite(t) && t < min) min = t;
  }
  return new Date(Number.isFinite(min) ? min : 0);
}

/** Union of every recipient address across a group of campaigns, deduped case-insensitively (first-seen casing kept). */
export function unionEmails(campaigns: CampaignRecord[]): string[] {
  const byLower = new Map<string, string>();
  for (const c of campaigns) {
    for (const email of c.emails) {
      const lower = email.trim().toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, email);
    }
  }
  return Array.from(byLower.values());
}

/**
 * Scopes one account-wide findResponders result down to a single campaign's own
 * recipients — the other half of the "one connection per account" trade: the
 * result covers every campaign in the group, so it must be intersected with
 * `campaign.emails` before being merged in, or a reply/bounce from one campaign's
 * recipient would leak onto every other campaign sharing that account.
 *
 * Output uses the casing already on the campaign's own `emails`/`recipients`
 * record, not whatever casing happened to win the account-wide union, so a
 * campaign's stored addresses stay internally consistent.
 */
export function attributeToCampaign(campaign: CampaignRecord, result: CheckRepliesResult): CheckRepliesResult {
  const ownByLower = new Map<string, string>();
  for (const e of campaign.emails) ownByLower.set(e.trim().toLowerCase(), e);

  const respondedLower = new Set(result.responded.map(e => e.trim().toLowerCase()));
  const bouncedLower = new Set(result.bounced.map(e => e.trim().toLowerCase()));

  const responded: string[] = [];
  const bounced: string[] = [];
  for (const [lower, original] of ownByLower) {
    if (respondedLower.has(lower)) responded.push(original);
    if (bouncedLower.has(lower)) bounced.push(original);
  }

  const classifications: Record<string, ReplyClassification> = {};
  for (const [addr, cls] of Object.entries(result.classifications)) {
    const lower = addr.trim().toLowerCase();
    if (ownByLower.has(lower)) classifications[lower] = cls;
  }

  return { responded, bounced, classifications };
}

/**
 * Merges one campaign's freshly-attributed result into its record: unions
 * `responded`/`bounced`, merges `classifications`, and stamps `lastChecked` —
 * the same shape as the manual "Check replies" path's merge in
 * useCampaignHistory.ts's checkReplies, just running server-side.
 */
export function mergeRefreshResultIntoCampaign(
  campaign: CampaignRecord,
  attributed: CheckRepliesResult,
  checkedAt: number
): CampaignRecord {
  const responded = Array.from(new Set([...(campaign.responded ?? []), ...attributed.responded]));
  const bounced = Array.from(new Set([...(campaign.bounced ?? []), ...attributed.bounced]));
  const classifications = { ...(campaign.classifications ?? {}), ...attributed.classifications };
  return { ...campaign, responded, bounced, classifications, lastChecked: checkedAt };
}

/** Addresses in `attributed.bounced` not already recorded as bounced on the campaign — what should newly reach the Do Not Contact list. */
function newlyBounced(campaign: CampaignRecord, attributed: CheckRepliesResult): string[] {
  const existing = new Set((campaign.bounced ?? []).map(e => e.trim().toLowerCase()));
  return attributed.bounced.filter(e => !existing.has(e.trim().toLowerCase()));
}

/** Addresses in `attributed.responded` not already recorded as responded — used only for the run's reported "newly responded" count. */
function newlyResponded(campaign: CampaignRecord, attributed: CheckRepliesResult): string[] {
  const existing = new Set((campaign.responded ?? []).map(e => e.trim().toLowerCase()));
  return attributed.responded.filter(e => !existing.has(e.trim().toLowerCase()));
}

export interface RefreshRepliesDeps {
  listCampaigns: () => Promise<CampaignRecord[]>;
  getAccount: (id: string) => Promise<StoredAccount | null>;
  findResponders: (config: ImapConfig, emails: string[], since: Date) => Promise<CheckRepliesResult>;
  resolveImapConfig: (smtpHost: string, user: string, pass: string) => ImapConfig;
  saveCampaign: (campaign: CampaignRecord) => Promise<void>;
  addManyToBlacklistServerSide: (emails: string[]) => Promise<void>;
  now: () => number;
}

const defaultDeps: RefreshRepliesDeps = {
  listCampaigns,
  getAccount,
  findResponders,
  resolveImapConfig,
  saveCampaign,
  addManyToBlacklistServerSide,
  now: () => Date.now(),
};

export interface RefreshRepliesSummary {
  ok: true;
  /** Accounts with at least one campaign worth checking this run — may be more than `accountsChecked`. */
  accountsSelected: number;
  /** Accounts this run actually opened an IMAP connection for (successfully or not). */
  accountsChecked: number;
  campaignsSelected: number;
  campaignsUpdated: number;
  newlyResponded: number;
  newlyBounced: number;
  /** True when MAX_ACCOUNTS_PER_RUN or the cumulative time budget stopped the run before every selected account was reached — the rest are picked up by tomorrow's run. */
  stoppedEarly: boolean;
  /** Per-account failures (bad credentials, unreachable host, etc.) — isolated so one bad mailbox doesn't abort the others. */
  accountErrors: { accountId: string; error: string }[];
}

/**
 * Refreshes reply/bounce data over IMAP for campaigns worth checking — never
 * sends anything. One connection per sending account (not per campaign): every
 * campaign sharing an account is checked in a single findResponders call against
 * the union of their recipients since the oldest of their send dates, then the
 * result is attributed back to each campaign individually.
 *
 * Bounded by MAX_ACCOUNTS_PER_RUN and ACCOUNT_TIME_BUDGET_MS so this fits well
 * inside the cron route's maxDuration=60s regardless of how many accounts or
 * campaigns exist; anything not reached this run is simply picked up tomorrow.
 * Progress is persisted after each account's campaigns (saveCampaign +
 * blacklist additions) before moving to the next, so a mid-run timeout loses at
 * most the in-flight account's work.
 */
export async function refreshReplies(overrides: Partial<RefreshRepliesDeps> = {}): Promise<RefreshRepliesSummary> {
  const deps: RefreshRepliesDeps = { ...defaultDeps, ...overrides };
  const startedAt = deps.now();

  const campaigns = await deps.listCampaigns();
  const selected = selectCampaignsForRefresh(campaigns, startedAt);
  const groups = groupCampaignsByAccount(selected);
  const entries = Array.from(groups.entries());

  let accountsChecked = 0;
  let campaignsUpdated = 0;
  let respondedCount = 0;
  let bouncedCount = 0;
  let stoppedEarly = false;
  const accountErrors: { accountId: string; error: string }[] = [];

  for (const [accountId, group] of entries) {
    if (accountsChecked >= MAX_ACCOUNTS_PER_RUN) { stoppedEarly = true; break; }
    if (deps.now() - startedAt > MAX_ACCOUNTS_PER_RUN * ACCOUNT_TIME_BUDGET_MS) { stoppedEarly = true; break; }

    accountsChecked++;
    try {
      const account = await deps.getAccount(accountId);
      if (!account) {
        accountErrors.push({ accountId, error: 'Account no longer available' });
        continue;
      }
      if (!account.smtpUser || !account.smtpPass) {
        accountErrors.push({ accountId, error: 'No SMTP credentials on the account' });
        continue;
      }

      const imapConfig = deps.resolveImapConfig(account.smtpHost, account.smtpUser, account.smtpPass);
      const since = oldestSince(group);
      const allEmails = unionEmails(group);
      const result = await deps.findResponders(imapConfig, allEmails, since);
      const checkedAt = deps.now();

      const accountNewBounces: string[] = [];
      for (const campaign of group) {
        const attributed = attributeToCampaign(campaign, result);
        respondedCount += newlyResponded(campaign, attributed).length;
        accountNewBounces.push(...newlyBounced(campaign, attributed));

        const updated = mergeRefreshResultIntoCampaign(campaign, attributed, checkedAt);
        await deps.saveCampaign(updated);
        campaignsUpdated++;
      }
      bouncedCount += accountNewBounces.length;

      // A bounce means the address is dead — re-pitching it burns sender
      // reputation, so it's added to the Do Not Contact list the same way the
      // browser's manual "Check replies" path does via addFailedToBlacklist.
      // Persisted right after this account's campaigns, before moving to the
      // next account, matching the saveCampaign persistence above.
      if (accountNewBounces.length) await deps.addManyToBlacklistServerSide(accountNewBounces);
    } catch (err) {
      // One mailbox with bad credentials or a dead IMAP host must not abort the
      // whole run — record why and move on to the next account.
      accountErrors.push({ accountId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    ok: true,
    accountsSelected: entries.length,
    accountsChecked,
    campaignsSelected: selected.length,
    campaignsUpdated,
    newlyResponded: respondedCount,
    newlyBounced: bouncedCount,
    stoppedEarly,
    accountErrors,
  };
}
