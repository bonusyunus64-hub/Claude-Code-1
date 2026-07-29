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

/**
 * Checks which of `emails` have written to this mailbox since `since`.
 *
 * One search for everything in the window, then match senders locally. The
 * previous per-address search meant one IMAP round trip per recipient, which on a
 * few hundred recipients ran well past a serverless function's time limit.
 */
export async function findResponders(config: ImapConfig, emails: string[], since: Date): Promise<string[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  await client.connect();
  const inboxSenders: string[] = [];
  try {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const uids = await client.search({ since }, { uid: true });
    if (uids && uids.length > 0) {
      for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
        inboxSenders.push(...sendersFromEnvelope(msg.envelope));
      }
    }
  } finally {
    await client.logout();
  }

  return matchResponders(emails, inboxSenders);
}
