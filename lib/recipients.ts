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

/**
 * Deterministically assigns a recipient to subject-line variant 'A' or 'B' for
 * two-variant subject-line testing (DemosSection's "Test a second subject line"
 * toggle). Hashing the lowercased address — rather than array position or
 * Math.random() — is what makes the assignment stable no matter how a send is
 * split up: a send pages through recipients across several batched requests and
 * can be resumed after an interruption (useCampaignHistory's resumeSend), both
 * of which rebuild the recipient list from scratch each time by excluding
 * whoever's already been attempted (app/dashboard/utils.ts's sendInBatches)
 * rather than working through a stable numeric offset — so there's no batch
 * index or random seed that could be relied on to reproduce the same split
 * twice. The same address always hashes to the same bucket, in any batch, on
 * any resume, forever.
 *
 * A plain djb2-style string hash rather than a cryptographic one: this only
 * needs to be a stable, roughly-uniform 50/50 split, not tamper-proof, and
 * unlike Node's `crypto` module this also has to run in the browser — the
 * recipient preview modal (app/dashboard/previewEntries.ts, via
 * subjectTemplateFor below) needs to show the same subject the server will
 * actually send. `| 0` after every step keeps the running hash a 32-bit
 * integer, which is what makes it reproduce identically between the browser
 * and Node.js: both implement JS's bitwise operators the same way, whereas
 * plain floating-point arithmetic on a value this large could in principle
 * round differently.
 *
 * Worth knowing before "improving" this: taking djb2's lowest bit reduces to a
 * parity check. Multiplying by 33 leaves the low bit untouched (33 is odd), so
 * the bit this returns is just the parity of the seed plus every character
 * code — a much weaker function than the full hash suggests. That was measured
 * against the real roster rather than assumed: across the 2,448 distinct
 * manager addresses in data/roster.json the split is 48.1/51.9, and across
 * every genre with at least 40 recipients (the realistic shape of a campaign)
 * mean skew is under 4 percentage points with none worse than 60/40. A proper
 * avalanche finaliser on top measured no better at those sample sizes, so the
 * simpler version stays.
 *
 * The real hazard isn't the hash quality, it's changing it at all: the variant
 * is stored per recipient on the campaign (CampaignRecord.subjectVariants), but
 * it's recomputed for anyone sent to after the change. Editing this function
 * mid-campaign would move already-mailed recipients into the other bucket and
 * quietly corrupt that campaign's results. Treat it as frozen once a test has
 * gone out.
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
 * Chooses which subject template a recipient should get when subject-line A/B
 * testing is on. `subjectB` blank/undefined means no test is running for this
 * send — the exact pre-A/B-testing behavior — so this always returns
 * `subjectA` in that case, keeping a payload with no B variant unaffected.
 * Shared between app/api/send/route.ts (the actual send) and the recipient
 * preview modal (app/dashboard/previewEntries.ts, via page.tsx) so the two can
 * never disagree about which subject a given address will receive.
 */
export function subjectTemplateFor(email: string, subjectA: string, subjectB: string | undefined): string {
  if (!subjectB?.trim()) return subjectA;
  return assignSubjectVariant(email) === 'A' ? subjectA : subjectB;
}
