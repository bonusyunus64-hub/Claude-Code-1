import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';

// /api/auth and /api/logout must stay reachable while logged out.
// /api/unsubscribe must stay reachable by anyone who received a pitch email —
// they have no dashboard session, and its own token (not a login) is what
// authorizes the request. See lib/unsubscribe.ts.
const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/logout', '/api/unsubscribe']);

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
