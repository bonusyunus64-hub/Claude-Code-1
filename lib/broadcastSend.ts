import { NextResponse } from 'next/server';
import { renderTemplate } from '@/lib/emailTemplate';
import {
  resolveSmtpConfig, sendMessagesPooled, paginate, dedupeByRecipient,
  DEFAULT_SEND_BATCH_SIZE, OutboundMessage,
} from '@/lib/mailSend';
import { resolveAccount } from '@/lib/accounts';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';
import { getBlacklist } from '@/lib/doNotContact';
import { defaultBroadcastSubject } from '@/lib/emailDefaults';
import { MAX_CAMPAIGN_RECIPIENTS } from '@/lib/sendLimits';

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

  const subjectTpl = subjectTemplate?.trim() || defaultBroadcastSubject(nameVar);

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
  // from bounces and hand-added entries, which a stale client tab can't be trusted to know about.
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

  // Hard blast-radius ceiling (operator-chosen) — see MAX_CAMPAIGN_RECIPIENTS' doc
  // comment in lib/sendLimits.ts and lib/demosSend.ts's identical check for the
  // full reasoning: checked against the FULL matched target list (post-dedup/
  // blacklist, exactly what pagination below runs over), before paginate/
  // checkCapAllows/recordSends, and rebuilt from scratch every request so it can't
  // be walked around by paging with a rising offset. Wording matches this
  // channel's own vocabulary — "stations" for the radio route, "curators" for the
  // playlist-curator route — rather than the generic "recipients" demos uses.
  if (allMessages.length > MAX_CAMPAIGN_RECIPIENTS) {
    const noun = nameVar === 'stationName' ? 'stations' : 'curators';
    return NextResponse.json({
      error: `Your filters match ${allMessages.length} ${noun}. A campaign can send to at most ${MAX_CAMPAIGN_RECIPIENTS} — narrow your filters and try again.`,
    }, { status: 400 });
  }

  const { batch, total, nextOffset: pageNextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);

  const capCheck = await checkCapAllows(batch.length, accountId);
  if (capCheck.allowed === 0) return NextResponse.json({ error: capCheck.error }, { status: 429 });

  // The cap may allow fewer than the full page (e.g. 5 of a 10-message batch).
  // Trim to what's actually allowed and make sure the untrimmed remainder isn't
  // dropped: since checkCapAllows clamps `allowed` to at most `batch.length`, a
  // partial allowance means there's more of this same page left over, so
  // nextOffset must point past only what actually went out rather than the
  // full page — the client pages by an exclusion set built from `results`
  // (see sendInBatches in app/dashboard/utils.ts), so a `results` entry only
  // for what was actually sent, plus a non-null nextOffset, is what makes the
  // leftover get retried on the next request instead of silently skipped.
  const sendBatch = capCheck.allowed < batch.length ? batch.slice(0, capCheck.allowed) : batch;
  const nextOffset = capCheck.allowed < batch.length ? (offset ?? 0) + sendBatch.length : pageNextOffset;

  const results = await sendMessagesPooled(
    { smtpHost, smtpPort, smtpUser, smtpPass },
    sendBatch,
    { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay }
  );

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  await recordSends(sent, accountId);

  return NextResponse.json({ sent, failed, total, batchTotal: sendBatch.length, nextOffset, results });
}
