import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { renderTemplate, textToHtml } from '@/lib/emailTemplate';

interface FromAccount {
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

interface TestEmailPayload {
  to: string;
  fromAccount?: FromAccount;
  emailTemplate?: string;
  signOff?: string;
  signOffImage?: string;
  senderName?: string;
  trackTitle?: string;
  driveLink?: string;
}

export async function POST(req: NextRequest) {
  const { to, fromAccount, emailTemplate, signOff, signOffImage, senderName, trackTitle, driveLink } =
    await req.json() as TestEmailPayload;

  if (!to) {
    return NextResponse.json({ error: 'Recipient email is required.' }, { status: 400 });
  }

  const smtpUser = fromAccount?.smtpUser || process.env.ZOHO_USER;
  const smtpPass = fromAccount?.smtpPass || process.env.ZOHO_PASS;
  const smtpHost = fromAccount?.smtpHost || 'smtp.zoho.com';
  const smtpPort = fromAccount?.smtpPort || 465;
  const fromName = fromAccount?.name || 'TrackPitch';
  const fromEmail = fromAccount?.email || smtpUser;

  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one above.' },
      { status: 500 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://music-distribution-website.vercel.app';

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  let subject = 'Email Test - TrackPitch';
  let text = `If you're reading this, your email connection is working successfully.\n\nHead back to TrackPitch here: ${siteUrl}`;
  let html: string | undefined = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:520px">
  <p>If you're reading this, your email connection is working successfully.</p>
  <p>Head back to TrackPitch here: <a href="${siteUrl}" style="color:#7c3aed">${siteUrl}</a></p>
</div>`;

  if (emailTemplate?.trim()) {
    const vars = {
      managerName: 'there',
      artistName: 'Sample Artist',
      trackTitle: trackTitle?.trim() || 'Your Track Title',
      driveLink: driveLink?.trim() || 'https://drive.google.com/your-link',
      senderName: senderName?.trim() || 'Your Name',
      managementCompany: 'Sample Management',
    };
    const bodyParts = [renderTemplate(emailTemplate, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
    text = bodyParts.join('\n\n');
    subject = `[TEST] ${renderTemplate('Music Submission: {{trackTitle}} for {{artistName}}', vars)}`;
    html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${textToHtml(text)}</div>`;
  }

  const mailOptions: Parameters<typeof transporter.sendMail>[0] = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    html,
  };

  if (emailTemplate?.trim() && signOffImage) {
    const imageData = signOffImage.replace(/^data:image\/\w+;base64,/, '');
    mailOptions.html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${textToHtml(text)}<img src="cid:signature@trackpitch" alt="Signature" style="max-width:600px;display:block;margin-top:8px"></div>`;
    mailOptions.attachments = [{ filename: 'signature.png', content: Buffer.from(imageData, 'base64'), cid: 'signature@trackpitch' }];
  }

  try {
    await transporter.sendMail(mailOptions);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
