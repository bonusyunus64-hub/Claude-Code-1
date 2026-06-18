import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getArtistsByGenres, Artist } from '@/lib/roster';

interface SendPayload {
  trackTitle: string;
  driveLink: string;
  genres: string[];
  emailTemplate: string;
  senderName: string;
  minAudience?: number;
  maxAudience?: number;
  gender?: string;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function buildEmailsForArtist(
  artist: Artist,
  trackTitle: string,
  driveLink: string,
  emailTemplate: string,
  senderName: string
): { to: string; subject: string; body: string }[] {
  return artist.managerEmails.map((email, idx) => {
    const managerName = artist.managerNames[idx] || 'there';
    const body = renderTemplate(emailTemplate, {
      managerName,
      artistName: artist.name,
      trackTitle,
      driveLink,
      senderName,
      managementCompany: artist.managementCompany,
    });
    const subject = renderTemplate(
      `Music Submission: {{trackTitle}} for {{artistName}}`,
      { trackTitle, artistName: artist.name }
    );
    return { to: email, subject, body };
  });
}

export async function POST(req: NextRequest) {
  const { trackTitle, driveLink, genres, emailTemplate, senderName, minAudience, maxAudience, gender } =
    await req.json() as SendPayload;

  if (!trackTitle || !driveLink || !genres?.length || !emailTemplate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const { ZOHO_USER, ZOHO_PASS } = process.env;
  if (!ZOHO_USER || !ZOHO_PASS) {
    return NextResponse.json(
      { error: 'Email credentials not configured. Set ZOHO_USER and ZOHO_PASS in .env.local.' },
      { status: 500 }
    );
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: ZOHO_USER, pass: ZOHO_PASS },
  });

  const artists = getArtistsByGenres(genres, minAudience ?? 0, maxAudience ?? 0, gender ?? '');
  const allMessages = artists.flatMap(a =>
    buildEmailsForArtist(a, trackTitle, driveLink, emailTemplate, senderName)
  );

  const results: { to: string; success: boolean; error?: string }[] = [];

  for (const msg of allMessages) {
    try {
      await transporter.sendMail({
        from: `"${senderName || 'TrackPitch'}" <${ZOHO_USER}>`,
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
