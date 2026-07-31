import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { listCampaigns, saveCampaign } from '@/lib/campaigns';
import { getAccount } from '@/lib/accounts';
import { resolveSmtpConfig, sendMessagesPooled } from '@/lib/mailSend';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';
import {
  DEFAULT_FOLLOWUP_DAYS, isCampaignDueForFollowUp, nonRespondedRecipients, buildFollowUpMessage,
  computeFollowUpBudget, mergeEmailList, MAX_CAMPAIGNS_TOUCHED_PER_RUN, followUpStopReason,
  resolveFollowUpContent,
} from '@/lib/autoFollowUp';
import { getBlacklist } from '@/lib/unsubscribe';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';

// Even with the per-run budgets below keeping total SMTP and Redis work bounded,
// this can still do up to MAX_CAMPAIGNS_TOUCHED_PER_RUN campaigns' worth of Redis
// reads/writes and account lookups in one invocation — comfortably past Vercel's
// 10s default, so this raises the ceiling to 60s (the Hobby-plan max) the same way
// the interactive send routes do.
export const maxDuration = 60;

// Vercel Cron (see vercel.json) hits this once a day. No browser session is
// involved, so it can't reuse proxy.ts's cookie auth — Vercel signs cron requests
// with `Authorization: Bearer $CRON_SECRET` instead (see lib/cronAuth.ts), which
// is why this path is also listed in proxy.ts's PUBLIC_API_PATHS (the auth
// happens here, not there).

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isKvConfigured()) return NextResponse.json({ ok: true, processed: 0, note: 'Storage not configured' });

  const settings = (await getRedis().hgetall<Record<string, unknown>>(STATE_KEY)) ?? {};
  if (settings['tp_auto_followup_enabled'] !== 'true') {
    return NextResponse.json({ ok: true, processed: 0, note: 'Auto follow-up is turned off' });
  }

  // Fallback only — a campaign's own snapshot (CampaignRecord.followUpTemplate/
  // followUpSubject, set at send time) wins when it has one; see
  // resolveFollowUpContent's doc comment. Unlike before this feature, an empty
  // globalFollowUpTemplate no longer short-circuits the whole run: a due
  // campaign with its own snapshot can still get its follow-up even if nothing
  // is currently configured in Account settings.
  const globalFollowUpTemplate = typeof settings['tp_followup_template'] === 'string' ? settings['tp_followup_template'] : '';
  const globalSubjectTemplate = (typeof settings['tp_followup_subject'] === 'string' && settings['tp_followup_subject'].trim())
    || 'Following Up: {{trackTitle}} for {{artistName}}';
  const signOff = typeof settings['tp_sign_off'] === 'string' ? settings['tp_sign_off'] : '';
  const sendDelay = Number(settings['tp_send_delay']) || undefined;
  const daysRaw = Number(settings['tp_auto_followup_days']);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : DEFAULT_FOLLOWUP_DAYS;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const campaigns = await listCampaigns();
  // Every campaign due today, unsliced — the response below needs the true count
  // to report honestly, and both budgets in the loop (not a slice taken up front)
  // are what actually keep this bounded. isCampaignDueForFollowUp only ever skips
  // campaigns that are fully done, so nothing found due here is at risk of being
  // silently dropped — it's either handled this run or picked up next.
  const due = campaigns.filter(c => isCampaignDueForFollowUp(c, cutoffMs));
  const blacklist = await getBlacklist();

  // Total messages this invocation may send, across every campaign below — not a
  // per-campaign limit. See computeFollowUpBudget's doc comment for the arithmetic;
  // it's what actually keeps this run's combined sendMessages() calls inside
  // maxDuration=60 regardless of how many campaigns are due today or how large any
  // one of them is.
  let remainingMessageBudget = computeFollowUpBudget(sendDelay);
  const initialMessageBudget = remainingMessageBudget;

  // How many due campaigns this run has read from and written back to Redis so
  // far, counted regardless of whether the campaign turned out to have anyone
  // left to send to. Bounded by MAX_CAMPAIGNS_TOUCHED_PER_RUN — see its doc
  // comment in lib/autoFollowUp.ts for why this needs a limit of its own, separate
  // from the message budget above.
  let campaignsTouched = 0;

  // Set once either per-run budget is exhausted, or a campaign's cap check blocks
  // even a reduced, budget-sized batch. Whichever it is, every campaign not yet
  // reached this run is simply picked up again by tomorrow's — see
  // isCampaignDueForFollowUp, which only skips campaigns that are fully done.
  let stopReason: 'messageBudget' | 'campaignBudget' | 'cap' | null = null;

  const results: {
    campaignId: string; trackTitle: string; sent: number;
    done: boolean; remaining?: number; skipped?: string;
  }[] = [];

  for (const campaign of due) {
    // Pure and Redis-free, so computing it before either budget check below costs
    // nothing — nonRespondedRecipients only touches campaign data already loaded.
    const targets = nonRespondedRecipients(campaign, blacklist);

    // Also Redis-free (campaign data is already loaded), so resolved before the
    // budget check too. A campaign resolving to no template at all — no
    // snapshot of its own and nothing currently configured to fall back to —
    // is skipped without touching either budget below: there's no Redis work
    // to bound here, just like the zero-targets case a little further down.
    const { template: followUpTemplate, subject: subjectTemplate } = resolveFollowUpContent(campaign, globalFollowUpTemplate, globalSubjectTemplate);
    if (!followUpTemplate.trim()) {
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, done: false, skipped: 'No follow-up template configured' });
      continue;
    }

    const stop = followUpStopReason(campaignsTouched, MAX_CAMPAIGNS_TOUCHED_PER_RUN, remainingMessageBudget, targets.length > 0);
    if (stop) {
      stopReason = stop;
      break;
    }
    campaignsTouched++;

    if (!targets.length) {
      // Everyone on it already replied, bounced, unsubscribed, or was already
      // followed up in an earlier (possibly partial) run — nothing left to nudge.
      await saveCampaign({ ...campaign, followUpSentAt: Date.now() });
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, done: true });
      continue;
    }

    // Send at most what's left of this run's budget, not the full remaining
    // target list — a campaign bigger than one run's budget gets worked through
    // over several days instead of running long enough to blow past maxDuration.
    const batchTargets = targets.slice(0, Math.min(targets.length, remainingMessageBudget));
    // True exactly when the budget, not the target list itself, decided the batch
    // size — used below to tell "stopped because the run ran out of message
    // budget" apart from "this batch simply had some permanent send failures in it".
    const budgetLimited = batchTargets.length < targets.length;

    // Checked against the batch actually about to go out, not targets.length: a
    // 400-recipient campaign under a 100/day cap should still make progress today
    // instead of being skipped wholesale every single run.
    const capCheck = await checkCapAllows(batchTargets.length, campaign.accountId);
    if (!capCheck.ok) {
      // The cap blocking even a reduced batch means nothing more can go out today
      // for anyone — later campaigns in `due` would just hit the same wall, so
      // stop the run here rather than recording an identical skip for each of them.
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, done: false, skipped: capCheck.error });
      stopReason = 'cap';
      break;
    }

    const account = await getAccount(campaign.accountId!).catch(() => null);
    if (!account) {
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, done: false, skipped: 'Sending account is no longer available' });
      continue;
    }

    const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(account, campaign.senderName);
    if (!smtpUser || !smtpPass) {
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, done: false, skipped: 'No SMTP credentials on the account' });
      continue;
    }

    const messages = batchTargets.map(email => buildFollowUpMessage(campaign, email, followUpTemplate, subjectTemplate, signOff));
    // One pooled transport per campaign rather than one for the whole run: campaigns
    // can each have their own sending account, so the connection isn't reusable across
    // them anyway. sendMessagesPooled closes each one before the next campaign starts,
    // which matters more here than on the interactive routes — this loop can touch
    // several campaigns in a single invocation, and leaking a socket per campaign would
    // pile up for the rest of the function's lifetime.
    const sendResults = await sendMessagesPooled(
      { smtpHost, smtpPort, smtpUser, smtpPass },
      messages,
      { fromName, fromEmail: fromEmail as string, sendDelay }
    );
    const sentCount = sendResults.filter(r => r.success).length;
    await recordSends(sentCount, campaign.accountId);

    const messageIds = { ...(campaign.messageIds ?? {}) };
    sendResults.forEach(r => { if (r.success && r.messageId) messageIds[r.to.toLowerCase()] = r.messageId; });

    const followUpSent = mergeEmailList(campaign.followUpSent, sendResults.filter(r => r.success).map(r => r.to));

    // An address the server rejected outright (5xx / bad envelope, flagged as
    // `permanent` by sendMessages) is recorded as bounced, which is exactly what it
    // is — a synchronous rejection rather than a bounce message arriving later. That
    // matters because nothing else would ever retire it: a rejection at SMTP time
    // generates no bounce email, so lib/checkReplies.ts can never discover it, and
    // without this the address stays a target and gets retried every single run
    // forever — burning this run's message budget daily on a mailbox that does not
    // exist, and leaving the campaign permanently short of `done`. Transient
    // failures (dropped connection, 4xx "try again") are deliberately NOT recorded,
    // so those addresses stay targets and get a fresh attempt tomorrow.
    const bounced = mergeEmailList(campaign.bounced, sendResults.filter(r => !r.success && r.permanent).map(r => r.to));

    // Persisted right after this batch, before moving to the next campaign, so a
    // mid-run kill (timeout, crash) loses at most the in-flight batch rather than
    // re-sending everything this campaign has already had follow-ups for. Mirrors
    // pendingSend's "persist progress as you go" approach on the interactive send
    // side.
    const stillRemaining = nonRespondedRecipients({ ...campaign, followUpSent, bounced }, blacklist);
    const done = stillRemaining.length === 0;
    await saveCampaign({ ...campaign, messageIds, followUpSent, bounced, ...(done ? { followUpSentAt: Date.now() } : {}) });

    results.push({
      campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: sentCount, done,
      ...(done ? {} : { remaining: stillRemaining.length }),
    });

    remainingMessageBudget -= batchTargets.length;
    if (budgetLimited) {
      // The batch was capped by the message budget, not by the target list running
      // out, so remainingMessageBudget is now exactly 0 — stop here rather than
      // looping into the next campaign (or, if this was the last one in `due`,
      // falling out of the loop with nothing recording why it's still incomplete).
      stopReason = 'messageBudget';
      break;
    }
  }

  const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
  // How many of today's due campaigns are not fully caught up as of this run —
  // either never reached at all (the run stopped on a budget or the send cap
  // before getting to them), or reached but left with a partial batch (send
  // failures, or the message budget cutting the batch short). Zero means every
  // campaign due today is completely done; anything else is picked up again by
  // tomorrow's run per isCampaignDueForFollowUp.
  const outstandingCampaigns = due.length - results.filter(r => r.done).length;

  return NextResponse.json({
    ok: true,
    // Total campaigns due today, independent of how many this run actually got
    // to — `due` is no longer sliced up front, so this is the true daily figure
    // rather than a number capped by an earlier campaign-count limit.
    dueThisRun: due.length,
    // Campaigns this run actually read and wrote back to Redis, whether or not
    // they had anyone left to send to.
    campaignsReached: results.length,
    totalSent,
    messageBudget: initialMessageBudget,
    campaignTouchBudget: MAX_CAMPAIGNS_TOUCHED_PER_RUN,
    // 'messageBudget' = the per-run send budget ran out; 'campaignBudget' = the
    // per-run cap on how many due campaigns get touched at all ran out (guards
    // Redis/bookkeeping time, not SMTP time — see MAX_CAMPAIGNS_TOUCHED_PER_RUN's
    // doc comment in lib/autoFollowUp.ts); 'cap' = the daily/account send cap
    // blocked even a reduced batch; null = the loop went through every due
    // campaign without any of the three kicking in (see outstandingCampaigns for
    // whether that also means nothing is left behind).
    stopReason,
    outstandingCampaigns,
    results,
  });
}
