import { NextResponse } from 'next/server';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';

// Unauthenticated on purpose — exposes no app data (field names only, never
// values, so no SMTP passwords or similar leak), just whether the sync
// store's env vars are visible to the running server and whether a real
// Redis read/write round-trip succeeds. Useful for diagnosing "sync isn't
// working" without needing to share the site password.
export async function GET() {
  const configured = isKvConfigured();
  if (!configured) return NextResponse.json({ configured, redisOk: false });

  try {
    const counter = await getRedis().incr('trackpitch:diag_counter');
    const state = (await getRedis().hgetall<Record<string, string>>(STATE_KEY)) ?? {};
    return NextResponse.json({ configured, redisOk: true, counter, savedKeys: Object.keys(state) });
  } catch (err) {
    return NextResponse.json({ configured, redisOk: false, error: String(err) });
  }
}
