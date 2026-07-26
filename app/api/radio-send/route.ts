import { NextRequest, NextResponse } from 'next/server';
import { filterRadioStations } from '@/lib/radio';
import { renderTemplate } from '@/lib/emailTemplate';
import { resolveSmtpConfig, createTransport, sendMessages, paginate, DEFAULT_SEND_BATCH_SIZE, FromAccount } from '@/lib/mailSend';

interface RadioSendPayload {
  trackTitle: string;
  driveLink: string;
  genres: string[];
  locations: string[];
  emailTemplate: string;
  subjectTemplate?: string;
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
    trackTitle, driveLink, genres, locations, emailTemplate, subjectTemplate, senderName,
    signOff, signOffImage, matchMode, fromAccount,
    sendDelay, blacklist, offset, limit,
  } = await req.json() as RadioSendPayload;

  if (!trackTitle || !driveLink || !emailTemplate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const subjectTpl = subjectTemplate?.trim() || `Music Submission: {{trackTitle}} for {{stationName}}`;

  const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(fromAccount, senderName);

  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one in the Email Template tab.' },
      { status: 500 }
    );
  }

  const transporter = createTransport({ smtpHost, smtpPort, smtpUser, smtpPass });

  const stations = filterRadioStations(genres ?? [], locations ?? [], matchMode ?? 'any');
  const bl = (blacklist ?? []).map(e => e.toLowerCase());

  const allMessages = stations.flatMap(station =>
    station.emails
      .filter(email => !bl.includes(email.toLowerCase()))
      .map(email => {
        const vars = { stationName: station.name, trackTitle, driveLink, senderName };
        const bodyParts = [renderTemplate(emailTemplate, vars)];
        if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
        const body = bodyParts.join('\n\n');
        const subject = renderTemplate(subjectTpl, vars);
        return { to: email, subject, body };
      })
  );

  const { batch, total, nextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);
  const results = await sendMessages(transporter, batch, { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay });

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({ sent, failed, total, batchTotal: batch.length, nextOffset, results });
}
