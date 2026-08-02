import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';

// /api/auth and /api/logout must stay reachable while logged out.
// /api/cron/refresh-replies and /api/cron/drain-send-window are invoked by
// Vercel Cron, which has no dashboard session either — each authenticates itself
// with a CRON_SECRET bearer token instead (lib/cronAuth.ts), checked inside the
// route.
//
// /api/unsubscribe used to be here too, as the one route a pitch recipient could
// reach without a session of any kind. It's gone along with the unsubscribe link
// itself (see the header comment in lib/doNotContact.ts), so this allowlist no
// longer exposes anything at all to the recipients of outgoing mail — every
// remaining entry is either part of the login flow or a cron route that
// authenticates with its own secret.
const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/logout', '/api/cron/refresh-replies', '/api/cron/drain-send-window']);

// Deliberately NOT here: the send routes (/api/send, /api/radio-send) or the
// manual follow-up send route. Draining the
// send-window queue needs to run a send without a browser session, and the
// obvious way to allow that would be to let a CRON_SECRET bearer token through to
// the send routes directly. That's a bad trade: /api/send accepts an arbitrary
// recipient list (customContacts) and an arbitrary message body, so a leaked cron
// secret would be enough to send anything to anyone through the user's own
// authenticated mailbox. The drain cron calls those send functions directly
// in-process instead (lib/sendDispatch.ts), so nothing has to be opened up here
// at all — and this reasoning applies even more cleanly now that
// /api/cron/refresh-replies can't send anything at all (it only refreshes reply/
// bounce data over IMAP): the one cron route that IS public here has no send
// capability to leak in the first place, and follow-ups are sent by the user
// pressing a button in the dashboard (an authenticated session), never by a
// bearer-token-authenticated cron.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isDashboard = pathname.startsWith('/dashboard');
  const isProtectedApi = pathname.startsWith('/api/') && !PUBLIC_API_PATHS.has(pathname);

  if (!isDashboard && !isProtectedApi) return NextResponse.next();

  if (!isAuthed(req)) {
    if (isProtectedApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
