import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { listCampaigns, saveCampaign, mergeSendResultsIntoCampaign, type CampaignRecord } from '@/lib/campaigns';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';
import { dispatchQueuedSend } from '@/lib/sendDispatch';

// Backstop for Account settings' Send Window (lib/sendWindow.ts): the primary way
// a queued campaign (pendingSend set, nothing sent yet — see useDemosFlow/
// usePromotionChannel's handleSend) actually goes out is app/dashboard/hooks/
// useCampaignHistory.ts's drain effect, which polls while the dashboard tab is
// open. This route exists for whenever it isn't — the user closed the tab (or
// never reopened it) before the window opened.
//
// Vercel's Hobby plan only allows a cron job to run once a day (and even then,
// only "at some point within the scheduled hour", not at an exact minute — see
// vercel.com/docs/cron-jobs/usage-and-pricing), so this is a genuinely coarse
// backstop, not a real-time drain: a send queued for, say, 9am and never picked
// up by the client-side effect might not actually go out until this run's next
// daily invocation, however many hours later that lands. Nothing is lost either
// way (the campaign just sits queued a while longer), which is the same
// trade-off "queue it" already makes over blocking the send outright — it's a
// question of exactly when, not whether. A more frequent cron simply isn't
// available on this plan; see the crons entry in vercel.json and the README.
//
// Rather than re-implementing the actual send logic here (roster/genre
// filtering, dedupe, blacklist union, subject A/B, the daily cap check — all of
// which already live in lib/demosSend.ts and lib/broadcastSend.ts), this runs the
// campaign's saved pendingSend.payload through lib/sendDispatch.ts, which calls
// those same functions directly, in-process. The browser's own resumeSend re-POSTs
// over HTTP because it has no other option; this is already on the server, so it
// doesn't need the round trip — and deliberately doesn't take it. Reaching /api/send
// over HTTP from here would have required getting past proxy.ts's session gate with
// a CRON_SECRET bearer token, which would leave a route that accepts an arbitrary
// recipient list and an arbitrary message body reachable by anyone holding that
// secret. See dispatchQueuedSend's doc comment.
export const maxDuration = 60;

// How many queued campaigns one invocation will actually drive (fully or up to
// the time budget below) before stopping. Queued sends are expected to be rare —
// this is a backstop for a single-operator tool, not a queue under real load —
// so this exists purely to keep one run from working through an unbounded
// backlog and blowing past maxDuration, not because a large number is expected
// in practice.
const MAX_QUEUED_CAMPAIGNS_PER_RUN = 5;

// Wall-clock budget for this run's own sending work, leaving headroom under
// maxDuration=60s (the Hobby-plan ceiling) for the listCampaigns/settings reads
// at the top and the JSON response at the end. Measured in wall-clock time
// (rather than a message count, the way lib/autoFollowUp.ts's budget is) because
// a queued campaign is driven toward completion here, not worked in a fixed-size
// batch — there's no equivalent "messages per run" figure to budget against.
const SAFE_RUN_BUDGET_MS = 50_000;

interface SendRouteResponse {
  error?: string;
  results?: { to: string; success: boolean; messageId?: string }[];
  nextOffset?: number | null;
}

/**
 * Drives one queued campaign's send to completion (or until this run's time
 * budget runs out), persisting progress after every round the same way
 * useCampaignHistory.ts's resumeSend does client-side — so a run that gets
 * killed mid-send by maxDuration loses at most the in-flight round, and the next
 * invocation (or the client-side drain effect, whichever gets there first)
 * picks up cleanly from `campaign.emails`/`pendingSend`, exactly like an
 * interrupted send always has.
 */
async function drainQueuedCampaign(
  campaign: CampaignRecord,
  signOffImage: string | undefined,
  startedAt: number
): Promise<{ sent: number; failed: number; done: boolean; error?: string }> {
  const pending = campaign.pendingSend!;
  const attempted = new Set<string>();
  let sent = 0;
  let failed = 0;
  let current = campaign;

  for (;;) {
    if (Date.now() - startedAt > SAFE_RUN_BUDGET_MS) {
      return { sent, failed, done: false, error: 'Ran out of time this run — will pick up again next run.' };
    }

    let res: Response;
    let data: SendRouteResponse;
    try {
      // Paged by exclusion set (offset pinned to 0, `attempted` growing each round)
      // rather than by a numeric offset — same approach as the client's sendInBatches
      // and resumeSend, and for the same reason: the recipient list is rebuilt from
      // scratch on every call, so a stable index into it doesn't exist.
      res = await dispatchQueuedSend(pending.endpoint, {
        ...pending.payload, signOffImage, offset: 0, excludeEmails: Array.from(attempted),
      });
      data = await res.json();
    } catch (err) {
      return { sent, failed, done: false, error: `Could not run ${pending.endpoint}: ${String(err)}` };
    }
    if (!res.ok) return { sent, failed, done: false, error: data.error ?? `Send request failed (${res.status})` };

    const batch = data.results ?? [];
    // Mirrors sendInBatches' own guard client-side (app/dashboard/utils.ts):
    // claims more work remains but returned nobody attempted — stop rather than
    // resend an identical request forever.
    if (batch.length === 0 && data.nextOffset != null) {
      return { sent, failed, done: false, error: 'The server stopped returning recipients mid-send.' };
    }

    const newlySent = batch.filter(r => r.success).map(r => r.to);
    sent += newlySent.length;
    failed += batch.length - newlySent.length;
    batch.forEach(r => attempted.add(r.to.toLowerCase()));

    const messageIds: Record<string, string> = {};
    batch.forEach(r => { if (r.success && r.messageId) messageIds[r.to.toLowerCase()] = r.messageId; });

    const nextPendingSend = data.nextOffset != null ? pending : undefined;
    current = mergeSendResultsIntoCampaign(current, newlySent, messageIds, nextPendingSend);
    await saveCampaign(current);

    if (data.nextOffset == null) return { sent, failed, done: true };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isKvConfigured()) return NextResponse.json({ ok: true, processed: 0, note: 'Storage not configured' });

  const startedAt = Date.now();
  const campaigns = await listCampaigns();
  const due = campaigns.filter(c => c.pendingSend && c.emails.length === 0 && c.scheduledFor != null && c.scheduledFor <= Date.now());

  // Re-injects the currently configured signature the same way resumeSend does
  // client-side (see its own doc comment in useCampaignHistory.ts):
  // pendingSend.payload never carries one (payloadForPendingSend strips it
  // before persisting), and there's no browser tab here to pull "whatever's on
  // screen right now" from — the settings blob is the next best thing.
  const rawSignOffImage = await getRedis().hget<unknown>(STATE_KEY, 'tp_sign_off_image').catch(() => null);
  const signOffImage = typeof rawSignOffImage === 'string' && rawSignOffImage ? rawSignOffImage : undefined;

  const results: { campaignId: string; trackTitle: string; sent: number; failed: number; done: boolean; error?: string }[] = [];
  let stopReason: 'campaignBudget' | 'timeBudget' | null = null;

  for (const campaign of due) {
    if (results.length >= MAX_QUEUED_CAMPAIGNS_PER_RUN) { stopReason = 'campaignBudget'; break; }
    if (Date.now() - startedAt > SAFE_RUN_BUDGET_MS) { stopReason = 'timeBudget'; break; }

    const outcome = await drainQueuedCampaign(campaign, signOffImage, startedAt);
    results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, ...outcome });
  }

  return NextResponse.json({
    ok: true,
    due: due.length,
    processed: results.length,
    // 'campaignBudget' = MAX_QUEUED_CAMPAIGNS_PER_RUN reached; 'timeBudget' = this
    // run's wall-clock budget ran out; null = every due campaign was reached (not
    // necessarily *finished* — see each result's own `done`/`error`). Anything
    // left unfinished is picked up by the next daily run, or sooner by the
    // client-side drain effect if the dashboard gets opened first.
    stopReason,
    results,
  });
}
