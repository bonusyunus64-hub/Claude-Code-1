import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getArtistsByGenres, Artist } from '@/lib/roster';
import { renderTemplate, textToHtml } from '@/lib/emailTemplate';

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
    signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode, fromAccount,
    sendDelay, blacklist, customContacts,
  } = await req.json() as SendPayload;

  if (!trackTitle || !driveLink || !emailTemplate || (!genres?.length && !customContacts?.length)) {
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

  const artists = genres?.length
    ? getArtistsByGenres(genres, minAudience ?? 0, maxAudience ?? 0, gender ?? '', artistType ?? '', minInstagram ?? 0, maxInstagram ?? 0, matchMode ?? 'any')
    : [];

  const artistMessages = artists.flatMap(a =>
    buildEmailsForArtist(a, trackTitle, driveLink, emailTemplate, signOff ?? '', senderName)
  );

  const customMessages = (customContacts ?? []).map(cc => {
    const vars = { managerName: cc.managerName || 'there', artistName: cc.artistName, trackTitle, driveLink, senderName, managementCompany: '' };
    const bodyParts = [renderTemplate(emailTemplate, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
    const body = bodyParts.join('\n\n');
    const subject = renderTemplate(`Music Submission: {{trackTitle}} for {{artistName}}`, { trackTitle, artistName: cc.artistName });
    return { to: cc.managerEmail, subject, body };
  });

  const bl = (blacklist ?? []).map(e => e.toLowerCase());
  const allMessages = [...artistMessages, ...customMessages].filter(msg => !bl.includes(msg.to.toLowerCase()));

  const results: { to: string; success: boolean; error?: string }[] = [];

  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i];
    if (i > 0 && sendDelay && sendDelay > 0) await new Promise<void>(r => setTimeout(r, sendDelay));
    try {
      const mailOptions: Parameters<typeof transporter.sendMail>[0] = {
        from: `"${fromName}" <${fromEmail}>`,
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
      };
      if (signOffImage) {
        const imageData = signOffImage.replace(/^data:image\/\w+;base64,/, '');
        mailOptions.html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${textToHtml(msg.body)}<img src="cid:signature@trackpitch" alt="Signature" style="max-width:600px;display:block;margin-top:8px"></div>`;
        mailOptions.attachments = [{ filename: 'signature.png', content: Buffer.from(imageData, 'base64'), cid: 'signature@trackpitch' }];
      }
      await transporter.sendMail(mailOptions);
      results.push({ to: msg.to, success: true });
    } catch (err) {
      results.push({ to: msg.to, success: false, error: String(err) });
    }
  }

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({ sent, failed, total: results.length, results });
}
