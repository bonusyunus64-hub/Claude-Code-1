import { NextResponse } from 'next/server';
import { isKvConfigured } from '@/lib/kv';

// Unauthenticated on purpose — exposes no data, just whether the sync
// store's env vars are visible to the running server. Useful for diagnosing
// "sync isn't working" without needing to share the site password.
export async function GET() {
  return NextResponse.json({ configured: isKvConfigured() });
}
