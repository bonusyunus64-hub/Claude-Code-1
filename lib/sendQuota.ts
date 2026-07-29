import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';

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

/**
 * Checked once per batch, before that batch goes out, so a long send stops at the
 * cap instead of blowing past it partway through.
 */
export async function checkCapAllows(batchSize: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const cap = await getDailyCap();
  if (cap <= 0) return { ok: true };

  const { count } = await getSendsToday();
  if (count + batchSize > cap) {
    return {
      ok: false,
      error: `Daily send limit reached (${count}/${cap} sent today). Wait until tomorrow or raise the limit in Account settings.`,
    };
  }
  return { ok: true };
}
