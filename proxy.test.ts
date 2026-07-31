import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { AUTH_COOKIE, getSessionToken } from '@/lib/auth';
import { vi } from 'vitest';

// proxy.ts is the session gate for the whole app: everything under /dashboard and
// everything under /api EXCEPT a small public allowlist requires a valid session
// cookie (lib/auth.ts's isAuthed). These tests exist so that adding a new route
// later doesn't silently end up unprotected, and so the public allowlist doesn't
// silently grow.

function reqFor(path: string, opts: { cookie?: string; authorization?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `${AUTH_COOKIE}=${opts.cookie}`;
  if (opts.authorization) headers.authorization = opts.authorization;
  return new NextRequest(`http://localhost${path}`, { headers });
}

describe('proxy', () => {
  afterEach(() => vi.unstubAllEnvs());

  describe('public paths — reachable with no session at all', () => {
    const publicApiPaths = [
      '/api/auth',
      '/api/logout',
      '/api/unsubscribe',
      '/api/cron/refresh-replies',
      '/api/cron/drain-send-window',
    ];

    it.each(publicApiPaths)('lets an unauthenticated request through to %s', (path) => {
      const res = proxy(reqFor(path));
      expect(res.status).toBe(200); // NextResponse.next()
    });

    it('lets an unauthenticated request through to the login page ("/")', () => {
      const res = proxy(reqFor('/'));
      expect(res.status).toBe(200);
    });

    it('lets an unauthenticated request through to the unsubscribe landing page ("/unsubscribe")', () => {
      const res = proxy(reqFor('/unsubscribe'));
      expect(res.status).toBe(200);
    });
  });

  describe('protected paths — require a valid session', () => {
    it('redirects an unauthenticated /dashboard request to the login page', () => {
      const res = proxy(reqFor('/dashboard'));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost/');
    });

    it('redirects an unauthenticated /dashboard/<sub-path> request too', () => {
      const res = proxy(reqFor('/dashboard/settings'));
      expect(res.status).toBe(307);
    });

    it('lets an authenticated /dashboard request through', () => {
      vi.stubEnv('SITE_PASSWORD', 'secret');
      const token = getSessionToken()!;
      const res = proxy(reqFor('/dashboard', { cookie: token }));
      expect(res.status).toBe(200);
    });

    // Every non-public /api path should 401 (JSON), not redirect — a fetch() caller
    // in the dashboard can't follow a redirect to an HTML login page usefully.
    const protectedApiPaths = [
      '/api/send',
      '/api/radio-send',
      '/api/state',
      '/api/blacklist',
      '/api/campaigns',
      '/api/accounts',
      '/api/send-followup',
      '/api/check-replies',
    ];

    it.each(protectedApiPaths)('rejects an unauthenticated request to %s with 401 JSON, not a redirect', async (path) => {
      const res = proxy(reqFor(path));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it.each(protectedApiPaths)('lets an authenticated request through to %s', (path) => {
      vi.stubEnv('SITE_PASSWORD', 'secret');
      const token = getSessionToken()!;
      const res = proxy(reqFor(path, { cookie: token }));
      expect(res.status).toBe(200);
    });

    // The invariant the README is emphatic about: CRON_SECRET authorises only the two
    // cron routes (checked inside those routes themselves via lib/cronAuth.ts) and is
    // deliberately NOT wired into proxy.ts as an alternative session credential anywhere
    // else. proxy.ts doesn't even look at the Authorization header, so a bearer token
    // (correct or not) must not substitute for the session cookie on a protected route —
    // otherwise a leaked CRON_SECRET would be enough to reach /api/send, which accepts an
    // arbitrary recipient list and message body.
    it('does NOT accept a CRON_SECRET bearer token as a substitute session on a protected API route', async () => {
      vi.stubEnv('CRON_SECRET', 'the-cron-secret');
      const res = proxy(reqFor('/api/send', { authorization: 'Bearer the-cron-secret' }));
      expect(res.status).toBe(401);
    });

    it('does NOT accept a CRON_SECRET bearer token as a substitute session for /dashboard either', () => {
      vi.stubEnv('CRON_SECRET', 'the-cron-secret');
      const res = proxy(reqFor('/dashboard', { authorization: 'Bearer the-cron-secret' }));
      expect(res.status).toBe(307); // redirected to login, same as no credential at all
    });
  });
});
