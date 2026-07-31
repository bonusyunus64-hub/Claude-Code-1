import type { NextRequest } from 'next/server';

/**
 * Shared by every Vercel Cron route (app/api/cron/auto-followup,
 * app/api/cron/drain-send-window) — one implementation rather than a copy of the
 * same bearer-token comparison in each.
 *
 * Note this is deliberately NOT wired into proxy.ts as an alternative to a
 * session: a cron secret authorises the two cron routes themselves, nothing more.
 * The send routes stay session-only, so a leaked CRON_SECRET can't be used to mail
 * arbitrary recipients — see the comment in proxy.ts.
 *
 * No browser session is involved in a cron invocation, so it can't reuse
 * lib/auth.ts's cookie-based isAuthed() — Vercel signs these requests with
 * `Authorization: Bearer $CRON_SECRET` instead, matching the platform's own
 * documented pattern (vercel.com/docs/cron-jobs).
 */
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
