import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTH_COOKIE, passwordMatches, getSessionToken, isAuthed } from './auth';

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

  it('derives a stable token from SITE_PASSWORD', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    const a = getSessionToken();
    const b = getSessionToken();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('never equals the password itself', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret');
    expect(getSessionToken()).not.toBe('secret');
  });

  it('changes if the password changes', () => {
    vi.stubEnv('SITE_PASSWORD', 'secret-one');
    const a = getSessionToken();
    vi.stubEnv('SITE_PASSWORD', 'secret-two');
    const b = getSessionToken();
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
});
