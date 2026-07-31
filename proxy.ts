import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';

// /api/auth and /api/logout must stay reachable while logged out.
// /api/unsubscribe must stay reachable by anyone who received a pitch email —
// they have no dashboard session, and its own token (not a login) is what
// authorizes the request. See lib/unsubscribe.ts.
// /api/cron/auto-followup and /api/cron/drain-send-window are invoked by Vercel
// Cron, which has no dashboard session either — each authenticates itself with a
// CRON_SECRET bearer token instead (lib/cronAuth.ts), checked inside the route.
const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/logout', '/api/unsubscribe', '/api/cron/auto-followup', '/api/cron/drain-send-window']);

// Deliberately NOT here: the three send routes (/api/send, /api/radio-send,
// /api/playlist-send). Draining the send-window queue needs to run them without a
// browser session, and the obvious way to allow that would be to let a CRON_SECRET
// bearer token through to them. That's a bad trade: /api/send accepts an arbitrary
// recipient list (customContacts) and an arbitrary message body, so a leaked cron
// secret would be enough to send anything to anyone through the user's own
// authenticated mailbox — a much larger blast radius than the follow-up cron's,
// which can only re-mail people an existing campaign already reached. The drain
// cron calls those send functions directly in-process instead
// (lib/sendDispatch.ts), so nothing has to be opened up here at all.
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
