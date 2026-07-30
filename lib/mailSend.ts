import nodemailer from 'nodemailer';
import { textToHtml } from '@/lib/emailTemplate';
import { buildUnsubscribeUrl, buildUnsubscribeApiUrl } from '@/lib/unsubscribe';
import type { OutboundMessage } from '@/lib/recipients';

// Same fallback used by /api/test-email — the real deployed URL when NEXT_PUBLIC_BASE_URL
// isn't set, so unsubscribe links in outbound mail are never accidentally localhost.
const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://music-distribution-website.vercel.app';

export interface FromAccount {
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

export type { OutboundMessage } from '@/lib/recipients';

export interface SendResult {
  to: string;
  success: boolean;
  error?: string;
  /**
   * Set on a failure that will never succeed on a retry — the address was rejected
   * outright (5xx, bad envelope) rather than lost to a dropped connection. Callers
   * that decide whether to try an address again need this: a synchronous rejection
   * generates no bounce message, so nothing downstream (lib/checkReplies.ts) will
   * ever discover the address is dead on its behalf.
   */
  permanent?: boolean;
  /** The Message-ID the server assigned, stored so a later follow-up can thread onto it. */
  messageId?: string;
}

export function resolveSmtpConfig(fromAccount: FromAccount | undefined, senderName: string | undefined) {
  const smtpUser = fromAccount?.smtpUser || process.env.ZOHO_USER;
  const smtpPass = fromAccount?.smtpPass || process.env.ZOHO_PASS;
  const smtpHost = fromAccount?.smtpHost || 'smtp.zoho.com';
  const smtpPort = fromAccount?.smtpPort || 465;
  const fromName = fromAccount?.name || senderName || 'TrackPitch';
  const fromEmail = fromAccount?.email || smtpUser;
  return { smtpUser, smtpPass, smtpHost, smtpPort, fromName, fromEmail };
}

/**
 * Builds a RFC 5322 `From` header value. The display name is only wrapped in a
 * quoted-string when it needs one; RFC 5322 §3.2.4 says a quoted-string only
 * requires escaping two characters — backslash and double-quote — and each needs
 * its own escaping backslash. Without this, an account name containing a quote
 * (e.g. Sender's "Nickname" Band) breaks out of the quoting early and produces a
 * malformed header that some mail clients mis-parse, truncate, or reject outright.
 */
export function formatFromHeader(name: string, email: string): string {
  const trimmed = name.trim();
  if (!trimmed) return email;
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}" <${email}>`;
}

export function createTransport(config: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string }) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
}

const MAX_SEND_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// SMTP replies in the 5xx range (and nodemailer's envelope/auth error codes)
// are permanent failures — retrying a rejected recipient just wastes time.
// Connection-level errors (timeouts, dropped sockets, 4xx "try again") are
// worth a couple of retries since they're often transient.
function isPermanentSendError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const responseCode = (err as { responseCode?: number })?.responseCode;
  if (typeof responseCode === 'number') return responseCode >= 500;
  return code === 'EENVELOPE' || code === 'EAUTH';
}

async function sendWithRetry(
  transporter: nodemailer.Transporter,
  mailOptions: Parameters<typeof transporter.sendMail>[0]
): Promise<string | undefined> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_SEND_RETRIES; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      return (info as { messageId?: string } | undefined)?.messageId;
    } catch (err) {
      lastErr = err;
      if (isPermanentSendError(err) || attempt === MAX_SEND_RETRIES) throw err;
      await new Promise<void>(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function sendMessages(
  transporter: nodemailer.Transporter,
  messages: OutboundMessage[],
  opts: { fromName: string; fromEmail: string; signOffImage?: string; sendDelay?: number }
): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (i > 0 && opts.sendDelay && opts.sendDelay > 0) await new Promise<void>(r => setTimeout(r, opts.sendDelay));
    try {
      // Both null together when ACCOUNTS_SECRET/SITE_PASSWORD isn't set — degrades
      // to sending without an unsubscribe link rather than failing the send.
      const unsubUrl = buildUnsubscribeUrl(SITE_URL, msg.to);
      const apiUnsubUrl = buildUnsubscribeApiUrl(SITE_URL, msg.to);
      const textBody = unsubUrl ? `${msg.body}\n\n---\nDon't want to hear from us? Unsubscribe: ${unsubUrl}` : msg.body;

      const mailOptions: Parameters<typeof transporter.sendMail>[0] = {
        from: formatFromHeader(opts.fromName, opts.fromEmail),
        to: msg.to,
        subject: msg.subject,
        text: textBody,
      };
      if (apiUnsubUrl) {
        // RFC 8058: this pair is what lets Gmail/Outlook/Yahoo show their own
        // built-in "Unsubscribe" button next to the sender instead of relying on
        // the recipient to find the footer link — a real deliverability signal for
        // bulk senders, not just a courtesy.
        mailOptions.headers = {
          'List-Unsubscribe': `<${apiUnsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        };
      }
      // Threading a follow-up onto the original pitch takes both headers: In-Reply-To
      // is what most clients read, References is what keeps the whole chain grouped.
      if (msg.inReplyTo) {
        mailOptions.inReplyTo = msg.inReplyTo;
        mailOptions.references = msg.inReplyTo;
      }
      if (opts.signOffImage) {
        const imageData = opts.signOffImage.replace(/^data:image\/\w+;base64,/, '');
        const unsubHtml = unsubUrl
          ? `<p style="font-size:12px;color:#999;margin-top:24px">Don't want to hear from us? <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>`
          : '';
        mailOptions.html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${textToHtml(msg.body)}<img src="cid:signature@trackpitch" alt="Signature" style="max-width:600px;display:block;margin-top:8px">${unsubHtml}</div>`;
        mailOptions.attachments = [{ filename: 'signature.png', content: Buffer.from(imageData, 'base64'), cid: 'signature@trackpitch' }];
      }
      const messageId = await sendWithRetry(transporter, mailOptions);
      results.push({ to: msg.to, success: true, messageId });
    } catch (err) {
      results.push({ to: msg.to, success: false, error: String(err), permanent: isPermanentSendError(err) });
    }
  }
  return results;
}

// Re-exported so every server-side importer of these (app/api/send/route.ts,
// lib/broadcastSend.ts, the tests) keeps working unchanged. They live in
// lib/recipients.ts because the preview modal in the browser needs the same
// dedupe logic, and importing it from here would drag nodemailer into the client
// bundle — see that file's header for the full reasoning.
export { dedupeByRecipient, paginate, DEFAULT_SEND_BATCH_SIZE } from '@/lib/recipients';
