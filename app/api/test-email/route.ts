import { NextRequest, NextResponse } from 'next/server';
import { renderTemplate, textToHtml } from '@/lib/emailTemplate';
import { resolveSmtpConfig, createTransport } from '@/lib/mailSend';
import { getAccount } from '@/lib/accounts';

interface TestEmailPayload {
  to: string;
  accountId?: string;
  emailTemplate?: string;
  subjectTemplate?: string;
  signOff?: string;
  signOffImage?: string;
  senderName?: string;
  trackTitle?: string;
  driveLink?: string;
  managerName?: string;
  artistName?: string;
  managementCompany?: string;
  pronoun?: string;
}

export async function POST(req: NextRequest) {
  const {
    to, accountId, emailTemplate, subjectTemplate, signOff, signOffImage, senderName, trackTitle, driveLink,
    managerName, artistName, managementCompany, pronoun,
  } = await req.json() as TestEmailPayload;

  if (!to) {
    return NextResponse.json({ error: 'Recipient email is required.' }, { status: 400 });
  }

  const account = accountId ? await getAccount(accountId) : null;
  if (accountId && !account) {
    return NextResponse.json(
      { error: 'That email account is no longer available. Re-add it in Account settings.' },
      { status: 400 }
    );
  }

  const { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail } = resolveSmtpConfig(account ?? undefined, undefined);

  if (!smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: 'No email account configured. Add one above.' },
      { status: 500 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://music-distribution-website.vercel.app';

  const transporter = createTransport({ smtpHost, smtpPort, smtpUser, smtpPass });

  let subject = 'Email Test - TrackPitch';
  let text = `If you're reading this, your email connection is working successfully.\n\nHead back to TrackPitch here: ${siteUrl}`;
  let html: string | undefined = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:520px">
  <p>If you're reading this, your email connection is working successfully.</p>
  <p>Head back to TrackPitch here: <a href="${siteUrl}" style="color:#7c3aed">${siteUrl}</a></p>
</div>`;

  if (emailTemplate?.trim()) {
    const vars = {
      managerName: managerName?.trim() || 'there',
      artistName: artistName?.trim() || 'Sample Artist',
      trackTitle: trackTitle?.trim() || 'Your Track Title',
      driveLink: driveLink?.trim() || 'https://drive.google.com/your-link',
      senderName: senderName?.trim() || 'Your Name',
      managementCompany: managementCompany?.trim() || 'Sample Management',
      pronoun: pronoun?.trim() || 'they',
    };
    const bodyParts = [renderTemplate(emailTemplate, vars)];
    if (signOff?.trim()) bodyParts.push(renderTemplate(signOff, vars));
    text = bodyParts.join('\n\n');
    const subjectTpl = subjectTemplate?.trim() || 'Music Submission: {{trackTitle}} for {{artistName}}';
    subject = `[TEST] ${renderTemplate(subjectTpl, vars)}`;
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
