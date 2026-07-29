import { ImapFlow } from 'imapflow';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/**
 * Zoho's IMAP host mirrors its SMTP host (smtp.zoho.com -> imap.zoho.com) under
 * the same account credentials, so we derive it instead of asking for a second
 * set of settings. Falls back to the smtp host itself for any other provider.
 */
export function resolveImapConfig(smtpHost: string, user: string, pass: string): ImapConfig {
  const host = smtpHost.replace(/^smtp\./, 'imap.');
  return { host, port: 993, user, pass };
}

/** Pulls every address out of an envelope's from/reply-to/sender fields, lowercased. */
export function sendersFromEnvelope(envelope: unknown): string[] {
  const env = envelope as {
    from?: { address?: string }[];
    replyTo?: { address?: string }[];
    sender?: { address?: string }[];
  } | undefined;
  if (!env) return [];
  return [...(env.from ?? []), ...(env.replyTo ?? []), ...(env.sender ?? [])]
    .map(a => a?.address?.trim().toLowerCase())
    .filter((a): a is string => !!a);
}

/**
 * Matches inbox senders against the campaign's recipient list.
 *
 * Kept separate from the IMAP plumbing so the matching logic is testable without
 * a live mailbox.
 */
export function matchResponders(emails: string[], inboxSenders: string[]): string[] {
  const byLower = new Map<string, string>();
  for (const email of emails) {
    const key = email.trim().toLowerCase();
    if (!byLower.has(key)) byLower.set(key, email);
  }

  const responded: string[] = [];
  const seen = new Set<string>();
  for (const sender of inboxSenders) {
    const original = byLower.get(sender);
    if (original && !seen.has(sender)) {
      seen.add(sender);
      responded.push(original);
    }
  }
  return responded;
}

/** Local-parts mail servers conventionally use for bounce/DSN notifications (RFC 3464 senders vary a lot in practice). */
const BOUNCE_LOCAL_PARTS = ['mailer-daemon', 'mailer_daemon', 'postmaster', 'mail-daemon', 'mailerdaemon'];

/** Whether an inbox sender address looks like an automated bounce notification rather than a human reply. */
export function isBounceSender(address: string): boolean {
  const local = address.split('@')[0]?.trim().toLowerCase() ?? '';
  return BOUNCE_LOCAL_PARTS.some(p => local === p || local.startsWith(`${p}+`));
}

/**
 * Pulls the address(es) a bounce (DSN) message says failed, scoped to `candidates`
 * so unrelated addresses elsewhere in the message body can't be misread as a
 * failed recipient. Tries the standard RFC 3464 headers first (Final-Recipient /
 * Original-Recipient / X-Failed-Recipients), then falls back to a plain substring
 * search over the raw source — mail providers vary a lot in how closely they
 * follow the DSN format, but nearly all of them quote the failed address
 * somewhere in the body ("The following address(es) failed: ...").
 */
export function extractFailedRecipients(source: string, candidates: string[]): string[] {
  const lowerSource = source.toLowerCase();
  const headerAddresses = new Set(
    [...source.matchAll(/(?:Final-Recipient|Original-Recipient|X-Failed-Recipients)\s*:\s*(?:rfc822;)?\s*<?([^\s>]+@[^\s>]+)>?/gi)]
      .map(m => m[1].toLowerCase())
  );

  return candidates.filter(email => {
    const lower = email.trim().toLowerCase();
    return headerAddresses.has(lower) || lowerSource.includes(lower);
  });
}

export interface CheckRepliesResult {
  /** Recipients who sent a human reply. */
  responded: string[];
  /** Recipients a bounce/DSN message named as undeliverable. */
  bounced: string[];
}

/**
 * Checks which of `emails` have written to this mailbox since `since`, and which
 * bounced instead.
 *
 * One search for everything in the window, then match senders locally. The
 * previous per-address search meant one IMAP round trip per recipient, which on a
 * few hundred recipients ran well past a serverless function's time limit.
 *
 * Bounce detection is a second pass: the first pass (envelope only, cheap) flags
 * which UIDs came from a bounce-looking sender, then only those UIDs get their
 * full source fetched to find which recipient they're reporting as failed —
 * fetching full source for every message in the window would be needlessly slow
 * on an active mailbox.
 */
export async function findResponders(config: ImapConfig, emails: string[], since: Date): Promise<CheckRepliesResult> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  await client.connect();
  const inboxSenders: string[] = [];
  const bounceUids: number[] = [];
  const bounced = new Set<string>();
  try {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const uids = await client.search({ since }, { uid: true });
    if (uids && uids.length > 0) {
      for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
        const senders = sendersFromEnvelope(msg.envelope);
        inboxSenders.push(...senders);
        if (typeof msg.uid === 'number' && senders.some(isBounceSender)) bounceUids.push(msg.uid);
      }
      if (bounceUids.length > 0) {
        for await (const msg of client.fetch(bounceUids, { source: true }, { uid: true })) {
          const source = msg.source?.toString('utf8') ?? '';
          extractFailedRecipients(source, emails).forEach(email => bounced.add(email.trim().toLowerCase()));
        }
      }
    }
  } finally {
    await client.logout();
  }

  return {
    responded: matchResponders(emails, inboxSenders),
    bounced: emails.filter(email => bounced.has(email.trim().toLowerCase())),
  };
}
