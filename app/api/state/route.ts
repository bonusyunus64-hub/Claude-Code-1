import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isKvConfigured } from '@/lib/kv';

const STATE_KEY = 'trackpitch:settings';

function isAuthed(req: NextRequest): boolean {
  const auth = req.cookies.get('auth')?.value;
  const correct = process.env.SITE_PASSWORD;
  return !!auth && !!correct && auth === correct;
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isKvConfigured()) return NextResponse.json({ state: {} });

  const state = (await getRedis().hgetall<Record<string, string>>(STATE_KEY)) ?? {};
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
