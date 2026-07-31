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
vi.mock('@/lib/unsubscribe', () => ({ getBlacklist: (...args: unknown[]) => getBlacklist(...args) }));
vi.mock('@/lib/mailSend', async () => {
  const actual = await vi.importActual<typeof import('./mailSend')>('./mailSend');
  return {
    ...actual,
    sendMessagesPooled: (...args: unknown[]) => sendMessagesPooled(...args),
  };
});

import { sendBroadcast, BroadcastSendPayload, BroadcastTarget } from './broadcastSend';

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

describe('sendBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Sender', email: 'sender@example.com', smtpHost: 'smtp.example.com', smtpPort: 465, smtpUser: 'user', smtpPass: 'pass' },
      error: null,
    });
    checkCapAllows.mockResolvedValue({ ok: true });
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

  it('stops with a 429 when the send cap is exceeded', async () => {
    checkCapAllows.mockResolvedValue({ ok: false, error: 'Daily send limit reached' });
    const res = await sendBroadcast(BASE_PAYLOAD, TARGETS, 'stationName');
    expect(res.status).toBe(429);
    expect(sendMessagesPooled).not.toHaveBeenCalled();
  });
});
