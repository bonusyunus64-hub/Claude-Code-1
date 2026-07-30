import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { listCampaigns, saveCampaign } from '@/lib/campaigns';
import { getAccount } from '@/lib/accounts';
import { resolveSmtpConfig, createTransport, sendMessages } from '@/lib/mailSend';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';
import {
  DEFAULT_FOLLOWUP_DAYS, isCampaignDueForFollowUp, nonRespondedRecipients, buildFollowUpMessage,
  computeFollowUpBudget, mergeEmailList,
} from '@/lib/autoFollowUp';
import { getBlacklist } from '@/lib/unsubscribe';

// Even with the per-run message budget below keeping total SMTP work bounded, this
// still does up to MAX_CAMPAIGNS_PER_RUN campaigns' worth of Redis reads/writes and
// account lookups in one invocation — comfortably past Vercel's 10s default, so this
// raises the ceiling to 60s (the Hobby-plan max) the same way the interactive send
// routes do.
export const maxDuration = 60;

// Vercel Cron (see vercel.json) hits this once a day. No browser session is
// involved, so it can't reuse proxy.ts's cookie auth — Vercel signs cron requests
// with `Authorization: Bearer $CRON_SECRET` instead, matching the platform's own
// documented pattern, which is why this path is also listed in proxy.ts's
// PUBLIC_API_PATHS (the auth happens here, not there).
function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

// Bounds how many campaigns one invocation processes, so a large history can't
// run past a serverless function's time limit. Anything left over is simply
// picked up by tomorrow's run — followUpSentAt is only set for campaigns this
// run actually finished.
const MAX_CAMPAIGNS_PER_RUN = 20;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isKvConfigured()) return NextResponse.json({ ok: true, processed: 0, note: 'Storage not configured' });

  const settings = (await getRedis().hgetall<Record<string, unknown>>(STATE_KEY)) ?? {};
  if (settings['tp_auto_followup_enabled'] !== 'true') {
    return NextResponse.json({ ok: true, processed: 0, note: 'Auto follow-up is turned off' });
  }

  const followUpTemplate = typeof settings['tp_followup_template'] === 'string' ? settings['tp_followup_template'] : '';
  if (!followUpTemplate.trim()) {
    return NextResponse.json({ ok: true, processed: 0, note: 'No follow-up template configured' });
  }
  const subjectTemplate = (typeof settings['tp_followup_subject'] === 'string' && settings['tp_followup_subject'].trim())
    || 'Following Up: {{trackTitle}} for {{artistName}}';
  const signOff = typeof settings['tp_sign_off'] === 'string' ? settings['tp_sign_off'] : '';
  const sendDelay = Number(settings['tp_send_delay']) || undefined;
  const daysRaw = Number(settings['tp_auto_followup_days']);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : DEFAULT_FOLLOWUP_DAYS;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const campaigns = await listCampaigns();
  const due = campaigns.filter(c => isCampaignDueForFollowUp(c, cutoffMs)).slice(0, MAX_CAMPAIGNS_PER_RUN);
  const blacklist = await getBlacklist();

  // Total messages this invocation may send, across every campaign below — not a
  // per-campaign limit. See computeFollowUpBudget's doc comment for the arithmetic;
  // it's what actually keeps this run's combined sendMessages() calls inside
  // maxDuration=60 regardless of how many campaigns are due today or how large any
  // one of them is.
  let remainingBudget = computeFollowUpBudget(sendDelay);
  const initialBudget = remainingBudget;

  // Set once a campaign's cap check blocks even a reduced, budget-sized batch, or
  // once the message budget itself runs out. Either way, every campaign not yet
  // reached this run is simply picked up again by tomorrow's — see
  // isCampaignDueForFollowUp, which only skips campaigns that are fully done.
  let stopReason: 'budget' | 'cap' | null = null;

  const results: {
    campaignId: string; trackTitle: string; sent: number;
    done: boolean; remaining?: number; skipped?: string;
  }[] = [];

  for (const campaign of due) {
    const targets = nonRespondedRecipients(campaign, blacklist);
    if (!targets.length) {
      // Everyone on it already replied, bounced, unsubscribed, or was already
      // followed up in an earlier (possibly partial) run — nothing left to nudge.
      await saveCampaign({ ...campaign, followUpSentAt: Date.now() });
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, done: true });
      continue;
    }

    if (remainingBudget <= 0) {
      stopReason = 'budget';
      break;
    }

    // Send at most what's left of this run's budget, not the full remaining
    // target list — a campaign bigger than one run's budget gets worked through
    // over several days instead of running long enough to blow past maxDuration.
    const batchTargets = targets.slice(0, Math.min(targets.length, remainingBudget));
    // True exactly when the budget, not the target list itself, decided the batch
    // size — used below to tell "stopped because the run ran out of budget" apart
    // from "this batch simply had some permanent send failures in it".
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
    const transporter = createTransport({ smtpHost, smtpPort, smtpUser, smtpPass });
    const sendResults = await sendMessages(transporter, messages, { fromName, fromEmail: fromEmail as string, sendDelay });
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

    remainingBudget -= batchTargets.length;
    if (budgetLimited) {
      // The batch was capped by budget, not by the target list running out, so
      // remainingBudget is now exactly 0 — stop here rather than looping into the
      // next campaign (or, if this was the last one in `due`, falling out of the
      // loop with nothing recording why it's still incomplete).
      stopReason = 'budget';
      break;
    }
  }

  const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
  // Every campaign that was due this run got touched, and every one of those is
  // now fully done (no partial batches left waiting on budget, cap, or a
  // permanently-failed send) — as opposed to `stopReason === null`, which only
  // says the loop wasn't cut short by budget/cap and says nothing about campaigns
  // left incomplete by send failures within a batch that did complete.
  const allDueCampaignsComplete = results.length === due.length && results.every(r => r.done);

  return NextResponse.json({
    ok: true,
    processed: results.length,
    dueThisRun: due.length,
    totalSent,
    messageBudget: initialBudget,
    // 'budget' = the per-run send budget ran out; 'cap' = the daily/account send
    // cap blocked even a reduced batch; null = the loop went through every due
    // campaign without either limit kicking in (see allDueCampaignsComplete for
    // whether that also means nothing is left outstanding).
    stopReason,
    allDueCampaignsComplete,
    results,
  });
}
