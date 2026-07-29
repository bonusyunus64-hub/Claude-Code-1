import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, getSessionToken, passwordMatches } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!process.env.SITE_PASSWORD) {
    return NextResponse.json({ error: 'SITE_PASSWORD env var not set' }, { status: 500 });
  }

  if (typeof password !== 'string' || !passwordMatches(password)) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, getSessionToken()!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
  return res;
}
