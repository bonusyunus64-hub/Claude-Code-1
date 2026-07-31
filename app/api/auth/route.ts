import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, SESSION_MAX_AGE_MS, getSessionToken, passwordMatches } from '@/lib/auth';
import { checkLoginRateLimit, clearLoginAttempts, clientIp, recordFailedLogin } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!process.env.SITE_PASSWORD) {
    return NextResponse.json({ error: 'SITE_PASSWORD env var not set' }, { status: 500 });
  }

  const ip = clientIp(req);
  const limit = await checkLoginRateLimit(ip);
  if (limit.blocked) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    return NextResponse.json(
      { error: `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  if (typeof password !== 'string' || !passwordMatches(password)) {
    await recordFailedLogin(ip);
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  await clearLoginAttempts(ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, getSessionToken()!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS / 1000, // seconds; kept in lockstep with the server-side check in lib/auth.ts
    path: '/',
  });
  return res;
}
