import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// lib/campaigns.ts and lib/sendDispatch.ts are mocked at the module boundary — this test
// is only about the route's auth gate (a correct/wrong/missing/unset CRON_SECRET), not the
// queued-send draining logic itself, which has no dedicated test coverage of its own here
// and is out of scope for this pass (see report).
const listCampaignsMock = vi.hoisted(() => vi.fn());
const saveCampaignMock = vi.hoisted(() => vi.fn());
const mergeMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/campaigns', () => ({
  listCampaigns: listCampaignsMock,
  saveCampaign: saveCampaignMock,
  mergeSendResultsIntoCampaign: mergeMock,
}));

const dispatchQueuedSendMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sendDispatch', () => ({ dispatchQueuedSend: dispatchQueuedSendMock }));

let kvConfigured = true;
vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hget: async () => null }),
}));

import { GET } from './route';

function cronReq(authHeader?: string) {
  return new NextRequest('http://localhost/api/cron/drain-send-window', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe('GET /api/cron/drain-send-window', () => {
  beforeEach(() => {
    kvConfigured = true;
    listCampaignsMock.mockReset().mockResolvedValue([]);
    saveCampaignMock.mockReset();
    mergeMock.mockReset();
    dispatchQueuedSendMock.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a request bearing the correct CRON_SECRET as an Authorization: Bearer header', async () => {
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
    const res = await GET(cronReq('Bearer the-cron-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(listCampaignsMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong bearer token with 401 and never touches campaign storage', async () => {
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
    const res = await GET(cronReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(listCampaignsMock).not.toHaveBeenCalled();
    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header at all', async () => {
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
    const res = await GET(cronReq());
    expect(res.status).toBe(401);
    expect(listCampaignsMock).not.toHaveBeenCalled();
  });

  // Security invariant: an unset CRON_SECRET must fail closed (always 401) rather than
  // fail open — this is the route that can actually trigger a queued send, so a bug here
  // would be worse than the refresh-replies route's equivalent case.
  it('fails closed (401) when CRON_SECRET is not configured, even with a bearer token present', async () => {
    const res = await GET(cronReq('Bearer anything'));
    expect(res.status).toBe(401);
    expect(listCampaignsMock).not.toHaveBeenCalled();
    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
  });

  it('short-circuits with ok:true and skips listing campaigns when KV is not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
    kvConfigured = false;
    const res = await GET(cronReq('Bearer the-cron-secret'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(listCampaignsMock).not.toHaveBeenCalled();
  });
});
