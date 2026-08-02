import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY, STATE_TOMBSTONES_KEY } from '@/lib/kv';
import { isAuthed } from '@/lib/auth';
import { readJsonBody } from '@/lib/readJsonBody';

// A signature image is the largest legitimate value stored here — see
// SIGN_OFF_IMAGE_MAX_BYTES in app/dashboard/hooks/useAccountSettings.ts, which caps the
// raw PNG at 200KB before it's ever encoded. Base64 inflates that by ~4/3 (~267KB) plus a
// short `data:image/png;base64,` prefix, so anything past a few hundred KB here is already
// surprising. 2MB leaves generous headroom above that (JSON overhead, a future bump to the
// image cap, a long template or CSV-derived contact list) while still catching a genuinely
// buggy client write — megabytes of accidental payload — before it lands in Redis.
const MAX_STATE_VALUE_BYTES = 2 * 1024 * 1024;

// A tombstone older than this is assumed to have already reached every device that was
// ever going to sync it, so it's pruned rather than kept forever. See hydrateFromRemote()
// in lib/remoteSync.ts for what tombstones are for. Pruned lazily on read (rather than via
// Redis key/field TTLs) since per-field TTLs (HEXPIRE) need Redis 7.4+, which isn't
// guaranteed on every Upstash plan. 90 days comfortably covers even an infrequently-opened
// second device while keeping the tombstone hash from growing without bound.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Reads the tombstone hash, dropping (and best-effort deleting) anything past TOMBSTONE_TTL_MS. */
async function liveTombstones(): Promise<Record<string, number>> {
  const raw = (await getRedis().hgetall<Record<string, unknown>>(STATE_TOMBSTONES_KEY)) ?? {};
  const now = Date.now();
  const live: Record<string, number> = {};
  const expired: string[] = [];
  for (const [key, v] of Object.entries(raw)) {
    const deletedAt = Number(v);
    if (!Number.isFinite(deletedAt) || now - deletedAt > TOMBSTONE_TTL_MS) expired.push(key);
    else live[key] = deletedAt;
  }
  if (expired.length) {
    // Best-effort: if this fails, the same expired entries just get filtered again
    // (and retried) on the next GET — no correctness issue, only a slightly larger hash.
    await getRedis().hdel(STATE_TOMBSTONES_KEY, ...expired).catch(() => {});
  }
  return live;
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isKvConfigured()) return NextResponse.json({ state: {}, tombstones: {} });

  // Upstash's client auto-parses any stored value that looks like valid JSON
  // (e.g. our JSON.stringify'd arrays/objects) back into a real object, even
  // though every value here was written as a plain string. Flatten it back
  // to strings so this endpoint's contract (Record<string, string>) actually
  // holds — the client mirrors these straight into localStorage as text.
  const raw = (await getRedis().hgetall<Record<string, unknown>>(STATE_KEY)) ?? {};
  const state: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    state[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  const tombstones = await liveTombstones();
  return NextResponse.json({ state, tombstones });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isKvConfigured()) return NextResponse.json({ error: 'Sync storage not configured' }, { status: 500 });

  const parsed = await readJsonBody<{ key?: string; value?: string }>(req);
  if (!parsed.ok) return parsed.response;

  const { key, value } = parsed.data;
  if (!key || typeof value !== 'string') {
    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
  }

  const valueBytes = Buffer.byteLength(value, 'utf8');
  if (valueBytes > MAX_STATE_VALUE_BYTES) {
    return NextResponse.json({
      error: `Value for "${key}" is too large (${(valueBytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_STATE_VALUE_BYTES / 1024 / 1024}MB).`,
    }, { status: 400 });
  }

  await getRedis().hset(STATE_KEY, { [key]: value });
  // A fresh write supersedes any earlier deletion of this key — clear the tombstone so it
  // doesn't linger as dead weight (or, in theory, ever get consulted) now that the key has
  // real data again.
  await getRedis().hdel(STATE_TOMBSTONES_KEY, key).catch(() => {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isKvConfigured()) return NextResponse.json({ error: 'Sync storage not configured' }, { status: 500 });

  const key = req.nextUrl.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  await getRedis().hdel(STATE_KEY, key);
  // Record when this key was deleted so a second device's hydrateFromRemote() can tell
  // "never synced" apart from "deleted elsewhere" and doesn't resurrect it by pushing its
  // own stale local copy back up.
  await getRedis().hset(STATE_TOMBSTONES_KEY, { [key]: String(Date.now()) });
  return NextResponse.json({ ok: true });
}
