import type { SendResultEntry, BatchProgress, Campaign, RateBreakdown, AnalyticsStats, SubjectTestSummary } from './types';
export { renderTemplate as renderTemplateClient, pronounFor as pronounForClient } from '@/lib/emailTemplate';
// nonRespondedRecipients only pulls in lib/emailTemplate.ts at runtime (its other
// imports — CampaignRecord from lib/campaigns, OutboundMessage from lib/mailSend —
// are `import type`-only in lib/autoFollowUp.ts and get erased before bundling, so
// the Node-only nodemailer/Redis chains those two modules pull in never actually
// reach the client bundle). Confirmed safe by `npm run build` after this change —
// see the header comment on lib/recipients.ts for why that check matters and tsc/
// vitest alone wouldn't catch a regression here.
import { nonRespondedRecipients } from '@/lib/autoFollowUp';

/**
 * How many distinct messages a send with these email lists will actually produce.
 * The server dedupes by lowercased address (dedupeByRecipient in lib/mailSend.ts) —
 * one address that shows up under several recipients (a manager covering many
 * artists, a station listing the same inbox on two shows) becomes a single send.
 * Counting raw list lengths client-side overstates the total against the daily cap.
 */
export function countUniqueRecipients(...emailLists: string[][]): number {
  const seen = new Set<string>();
  for (const list of emailLists) {
    for (const email of list) seen.add(email.trim().toLowerCase());
  }
  return seen.size;
}

export function getTodayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Send routes rebuild their recipient list from scratch on every request — including
// a fresh read of the server-side Do Not Contact blacklist (see getBlacklist in
// app/api/send/route.ts and lib/broadcastSend.ts). If an address gets blacklisted
// mid-send (an unsubscribe click, an auto-blacklisted bounce) while paging by a plain
// numeric offset, the rebuilt list shrinks and every index after the removed one
// shifts down — the batch that follows silently skips whoever moved into the gap.
//
// So this doesn't page by index at all: every request asks for offset 0, plus the
// full set of addresses already attempted this run (successes AND failures — a
// hard-rejected address has to be excluded too, or it just gets retried forever and
// the loop never ends). The server unions that into its blacklist and rebuilds the
// list without any of them, so each round naturally sends the next `limit` addresses
// regardless of what shifted underneath. The list shrinks by `limit` every round
// (paginate in lib/mailSend.ts returns nextOffset: null once what's left fits in one
// page, or an empty batch with nextOffset: null once nothing is left), so this still
// terminates in the same number of rounds as before.
//
// onProgress also receives the cumulative results-so-far (not just counts) so a
// caller can persist campaign history as each batch lands, rather than only after
// the whole send finishes — closing the tab mid-send then loses at most the
// in-flight batch instead of the entire campaign record. Its third argument is the
// server's nextOffset for the round just completed (null once nothing's left) — no
// longer a resumable index, just a "there's more to send" signal a caller uses to
// decide whether to keep a pendingSend record around.
//
// `alreadyAttempted` seeds the exclusion set before the first request, which is what
// lets a resumed send (see useCampaignHistory's resumeSend) pick up cleanly from a
// campaign's recorded `emails` — no offset needs to have survived the interruption.
export async function sendInBatches(
  endpoint: string,
  payload: Record<string, unknown>,
  onProgress: (progress: BatchProgress, resultsSoFar: SendResultEntry[], nextOffset: number | null) => void,
  alreadyAttempted: string[] = []
): Promise<{ ok: true; results: SendResultEntry[]; total: number } | { ok: false; error: string }> {
  const payloadExclude = Array.isArray(payload.excludeEmails) ? (payload.excludeEmails as string[]) : [];
  const attempted = new Set([...payloadExclude, ...alreadyAttempted].map(e => e.toLowerCase()));
  const allResults: SendResultEntry[] = [];
  // Set from the first round only: the server's own `total` shrinks every round
  // after that (it reflects the post-exclusion list), so re-reading it each time
  // would make the progress bar count down instead of up.
  let total: number | null = null;
  for (;;) {
    let res: Response;
    let data: { error?: string; results?: SendResultEntry[]; total?: number; nextOffset?: number | null };
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, offset: 0, excludeEmails: Array.from(attempted) }),
      });
      data = await res.json();
    } catch {
      return { ok: false, error: 'Network error. Please try again.' };
    }
    if (!res.ok) return { ok: false, error: data.error || 'Failed to send.' };
    const batch = data.results ?? [];
    allResults.push(...batch);
    batch.forEach(r => attempted.add(r.to.toLowerCase()));
    if (total === null) total = data.total ?? allResults.length;
    const nextOffset = data.nextOffset ?? null;
    onProgress({
      sent: allResults.filter(r => r.success).length,
      failed: allResults.filter(r => !r.success).length,
      total,
    }, allResults, nextOffset);
    if (nextOffset == null) break;
    // Every round has to grow the exclusion set, or the next request is byte-for-byte
    // identical to this one and the loop spins forever — the old numeric offset used
    // to guarantee forward progress by itself and no longer does. A round that claims
    // more work remains but reports no attempted recipients (a proxy or edge error
    // answering 200 with a body that has no `results`) is that case, so stop instead.
    if (batch.length === 0) {
      return { ok: false, error: 'The server stopped returning recipients mid-send. Some may not have been emailed — check History before resending.' };
    }
  }
  return { ok: true, results: allResults, total: total ?? 0 };
}

/**
 * pendingSend.payload only exists so a resumed send can redrive sendInBatches
 * from scratch (see useCampaignHistory's resumeSend), but it's POSTed to
 * /api/campaigns and written to Redis after every batch of a send (see
 * upsertCampaign in the progress callbacks of useDemosFlow/usePromotionChannel).
 * signOffImage is a base64 data URL of the user's signature — up to ~200KB even
 * after the upload-time cap — so persisting it inside pendingSend multiplies
 * that weight by every batch of a long send: the same class of problem the
 * image cap was fixing, just on a different write path. It's also the only
 * field worth evicting here — resumeSend re-supplies it from current settings,
 * so nothing is lost — while templates/subjects (a couple of KB) stay so a
 * resumed send keeps using the template as it stood at send time rather than
 * silently picking up an edit made in between, and customContacts stay so
 * resuming can't change the recipient set out from under a still-running send.
 */
export function payloadForPendingSend(payload: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...payload };
  delete stripped.signOffImage;
  return stripped;
}

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseContactsCsv(text: string): { artistName: string; managerName: string; managerEmail: string }[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: { artistName: string; managerName: string; managerEmail: string }[] = [];
  for (const line of lines) {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;
    const [artistName, managerName, managerEmail] = cols.length >= 3
      ? [cols[0], cols[1], cols[2]]
      : [cols[0], '', cols[1]];
    if (!artistName || !managerEmail || !managerEmail.includes('@')) continue;
    if (artistName.toLowerCase() === 'artist' && managerEmail.toLowerCase().includes('email')) continue;
    out.push({ artistName, managerName, managerEmail });
  }
  return out;
}

/** Uniform shuffle (Fisher-Yates) — Math.random()-based comparator sorts are a well-known non-fix that biases the result. */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Which of `emails` were already pitched the current track under a previous
 * campaign — `pitchedEmailMap` (lowercased email -> track titles it's been sent
 * for) is built once from campaign history, so this is just a lookup per address.
 * Empty `trackTitle` means nothing to compare against yet, so nothing is flagged.
 */
export function findDuplicateRecipients(
  pitchedEmailMap: Map<string, string[]>,
  trackTitle: string,
  emails: string[]
): string[] {
  const title = trackTitle.trim().toLowerCase();
  if (!title) return [];
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const email of emails) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tracks = pitchedEmailMap.get(key) ?? [];
    if (tracks.some(t => t.trim().toLowerCase() === title)) dupes.push(email);
  }
  return dupes;
}

/** Lowercased recipient -> Message-ID, for whichever results actually got one (skips failures). */
export function messageIdsFromResults(results: SendResultEntry[]): Record<string, string> {
  const ids: Record<string, string> = {};
  results.forEach(r => { if (r.success && r.messageId) ids[r.to.toLowerCase()] = r.messageId; });
  return ids;
}

/**
 * Screens a freshly-loaded recipient list for addresses guaranteed to bounce
 * (malformed, or a domain with no usable mail DNS) so they can be flagged before
 * a send ever reaches them. Best-effort: any network/server failure just means no
 * addresses get flagged, not that the caller's preview fails.
 */
export async function checkRecipientsValidity(emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  try {
    const res = await fetch('/api/mx-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { malformed: string[]; noMx: string[] };
    return [...data.malformed, ...data.noMx];
  } catch {
    return [];
  }
}

/** sent === 0 means nothing to divide by, not a 0% reply rate — reported as 0 either way for display purposes. */
function replyRateOf(sent: number, responded: number): number {
  return sent > 0 ? responded / sent : 0;
}

/**
 * Addresses that genuinely replied — `responded` minus anyone whose reply was
 * classified as an auto-reply (vacation responder). `responded` entries keep
 * their original casing while `classifications` keys are lowercased (see
 * lib/checkReplies.ts's classifyReply), so the lookup has to lowercase each
 * address before checking. Campaigns with no `classifications` at all (older
 * records, or ones never checked) simply keep every responder — nothing here
 * gets excluded unless it was positively classified as an auto-reply.
 */
export function countedResponders(campaign: Campaign): string[] {
  return (campaign.responded ?? []).filter(email => campaign.classifications?.[email.toLowerCase()] !== 'auto-reply');
}

/**
 * Recipients a send actually reached: everyone mailed, minus confirmed
 * bounces. Computed by checking which `emails` entries appear in `bounced`
 * (case-insensitively) rather than just subtracting `bounced.length` — a
 * stale record could in principle list a bounce for an address no longer (or
 * never) present in `emails`, which would under-count or even go negative.
 */
export function deliveredCount(campaign: Campaign): number {
  const bouncedSet = new Set((campaign.bounced ?? []).map(e => e.toLowerCase()));
  const bouncedDeliveries = campaign.emails.filter(e => bouncedSet.has(e.toLowerCase())).length;
  return campaign.emails.length - bouncedDeliveries;
}

// Minimum recipients *per variant* before a subject test's reply-rate gap is
// even considered — below this, subjectTestWinner always says "too early to
// tell" (returns null) regardless of how big the gap looks, since a handful of
// replies swings a percentage wildly (2 of 5 vs 3 of 5 is a 20-point "gap" that
// means nothing). 20 per variant — 40 total — is a low bar, not a rigorous one:
// it exists to rule out the most obviously premature calls, not to certify
// statistical significance, and it's the same "40 recipients" figure this
// feature's own spec used as its example of a sample too small to call.
const SUBJECT_TEST_MIN_PER_VARIANT = 20;

// Once both variants clear the sample floor above, the gap between their reply
// rates still has to clear this many standard errors of a two-proportion
// z-test (on the pooled reply rate) before either one is called a winner.
// Without this, a 40-recipient send with a 5-point gap — again, this feature's
// own worked example of noise — reads as a confident winner: at n=20/variant
// and a ~10% pooled reply rate, one standard error is already close to 9
// points, so a 5-point gap is under 1 SE, nowhere near real. 1.65 is roughly a
// one-sided 90% confidence threshold — loose enough to be a useful nudge for
// someone picking between two subject lines, not a claim of scientific
// significance (this is cold-email reply counts, not a clinical trial).
const SUBJECT_TEST_Z_THRESHOLD = 1.65;

/**
 * Whether a subject-line A/B test's gap is real enough to call a winner, and
 * for which variant — a plain two-proportion z-test on the pooled reply rate.
 * See the two constants above for what the thresholds are and why. Returns
 * null ("too early to tell") both below the sample floor and when the gap
 * doesn't clear the z-threshold — including the degenerate case where nobody
 * in either group has replied yet (pooled rate 0, so there's no variance to
 * measure a gap against, even though the raw counts might differ).
 */
export function subjectTestWinner(sentA: number, respondedA: number, sentB: number, respondedB: number): 'A' | 'B' | null {
  if (sentA < SUBJECT_TEST_MIN_PER_VARIANT || sentB < SUBJECT_TEST_MIN_PER_VARIANT) return null;
  const pooled = (respondedA + respondedB) / (sentA + sentB);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / sentA + 1 / sentB));
  if (standardError === 0) return null;
  const z = (respondedA / sentA - respondedB / sentB) / standardError;
  if (Math.abs(z) < SUBJECT_TEST_Z_THRESHOLD) return null;
  return z > 0 ? 'A' : 'B';
}

export interface FollowUpDue {
  campaign: Campaign;
  /** Whole days since the campaign was sent, floored — also what decides eligibility (see below). */
  daysSinceSent: number;
  /** How many recipients haven't replied yet — nonRespondedRecipients's count, i.e. exactly who a follow-up send would target. */
  pendingCount: number;
  /** How many were mailed in the original campaign. */
  totalCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Song Demos campaigns overdue for a manual follow-up nudge — feeds the Overview
 * tab's "Needs follow-up" panel. A campaign qualifies when: it's a Song Demos send
 * (the only type with a follow-up template) with an account and drive link on
 * record (the template renders {{driveLink}}, so without one there's nothing
 * coherent to send); it hasn't already been marked followed-up
 * (`followUpSentAt`); it isn't mid-send (`pendingSend`); it's old enough
 * (`followUpDays`, compared in raw elapsed ms so the boundary is exact rather than
 * calendar-day-rounded); and it still has at least one recipient who hasn't
 * replied, bounced, unsubscribed (blacklisted), or already gotten a follow-up.
 *
 * That last check reuses nonRespondedRecipients from lib/autoFollowUp.ts — the
 * same function the server uses to decide who a follow-up send actually reaches —
 * so the count shown here can never disagree with what pressing "Send follow-up"
 * would target. Sorted most-overdue first.
 */
export function campaignsNeedingFollowUp(
  campaigns: Campaign[],
  followUpDays: number,
  blacklist: string[],
  now: number = Date.now()
): FollowUpDue[] {
  const blacklistSet = new Set(blacklist.map(e => e.toLowerCase()));
  const due: FollowUpDue[] = [];
  for (const campaign of campaigns) {
    if (campaign.type !== 'demos') continue;
    if (!campaign.accountId || !campaign.driveLink) continue;
    if (campaign.followUpSentAt) continue;
    if (campaign.pendingSend) continue;
    const elapsedMs = now - new Date(campaign.date).getTime();
    if (elapsedMs < followUpDays * DAY_MS) continue;
    const pending = nonRespondedRecipients(campaign, blacklistSet);
    if (pending.length === 0) continue;
    due.push({
      campaign,
      daysSinceSent: Math.floor(elapsedMs / DAY_MS),
      pendingCount: pending.length,
      totalCount: campaign.emails.length,
    });
  }
  return due.sort((a, b) => b.daysSinceSent - a.daysSinceSent);
}

/**
 * All the derived numbers behind the Overview tab: totals, a 14-day send chart,
 * reply/bounce rates, and reply-rate breakdowns by campaign type, genre, and
 * follower tier. Genre/follower-tier breakdowns only make sense against recipient
 * metadata (genres, spotifyFollowers), which currently only Demos sends record —
 * campaigns without it simply don't contribute to those two breakdowns.
 */
export function computeAnalyticsStats(campaigns: Campaign[]): AnalyticsStats {
  const totalCampaigns = campaigns.length;
  const totalEmailsSent = campaigns.reduce((s, c) => s + c.emails.length, 0);
  const demosCampaigns = campaigns.filter(c => c.type === 'demos');
  const radioCampaigns = campaigns.filter(c => c.type === 'radio');
  const playlistCampaigns = campaigns.filter(c => c.type === 'playlists');
  const demosEmailsSent = demosCampaigns.reduce((s, c) => s + c.emails.length, 0);
  const radioEmailsSent = radioCampaigns.reduce((s, c) => s + c.emails.length, 0);
  const playlistEmailsSent = playlistCampaigns.reduce((s, c) => s + c.emails.length, 0);

  const trackCounts = new Map<string, number>();
  campaigns.forEach(c => trackCounts.set(c.trackTitle, (trackCounts.get(c.trackTitle) ?? 0) + c.emails.length));
  const topTracks = Array.from(trackCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const dayCounts = new Map<string, number>();
  campaigns.forEach(c => {
    const day = c.date.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + c.emails.length);
  });
  const today = new Date();
  const last14Days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: dayCounts.get(key) ?? 0 };
  });
  const maxDayCount = Math.max(1, ...last14Days.map(d => d.count));

  const totalRespondedRaw = campaigns.reduce((s, c) => s + (c.responded?.length ?? 0), 0);
  const totalResponded = campaigns.reduce((s, c) => s + countedResponders(c).length, 0);
  const totalAutoReplies = totalRespondedRaw - totalResponded;
  const totalBounced = campaigns.reduce((s, c) => s + (c.bounced?.length ?? 0), 0);
  const totalDelivered = campaigns.reduce((s, c) => s + deliveredCount(c), 0);
  const replyRate = replyRateOf(totalDelivered, totalResponded);
  // Bounce rate deliberately stays "of everything we attempted" (totalEmailsSent),
  // not totalDelivered — it's answering a different question than replyRate
  // ("how much of what we tried to send bounced" vs. "how much of what actually
  // landed got a reply"), so the two rates use different denominators on purpose.
  const bounceRate = totalEmailsSent > 0 ? totalBounced / totalEmailsSent : 0;

  const classificationCounts = { interested: 0, pass: 0, autoReply: 0, unclassified: 0 };
  campaigns.forEach(c => {
    Object.values(c.classifications ?? {}).forEach(cls => {
      if (cls === 'interested') classificationCounts.interested++;
      else if (cls === 'pass') classificationCounts.pass++;
      else if (cls === 'auto-reply') classificationCounts.autoReply++;
      else classificationCounts.unclassified++;
    });
  });

  const byType: RateBreakdown[] = ([
    ['Song Demos', demosCampaigns], ['Track Promotion (Radio)', radioCampaigns], ['Playlist Curators', playlistCampaigns],
  ] as const).map(([label, list]) => {
    const sent = list.reduce((s, c) => s + deliveredCount(c), 0);
    const responded = list.reduce((s, c) => s + countedResponders(c).length, 0);
    return { label, sent, responded, replyRate: replyRateOf(sent, responded) };
  }).filter(b => b.sent > 0);

  const genreTotals = new Map<string, { sent: number; responded: number }>();
  const FOLLOWER_TIERS: [string, (n: number) => boolean][] = [
    ['Under 10K', n => n < 10_000],
    ['10K–100K', n => n >= 10_000 && n < 100_000],
    ['100K–1M', n => n >= 100_000 && n < 1_000_000],
    ['1M+', n => n >= 1_000_000],
  ];
  const tierTotals = new Map<string, { sent: number; responded: number }>(FOLLOWER_TIERS.map(([label]) => [label, { sent: 0, responded: 0 }]));

  demosCampaigns.forEach(c => {
    const respondedSet = new Set(countedResponders(c).map(e => e.toLowerCase()));
    const bouncedSet = new Set((c.bounced ?? []).map(e => e.toLowerCase()));
    (c.recipients ?? []).forEach(r => {
      // A bounced recipient never actually received anything, so they shouldn't
      // count toward this breakdown's `sent` (or its `responded`, though a
      // genuinely bounced address replying back is already a contradiction).
      if (bouncedSet.has(r.email.toLowerCase())) return;
      const didRespond = respondedSet.has(r.email.toLowerCase());
      r.genres.forEach(genre => {
        const entry = genreTotals.get(genre) ?? { sent: 0, responded: 0 };
        entry.sent++;
        if (didRespond) entry.responded++;
        genreTotals.set(genre, entry);
      });
      const tierLabel = FOLLOWER_TIERS.find(([, test]) => test(r.spotifyFollowers))?.[0];
      if (tierLabel) {
        const entry = tierTotals.get(tierLabel)!;
        entry.sent++;
        if (didRespond) entry.responded++;
      }
    });
  });

  const byGenre: RateBreakdown[] = Array.from(genreTotals.entries())
    .map(([label, { sent, responded }]) => ({ label, sent, responded, replyRate: replyRateOf(sent, responded) }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 10);

  const byFollowerTier: RateBreakdown[] = FOLLOWER_TIERS
    .map(([label]) => ({ label, ...tierTotals.get(label)! }))
    .filter(b => b.sent > 0)
    .map(b => ({ ...b, replyRate: replyRateOf(b.sent, b.responded) }));

  // subjectVariants is only ever set alongside subjectB (see the field's doc
  // comment on Campaign) — checking subjectB is enough to identify which
  // campaigns actually ran a test.
  const subjectTests: SubjectTestSummary[] = demosCampaigns
    .filter(c => c.subjectB && c.subjectVariants)
    .map(c => {
      // Auto-replies are unrelated to which subject line was used, so they're
      // pure noise in an A/B comparison; bounced addresses never received
      // either subject line, so they don't belong in sentA/sentB at all.
      const respondedSet = new Set(countedResponders(c).map(e => e.toLowerCase()));
      const bouncedSet = new Set((c.bounced ?? []).map(e => e.toLowerCase()));
      let sentA = 0, respondedA = 0, sentB = 0, respondedB = 0;
      c.emails.forEach(email => {
        const key = email.toLowerCase();
        if (bouncedSet.has(key)) return;
        const variant = c.subjectVariants?.[key];
        // A recipient with no recorded variant (shouldn't normally happen once a
        // campaign is fully written, but a send interrupted mid-write could in
        // principle leave a gap) simply isn't counted for either side, rather
        // than guessed at.
        if (variant === 'A') { sentA++; if (respondedSet.has(key)) respondedA++; }
        else if (variant === 'B') { sentB++; if (respondedSet.has(key)) respondedB++; }
      });
      return {
        campaignId: c.id, trackTitle: c.trackTitle, date: c.date,
        subjectA: c.subjectA ?? '', subjectB: c.subjectB ?? '',
        sentA, respondedA, replyRateA: replyRateOf(sentA, respondedA),
        sentB, respondedB, replyRateB: replyRateOf(sentB, respondedB),
        winner: subjectTestWinner(sentA, respondedA, sentB, respondedB),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    totalCampaigns, totalEmailsSent,
    demosCampaignCount: demosCampaigns.length, radioCampaignCount: radioCampaigns.length, playlistCampaignCount: playlistCampaigns.length,
    demosEmailsSent, radioEmailsSent, playlistEmailsSent,
    topTracks, last14Days, maxDayCount,
    lastCampaignDate: campaigns.length ? campaigns.slice().sort((a, b) => b.date.localeCompare(a.date))[0].date : null,
    totalResponded, totalBounced, totalDelivered, totalAutoReplies, replyRate, bounceRate, classificationCounts,
    byType, byGenre, byFollowerTier, subjectTests,
  };
}
