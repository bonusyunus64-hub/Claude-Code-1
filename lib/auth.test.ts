import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTH_COOKIE, SESSION_MAX_AGE_MS, passwordMatches, getSessionToken, isAuthed } from './auth';
import crypto from 'crypto';

function fakeReq(cookieValue: string | undefined) {
  return {
    cookies: { get: (name: string) => (name === AUTH_COOKIE && cookieValue !== undefined ? { value: cookieValue } : undefined) },
  } as unknown as Parameters<typeof isAuthed>[0];
}

describe('passwordMatches', () => {
  beforeEach(() => vi.stubEnv('SITE_PASSWORD', 'correct-horse-battery-staple'));
  afterEach(() => vi.unstubAllEnvs());

  it('accepts the correct password', () => {
    expect(passwordMatches('correct-horse-battery-staple')).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(passwordMatches('wrong-password')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(passwordMatches('')).toBe(false);
  });

  it('fails closed when SITE_PASSWORD is not configured', () => {
    vi.unstubAllEnvs();
    expect(passwordMatches('correct-horse-battery-staple')).toBe(false);
    expect(passwordMatches('')).toBe(false);
  });
});

describe('getSessionToken', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('derives the same token from the same SITE_PASSWORD and issue time', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const a = getSessionToken(1000);
    const b = getSessionToken(1000);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('never equals the password itself', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    expect(getSessionToken()).not.toBe('secret');
  });

  it('changes if the password changes', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret-one');
    const a = getSessionToken(1000);
    vi.stubEnv('SITE_PASSWORD', 'secret-two');
    const b = getSessionToken(1000);
    expect(a).not.toBe(b);
  });

  it('changes if the issue time changes', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const a = getSessionToken(1000);
    const b = getSessionToken(2000);
    expect(a).not.toBe(b);
  });

  it('returns null when SITE_PASSWORD is not configured', () => {
    expect(getSessionToken()).toBeNull();
  });
});

describe('isAuthed', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('authenticates a request carrying the correct session token', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const token = getSessionToken()!;
    expect(isAuthed(fakeReq(token))).toBe(true);
  });

  it('rejects a request with no auth cookie', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    expect(isAuthed(fakeReq(undefined))).toBe(false);
  });

  it('rejects a request with a garbage cookie value', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    expect(isAuthed(fakeReq('not-a-real-token'))).toBe(false);
  });

  it('rejects a token minted under a different SITE_PASSWORD (e.g. after rotation)', () => {
    vi.stubEnv('SITE_PASSWORD', 'old-secret');
    const staleToken = getSessionToken()!;
    vi.stubEnv('SITE_PASSWORD', 'new-secret');
    expect(isAuthed(fakeReq(staleToken))).toBe(false);
  });

  it('fails closed when SITE_PASSWORD is not configured, even with a cookie present', () => {
    expect(isAuthed(fakeReq('anything'))).toBe(false);
  });

  it('accepts a freshly issued token', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const token = getSessionToken(Date.now())!;
    expect(isAuthed(fakeReq(token))).toBe(true);
  });

  it('rejects a token older than the max session age', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const issuedAtMs = Date.now() - SESSION_MAX_AGE_MS - 1000;
    const token = getSessionToken(issuedAtMs)!;
    expect(isAuthed(fakeReq(token))).toBe(false);
  });

  it('accepts a token right up to the max session age', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const issuedAtMs = Date.now() - SESSION_MAX_AGE_MS + 1000;
    const token = getSessionToken(issuedAtMs)!;
    expect(isAuthed(fakeReq(token))).toBe(true);
  });

  it('rejects a token whose timestamp was edited after signing (tampered timestamp)', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const originalIssuedAtMs = Date.now() - 1000;
    const original = getSessionToken(originalIssuedAtMs)!;
    const sepIndex = original.lastIndexOf('.');
    const originalHmacHex = original.slice(sepIndex + 1);
    // Splice in a different (fresher) timestamp but keep the original signature.
    const tampered = `${originalIssuedAtMs + 1}.${originalHmacHex}`;
    expect(isAuthed(fakeReq(tampered))).toBe(false);
  });

  it('rejects a token with a tampered signature', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const original = getSessionToken(Date.now())!;
    const sepIndex = original.lastIndexOf('.');
    const issuedAtStr = original.slice(0, sepIndex);
    const badHmacHex = crypto.createHash('sha256').update('not-the-real-hmac').digest('hex');
    const tampered = `${issuedAtStr}.${badHmacHex}`;
    expect(isAuthed(fakeReq(tampered))).toBe(false);
  });

  it('rejects a malformed/legacy token (no timestamp separator)', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    // Old-format cookies were a bare HMAC hex string with no "." separator.
    const legacy = crypto.createHmac('sha256', 'secret').update('trackpitch-auth-session').digest('hex');
    expect(isAuthed(fakeReq(legacy))).toBe(false);
  });

  it('rejects a token whose timestamp is meaningfully in the future', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const issuedAtMs = Date.now() + 60 * 60 * 1000; // 1 hour ahead, well past clock-skew tolerance
    const token = getSessionToken(issuedAtMs)!;
    expect(isAuthed(fakeReq(token))).toBe(false);
  });

  it('rejects a token with a non-numeric issued-at value', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const badHmacHex = crypto.createHash('sha256').update('irrelevant').digest('hex');
    expect(isAuthed(fakeReq(`not-a-number.${badHmacHex}`))).toBe(false);
  });
});
