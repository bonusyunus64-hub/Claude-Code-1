import crypto from 'crypto';
import { NextRequest } from 'next/server';

export const AUTH_COOKIE = 'auth';

// How long a session cookie stays valid after it's issued. Exported so
// app/api/auth/route.ts can use the exact same value for the cookie's
// `maxAge` — the server-side check here and the browser-side hint there can
// never drift apart.
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// How far into the future an `issuedAtMs` is allowed to be before it's
// treated as invalid, to tolerate small clock differences between the
// machine that minted the token and the machine validating it. Anything
// beyond this is rejected outright — otherwise a far-future timestamp would
// be a session that never expires.
const CLOCK_SKEW_MS = 2 * 60 * 1000; // 2 minutes

// The cookie stores "<issuedAtMs>.<hmacHex>", where the HMAC is keyed by
// SITE_PASSWORD and computed over a message that includes issuedAtMs. The
// timestamp is bound INTO the signed message (not just appended to the
// token) so it can't be edited after the fact to extend a session — any
// change to issuedAtMs invalidates the signature. The cookie still never
// reveals the real password.
const SESSION_MESSAGE_PREFIX = 'trackpitch-auth-session:';

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

export function passwordMatches(candidate: string): boolean {
  const correct = process.env.SITE_PASSWORD;
  if (!correct) return false;
  return timingSafeStringEqual(candidate, correct);
}

export function getSessionToken(issuedAtMs: number = Date.now()): string | null {
  const secret = process.env.SITE_PASSWORD;
  if (!secret) return null;
  const hmacHex = crypto
    .createHmac('sha256', secret)
    .update(SESSION_MESSAGE_PREFIX + issuedAtMs)
    .digest('hex');
  return `${issuedAtMs}.${hmacHex}`;
}

export function isAuthed(req: NextRequest): boolean {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return false;

  const secret = process.env.SITE_PASSWORD;
  if (!secret) return false;

  const sepIndex = token.lastIndexOf('.');
  if (sepIndex === -1) return false;

  const issuedAtStr = token.slice(0, sepIndex);
  const providedHmacHex = token.slice(sepIndex + 1);

  const issuedAtMs = Number(issuedAtStr);
  if (!Number.isFinite(issuedAtMs)) return false;

  const now = Date.now();
  if (issuedAtMs - now > CLOCK_SKEW_MS) return false;
  if (now - issuedAtMs > SESSION_MAX_AGE_MS) return false;

  const expectedHmacHex = crypto
    .createHmac('sha256', secret)
    .update(SESSION_MESSAGE_PREFIX + issuedAtStr)
    .digest('hex');

  return timingSafeStringEqual(providedHmacHex, expectedHmacHex);
}
