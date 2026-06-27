import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getArtistsByGenres, Artist } from '@/lib/roster';

interface FromAccount {
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

interface SendPayload {
  trackTitle: string;
  driveLink: string;
  genres: string[];
  emailTemplate: string;
  senderName: string;
  signOff?: string;
  minAudience?: number;
  maxAudience?: number;
  gender?: string;
  fromAccount?: FromAccount;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function buildEmailsForArtist(
  artist: Artist,
  trackTitle: string,
  driveLink: string,
  emailTemplate: string,
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
    const subject = renderTemplate(
      `Music Submission: {{trackTitle}} for {{artistName}}`,
      { trackTitle, artistName: artist.name }
    );
    return { to: email, subject, body };
  });
}

export async function POST(req: NextRequest) {
  const {
    trackTitle, driveLink, genres, emailTemplate, senderName,
    signOff, minAudience, maxAudience, gender, fromAccount,
  } = await req.json() as SendPayload;

  if (!trackTitle || !driveLink || !genres?.length || !emailTemplate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const smtpUser = fromAccount?.smtpUser || process.env.ZOHO_USER;
  const smtpPass = fromAccount?.smtpPass || process.env.ZOHO_PASS;
  const smtpHost = fromAccount?.smtpHost || 'smtp.zoho.com';
  const smtpPort = fromAccount?.smtpPort || 465;
  const fromName = fromAccount?.name || senderName || 'TrackPitch';
  const fromEmail = fromAccount?.email || smtpUser;

  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one in the Email Template tab.' },
      { status: 500 }
    );
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const artists = getArtistsByGenres(genres, minAudience ?? 0, maxAudience ?? 0, gender ?? '');
  const allMessages = artists.flatMap(a =>
    buildEmailsForArtist(a, trackTitle, driveLink, emailTemplate, signOff ?? '', senderName)
  );

  const results: { to: string; success: boolean; error?: string }[] = [];

  for (const msg of allMessages) {
    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
      });
      results.push({ to: msg.to, success: true });
    } catch (err) {
      results.push({ to: msg.to, success: false, error: String(err) });
    }
  }

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({ sent, failed, total: results.length, results });
}
