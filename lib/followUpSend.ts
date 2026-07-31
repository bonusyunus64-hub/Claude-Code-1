import { NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { listCampaigns, saveCampaign } from '@/lib/campaigns';
import { resolveAccount } from '@/lib/accounts';
import { resolveSmtpConfig, sendMessagesPooled, paginate, DEFAULT_SEND_BATCH_SIZE } from '@/lib/mailSend';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';
import { nonRespondedRecipients, resolveFollowUpContent, buildFollowUpMessage, mergeEmailList } from '@/lib/autoFollowUp';
import { getBlacklist } from '@/lib/unsubscribe';

export interface FollowUpSendPayload {
  campaignId: string;
  offset?: number;
  limit?: number;
  excludeEmails?: string[];
  signOffImage?: string;
  sendDelay?: number;
  signOff?: string;
}

/**
 * Button-driven counterpart to the old auto-followup cron (now removed): sends one
 * batch of follow-ups for a single campaign, on demand, from the dashboard. Reuses
 * the cron's message-building logic (lib/autoFollowUp.ts) but none of its per-run
 * budgets — those existed only to keep an unattended timer under Vercel's
 * maxDuration, and don't apply to a user pressing a button and paging through
 * batches from the browser (see app/dashboard/utils.ts's sendInBatches).
 *
 * This route is dashboard-session-only (proxy.ts's generic /api/* session gate
 * already covers it) and deliberately does NOT accept a CRON_SECRET — see the
 * long comment in proxy.ts on why send routes stay out of PUBLIC_API_PATHS: a
 * leaked cron secret must never be enough to send mail through the user's mailbox.
 */
export async function sendFollowUp(payload: FollowUpSendPayload): Promise<NextResponse> {
  const { campaignId, offset, limit, excludeEmails, signOffImage, sendDelay, signOff } = payload;

  const campaigns = await listCampaigns();
  const campaign = campaigns.find(c => c.id === campaignId);
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  // The follow-up template renders {{driveLink}}, and only a Song Demos send
  // records driveLink/accountId at all (see CampaignRecord's doc comments) —
  // without both there's nothing coherent to send.
  if (campaign.type !== 'demos' || !campaign.accountId || !campaign.driveLink) {
    return NextResponse.json({ error: 'This campaign cannot be followed up on.' }, { status: 400 });
  }

  const { account, error: accountError } = await resolveAccount(campaign.accountId);
  if (accountError) return NextResponse.json({ error: accountError }, { status: 400 });

  const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(account ?? undefined, campaign.senderName);
  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one in the Email Template tab.' },
      { status: 500 }
    );
  }

  const blacklist = await getBlacklist();
  const exclude = new Set((excludeEmails ?? []).map(e => e.toLowerCase()));
  const targets = nonRespondedRecipients(campaign, blacklist).filter(e => !exclude.has(e.toLowerCase()));

  // Nobody left to mail. Returned as an empty success rather than an error: with
  // zero targets, checkCapAllows below would report allowed: 0 with no `error`
  // (its "batchSize was itself 0" branch), which would surface as a bare 429 and
  // read to the user as a failure. This happens when the dashboard's count has
  // gone stale — someone replied since the panel was rendered, or the campaign was
  // already followed up in another tab — so the honest answer is that there was
  // nothing to do. nextOffset: null also terminates sendInBatches cleanly.
  if (targets.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, total: 0, batchTotal: 0, nextOffset: null, results: [] });
  }

  let globalTemplate = '';
  let globalSubject = '';
  if (isKvConfigured()) {
    const settings = (await getRedis().hgetall<Record<string, unknown>>(STATE_KEY)) ?? {};
    globalTemplate = typeof settings['tp_followup_template'] === 'string' ? settings['tp_followup_template'] : '';
    globalSubject = (typeof settings['tp_followup_subject'] === 'string' && settings['tp_followup_subject'].trim())
      || 'Following Up: {{trackTitle}} for {{artistName}}';
  }

  const { template: followUpTemplate, subject: subjectTemplate } = resolveFollowUpContent(campaign, globalTemplate, globalSubject);
  if (!followUpTemplate.trim()) {
    return NextResponse.json({ error: 'No follow-up template configured. Set one in Account settings.' }, { status: 400 });
  }

  const allMessages = targets.map(email => buildFollowUpMessage(campaign, email, followUpTemplate, subjectTemplate, signOff ?? ''));

  const { batch, total, nextOffset: pageNextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);

  const capCheck = await checkCapAllows(batch.length, campaign.accountId);
  if (capCheck.allowed === 0) return NextResponse.json({ error: capCheck.error }, { status: 429 });

  // Same partial-allowance handling as lib/demosSend.ts: the cap may allow fewer
  // than the full page, so trim to what's actually allowed and point nextOffset
  // past only what actually went out — the client rebuilds its exclusion set from
  // `results` (sendInBatches in app/dashboard/utils.ts), so a non-null nextOffset
  // with a partial `results` is what makes the leftover retried instead of dropped.
  const sendBatch = capCheck.allowed < batch.length ? batch.slice(0, capCheck.allowed) : batch;
  const nextOffset = capCheck.allowed < batch.length ? (offset ?? 0) + sendBatch.length : pageNextOffset;

  const results = await sendMessagesPooled(
    { smtpHost, smtpPort, smtpUser, smtpPass },
    sendBatch,
    { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay }
  );

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  await recordSends(sent, campaign.accountId);

  const messageIds = { ...(campaign.messageIds ?? {}) };
  results.forEach(r => { if (r.success && r.messageId) messageIds[r.to.toLowerCase()] = r.messageId; });

  const followUpSent = mergeEmailList(campaign.followUpSent, results.filter(r => r.success).map(r => r.to));
  // A synchronous 5xx rejection produces no bounce email, so nothing else would
  // ever retire that address — see lib/autoFollowUp.ts's cron-era comment on the
  // same tradeoff, which applies identically here.
  const bounced = mergeEmailList(campaign.bounced, results.filter(r => !r.success && r.permanent).map(r => r.to));

  const stillRemaining = nonRespondedRecipients({ ...campaign, followUpSent, bounced }, blacklist);
  const done = stillRemaining.length === 0;
  await saveCampaign({ ...campaign, messageIds, followUpSent, bounced, ...(done ? { followUpSentAt: Date.now() } : {}) });

  return NextResponse.json({ sent, failed, total, batchTotal: sendBatch.length, nextOffset, results });
}
