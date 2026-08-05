import { NextRequest, NextResponse } from 'next/server';
import { isKvConfigured } from '@/lib/kv';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';
import { refreshReplies } from '@/lib/refreshReplies';
import { pruneOldCampaignDetail } from '@/lib/campaigns';

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

  // Piggybacked on the same daily run rather than given a cron slot of its own:
  // Vercel's Hobby plan allows only two cron jobs and vercel.json already uses
  // both. It runs after the refresh, not before, so a campaign that just aged
  // past the window still gets its final reply check first. Failure here is
  // deliberately non-fatal — dropping stale detail is housekeeping, and losing a
  // day of it must not turn a successful reply refresh into a 500.
  let detailPruned = 0;
  let pruneError: string | null = null;
  try {
    detailPruned = await pruneOldCampaignDetail(Date.now());
  } catch (err) {
    pruneError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({ ...summary, detailPruned, ...(pruneError ? { pruneError } : {}) });
}
