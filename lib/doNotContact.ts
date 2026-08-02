import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';

export const BLACKLIST_SET_KEY = 'trackpitch:blacklist';

/** The old field in the settings hash this list used to live in, as one big JSON array. */
const LEGACY_BLACKLIST_FIELD = 'tp_blacklist';

// This module used to also mint and verify signed unsubscribe-link tokens, back when every
// outgoing pitch carried a recipient-facing "Unsubscribe" footer and an RFC 8058
// List-Unsubscribe header. Both were removed deliberately. The deliverability case for
// carrying an unsubscribe link applies to senders pushing high volume off a single
// template — mailbox providers judge what they observe, not intent, so a few hundred
// near-identical messages a day from one mailbox needs the pressure valve. This tool is
// used for a handful of hand-picked recipients a week, which is nowhere near that, and at
// that scale the footer actively works against the pitch: it tells a manager the email
// they're reading was a mass mailing rather than written for them.
//
// The Do Not Contact list itself stays, and is if anything more load-bearing now: it's how
// a bounced address (lib/refreshReplies.ts), a hard rejection, or someone who already said
// no stops being pitched again. None of that ever depended on the link — the list is fed by
// reply checking and by the dashboard's own Account settings, never by a recipient's click.

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

// The Do Not Contact list used to live as one JSON array in a single settings-hash field,
// read in full, modified, and written back in full on every addition. Two writes landing at
// nearly the same moment would both read the same starting array, and whichever landed
// second would silently clobber the first — losing an entry, on the one list here where
// being wrong means emailing someone who already said no. SADD/SREM/SMEMBERS on a Redis set
// are atomic per-member operations, so concurrent writes can't step on each other that way.
// Still worth keeping now that additions come from reply checking and the dashboard rather
// than from recipients: a bounce sweep adding a batch while the operator edits the list by
// hand is the same race, just with different actors.
//
// Same one-time-migration shape as migrateLegacyAccounts() in lib/accounts.ts and
// migrateLegacyCampaigns() in lib/campaigns.ts: a module-level flag so it only runs once
// per server instance, reset to false on a transient failure so the next request retries.
let migrationDone = false;

async function migrateLegacyBlacklist(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const redis = getRedis();
    const legacy = await redis.hget<unknown>(STATE_KEY, LEGACY_BLACKLIST_FIELD);
    if (legacy == null) return; // Nothing to migrate.

    const parsed = typeof legacy === 'string' ? safeParse(legacy) : legacy;
    if (Array.isArray(parsed)) {
      const emails = [...new Set(parsed.map(e => String(e).trim().toLowerCase()).filter(Boolean))];
      if (emails.length) await redis.sadd(BLACKLIST_SET_KEY, emails[0], ...emails.slice(1));
    }
    // Purge the plaintext-array field regardless of whether anything parsed — leaving it is the bug.
    await redis.hdel(STATE_KEY, LEGACY_BLACKLIST_FIELD);
  } catch {
    migrationDone = false; // transient Redis failure: let the next request retry
  }
}

/**
 * Adds addresses to the shared Do Not Contact list directly in Redis — one SADD round
 * trip for the whole batch rather than one request per address. Callers are the
 * dashboard's "move failed sends to Do Not Contact" action (via /api/blacklist, which
 * also routes its single-address form through here) and the bounce sweep in
 * lib/refreshReplies.ts, which can hand over a whole run's worth of dead addresses at once.
 */
export async function addManyToBlacklistServerSide(emails: string[]): Promise<void> {
  if (!isKvConfigured()) return;
  await migrateLegacyBlacklist();
  const lower = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))];
  if (!lower.length) return;
  await getRedis().sadd(BLACKLIST_SET_KEY, lower[0], ...lower.slice(1));
}

/** Dashboard-only counterpart to addManyToBlacklistServerSide, for the "remove from Do Not Contact" action. */
export async function removeFromBlacklistServerSide(email: string): Promise<void> {
  if (!isKvConfigured()) return;
  await migrateLegacyBlacklist();
  const lower = email.trim().toLowerCase();
  if (!lower) return;
  await getRedis().srem(BLACKLIST_SET_KEY, lower);
}

/**
 * The authoritative Do Not Contact list, read straight from Redis rather than
 * trusting whatever a client posts — a stale dashboard tab only syncs this on
 * load, so anything added since then would otherwise still get mailed.
 * Every send path (manual sends and the auto-follow-up cron) unions this with
 * whatever blacklist the caller passed, so an entry is honored the moment
 * it's recorded rather than on the client's next sync.
 */
export async function getBlacklist(): Promise<Set<string>> {
  if (!isKvConfigured()) return new Set();
  await migrateLegacyBlacklist();
  const members = (await getRedis().smembers(BLACKLIST_SET_KEY)) ?? [];
  return new Set(members.map(e => String(e).trim().toLowerCase()));
}
