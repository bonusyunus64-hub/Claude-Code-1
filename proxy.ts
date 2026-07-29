import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';

// /api/auth and /api/logout must stay reachable while logged out.
const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/logout']);

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
