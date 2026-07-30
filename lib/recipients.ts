// Pure recipient-list logic, deliberately free of any dependency on nodemailer or
// anything else Node-only.
//
// This lives apart from lib/mailSend.ts because the browser needs it too: the email
// preview modal (app/dashboard/previewEntries.ts) has to dedupe exactly the way the
// server does, or it shows the user a preview row for a message that will never be
// sent. Importing it from mailSend.ts to get that would pull nodemailer — and its
// `child_process`/`dns`/`net` requires — into the client bundle and fail the build.
// Note that neither `tsc` nor vitest catches that, since both resolve Node built-ins
// happily; only `next build` does.
//
// mailSend.ts re-exports everything here, so existing server-side importers are
// unaffected and there's still exactly one implementation of each of these.

export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
  /** Higher wins when two messages target the same address. See dedupeByRecipient. */
  rank?: number;
  /** Message-ID of the pitch this one follows up on, so it threads instead of arriving cold. */
  inReplyTo?: string;
}

/**
 * One address, one email per send.
 *
 * The roster maps its artists onto far fewer manager addresses than there are
 * artists — a single address can represent 40+ of them — so building one message
 * per artist drops dozens of near-identical pitches into the same inbox within
 * seconds. That reads as spam to both the human and the receiving server.
 *
 * Keeps the highest-`rank` message per address (ties keep the first seen), so
 * callers control which artist gets to front the pitch. Insertion order is
 * preserved: replacing a Map value leaves its original position alone.
 */
export function dedupeByRecipient<T extends OutboundMessage>(messages: T[]): T[] {
  const best = new Map<string, T>();
  for (const msg of messages) {
    const key = msg.to.trim().toLowerCase();
    const current = best.get(key);
    if (!current || (msg.rank ?? 0) > (current.rank ?? 0)) best.set(key, msg);
  }
  return Array.from(best.values());
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

// Sized so a batch comfortably finishes inside the send routes' maxDuration=60s
// even with SMTP retries (up to 2, ~1-2s each) stacked on top of the largest
// realistic inter-message sendDelay — 25 ran too close to that ceiling in practice.
export const DEFAULT_SEND_BATCH_SIZE = 10;
