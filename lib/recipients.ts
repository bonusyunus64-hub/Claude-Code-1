// Pure recipient-list logic, deliberately free of any dependency on nodemailer or
// anything else Node-only: the browser (app/dashboard/previewEntries.ts) imports
// this directly to preview a send, and pulling nodemailer in here would drag its
// Node built-ins into the client bundle and fail `next build` — a failure neither
// `tsc` nor vitest catches. mailSend.ts re-exports everything here for server callers.

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
 * Collapses messages to one per address. A manager address can represent 40+
 * artists, so an unfiltered send would drop dozens of near-identical pitches
 * into one inbox. Keeps the highest-`rank` message per address; ties keep the
 * first seen, and insertion order is otherwise preserved.
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

/**
 * Deterministically assigns a recipient to subject-line variant 'A' or 'B' for
 * two-variant subject-line testing. Hashes the lowercased address — not array
 * position or Math.random() — so the same address always lands in the same
 * bucket no matter how a send is batched or resumed after an interruption;
 * there's no stable batch index or seed to rely on instead. A plain djb2-style
 * hash rather than a cryptographic one: it only needs a stable, roughly-uniform
 * split, and unlike Node's `crypto` it also has to run in the browser (the
 * recipient preview modal needs to show the same subject the server will send).
 * `| 0` after every step keeps the hash a 32-bit integer so browser and Node
 * produce identical results.
 *
 * FROZEN ONCE A TEST HAS GONE OUT — DO NOT CHANGE THIS FUNCTION MID-CAMPAIGN.
 * The variant is stored per recipient on the campaign
 * (CampaignRecord.subjectVariants), but it's recomputed for anyone sent to
 * after this function changes. Editing it mid-campaign would move
 * already-mailed recipients into the other bucket and quietly corrupt that
 * campaign's results.
 */
export function assignSubjectVariant(email: string): 'A' | 'B' {
  const key = email.trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = (((hash << 5) + hash) + key.charCodeAt(i)) | 0; // hash*33 + c
  }
  return (hash & 1) === 0 ? 'A' : 'B';
}

/**
 * Picks subjectA or subjectB for a recipient. Blank/undefined `subjectB` means
 * no test is running, so `subjectA` is always returned. Shared between the send
 * route and the preview modal so they never disagree on which subject an
 * address gets.
 */
export function subjectTemplateFor(email: string, subjectA: string, subjectB: string | undefined): string {
  if (!subjectB?.trim()) return subjectA;
  return assignSubjectVariant(email) === 'A' ? subjectA : subjectB;
}
