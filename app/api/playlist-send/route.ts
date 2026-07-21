import { NextRequest, NextResponse } from 'next/server';
import { filterPlaylistCurators } from '@/lib/playlists';
import { renderTemplate } from '@/lib/emailTemplate';
import { resolveSmtpConfig, createTransport, sendMessages, paginate, DEFAULT_SEND_BATCH_SIZE, FromAccount } from '@/lib/mailSend';

interface PlaylistSendPayload {
  trackTitle: string;
  driveLink: string;
  genres: string[];
  platforms: string[];
  emailTemplate: string;
  senderName: string;
  signOff?: string;
  signOffImage?: string;
  matchMode?: 'any' | 'all';
  fromAccount?: FromAccount;
  sendDelay?: number;
  blacklist?: string[];
  offset?: number;
  limit?: number;
}

export async function POST(req: NextRequest) {
  const {
    trackTitle, driveLink, genres, platforms, emailTemplate, senderName,
    signOff, signOffImage, matchMode, fromAccount,
    sendDelay, blacklist, offset, limit,
  } = await req.json() as PlaylistSendPayload;

  if (!trackTitle || !driveLink || !emailTemplate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(fromAccount, senderName);

  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one in the Email Template tab.' },
      { status: 500 }
    );
  }

  const transporter = createTransport({ smtpHost, smtpPort, smtpUser, smtpPass });

  const curators = filterPlaylistCurators(genres ?? [], platforms ?? [], matchMode ?? 'any');
  const bl = (blacklist ?? []).map(e => e.toLowerCase());

  const allMessages = curators.flatMap(curator =>
    curator.emails
      .filter(email => !bl.includes(email.toLowerCase()))
      .map(email => {
        const vars = { curatorName: curator.name, trackTitle, driveLink, senderName };
        const bodyParts = [renderTemplate(emailTemplate, vars)];
        if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
        const body = bodyParts.join('\n\n');
        const subject = renderTemplate(
          `Music Submission: {{trackTitle}} for {{curatorName}}`,
          { trackTitle, curatorName: curator.name }
        );
        return { to: email, subject, body };
      })
  );

  const { batch, total, nextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);
  const results = await sendMessages(transporter, batch, { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay });

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({ sent, failed, total, batchTotal: batch.length, nextOffset, results });
}
