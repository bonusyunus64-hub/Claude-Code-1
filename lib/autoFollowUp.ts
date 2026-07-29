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

/** Recipients who neither replied nor bounced — the ones still worth a nudge. */
export function nonRespondedRecipients(campaign: CampaignRecord): string[] {
  const responded = new Set((campaign.responded ?? []).map(e => e.toLowerCase()));
  const bounced = new Set((campaign.bounced ?? []).map(e => e.toLowerCase()));
  return campaign.emails.filter(e => !responded.has(e.toLowerCase()) && !bounced.has(e.toLowerCase()));
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
