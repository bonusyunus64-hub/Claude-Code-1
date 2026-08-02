import type { CampaignRecord } from '@/lib/campaigns';
import { renderTemplate } from '@/lib/emailTemplate';
import type { OutboundMessage } from '@/lib/mailSend';

export const DEFAULT_FOLLOWUP_DAYS = 5;

/**
 * Whether a campaign is due for a follow-up reminder: a Song Demos send (the
 * only type with a follow-up template), old enough, not already followed up,
 * not mid-send, and with enough recorded to actually build one (driveLink wasn't
 * tracked on campaigns before this feature, so older records can't be re-rendered).
 *
 * Nothing here sends anything — sending is manual now, triggered by the user from
 * the dashboard. This just decides whether the dashboard should remind them a
 * campaign is ready for a nudge; app/api/cron/refresh-replies/route.ts is what
 * keeps `campaign.responded` accurate in the background so that reminder (and
 * nonRespondedRecipients below) reflect real replies rather than stale data.
 */
export function isCampaignDueForFollowUp(campaign: CampaignRecord, cutoffMs: number): boolean {
  if (campaign.type !== 'demos') return false;
  if (campaign.followUpSentAt) return false;
  if (campaign.pendingSend) return false;
  if (!campaign.accountId || !campaign.driveLink) return false;
  return new Date(campaign.date).getTime() <= cutoffMs;
}

/**
 * Recipients who neither replied nor bounced nor landed on Do Not Contact nor already got a
 * follow-up — the ones still worth a nudge. `blacklist` should be the Do Not
 * Contact list (lowercased); skipping it isn't optional, since following up with
 * someone already on the Do Not Contact list is the one mistake this list exists to prevent.
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

/**
 * Merges addresses into one of a campaign's lowercased address lists (`followUpSent`,
 * `bounced`), deduplicated. Used by the manual follow-up send path to persist
 * progress after a batch without repeating this normalization inline.
 */
export function mergeEmailList(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set((existing ?? []).map(e => e.toLowerCase()));
  for (const email of additions) merged.add(email.toLowerCase());
  return Array.from(merged);
}
