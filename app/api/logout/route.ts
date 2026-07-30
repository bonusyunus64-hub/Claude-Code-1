import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/auth';

// Redirects to the origin the request actually came in on, the same way proxy.ts
// builds its own redirect back to the login page. This used to read
// NEXT_PUBLIC_BASE_URL and fall back to http://localhost:3000 — which meant that on
// any deployment where that env var wasn't set, logging out bounced the user to
// localhost. There's nothing to configure here: the request already knows where it is.
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.set(AUTH_COOKIE, '', { maxAge: 0, path: '/' });
  return res;
}
