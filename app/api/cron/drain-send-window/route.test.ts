import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { CampaignRecord } from '@/lib/campaigns';

// lib/campaigns.ts and lib/sendDispatch.ts are mocked at the module boundary so these
// tests can drive the route's own decisions (which campaigns are `due`, whether the
// Send Window blocks a send) without a real Redis or real SMTP behind them.
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
// Backs both tp_sign_off_image and the tp_send_window_* fields the route now reads via
// a single hgetall — see route.ts's settingsHash. Empty by default: no signature image,
// Send Window unconfigured (tp_send_window_enabled unset, which reads as "off").
// `unknown` rather than `string`: values are written as strings, but the Upstash client
// JSON-parses whatever it can on read, so what a route actually receives is a mix of
// strings, booleans and numbers. Typing this as Record<string, string> would make the
// realistic case (see the JSON-parsed test below) a type error rather than a scenario
// worth covering — and hgetall's own signature in route.ts already says unknown.
let settingsHash: Record<string, unknown> = {};
vi.mock('@/lib/kv', () => ({
  STATE_KEY: 'trackpitch:settings',
  isKvConfigured: () => kvConfigured,
  getRedis: () => ({ hgetall: async () => settingsHash }),
}));

import { GET } from './route';

function cronReq(authHeader?: string) {
  return new NextRequest('http://localhost/api/cron/drain-send-window', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

/** Response shape dispatchQueuedSend/sendDispatch resolves with — same fields drainQueuedCampaign reads. */
function sendResponse(overrides: {
  results?: { to: string; success: boolean; messageId?: string }[];
  nextOffset?: number | null;
  error?: string;
  status?: number;
} = {}) {
  const body = { results: overrides.results ?? [], nextOffset: overrides.nextOffset ?? null, error: overrides.error };
  const ok = overrides.status ? overrides.status < 400 : !overrides.error;
  return { ok, status: overrides.status ?? (ok ? 200 : 400), json: async () => body } as unknown as Response;
}

function campaign(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: 'c1',
    trackTitle: 'Track',
    date: '2026-01-01T00:00:00.000Z',
    type: 'demos',
    emails: [],
    pendingSend: { endpoint: '/api/send', payload: {} },
    scheduledFor: Date.now() - 1000,
    ...overrides,
  };
}

describe('GET /api/cron/drain-send-window', () => {
  beforeEach(() => {
    kvConfigured = true;
    settingsHash = {};
    listCampaignsMock.mockReset().mockResolvedValue([]);
    saveCampaignMock.mockReset().mockResolvedValue(undefined);
    // Default: merges newlySent onto emails and carries nextPendingSend through, close
    // enough to the real lib/campaigns.ts implementation for these tests' purposes —
    // they assert on dispatchQueuedSend/saveCampaign call counts and the route's own
    // response shape, not on mergeSendResultsIntoCampaign's own merge logic (that has
    // its own coverage in lib/campaigns.test.ts).
    mergeMock.mockReset().mockImplementation((current: CampaignRecord, newlySent: string[], _messageIds: unknown, nextPendingSend: CampaignRecord['pendingSend']) => ({
      ...current,
      emails: [...current.emails, ...newlySent],
      pendingSend: nextPendingSend,
    }));
    dispatchQueuedSendMock.mockReset();
    vi.stubEnv('CRON_SECRET', 'the-cron-secret');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function authedReq() {
    return cronReq('Bearer the-cron-secret');
  }

  it('accepts a request bearing the correct CRON_SECRET as an Authorization: Bearer header', async () => {
    const res = await GET(authedReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(listCampaignsMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong bearer token with 401 and never touches campaign storage', async () => {
    const res = await GET(cronReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(listCampaignsMock).not.toHaveBeenCalled();
    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header at all', async () => {
    const res = await GET(cronReq());
    expect(res.status).toBe(401);
    expect(listCampaignsMock).not.toHaveBeenCalled();
  });

  // Security invariant: an unset CRON_SECRET must fail closed (always 401) rather than
  // fail open — this is the route that can actually trigger a queued send, so a bug here
  // would be worse than the refresh-replies route's equivalent case.
  it('fails closed (401) when CRON_SECRET is not configured, even with a bearer token present', async () => {
    vi.unstubAllEnvs();
    const res = await GET(cronReq('Bearer anything'));
    expect(res.status).toBe(401);
    expect(listCampaignsMock).not.toHaveBeenCalled();
    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
  });

  it('short-circuits with ok:true and skips listing campaigns when KV is not configured', async () => {
    kvConfigured = false;
    const res = await GET(authedReq());
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(listCampaignsMock).not.toHaveBeenCalled();
  });

  // --- Bug 1: a campaign this route already partially sent must remain due ---

  it('picks up a campaign partially drained by an earlier run (pendingSend set, emails.length > 0) and finishes it', async () => {
    listCampaignsMock.mockResolvedValue([
      campaign({ id: 'c1', emails: ['already-sent@example.com'], scheduledFor: Date.now() - 60_000 }),
    ]);
    dispatchQueuedSendMock.mockResolvedValue(sendResponse({ results: [{ to: 'new@example.com', success: true }], nextOffset: null }));

    const res = await GET(authedReq());
    const body = await res.json();

    expect(dispatchQueuedSendMock).toHaveBeenCalledTimes(1);
    expect(saveCampaignMock).toHaveBeenCalledTimes(1);
    expect(body.due).toBe(1);
    expect(body.processed).toBe(1);
    expect(body.results[0]).toMatchObject({ campaignId: 'c1', sent: 1, failed: 0, done: true });
  });

  it('does not pick up a pendingSend campaign that was never send-window-queued (no scheduledFor) — that stays a manual Resume', async () => {
    listCampaignsMock.mockResolvedValue([
      campaign({ id: 'c1', emails: ['already-sent@example.com'], scheduledFor: undefined }),
    ]);

    const res = await GET(authedReq());
    const body = await res.json();

    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
    expect(body.due).toBe(0);
    expect(body.processed).toBe(0);
  });

  it('does not pick up a campaign whose scheduledFor is still in the future', async () => {
    listCampaignsMock.mockResolvedValue([
      campaign({ id: 'c1', scheduledFor: Date.now() + 60_000 }),
    ]);

    const res = await GET(authedReq());
    const body = await res.json();

    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
    expect(body.due).toBe(0);
  });

  // --- Bug 2: the drain must not fire outside the configured Send Window ---

  it('does not send a due campaign while the configured Send Window is closed, and leaves it queued', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T02:00:00.000Z')); // 02:00 UTC — outside a 9-17 UTC window
    settingsHash = {
      tp_send_window_enabled: 'true',
      tp_send_window_start_hour: '9',
      tp_send_window_end_hour: '17',
      tp_send_window_timezone: 'UTC',
    };
    listCampaignsMock.mockResolvedValue([campaign({ id: 'c1', scheduledFor: Date.now() - 60_000 })]);

    const res = await GET(authedReq());
    const body = await res.json();

    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
    expect(saveCampaignMock).not.toHaveBeenCalled();
    expect(body.due).toBe(1);
    expect(body.processed).toBe(0);
    expect(body.results).toEqual([]);
    expect(body.stopReason).toBe('sendWindowClosed');
  });

  // Bug 1 x Bug 2 interaction: a campaign this route already sent part of doesn't get an
  // exception from the window check just because it's "already in flight" — see route.ts's
  // header comment on why finishing it isn't treated as more urgent than respecting the window.
  it('also holds back an already-partly-sent campaign while the window is closed, rather than finishing it regardless', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T02:00:00.000Z'));
    settingsHash = {
      tp_send_window_enabled: 'true',
      tp_send_window_start_hour: '9',
      tp_send_window_end_hour: '17',
      tp_send_window_timezone: 'UTC',
    };
    listCampaignsMock.mockResolvedValue([
      campaign({ id: 'c1', emails: ['already-sent@example.com'], scheduledFor: Date.now() - 60_000 }),
    ]);

    const res = await GET(authedReq());
    const body = await res.json();

    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
    expect(body.processed).toBe(0);
    expect(body.stopReason).toBe('sendWindowClosed');
  });

  // The settings mocked above are what actually gets *written* — plain strings. But the
  // Upstash client auto-parses any stored value that is valid JSON on the way back out, so
  // a real deployment hands this route boolean true and number 9, not 'true' and '9'. That
  // makes this the shape that matters in production, and the one a strict `=== 'true'`
  // check silently fails on: the window reads as disabled and every queued campaign drains
  // at whatever hour the cron fires, which is the exact thing the check exists to prevent.
  // See route.ts's comment on sendWindowSettings, and /api/state's GET, which re-flattens
  // the same values with JSON.stringify for the same underlying reason.
  it('honours a closed window when Upstash returns the settings JSON-parsed rather than as strings', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T02:00:00.000Z')); // 02:00 UTC — outside a 9-17 UTC window
    settingsHash = {
      tp_send_window_enabled: true,
      tp_send_window_start_hour: 9,
      tp_send_window_end_hour: 17,
      tp_send_window_timezone: 'Europe/London', // not valid JSON, so this one genuinely does stay a string
    };
    listCampaignsMock.mockResolvedValue([campaign({ id: 'c1', scheduledFor: Date.now() - 60_000 })]);

    const res = await GET(authedReq());
    const body = await res.json();

    expect(dispatchQueuedSendMock).not.toHaveBeenCalled();
    expect(body.stopReason).toBe('sendWindowClosed');
  });

  it('sends normally when the Send Window is enabled but currently open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00.000Z')); // 12:00 UTC — inside a 9-17 UTC window
    settingsHash = {
      tp_send_window_enabled: 'true',
      tp_send_window_start_hour: '9',
      tp_send_window_end_hour: '17',
      tp_send_window_timezone: 'UTC',
    };
    listCampaignsMock.mockResolvedValue([campaign({ id: 'c1', scheduledFor: Date.now() - 60_000 })]);
    dispatchQueuedSendMock.mockResolvedValue(sendResponse({ results: [{ to: 'a@example.com', success: true }], nextOffset: null }));

    const res = await GET(authedReq());
    const body = await res.json();

    expect(dispatchQueuedSendMock).toHaveBeenCalledTimes(1);
    expect(body.stopReason).toBeNull();
    expect(body.processed).toBe(1);
  });

  it('drains a due campaign normally when no Send Window is configured at all', async () => {
    listCampaignsMock.mockResolvedValue([campaign({ id: 'c1', scheduledFor: Date.now() - 60_000 })]);
    dispatchQueuedSendMock.mockResolvedValue(sendResponse({ results: [{ to: 'a@example.com', success: true }], nextOffset: null }));

    const res = await GET(authedReq());
    const body = await res.json();

    expect(dispatchQueuedSendMock).toHaveBeenCalledTimes(1);
    expect(saveCampaignMock).toHaveBeenCalledTimes(1);
    expect(body.stopReason).toBeNull();
    expect(body.processed).toBe(1);
    expect(body.results[0]).toMatchObject({ campaignId: 'c1', sent: 1, done: true });
  });
});
