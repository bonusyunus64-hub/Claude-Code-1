import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { listCampaigns, saveCampaign, mergeSendResultsIntoCampaign, type CampaignRecord } from '@/lib/campaigns';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';
import { dispatchQueuedSend } from '@/lib/sendDispatch';
import { isWithinSendWindow, type SendWindowSettings } from '@/lib/sendWindow';

// Backstop for Account settings' Send Window (lib/sendWindow.ts): the primary way
// a queued campaign (pendingSend set, nothing sent yet — see useDemosFlow/
// usePromotionChannel's handleSend) actually goes out is app/dashboard/hooks/
// useCampaignHistory.ts's drain effect, which polls while the dashboard tab is
// open. This route exists for whenever it isn't — the user closed the tab (or
// never reopened it) before the window opened.
//
// Vercel's Hobby plan only allows a cron job to run once a day, and even then
// only "at some point within the scheduled hour", not at an exact minute — see
// vercel.com/docs/cron-jobs/usage-and-pricing. That one guaranteed slot is
// scheduled at 10:00 UTC (see vercel.json) rather than some arbitrary hour: it's
// squarely inside typical 9-5 working hours for UK/EU zones and still inside
// them (morning) for US-East, which between them cover most plausible Send
// Window configurations for a single-operator tool without needing to know what
// timezone any given user picked. Nothing about that placement is a guarantee for
// every timezone, though — see the window check below, which is what actually
// keeps this honest rather than the schedule alone.
//
// Even with a well-chosen hour, this is a genuinely coarse backstop, not a
// real-time drain: a send queued for, say, 9am and never picked up by the
// client-side effect might not actually go out until this run's next daily
// invocation, however many hours later that lands, and if the window happens to
// be closed at 10:00 UTC on a given day (see below), it waits a further day on
// top of that. Nothing is lost either way (the campaign just sits queued a while
// longer), which is the same trade-off "queue it" already makes over blocking
// the send outright — it's a question of exactly when, not whether. A more
// frequent cron simply isn't available on this plan; see the crons entry in
// vercel.json and the README.
//
// Because the schedule alone can't guarantee landing inside the window (a queued
// campaign can be due at any hour, and this only runs once a day), this route
// also re-checks the configured Send Window itself immediately before sending —
// see sendWindowClosed below — and skips rather than sends if it's currently
// closed, leaving the campaign queued for a later run. That check applies
// uniformly to a campaign that hasn't sent anything yet and to one this route
// already partially drained on an earlier run: the feature's whole point is not
// mailing people at odd hours, and that reasoning doesn't stop applying to
// recipient 51 of 100 just because recipients 1-50 already went out under an
// open window. A closed window pauses the whole batch of due campaigns rather
// than picking and choosing.
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
 * invocation picks up cleanly from `campaign.emails`/`pendingSend` (see the
 * `due` filter below — matching on `scheduledFor` rather than "emails still
 * empty" is what makes that true for a campaign this route itself already sent
 * part of), or the client-side drain effect gets there first while the tab
 * happens to be open.
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

  // Due = a send-window-queued campaign whose window has opened, whether or not
  // this route already sent part of it on an earlier run. Unlike the client-side
  // drain effect's similar-looking filter (useCampaignHistory.ts:407), this one
  // deliberately drops the `emails.length === 0` clause: drainQueuedCampaign
  // persists progress after every round via mergeSendResultsIntoCampaign, which
  // appends to `emails` but never clears `pendingSend` or touches `scheduledFor`
  // until the whole campaign finishes. Keeping that clause meant a campaign this
  // route started sending and then ran out of SAFE_RUN_BUDGET_MS on could never
  // match this filter again on a later run — pendingSend stayed set forever with
  // nothing left to pick it back up (see this function's own doc comment above).
  //
  // `scheduledFor != null` stays, though, and is a deliberate choice, not an
  // oversight left over from the old filter. It's what distinguishes "this
  // campaign was queued by the Send Window" from a plain interrupted send
  // (network drop, tab crash, a send request that itself timed out) that never
  // went through the window at all — those set `pendingSend` too, but
  // useDemosFlow.ts/usePromotionChannel.ts's ordinary batch-loop path never
  // assigns `scheduledFor` the way the window-queue branch does. The dashboard's
  // own drain effect requires the same field for the same reason, and
  // deliberately leaves those plain interrupted sends for the user to resume by
  // hand via the History tab's "Resume" button rather than auto-finishing them
  // (see cancelQueuedSend's doc comment on that distinction). This route has no
  // user to hand a Resume button to, but that argues for staying conservative —
  // only auto-resuming what the Send Window itself queued — not for silently
  // taking over every stalled send in history the moment a daily cron happens to
  // run. Per lib/campaigns.ts's doc comment, `scheduledFor` is "ignored" as a
  // *gating* signal once the first batch has sent — that's still true here,
  // since the sendWindowClosed check below (not `scheduledFor`) is what actually
  // decides whether it's safe to keep sending; `scheduledFor` is only being used
  // here as a marker of "this came from the Send Window", which nothing clears.
  const due = campaigns.filter(c => c.pendingSend && c.scheduledFor != null && c.scheduledFor <= Date.now());

  // Re-injects the currently configured signature the same way resumeSend does
  // client-side (see its own doc comment in useCampaignHistory.ts):
  // pendingSend.payload never carries one (payloadForPendingSend strips it
  // before persisting), and there's no browser tab here to pull "whatever's on
  // screen right now" from — the settings blob is the next best thing. Read via
  // hgetall alongside the Send Window fields below rather than one hget per
  // field, so this only costs one round trip to Redis regardless of how many
  // settings it ends up needing.
  const settingsHash = (await getRedis().hgetall<Record<string, unknown>>(STATE_KEY).catch(() => null)) ?? {};
  const rawSignOffImage = settingsHash['tp_sign_off_image'];
  const signOffImage = typeof rawSignOffImage === 'string' && rawSignOffImage ? rawSignOffImage : undefined;

  // Same settings hash Account settings' Send Window UI reads/writes via
  // syncStorage (see useAccountSettings.ts's tp_send_window_* setters and
  // SYNCED_KEYS in lib/remoteSync.ts) — there's no live sendWindowSettings object
  // to close over here the way useDemosFlow.ts's handleSend has, so this rebuilds
  // one from Redis instead. A never-configured (or explicitly disabled)
  // tp_send_window_enabled reads as `enabled: false`, which isWithinSendWindow
  // treats as "no restriction at all" — so an account that's never touched this
  // feature drains exactly as it always has, with no extra check in its way.
  //
  // Every one of these fields is *written* as a plain string (syncStorage.setItem
  // takes a string, and /api/state hset's it verbatim), but they don't all come
  // back as one: the Upstash client auto-parses any stored value that happens to
  // be valid JSON, so `"true"` returns as boolean true and `"9"` as number 9,
  // while a timezone like `"Europe/Istanbul"` isn't valid JSON and stays a string.
  // A strict `=== 'true'` here would therefore be false for every genuinely
  // enabled window in production while passing any test that mocks the raw
  // string — the window check would silently never apply, which is the one
  // failure mode this whole block exists to prevent. Both shapes are accepted for
  // the same reason getDailyCap in lib/sendQuota.ts coerces rather than compares,
  // and /api/state's GET re-flattens with JSON.stringify on the way out.
  const enabledRaw = settingsHash['tp_send_window_enabled'];
  const timezoneRaw = settingsHash['tp_send_window_timezone'];
  const sendWindowSettings: SendWindowSettings = {
    enabled: enabledRaw === true || enabledRaw === 'true',
    startHour: Number(settingsHash['tp_send_window_start_hour']) || 0,
    endHour: Number(settingsHash['tp_send_window_end_hour']) || 0,
    timezone: typeof timezoneRaw === 'string' && timezoneRaw ? timezoneRaw : 'UTC',
  };

  // The schedule in vercel.json is chosen to usually land inside a typical
  // working-hours window (see the header comment above), but "usually" isn't
  // "always" — a non-UK/EU/US-East timezone, or hours moved off the 9-5 default,
  // can leave the window closed at whatever moment this happens to run. Checked
  // once, up front, rather than per campaign: it's one global setting, so if it's
  // closed it's closed for every due campaign this run, not just some of them —
  // see the header comment above for why a campaign already partway sent doesn't
  // get an exception.
  const sendWindowClosed = sendWindowSettings.enabled && !isWithinSendWindow(Date.now(), sendWindowSettings);

  const results: { campaignId: string; trackTitle: string; sent: number; failed: number; done: boolean; error?: string }[] = [];
  let stopReason: 'campaignBudget' | 'timeBudget' | 'sendWindowClosed' | null = sendWindowClosed ? 'sendWindowClosed' : null;

  if (!sendWindowClosed) {
    for (const campaign of due) {
      if (results.length >= MAX_QUEUED_CAMPAIGNS_PER_RUN) { stopReason = 'campaignBudget'; break; }
      if (Date.now() - startedAt > SAFE_RUN_BUDGET_MS) { stopReason = 'timeBudget'; break; }

      const outcome = await drainQueuedCampaign(campaign, signOffImage, startedAt);
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, ...outcome });
    }
  }

  return NextResponse.json({
    ok: true,
    due: due.length,
    processed: results.length,
    // 'campaignBudget' = MAX_QUEUED_CAMPAIGNS_PER_RUN reached; 'timeBudget' = this
    // run's wall-clock budget ran out; 'sendWindowClosed' = the Send Window is
    // enabled and currently closed, so nothing due this run was even attempted
    // (see sendWindowClosed above); null = every due campaign was reached (not
    // necessarily *finished* — see each result's own `done`/`error`). Anything
    // left unfinished (or, in the sendWindowClosed case, entirely untouched) is
    // picked up by the next daily run, or sooner by the client-side drain effect
    // if the dashboard gets opened first.
    stopReason,
    results,
  });
}
