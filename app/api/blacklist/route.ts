import { NextRequest, NextResponse } from 'next/server';
import { isKvConfigured } from '@/lib/kv';
import { getBlacklist, addManyToBlacklistServerSide, removeFromBlacklistServerSide } from '@/lib/unsubscribe';

// The dashboard's own view of the Do Not Contact list (Account settings). Reads/writes go
// straight through the atomic SADD/SREM/SMEMBERS in lib/unsubscribe.ts — the same
// operations /api/unsubscribe uses when a recipient opts out themselves — rather than the
// settings blob's read-whole-array/write-whole-array pattern used elsewhere in this app.
// That pattern is what let two concurrent unsubscribes silently lose one, which is exactly
// the failure mode this particular list can least afford. No isAuthed() check needed here:
// proxy.ts already gates everything under /api/ behind a session except its small public
// allowlist, and this path isn't on it.

async function listSorted() {
  return Array.from(await getBlacklist()).sort();
}

export async function GET() {
  if (!isKvConfigured()) return NextResponse.json({ blacklist: [] });
  return NextResponse.json({ blacklist: await listSorted() });
}

export async function POST(req: NextRequest) {
  if (!isKvConfigured()) {
    return NextResponse.json({ error: 'Do Not Contact storage is not configured on the server.' }, { status: 500 });
  }
  // Accepts either a single `email` (the "add one address" form) or a batch `emails`
  // (the dashboard's "move failed sends to Do Not Contact" action) — either way it's one
  // SADD round trip via addManyToBlacklistServerSide, not one request per address.
  const body = await req.json() as { email?: string; emails?: string[] };
  const emails = Array.isArray(body.emails) ? body.emails : (body.email ? [body.email] : []);
  const cleaned = emails.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
  if (!cleaned.length) return NextResponse.json({ error: 'Missing email' }, { status: 400 });

  await addManyToBlacklistServerSide(cleaned);
  return NextResponse.json({ blacklist: await listSorted() });
}

export async function DELETE(req: NextRequest) {
  if (!isKvConfigured()) {
    return NextResponse.json({ error: 'Do Not Contact storage is not configured on the server.' }, { status: 500 });
  }
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 });

  await removeFromBlacklistServerSide(email);
  return NextResponse.json({ blacklist: await listSorted() });
}
