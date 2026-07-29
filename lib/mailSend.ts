import nodemailer from 'nodemailer';
import { textToHtml } from '@/lib/emailTemplate';

export interface FromAccount {
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
}

export interface SendResult {
  to: string;
  success: boolean;
  error?: string;
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
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_SEND_RETRIES; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      return;
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
      const mailOptions: Parameters<typeof transporter.sendMail>[0] = {
        from: `"${opts.fromName}" <${opts.fromEmail}>`,
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
      };
      if (opts.signOffImage) {
        const imageData = opts.signOffImage.replace(/^data:image\/\w+;base64,/, '');
        mailOptions.html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${textToHtml(msg.body)}<img src="cid:signature@trackpitch" alt="Signature" style="max-width:600px;display:block;margin-top:8px"></div>`;
        mailOptions.attachments = [{ filename: 'signature.png', content: Buffer.from(imageData, 'base64'), cid: 'signature@trackpitch' }];
      }
      await sendWithRetry(transporter, mailOptions);
      results.push({ to: msg.to, success: true });
    } catch (err) {
      results.push({ to: msg.to, success: false, error: String(err) });
    }
  }
  return results;
}

/**
 * Slices a full message list into one page. Send routes accept `offset`/`limit`
 * so the client can send in small batches instead of one long request that
 * risks a serverless function timeout on large recipient lists.
 */
export function paginate<T>(items: T[], offset: number, limit: number) {
  const batch = items.slice(offset, offset + limit);
  const nextOffset = offset + batch.length < items.length ? offset + batch.length : null;
  return { batch, total: items.length, nextOffset };
}

export const DEFAULT_SEND_BATCH_SIZE = 25;
