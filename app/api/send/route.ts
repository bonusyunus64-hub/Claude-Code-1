import { NextRequest, NextResponse } from 'next/server';
import { getArtistsByGenres, Artist } from '@/lib/roster';
import { renderTemplate } from '@/lib/emailTemplate';
import { resolveSmtpConfig, createTransport, sendMessages, paginate, DEFAULT_SEND_BATCH_SIZE, FromAccount } from '@/lib/mailSend';

interface SendPayload {
  trackTitle: string;
  driveLink: string;
  genres: string[];
  emailTemplate: string;
  subjectTemplate?: string;
  senderName: string;
  signOff?: string;
  signOffImage?: string;
  minAudience?: number;
  maxAudience?: number;
  gender?: string;
  artistType?: string;
  minInstagram?: number;
  maxInstagram?: number;
  matchMode?: 'any' | 'all';
  fromAccount?: FromAccount;
  sendDelay?: number;
  blacklist?: string[];
  customContacts?: { artistName: string; managerName: string; managerEmail: string }[];
  offset?: number;
  limit?: number;
}

function buildEmailsForArtist(
  artist: Artist,
  trackTitle: string,
  driveLink: string,
  emailTemplate: string,
  subjectTemplate: string,
  signOff: string,
  senderName: string
): { to: string; subject: string; body: string }[] {
  return artist.managerEmails.map((email, idx) => {
    const managerName = artist.managerNames[idx] || 'there';
    const vars = {
      managerName,
      artistName: artist.name,
      trackTitle,
      driveLink,
      senderName,
      managementCompany: artist.managementCompany,
    };
    const bodyParts = [renderTemplate(emailTemplate, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
    const body = bodyParts.join('\n\n');
    const subject = renderTemplate(subjectTemplate, vars);
    return { to: email, subject, body };
  });
}

export async function POST(req: NextRequest) {
  const {
    trackTitle, driveLink, genres, emailTemplate, subjectTemplate, senderName,
    signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode, fromAccount,
    sendDelay, blacklist, customContacts, offset, limit,
  } = await req.json() as SendPayload;

  const subjectTpl = subjectTemplate?.trim() || `Music Submission: {{trackTitle}} for {{artistName}}`;

  if (!trackTitle || !driveLink || !emailTemplate || (!genres?.length && !customContacts?.length)) {
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

  const artists = genres?.length
    ? getArtistsByGenres(genres, minAudience ?? 0, maxAudience ?? 0, gender ?? '', artistType ?? '', minInstagram ?? 0, maxInstagram ?? 0, matchMode ?? 'any')
    : [];

  const artistMessages = artists.flatMap(a =>
    buildEmailsForArtist(a, trackTitle, driveLink, emailTemplate, subjectTpl, signOff ?? '', senderName)
  );

  const customMessages = (customContacts ?? []).map(cc => {
    const vars = { managerName: cc.managerName || 'there', artistName: cc.artistName, trackTitle, driveLink, senderName, managementCompany: '' };
    const bodyParts = [renderTemplate(emailTemplate, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
    const body = bodyParts.join('\n\n');
    const subject = renderTemplate(subjectTpl, vars);
    return { to: cc.managerEmail, subject, body };
  });

  const bl = (blacklist ?? []).map(e => e.toLowerCase());
  const allMessages = [...artistMessages, ...customMessages].filter(msg => !bl.includes(msg.to.toLowerCase()));

  const { batch, total, nextOffset } = paginate(allMessages, offset ?? 0, limit ?? DEFAULT_SEND_BATCH_SIZE);
  const results = await sendMessages(transporter, batch, { fromName, fromEmail: fromEmail as string, signOffImage, sendDelay });

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({ sent, failed, total, batchTotal: batch.length, nextOffset, results });
}
