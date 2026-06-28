import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

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
}

export async function POST(req: NextRequest) {
  const { to, fromAccount } = await req.json() as TestEmailPayload;

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

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: 'Email Test - TrackPitch',
      text: `If you're reading this, your email connection is working successfully.\n\nHead back to TrackPitch here: ${siteUrl}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:520px">
  <p>If you're reading this, your email connection is working successfully.</p>
  <p>Head back to TrackPitch here: <a href="${siteUrl}" style="color:#7c3aed">${siteUrl}</a></p>
</div>`,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
