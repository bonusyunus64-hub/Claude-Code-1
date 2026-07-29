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

export type ReplyClassification = 'interested' | 'pass' | 'auto-reply' | 'unclassified';

/** Headers RFC 3834 / common mail clients set on vacation responders and other auto-replies. */
const AUTO_REPLY_HEADER_RE = /^(?:Auto-Submitted|X-Autoreply|X-Autorespond|X-Autoresponder)\s*:\s*(\S.*)$/im;

/** Whether a matched Auto-Submitted-style header value indicates an actual auto-reply (RFC 3834: "no" means a normal message). */
function isAutoReplyHeaderValue(value: string): boolean {
  return !/^no\b/i.test(value.trim());
}
const AUTO_REPLY_SUBJECT_PHRASES = [
  'out of office', 'automatic reply', 'auto-reply', 'autoreply', 'away from my desk',
  'automatic response', "i'm currently out", 'on vacation', 'on leave', 'currently unavailable',
];
const INTERESTED_PHRASES = [
  'sounds great', 'would love', "let's do it", "let's talk", 'send it over', 'please send',
  "i'm interested", 'im interested', "we're interested", 'very interested', 'yes please',
  'love this', 'love it', 'count me in', 'sign me up', "let's move forward", 'keen to hear',
  'would love to hear', 'excited to hear', 'happy to listen', 'happy to check',
];
const PASS_PHRASES = [
  'not interested', 'not a fit', 'not for us', 'no thank you', 'no thanks',
  'pass on this', 'will pass', 'not accepting', 'not currently accepting', 'not the right fit',
  "not what we're looking for", 'unable to take on', 'not looking for new',
];

/**
 * Splits a raw message source into its header block and everything after the
 * blank line that ends it — not a real MIME parser, just enough structure for
 * keyword-based classification below.
 */
function splitHeadersAndBody(source: string): { headerBlock: string; body: string } {
  const blankLineIdx = source.search(/\r?\n\r?\n/);
  if (blankLineIdx === -1) return { headerBlock: source, body: '' };
  const match = source.slice(blankLineIdx).match(/^\r?\n\r?\n/);
  return { headerBlock: source.slice(0, blankLineIdx), body: source.slice(blankLineIdx + (match?.[0].length ?? 0)) };
}

function extractSubject(headerBlock: string): string {
  const match = headerBlock.match(/^Subject:\s*(.+)$/im);
  return match ? match[1].trim() : '';
}

/**
 * Best-effort keyword classification of a reply — not a real language model, just
 * enough to separate "clearly a vacation responder" and "clearly said yes/no" from
 * the replies worth a human actually reading. Anything ambiguous falls through to
 * 'unclassified' rather than guessing.
 */
export function classifyReply(source: string): ReplyClassification {
  const { headerBlock, body } = splitHeadersAndBody(source);
  const headerMatch = headerBlock.match(AUTO_REPLY_HEADER_RE);
  if (headerMatch && isAutoReplyHeaderValue(headerMatch[1])) return 'auto-reply';

  const subject = extractSubject(headerBlock).toLowerCase();
  if (AUTO_REPLY_SUBJECT_PHRASES.some(p => subject.includes(p))) return 'auto-reply';

  // Strip HTML tags (in case the reply is HTML-only) and drop quoted history below
  // the new text, so a "yes!" isn't drowned out by the entire original pitch quoted
  // back underneath it.
  const plain = body.replace(/<[^>]+>/g, ' ').split(/\r?\n\s*(?:>|On .{0,80} wrote:)/i)[0];
  const lowerBody = plain.slice(0, 4000).toLowerCase();

  const interested = INTERESTED_PHRASES.some(p => lowerBody.includes(p));
  const pass = PASS_PHRASES.some(p => lowerBody.includes(p));
  if (interested && !pass) return 'interested';
  if (pass && !interested) return 'pass';
  return 'unclassified';
}

export interface CheckRepliesResult {
  /** Recipients who sent a human reply. */
  responded: string[];
  /** Recipients a bounce/DSN message named as undeliverable. */
  bounced: string[];
  /** Lowercased recipient -> best-effort classification of their most recent reply. */
  classifications: Record<string, ReplyClassification>;
}

/**
 * Checks which of `emails` have written to this mailbox since `since`, which
 * bounced instead, and a rough classification of what each reply said.
 *
 * One search for everything in the window, then match senders locally. The
 * previous per-address search meant one IMAP round trip per recipient, which on a
 * few hundred recipients ran well past a serverless function's time limit.
 *
 * Both bounce parsing and reply classification need the message body, not just
 * the envelope, so they're a second pass: the first pass (envelope only, cheap)
 * sorts every UID into "looks like a bounce" / "from one of our recipients" /
 * neither, then only those flagged UIDs get their full source fetched — fetching
 * full source for every message in the window would be needlessly slow on an
 * active mailbox.
 */
export async function findResponders(config: ImapConfig, emails: string[], since: Date): Promise<CheckRepliesResult> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  const recipientSet = new Set(emails.map(e => e.trim().toLowerCase()));

  await client.connect();
  const inboxSenders: string[] = [];
  const bounceUids: number[] = [];
  const responderUidToSender = new Map<number, string>();
  const bounced = new Set<string>();
  const classifications: Record<string, ReplyClassification> = {};
  try {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const uids = await client.search({ since }, { uid: true });
    if (uids && uids.length > 0) {
      for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
        const senders = sendersFromEnvelope(msg.envelope);
        inboxSenders.push(...senders);
        if (typeof msg.uid !== 'number') continue;
        if (senders.some(isBounceSender)) {
          bounceUids.push(msg.uid);
        } else {
          const matchedSender = senders.find(s => recipientSet.has(s));
          if (matchedSender) responderUidToSender.set(msg.uid, matchedSender);
        }
      }
      if (bounceUids.length > 0) {
        for await (const msg of client.fetch(bounceUids, { source: true }, { uid: true })) {
          const source = msg.source?.toString('utf8') ?? '';
          extractFailedRecipients(source, emails).forEach(email => bounced.add(email.trim().toLowerCase()));
        }
      }
      if (responderUidToSender.size > 0) {
        for await (const msg of client.fetch([...responderUidToSender.keys()], { source: true }, { uid: true })) {
          if (typeof msg.uid !== 'number') continue;
          const sender = responderUidToSender.get(msg.uid);
          if (!sender) continue;
          const source = msg.source?.toString('utf8') ?? '';
          // A later message (higher UID = more recent) overwrites an earlier
          // classification from the same sender, so a follow-up reply wins.
          classifications[sender] = classifyReply(source);
        }
      }
    }
  } finally {
    await client.logout();
  }

  return {
    responded: matchResponders(emails, inboxSenders),
    bounced: emails.filter(email => bounced.has(email.trim().toLowerCase())),
    classifications,
  };
}
