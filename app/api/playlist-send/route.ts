import { NextRequest, NextResponse } from 'next/server';
import { filterPlaylistCurators } from '@/lib/playlists';
import { renderTemplate } from '@/lib/emailTemplate';
import {
  resolveSmtpConfig, createTransport, sendMessages, paginate, dedupeByRecipient,
  DEFAULT_SEND_BATCH_SIZE, OutboundMessage,
} from '@/lib/mailSend';
import { resolveAccount } from '@/lib/accounts';
import { checkCapAllows, recordSends } from '@/lib/sendQuota';

interface PlaylistSendPayload {
  trackTitle: string;
  driveLink: string;
  genres: string[];
  platforms: string[];
  emailTemplate: string;
  subjectTemplate?: string;
  senderName: string;
  signOff?: string;
  signOffImage?: string;
  matchMode?: 'any' | 'all';
  accountId?: string;
  sendDelay?: number;
  blacklist?: string[];
  threadIds?: Record<string, string>;
  offset?: number;
  limit?: number;
}

export async function POST(req: NextRequest) {
  const {
    trackTitle, driveLink, genres, platforms, emailTemplate, subjectTemplate, senderName,
    signOff, signOffImage, matchMode, accountId,
    sendDelay, blacklist, threadIds, offset, limit,
  } = await req.json() as PlaylistSendPayload;

  if (!trackTitle || !driveLink || !emailTemplate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const subjectTpl = subjectTemplate?.trim() || `Music Submission: {{trackTitle}} for {{curatorName}}`;

  const { account, error: accountError } = await resolveAccount(accountId);
  if (accountError) return NextResponse.json({ error: accountError }, { status: 400 });

  const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(account ?? undefined, senderName);

  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one in the Email Template tab.' },
      { status: 500 }
    );
  }

  const curators = filterPlaylistCurators(genres ?? [], platforms ?? [], matchMode ?? 'any');
  const bl = (blacklist ?? []).map(e => e.toLowerCase());

  const builtMessages: OutboundMessage[] = curators.flatMap(curator =>
    curator.emails
      .filter(email => !bl.includes(email.toLowerCase()))
      .map(email => {
        const vars = { curatorName: curator.name, trackTitle, driveLink, senderName };
        const bodyParts = [renderTemplate(emailTemplate, vars)];
        if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
        const body = bodyParts.join('\n\n');
        const subject = renderTemplate(subjectTpl, vars);
        return { to: email, subject, body };
      })
  );

  // One curator often runs several playlists off a single contact address.
  const allMessages = dedupeByRecipient(builtMessages).map(msg => {
    const threadId = threadIds?.[msg.to.toLowerCase()];
    return threadId ? { ...msg, inReplyTo: threadId } : msg;
  });

  const { batch, total, nextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);

  const capCheck = await checkCapAllows(batch.length);
  if (!capCheck.ok) return NextResponse.json({ error: capCheck.error }, { status: 429 });

  const transporter = createTransport({ smtpHost, smtpPort, smtpUser, smtpPass });
  const results = await sendMessages(transporter, batch, { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay });

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  await recordSends(sent, accountId);

  return NextResponse.json({ sent, failed, total, batchTotal: batch.length, nextOffset, results });
}
