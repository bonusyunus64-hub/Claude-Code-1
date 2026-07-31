import { NextResponse } from 'next/server';
import { renderTemplate } from '@/lib/emailTemplate';
import {
  resolveSmtpConfig, sendMessagesPooled, paginate, dedupeByRecipient,
  DEFAULT_SEND_BATCH_SIZE, OutboundMessage,
} from '@/lib/mailSend';
import { resolveAccount } from '@/lib/accounts';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';
import { getBlacklist } from '@/lib/unsubscribe';

/** A filtered target (radio station or playlist curator) worth pitching. */
export interface BroadcastTarget {
  name: string;
  emails: string[];
}

export interface BroadcastSendPayload {
  trackTitle: string;
  driveLink: string;
  emailTemplate: string;
  subjectTemplate?: string;
  senderName: string;
  signOff?: string;
  signOffImage?: string;
  accountId?: string;
  sendDelay?: number;
  blacklist?: string[];
  /** Session-local exclusions the client already knows about (e.g. addresses attempted
   *  in an earlier round of this same batched send) — see sendInBatches in
   *  app/dashboard/utils.ts. Unioned into the server blacklist the same way `blacklist` is. */
  excludeEmails?: string[];
  threadIds?: Record<string, string>;
  offset?: number;
  limit?: number;
}

/**
 * Shared POST handler for the radio-send and playlist-send routes, which used to
 * be near-duplicate files differing only in how targets are filtered (stations
 * vs curators) and which template variable carries the target's name.
 */
export async function sendBroadcast(
  payload: BroadcastSendPayload,
  targets: BroadcastTarget[],
  nameVar: 'stationName' | 'curatorName'
): Promise<NextResponse> {
  const {
    trackTitle, driveLink, emailTemplate, subjectTemplate, senderName,
    signOff, signOffImage, accountId, sendDelay, blacklist, excludeEmails, threadIds, offset, limit,
  } = payload;

  if (!trackTitle || !driveLink || !emailTemplate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const subjectTpl = subjectTemplate?.trim() || `Music Submission: {{trackTitle}} for {{${nameVar}}}`;

  const { account, error: accountError } = await resolveAccount(accountId);
  if (accountError) return NextResponse.json({ error: accountError }, { status: 400 });

  const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(account ?? undefined, senderName);
  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one in the Email Template tab.' },
      { status: 500 }
    );
  }

  // The client-supplied lists cover session-local exclusions (e.g. "just sent to
  // this address", or every address a batched send has already attempted — see
  // sendInBatches); the server list is the authoritative Do Not Contact record
  // from unsubscribes, which a stale client tab can't be trusted to know about.
  const serverBlacklist = await getBlacklist();
  const bl = new Set([...(blacklist ?? []), ...(excludeEmails ?? []), ...serverBlacklist].map(e => e.toLowerCase()));

  const builtMessages: OutboundMessage[] = targets.flatMap(target =>
    target.emails
      .filter(email => !bl.has(email.toLowerCase()))
      .map(email => {
        const vars: Record<string, string> = { [nameVar]: target.name, trackTitle, driveLink, senderName };
        const bodyParts = [renderTemplate(emailTemplate, vars)];
        if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
        const body = bodyParts.join('\n\n');
        const subject = renderTemplate(subjectTpl, vars);
        return { to: email, subject, body };
      })
  );

  // Stations/curators frequently share one inbox across several shows or
  // playlists — one email each.
  const allMessages = dedupeByRecipient(builtMessages).map(msg => {
    const threadId = threadIds?.[msg.to.toLowerCase()];
    return threadId ? { ...msg, inReplyTo: threadId } : msg;
  });

  const { batch, total, nextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);

  const capCheck = await checkCapAllows(batch.length, accountId);
  if (!capCheck.ok) return NextResponse.json({ error: capCheck.error }, { status: 429 });

  const results = await sendMessagesPooled(
    { smtpHost, smtpPort, smtpUser, smtpPass },
    batch,
    { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay }
  );

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  await recordSends(sent, accountId);

  return NextResponse.json({ sent, failed, total, batchTotal: batch.length, nextOffset, results });
}
