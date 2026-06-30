import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { filterPlaylistCurators } from '@/lib/playlists';

interface FromAccount {
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

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
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textToHtml(text: string): string {
  return text
    .split('\n\n')
    .map(p => `<p style="margin:0 0 12px 0">${p.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('');
}

export async function POST(req: NextRequest) {
  const {
    trackTitle, driveLink, genres, platforms, emailTemplate, senderName,
    signOff, signOffImage, matchMode, fromAccount,
    sendDelay, blacklist,
  } = await req.json() as PlaylistSendPayload;

  if (!trackTitle || !driveLink || !emailTemplate) {
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

  const curators = filterPlaylistCurators(genres ?? [], platforms ?? [], matchMode ?? 'any');
  const bl = (blacklist ?? []).map(e => e.toLowerCase());
  const results: { to: string; success: boolean; error?: string }[] = [];
  let emailIndex = 0;

  for (const curator of curators) {
    for (const email of curator.emails) {
      if (bl.includes(email.toLowerCase())) continue;
      if (emailIndex > 0 && sendDelay && sendDelay > 0) await new Promise<void>(r => setTimeout(r, sendDelay));
      emailIndex++;
      const vars = { curatorName: curator.name, trackTitle, driveLink, senderName };
      const bodyParts = [renderTemplate(emailTemplate, vars)];
      if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
      const body = bodyParts.join('\n\n');
      const subject = renderTemplate(
        `Music Submission: {{trackTitle}} for {{curatorName}}`,
        { trackTitle, curatorName: curator.name }
      );

      try {
        const mailOptions: Parameters<typeof transporter.sendMail>[0] = {
          from: `"${fromName}" <${fromEmail}>`,
          to: email,
          subject,
          text: body,
        };
        if (signOffImage) {
          const imageData = signOffImage.replace(/^data:image\/\w+;base64,/, '');
          mailOptions.html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${textToHtml(body)}<img src="cid:signature@trackpitch" alt="Signature" style="max-width:600px;display:block;margin-top:8px"></div>`;
          mailOptions.attachments = [{ filename: 'signature.png', content: Buffer.from(imageData, 'base64'), cid: 'signature@trackpitch' }];
        }
        await transporter.sendMail(mailOptions);
        results.push({ to: email, success: true });
      } catch (err) {
        results.push({ to: email, success: false, error: String(err) });
      }
    }
  }

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({ sent, failed, total: results.length, results });
}
