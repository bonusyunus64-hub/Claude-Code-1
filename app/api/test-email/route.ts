import { NextRequest, NextResponse } from 'next/server';
import { renderTemplate, textToHtml } from '@/lib/emailTemplate';
import { resolveSmtpConfig, createTransport, formatFromHeader } from '@/lib/mailSend';
import { resolveAccount } from '@/lib/accounts';
import { recordSends } from '@/lib/sendQuota';
import { readJsonBody } from '@/lib/readJsonBody';

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
  const parsed = await readJsonBody<TestEmailPayload>(req);
  if (!parsed.ok) return parsed.response;

  const {
    to, accountId, emailTemplate, subjectTemplate, signOff, signOffImage, senderName, trackTitle, driveLink,
    managerName, artistName, managementCompany, pronoun,
  } = parsed.data;

  if (!to) {
    return NextResponse.json({ error: 'Recipient email is required.' }, { status: 400 });
  }

  const { account, error: accountError } = await resolveAccount(accountId);
  if (accountError) return NextResponse.json({ error: accountError }, { status: 400 });

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
    from: formatFromHeader(fromName, fromEmail as string),
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
    // Not routed through sendMessagesPooled like the bulk paths: this builds its own
    // one-off mailOptions (test subject prefix, sample-variable rendering, no
    // signature handling) rather than an OutboundMessage batch. It still needs the
    // explicit close in the finally below, though — createTransport pools now, so the
    // socket outlives the send and would otherwise keep the function alive after the
    // response has already gone out.
    // Recorded the same way /api/send and lib/broadcastSend.ts count a real send
    // (see lib/sendQuota.ts) — this goes out over the same real SMTP account, so
    // leaving it uncounted would let test sends quietly push the account past
    // Zoho's actual rate limit. Deliberately NOT gated behind checkCapAllows,
    // though: this is a single, hand-triggered diagnostic email, not a bulk send
    // that could run away, and refusing to let someone verify their SMTP config
    // works just because the day's bulk-send cap is exhausted would be a
    // confusing failure mode of its own. It still counts toward the cap for
    // whoever sends after it.
    await recordSends(1, account?.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    transporter.close();
  }
}
