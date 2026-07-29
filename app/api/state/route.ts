import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';
import { isAuthed } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isKvConfigured()) return NextResponse.json({ state: {} });

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
  return NextResponse.json({ state });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isKvConfigured()) return NextResponse.json({ error: 'Sync storage not configured' }, { status: 500 });

  const { key, value } = await req.json() as { key?: string; value?: string };
  if (!key || typeof value !== 'string') {
    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
  }

  await getRedis().hset(STATE_KEY, { [key]: value });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isKvConfigured()) return NextResponse.json({ error: 'Sync storage not configured' }, { status: 500 });

  const key = req.nextUrl.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  await getRedis().hdel(STATE_KEY, key);
  return NextResponse.json({ ok: true });
}
