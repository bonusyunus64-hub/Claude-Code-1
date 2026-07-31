import { NextRequest, NextResponse } from 'next/server';
import { isKvConfigured } from '@/lib/kv';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';
import { refreshReplies } from '@/lib/refreshReplies';

// One findResponders call per sending account (see lib/refreshReplies.ts), each
// of which can itself take up to ~10s (greeting/connection/socket timeouts) —
// past Vercel's 10s default, so this raises the ceiling to 60s (the Hobby-plan
// max) the same way the route this replaces did.
export const maxDuration = 60;

// Vercel Cron (see vercel.json) hits this once a day. No browser session is
// involved, so it can't reuse proxy.ts's cookie auth — Vercel signs cron requests
// with `Authorization: Bearer $CRON_SECRET` instead (see lib/cronAuth.ts), which
// is why this path is also listed in proxy.ts's PUBLIC_API_PATHS (the auth
// happens here, not there).
//
// This route only ever refreshes reply/bounce data over IMAP — it never sends
// email (no nodemailer import, no sendMessages call anywhere in
// lib/refreshReplies.ts). Sending is now something the user does themselves from
// the dashboard, once this run has made sure `campaign.responded` is accurate.

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isKvConfigured()) return NextResponse.json({ ok: true, note: 'Storage not configured' });

  const summary = await refreshReplies();
  return NextResponse.json(summary);
}
