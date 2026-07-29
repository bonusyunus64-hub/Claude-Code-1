import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { listCampaigns, saveCampaign } from '@/lib/campaigns';
import { getAccount } from '@/lib/accounts';
import { resolveSmtpConfig, createTransport, sendMessages } from '@/lib/mailSend';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';
import { DEFAULT_FOLLOWUP_DAYS, isCampaignDueForFollowUp, nonRespondedRecipients, buildFollowUpMessage } from '@/lib/autoFollowUp';

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

  const results: { campaignId: string; trackTitle: string; sent: number; skipped?: string }[] = [];

  for (const campaign of due) {
    const targets = nonRespondedRecipients(campaign);
    if (!targets.length) {
      // Everyone on it already replied or bounced — nothing left to nudge, done.
      await saveCampaign({ ...campaign, followUpSentAt: Date.now() });
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0 });
      continue;
    }

    const capCheck = await checkCapAllows(targets.length, campaign.accountId);
    if (!capCheck.ok) {
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, skipped: capCheck.error });
      continue;
    }

    const account = await getAccount(campaign.accountId!).catch(() => null);
    if (!account) {
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, skipped: 'Sending account is no longer available' });
      continue;
    }

    const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(account, campaign.senderName);
    if (!smtpUser || !smtpPass) {
      results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: 0, skipped: 'No SMTP credentials on the account' });
      continue;
    }

    const messages = targets.map(email => buildFollowUpMessage(campaign, email, followUpTemplate, subjectTemplate, signOff));
    const transporter = createTransport({ smtpHost, smtpPort, smtpUser, smtpPass });
    const sendResults = await sendMessages(transporter, messages, { fromName, fromEmail: fromEmail as string, sendDelay });
    const sentCount = sendResults.filter(r => r.success).length;
    await recordSends(sentCount, campaign.accountId);

    const messageIds = { ...(campaign.messageIds ?? {}) };
    sendResults.forEach(r => { if (r.success && r.messageId) messageIds[r.to.toLowerCase()] = r.messageId; });

    await saveCampaign({ ...campaign, messageIds, followUpSentAt: Date.now() });
    results.push({ campaignId: campaign.id, trackTitle: campaign.trackTitle, sent: sentCount });
  }

  return NextResponse.json({ ok: true, processed: due.length, results });
}
