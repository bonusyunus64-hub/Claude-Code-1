import type { CampaignRecord } from '@/lib/campaigns';
import { renderTemplate } from '@/lib/emailTemplate';
import type { OutboundMessage } from '@/lib/mailSend';

export const DEFAULT_FOLLOWUP_DAYS = 5;

/**
 * Whether a campaign is ready for its automatic follow-up: a Song Demos send
 * (the only type with a follow-up template), old enough, not already followed up,
 * not mid-send, and with enough recorded to actually build one (driveLink wasn't
 * tracked on campaigns before this feature, so older records can't be re-rendered).
 */
export function isCampaignDueForFollowUp(campaign: CampaignRecord, cutoffMs: number): boolean {
  if (campaign.type !== 'demos') return false;
  if (campaign.followUpSentAt) return false;
  if (campaign.pendingSend) return false;
  if (!campaign.accountId || !campaign.driveLink) return false;
  return new Date(campaign.date).getTime() <= cutoffMs;
}

/**
 * Recipients who neither replied nor bounced nor unsubscribed nor already got a
 * follow-up — the ones still worth a nudge. `blacklist` should be the Do Not
 * Contact list (lowercased); skipping it isn't optional, since following up with
 * someone who opted out defeats the point of having an unsubscribe link at all.
 *
 * Also excludes `campaign.followUpSent`, so a campaign that a previous cron run
 * only got partway through (because it hit the per-run message budget or the
 * daily send cap) picks up exactly where it left off instead of re-mailing
 * whoever already got one. Campaigns saved before that field existed simply have
 * an empty list here, which is the same as not filtering anyone extra out.
 */
export function nonRespondedRecipients(campaign: CampaignRecord, blacklist: Set<string> = new Set()): string[] {
  const responded = new Set((campaign.responded ?? []).map(e => e.toLowerCase()));
  const bounced = new Set((campaign.bounced ?? []).map(e => e.toLowerCase()));
  const alreadyFollowedUp = new Set((campaign.followUpSent ?? []).map(e => e.toLowerCase()));
  return campaign.emails.filter(e => {
    const lower = e.toLowerCase();
    return !responded.has(lower) && !bounced.has(lower) && !blacklist.has(lower) && !alreadyFollowedUp.has(lower);
  });
}

/**
 * Resolves which follow-up template/subject the cron route should use for a
 * campaign: its own snapshot (CampaignRecord.followUpTemplate/followUpSubject,
 * taken at send time — see lib/campaigns.ts's doc comment on those fields) when
 * present, falling back to whatever's currently configured
 * (tp_followup_template/tp_followup_subject) for campaigns saved before that
 * snapshot existed, or where the follow-up template was blank at send time. A
 * resolved template that's still blank either way means there's genuinely
 * nothing to send this campaign.
 */
export function resolveFollowUpContent(
  campaign: CampaignRecord,
  globalTemplate: string,
  globalSubject: string
): { template: string; subject: string } {
  const template = campaign.followUpTemplate?.trim() ? campaign.followUpTemplate : globalTemplate;
  const subject = campaign.followUpSubject?.trim() ? campaign.followUpSubject : globalSubject;
  return { template, subject };
}

/**
 * Builds one follow-up message for a recipient. Recipient metadata (artist/manager
 * name) comes from campaign.recipients when available; a recipient added before
 * that was tracked, or a custom contact, falls back to blank fields the same way
 * a fresh send already tolerates missing manager names ("there"). Gender/artist
 * type aren't stored per recipient, so {{pronoun}} always resolves to "they" here
 * — the same default the roster already uses for groups/unknown.
 */
export function buildFollowUpMessage(
  campaign: CampaignRecord,
  email: string,
  template: string,
  subjectTemplate: string,
  signOff: string
): OutboundMessage {
  const recipient = campaign.recipients?.find(r => r.email.toLowerCase() === email.toLowerCase());
  const vars = {
    managerName: recipient?.managerName || 'there',
    artistName: recipient?.artistName || '',
    trackTitle: campaign.trackTitle,
    driveLink: campaign.driveLink ?? '',
    senderName: campaign.senderName ?? '',
    managementCompany: '',
    pronoun: 'they',
  };
  const bodyParts = [renderTemplate(template, vars)];
  if (signOff.trim()) bodyParts.push(renderTemplate(signOff, vars));
  const subject = renderTemplate(subjectTemplate, vars);
  const inReplyTo = campaign.messageIds?.[email.toLowerCase()];
  return { to: email, subject, body: bodyParts.join('\n\n'), ...(inReplyTo ? { inReplyTo } : {}) };
}

// Per-message SMTP round trip assumed for budgeting purposes. lib/mailSend.ts's
// sendWithRetry only retries transient errors (connection drops, 4xx "try again");
// most real failures are permanent 5xx rejections that fail fast, so budgeting for
// the full 2-retry/RETRY_DELAY_MS worst case on every message would be far too
// pessimistic. 1.5s is a generous allowance for one successful SMTP conversation.
const ASSUMED_SMTP_MS = 1500;

// How much of maxDuration=60s (app/api/cron/auto-followup/route.ts) this run's
// sendMessages() calls are allowed to occupy. The remainder (~15s) is headroom for
// the Redis reads at the top of the route, one account/roster lookup per campaign,
// and serializing the JSON response — none of which are free, and none of which
// this budget accounts for directly.
const SAFE_SEND_WINDOW_MS = 45_000;

// However small SAFE_SEND_WINDOW_MS / perMessageMs comes out, a run should still
// make forward progress on the campaign it's working — 3 is small enough to fit
// comfortably even at the largest configured sendDelay (10s, the top of
// SEND_DELAY_OPTIONS in app/dashboard/constants.ts: 3 * (1500+10000) = 34.5s).
const MIN_FOLLOWUP_BUDGET = 3;

// However generous the math gets at low/no delay, an unbounded per-run total would
// let one invocation's response balloon (one JSON result entry per message-bearing
// campaign batch) and would mean a single run could still quietly blow through a
// lot of a mailbox's daily volume at once. 100 is comfortably above what the
// zero-delay case computes (30) while still capping the worst case.
const MAX_FOLLOWUP_BUDGET = 100;

/**
 * Total follow-up emails one cron invocation is allowed to send, across every
 * campaign it touches this run — not a per-campaign limit. Sized from the
 * configured inter-message sendDelay (lib/mailSend.ts's sendMessages sleeps this
 * long before every message after the first in a batch) plus an assumed SMTP cost,
 * against a safety window well under the route's 60s ceiling.
 *
 * Worked examples: sendDelay=0 -> floor(45000/1500) = 30. sendDelay=2000 (the
 * case this feature exists for: 50 messages at 2s apart is 100s+, past the 60s
 * ceiling) -> floor(45000/3500) = 12. sendDelay=10000 (the largest
 * SEND_DELAY_OPTIONS value) -> floor(45000/11500) = 3, the floor.
 */
export function computeFollowUpBudget(sendDelay?: number): number {
  const delay = Number.isFinite(sendDelay) && (sendDelay as number) > 0 ? (sendDelay as number) : 0;
  const perMessageMs = ASSUMED_SMTP_MS + delay;
  const raw = Math.floor(SAFE_SEND_WINDOW_MS / perMessageMs);
  return Math.min(MAX_FOLLOWUP_BUDGET, Math.max(MIN_FOLLOWUP_BUDGET, raw));
}

/**
 * Merges addresses into one of a campaign's lowercased address lists (`followUpSent`,
 * `bounced`), deduplicated. Pulled out so the route can persist progress after every
 * batch without repeating this normalization inline.
 */
export function mergeEmailList(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set((existing ?? []).map(e => e.toLowerCase()));
  for (const email of additions) merged.add(email.toLowerCase());
  return Array.from(merged);
}

// Assumed cost of one Upstash Redis round trip from this Vercel function. Upstash
// is reached over its REST API rather than a persistent connection, so every call
// pays real network latency; 150ms is a generous per-call allowance even when the
// function and the Redis region aren't colocated.
const ASSUMED_REDIS_ROUNDTRIP_MS = 150;

// Worst-case Redis round trips one touched due campaign can cost in the route
// below: a campaign with nothing left to send only pays for the final
// saveCampaign write that marks it done (1 call), but one with targets pays for
// checkCapAllows, getAccount, recordSends, and saveCampaign (4 calls). Budgeting
// for the more expensive shape keeps the total safe regardless of how the due
// campaigns in a given run split between the two.
const MAX_REDIS_CALLS_PER_TOUCHED_CAMPAIGN = 4;

// How much of maxDuration=60s (app/api/cron/auto-followup/route.ts) this run's
// per-campaign Redis/bookkeeping work — as opposed to the SMTP time
// computeFollowUpBudget already bounds — is allowed to occupy.
//
// Deliberately NOT the whole 15s left over after SAFE_SEND_WINDOW_MS's 45s: these
// two budgets are additive, and a run that exhausts both would then be at exactly
// the 60s ceiling with nothing left for the settings/listCampaigns/getBlacklist
// reads at the top of the route or for serializing the response. Taking 10s here
// leaves ~5s of genuine slack for those, so the worst case lands under the ceiling
// instead of exactly on it.
const BOOKKEEPING_WINDOW_MS = 10_000;

/**
 * How many due campaigns one cron invocation may read from and write back to
 * Redis this run — a bound on bookkeeping work, not on SMTP time. computeFollowUpBudget
 * above already bounds every campaign that has recipients left to send to (a
 * campaign can never consume more than its own batch's share of the message
 * budget), so this exists purely for what that budget can't see: a campaign with
 * zero remaining targets costs no SMTP time at all, just one saveCampaign write to
 * mark it done. Without a separate bound, an account with a few hundred
 * long-finished campaigns would pay a few hundred sequential Redis round trips
 * every run before ever reaching one that still needs sending.
 *
 * floor(10000 / (4 * 150)) = 16.
 */
export const MAX_CAMPAIGNS_TOUCHED_PER_RUN = Math.floor(
  BOOKKEEPING_WINDOW_MS / (MAX_REDIS_CALLS_PER_TOUCHED_CAMPAIGN * ASSUMED_REDIS_ROUNDTRIP_MS)
);

/**
 * Whether the follow-up loop in the cron route has room to touch another due
 * campaign this run, and if not, which limit is responsible. Meant to be checked
 * once per due campaign, before any of that campaign's own Redis work runs:
 *
 * - `campaignTouchBudget` applies no matter what the campaign turns out to need —
 *   even the "already done, just mark it" path costs a saveCampaign write — so
 *   it's checked first and unconditionally.
 * - `remainingMessageBudget` only matters once a campaign turns out to have
 *   targets to send to, so a run that's already out of message budget can still
 *   walk through and retire any number of already-finished campaigns behind it;
 *   passing `campaignHasTargets: false` always clears this half of the check.
 *
 * Returns null when neither limit blocks moving on to (and finishing) this
 * campaign this run.
 */
export function followUpStopReason(
  campaignsTouched: number,
  campaignTouchBudget: number,
  remainingMessageBudget: number,
  campaignHasTargets: boolean
): 'campaignBudget' | 'messageBudget' | null {
  if (campaignsTouched >= campaignTouchBudget) return 'campaignBudget';
  if (campaignHasTargets && remainingMessageBudget <= 0) return 'messageBudget';
  return null;
}
