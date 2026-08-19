import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveAccount = vi.fn();
const checkCapAllows = vi.fn();
const recordSends = vi.fn();
const getBlacklist = vi.fn();
// sendBroadcast now goes through sendMessagesPooled (which owns the transport's
// create/send/close lifecycle) rather than createTransport + sendMessages, so that's
// the seam to mock. Its second argument is still the message batch, which is what
// every assertion below inspects.
const sendMessagesPooled = vi.fn();

vi.mock('@/lib/accounts', () => ({ resolveAccount: (...args: unknown[]) => resolveAccount(...args) }));
vi.mock('@/lib/sendQuota', () => ({
  checkCapAllows: (...args: unknown[]) => checkCapAllows(...args),
  recordSends: (...args: unknown[]) => recordSends(...args),
}));
vi.mock('@/lib/doNotContact', () => ({ getBlacklist: (...args: unknown[]) => getBlacklist(...args) }));
vi.mock('@/lib/mailSend', async () => {
  const actual = await vi.importActual<typeof import('./mailSend')>('./mailSend');
  return {
    ...actual,
    sendMessagesPooled: (...args: unknown[]) => sendMessagesPooled(...args),
  };
});

import { sendBroadcast, BroadcastSendPayload, BroadcastTarget } from './broadcastSend';
import { MAX_CAMPAIGN_RECIPIENTS } from './sendLimits';

const BASE_PAYLOAD: BroadcastSendPayload = {
  trackTitle: 'Track',
  driveLink: 'https://drive.example.com/x',
  emailTemplate: 'Hi {{stationName}}, check out {{trackTitle}}: {{driveLink}}',
  senderName: 'Sender',
};

const TARGETS: BroadcastTarget[] = [
  { name: 'Station A', emails: ['a@example.com'] },
  { name: 'Station B', emails: ['b@example.com'] },
];

function makeTargets(n: number, prefix: string): BroadcastTarget[] {
  return Array.from({ length: n }, (_, i) => ({ name: `${prefix} ${i}`, emails: [`${prefix.toLowerCase()}${i}@example.com`] }));
}

describe('sendBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Sender', email: 'sender@example.com', smtpHost: 'smtp.example.com', smtpPort: 465, smtpUser: 'user', smtpPass: 'pass' },
      error: null,
    });
    checkCapAllows.mockResolvedValue({ allowed: Infinity });
    getBlacklist.mockResolvedValue(new Set());
    sendMessagesPooled.mockImplementation(async (_config, messages) =>
      messages.map((m: { to: string }) => ({ to: m.to, success: true, messageId: `<${m.to}>` }))
    );
  });

  it('rejects a payload missing required fields', async () => {
    const res = await sendBroadcast({ ...BASE_PAYLOAD, trackTitle: '' }, TARGETS, 'stationName');
    expect(res.status).toBe(400);
  });

  it('surfaces an account resolution error', async () => {
    resolveAccount.mockResolvedValue({ account: null, error: 'That email account is no longer available.' });
    const res = await sendBroadcast(BASE_PAYLOAD, TARGETS, 'stationName');
    expect(res.status).toBe(400);
  });

  it('sends one message per target and fills in the name variable', async () => {
    const res = await sendBroadcast(BASE_PAYLOAD, TARGETS, 'stationName');
    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(recordSends).toHaveBeenCalledWith(2, undefined);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    expect(sentMessages.map((m: { to: string }) => m.to).sort()).toEqual(['a@example.com', 'b@example.com']);
    expect(sentMessages.find((m: { to: string }) => m.to === 'a@example.com').body).toContain('Hi Station A');
  });

  it('excludes addresses on the server blacklist even when the client did not send them', async () => {
    getBlacklist.mockResolvedValue(new Set(['a@example.com']));
    const res = await sendBroadcast(BASE_PAYLOAD, TARGETS, 'stationName');
    const body = await res.json();
    expect(body.total).toBe(1);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    expect(sentMessages.map((m: { to: string }) => m.to)).toEqual(['b@example.com']);
  });

  it('excludes addresses on the client-supplied blacklist', async () => {
    const res = await sendBroadcast({ ...BASE_PAYLOAD, blacklist: ['b@example.com'] }, TARGETS, 'stationName');
    const body = await res.json();
    expect(body.total).toBe(1);
  });

  it('falls back to the app default subject, not the old "Music Submission:" wording, when subjectTemplate is blank', async () => {
    const res = await sendBroadcast({ ...BASE_PAYLOAD, subjectTemplate: '  ' }, TARGETS, 'stationName');
    expect(res.status).toBe(200);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    expect(sentMessages.find((m: { to: string }) => m.to === 'a@example.com').subject).toBe('Track for Station A');
  });

  it('uses {{curatorName}}, not a hardcoded {{stationName}}, in the default subject for a curator send', async () => {
    const res = await sendBroadcast({ ...BASE_PAYLOAD, subjectTemplate: undefined }, TARGETS, 'curatorName');
    expect(res.status).toBe(200);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    // vars only has `curatorName` set (see sendBroadcast's vars object), so a
    // default subject that still referenced {{stationName}} would render with
    // the placeholder left un-substituted rather than the target's actual name.
    expect(sentMessages.find((m: { to: string }) => m.to === 'a@example.com').subject).toBe('Track for Station A');
    expect(sentMessages.find((m: { to: string }) => m.to === 'a@example.com').subject).not.toContain('{{');
  });

  it('stops with a 429 when the send cap allows nothing at all', async () => {
    checkCapAllows.mockResolvedValue({ allowed: 0, error: 'Daily send limit reached' });
    const res = await sendBroadcast(BASE_PAYLOAD, TARGETS, 'stationName');
    expect(res.status).toBe(429);
    expect(sendMessagesPooled).not.toHaveBeenCalled();
  });

  it('trims the batch to a partial cap allowance instead of refusing it outright', async () => {
    // Two targets, but the cap only has room for one — the send should still go
    // out for the one it has room for, and the response should signal there's
    // more left (a non-null nextOffset) rather than silently dropping it.
    checkCapAllows.mockResolvedValue({ allowed: 1 });
    const res = await sendBroadcast(BASE_PAYLOAD, TARGETS, 'stationName');
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.batchTotal).toBe(1);
    expect(body.nextOffset).not.toBeNull();
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    expect(sentMessages).toHaveLength(1);
    expect(recordSends).toHaveBeenCalledWith(1, undefined);
  });

  describe('MAX_CAMPAIGN_RECIPIENTS ceiling', () => {
    it('sends normally at exactly the ceiling (25 is allowed)', async () => {
      const targets = makeTargets(MAX_CAMPAIGN_RECIPIENTS, 'Station');
      // limit raised past DEFAULT_SEND_BATCH_SIZE (10) so this one request covers
      // the whole 25-recipient audience in a single page — the point of this test
      // is the ceiling's boundary, not pagination.
      const res = await sendBroadcast({ ...BASE_PAYLOAD, limit: MAX_CAMPAIGN_RECIPIENTS }, targets, 'stationName');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total).toBe(MAX_CAMPAIGN_RECIPIENTS);
      expect(body.sent).toBe(MAX_CAMPAIGN_RECIPIENTS);
      expect(recordSends).toHaveBeenCalledWith(MAX_CAMPAIGN_RECIPIENTS, undefined);
    });

    it('refuses a radio send one over the ceiling, naming stations in the error', async () => {
      const targets = makeTargets(MAX_CAMPAIGN_RECIPIENTS + 1, 'Station');
      const res = await sendBroadcast(BASE_PAYLOAD, targets, 'stationName');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain(String(MAX_CAMPAIGN_RECIPIENTS + 1));
      expect(body.error).toContain(String(MAX_CAMPAIGN_RECIPIENTS));
      expect(body.error).toContain('stations');
      expect(sendMessagesPooled).not.toHaveBeenCalled();
      expect(recordSends).not.toHaveBeenCalled();
    });

    it('refuses a curator send one over the ceiling, naming curators in the error', async () => {
      const targets = makeTargets(MAX_CAMPAIGN_RECIPIENTS + 1, 'Curator');
      const res = await sendBroadcast(BASE_PAYLOAD, targets, 'curatorName');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('curators');
      expect(body.error).not.toContain('stations');
      expect(sendMessagesPooled).not.toHaveBeenCalled();
      expect(recordSends).not.toHaveBeenCalled();
    });

    it('cannot be walked around by paging: an over-limit audience is still refused on a request with a non-zero offset', async () => {
      const targets = makeTargets(MAX_CAMPAIGN_RECIPIENTS + 1, 'Station');
      const res = await sendBroadcast({ ...BASE_PAYLOAD, offset: 10, limit: 5 }, targets, 'stationName');
      expect(res.status).toBe(400);
      expect(sendMessagesPooled).not.toHaveBeenCalled();
      expect(recordSends).not.toHaveBeenCalled();
    });
  });
});
