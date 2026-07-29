import crypto from 'crypto';
import { NextRequest } from 'next/server';

export const AUTH_COOKIE = 'auth';

// The cookie stores an HMAC of a fixed message keyed by SITE_PASSWORD, not the
// password itself — so reading the cookie never reveals the real password.
const SESSION_MESSAGE = 'trackpitch-auth-session';

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

export function passwordMatches(candidate: string): boolean {
  const correct = process.env.SITE_PASSWORD;
  if (!correct) return false;
  return timingSafeStringEqual(candidate, correct);
}

export function getSessionToken(): string | null {
  const secret = process.env.SITE_PASSWORD;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(SESSION_MESSAGE).digest('hex');
}

function tokenMatches(token: string): boolean {
  const expected = getSessionToken();
  if (!expected) return false;
  return timingSafeStringEqual(token, expected);
}

export function isAuthed(req: NextRequest): boolean {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  return !!token && tokenMatches(token);
}
