import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { getAccountDailyCap } from '@/lib/accounts';

// The daily cap used to be a localStorage counter, which meant a page reload or a
// second device could quietly send past it. The count now lives in Redis and is
// checked inside the send routes, so it holds no matter how many tabs are open.

const TOTAL_FIELD = 'total';
const ACCOUNT_PREFIX = 'acct:';
const TWO_DAYS_SECONDS = 60 * 60 * 48;

/** UTC day, matching the client's `new Date().toISOString().slice(0, 10)`. */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function counterKey(day = todayKey()): string {
  return `trackpitch:sends:${day}`;
}

export interface SendsToday {
  date: string;
  count: number;
  byAccount: Record<string, number>;
}

export async function getSendsToday(): Promise<SendsToday> {
  const date = todayKey();
  if (!isKvConfigured()) return { date, count: 0, byAccount: {} };

  const raw = (await getRedis().hgetall<Record<string, unknown>>(counterKey(date))) ?? {};
  const byAccount: Record<string, number> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (field.startsWith(ACCOUNT_PREFIX)) byAccount[field.slice(ACCOUNT_PREFIX.length)] = Number(value) || 0;
  }
  return { date, count: Number(raw[TOTAL_FIELD]) || 0, byAccount };
}

export async function recordSends(n: number, accountId?: string): Promise<void> {
  if (!isKvConfigured() || n <= 0) return;
  const key = counterKey();
  const redis = getRedis();
  await redis.hincrby(key, TOTAL_FIELD, n);
  if (accountId) await redis.hincrby(key, `${ACCOUNT_PREFIX}${accountId}`, n);
  // Counters are only meaningful for the day they cover; expiring them keeps
  // Redis from accumulating a key per day forever.
  await redis.expire(key, TWO_DAYS_SECONDS);
}

/**
 * The cap is a user setting that already syncs to the settings hash, so we read it
 * there rather than trusting a value posted by the client. 0 means "no limit".
 */
export async function getDailyCap(): Promise<number> {
  if (!isKvConfigured()) return 0;
  const raw = await getRedis().hget<unknown>(STATE_KEY, 'tp_daily_cap');
  const cap = Number(typeof raw === 'string' ? raw : raw ?? 0);
  return Number.isFinite(cap) && cap > 0 ? cap : 0;
}

export interface CapAllowance {
  /** How many of the requested messages may actually go out now. 0 means the cap is genuinely exhausted. */
  allowed: number;
  /** Set only when `allowed` is 0 — a user-facing explanation of which cap blocked it. */
  error?: string;
}

/**
 * Checked once per batch, before that batch goes out, so a long send stops at the
 * cap instead of blowing past it partway through.
 *
 * Two independent caps can apply: the global daily cap (all accounts combined),
 * and a per-account cap set on the account itself (Account settings) — the
 * warmup-style limit for spreading volume so no single mailbox takes the full
 * load.
 *
 * Rather than refusing the whole batch outright when it would cross either cap
 * (which used to mean a user sitting at 45/50 with a 10-message batch got
 * refused entirely, even though 5 sends were still available), this returns how
 * many of `batchSize` may actually go out right now — the minimum of the batch
 * size and whatever headroom is left under each cap, floored at 0 so a counter
 * that has somehow overshot its cap can't produce a negative allowance. Callers
 * are responsible for trimming their batch to `allowed` and making sure the
 * untrimmed remainder is picked up later rather than silently dropped.
 */
export async function checkCapAllows(batchSize: number, accountId?: string): Promise<CapAllowance> {
  const [cap, accountCap, sendsToday] = await Promise.all([
    getDailyCap(),
    accountId ? getAccountDailyCap(accountId) : Promise.resolve(0),
    getSendsToday(),
  ]);

  const globalRemaining = cap > 0 ? Math.max(0, cap - sendsToday.count) : Infinity;
  const accountCount = accountId ? (sendsToday.byAccount[accountId] ?? 0) : 0;
  const accountRemaining = accountId && accountCap > 0 ? Math.max(0, accountCap - accountCount) : Infinity;

  const allowed = Math.max(0, Math.min(batchSize, globalRemaining, accountRemaining));
  if (allowed > 0) return { allowed };

  // allowed === 0: name whichever cap is actually out of room, checking the
  // global cap first — the same precedence the checks above apply — so the
  // message doesn't blame the global cap when it was the account cap that
  // was actually binding (or vice versa).
  if (cap > 0 && globalRemaining <= 0) {
    return {
      allowed: 0,
      error: `Daily send limit reached (${sendsToday.count}/${cap} sent today). Wait until tomorrow or raise the limit in Account settings.`,
    };
  }
  if (accountId && accountCap > 0 && accountRemaining <= 0) {
    return {
      allowed: 0,
      error: `This account has reached its daily limit (${accountCount}/${accountCap} sent today). Switch accounts, wait until tomorrow, or raise its limit in Account settings.`,
    };
  }
  // Neither cap is actually exhausted — batchSize itself must have been 0.
  return { allowed: 0 };
}
