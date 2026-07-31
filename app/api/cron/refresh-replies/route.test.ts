import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// lib/refreshReplies.ts is edited by other work in this repo concurrently and does real
// IMAP/campaign work — mocked at the module boundary so this test only exercises the
// route's own auth-gating logic, not refreshReplies' internals (which have their own tests).
const refreshRepliesMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/refreshReplies', () => ({ refreshReplies: refreshRepliesMock }));

let kvConfigured = true;
vi.mock('@/lib/kv', () => ({ isKvConfigured: () => kvConfigured }));

import { GET } from './route';

function cronReq(authHeader?: string) {
  return new NextRequest('http://localhost/api/cron/refresh-replies', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe('GET /api/cron/refresh-replies', () => {
  beforeEach(() => {
    kvConfigured = true;
    refreshRepliesMock.mockReset();
    refreshRepliesMock.mockResolvedValue({ accountsChecked: 0, campaignsChecked: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a request bearing the correct CRON_SECRET as an Authorization: Bearer header', async () => {
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
    const res = await GET(cronReq('Bearer the-cron-secret'));
    expect(res.status).toBe(200);
    expect(refreshRepliesMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong bearer token with 401 and does not run the refresh', async () => {
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
    const res = await GET(cronReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(refreshRepliesMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header at all', async () => {
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
    const res = await GET(cronReq());
    expect(res.status).toBe(401);
    expect(refreshRepliesMock).not.toHaveBeenCalled();
  });

  // Security invariant: an unset CRON_SECRET must fail closed (always 401), never fail
  // open into "any bearer token is accepted" — see isAuthorizedCronRequest's own doc
  // comment in lib/cronAuth.ts.
  it('fails closed (401) when CRON_SECRET is not configured, even with a bearer token present', async () => {
    const res = await GET(cronReq('Bearer anything'));
    expect(res.status).toBe(401);
    expect(refreshRepliesMock).not.toHaveBeenCalled();
  });

  it('short-circuits with ok:true and skips the refresh entirely when KV is not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
    kvConfigured = false;
    const res = await GET(cronReq('Bearer the-cron-secret'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(refreshRepliesMock).not.toHaveBeenCalled();
  });
});
