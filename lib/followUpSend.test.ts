import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveAccount = vi.fn();
const checkCapAllows = vi.fn();
const recordSends = vi.fn();
const getBlacklist = vi.fn();
const listCampaigns = vi.fn();
const saveCampaign = vi.fn();
const sendMessagesPooled = vi.fn();
const hgetall = vi.fn();

vi.mock('@/lib/accounts', () => ({ resolveAccount: (...args: unknown[]) => resolveAccount(...args) }));
vi.mock('@/lib/sendQuota', () => ({
  checkCapAllows: (...args: unknown[]) => checkCapAllows(...args),
  recordSends: (...args: unknown[]) => recordSends(...args),
}));
vi.mock('@/lib/doNotContact', () => ({ getBlacklist: (...args: unknown[]) => getBlacklist(...args) }));
vi.mock('@/lib/campaigns', () => ({
  listCampaigns: (...args: unknown[]) => listCampaigns(...args),
  saveCampaign: (...args: unknown[]) => saveCampaign(...args),
}));
vi.mock('@/lib/kv', () => ({
  getRedis: () => ({ hgetall }),
  isKvConfigured: () => true,
  STATE_KEY: 'trackpitch:settings',
}));
vi.mock('@/lib/mailSend', async () => {
  const actual = await vi.importActual<typeof import('./mailSend')>('./mailSend');
  return {
    ...actual,
    sendMessagesPooled: (...args: unknown[]) => sendMessagesPooled(...args),
  };
});

import { sendFollowUp, FollowUpSendPayload } from './followUpSend';
import type { CampaignRecord } from './campaigns';

const BASE_CAMPAIGN: CampaignRecord = {
  id: 'camp-1',
  trackTitle: 'Track',
  date: new Date().toISOString(),
  type: 'demos',
  emails: ['a@example.com', 'b@example.com', 'c@example.com'],
  accountId: 'acct-1',
  driveLink: 'https://drive.example.com/x',
  senderName: 'Sender',
  followUpTemplate: 'Hi {{managerName}}, following up on {{driveLink}}',
  followUpSubject: 'Following up: {{trackTitle}}',
  messageIds: {
    'a@example.com': '<pitch-a>',
    'b@example.com': '<pitch-b>',
    'c@example.com': '<pitch-c>',
  },
};

const BASE_PAYLOAD: FollowUpSendPayload = { campaignId: 'camp-1' };

describe('sendFollowUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCampaigns.mockResolvedValue([BASE_CAMPAIGN]);
    resolveAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Sender', email: 'sender@example.com', smtpHost: 'smtp.example.com', smtpPort: 465, smtpUser: 'user', smtpPass: 'pass' },
      error: null,
    });
    checkCapAllows.mockResolvedValue({ allowed: Infinity });
    getBlacklist.mockResolvedValue(new Set());
    hgetall.mockResolvedValue({ tp_followup_template: 'global template', tp_followup_subject: 'global subject' });
    saveCampaign.mockResolvedValue(undefined);
    sendMessagesPooled.mockImplementation(async (_config, messages) =>
      messages.map((m: { to: string }) => ({ to: m.to, success: true, messageId: `<followup-${m.to}>` }))
    );
  });

  it('404s when the campaign does not exist', async () => {
    listCampaigns.mockResolvedValue([]);
    const res = await sendFollowUp(BASE_PAYLOAD);
    expect(res.status).toBe(404);
  });

  it('400s for a non-demos campaign', async () => {
    listCampaigns.mockResolvedValue([{ ...BASE_CAMPAIGN, type: 'radio' }]);
    const res = await sendFollowUp(BASE_PAYLOAD);
    expect(res.status).toBe(400);
    expect(sendMessagesPooled).not.toHaveBeenCalled();
  });

  it('400s when accountId or driveLink is missing', async () => {
    listCampaigns.mockResolvedValue([{ ...BASE_CAMPAIGN, driveLink: undefined }]);
    const res = await sendFollowUp(BASE_PAYLOAD);
    expect(res.status).toBe(400);
  });

  it('surfaces an account resolution error as-is', async () => {
    resolveAccount.mockResolvedValue({ account: null, error: "This account's saved password can't be decrypted" });
    const res = await sendFollowUp(BASE_PAYLOAD);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("This account's saved password can't be decrypted");
  });

  it('targets only non-responded recipients, excluding replied/bounced/blacklisted/already-followed-up', async () => {
    listCampaigns.mockResolvedValue([{
      ...BASE_CAMPAIGN,
      emails: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'],
      responded: ['a@example.com'],
      bounced: ['b@example.com'],
      followUpSent: ['c@example.com'],
    }]);
    getBlacklist.mockResolvedValue(new Set(['d@example.com']));
    const res = await sendFollowUp(BASE_PAYLOAD);
    const body = await res.json();
    expect(body.sent).toBe(1);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    expect(sentMessages.map((m: { to: string }) => m.to)).toEqual(['e@example.com']);
  });

  it('returns an empty success, not an error, when nobody is left to follow up', async () => {
    // The dashboard's count can go stale — someone replies, or another tab
    // already followed the campaign up — so pressing the button with nothing
    // left must be a clean no-op. Without the zero-target guard this falls into
    // checkCapAllows's "batchSize was itself 0" branch, which reports allowed: 0
    // with no error string and would surface as a bare 429 reading as a failure.
    listCampaigns.mockResolvedValue([{
      ...BASE_CAMPAIGN,
      emails: ['a@example.com'],
      responded: ['a@example.com'],
    }]);
    const res = await sendFollowUp(BASE_PAYLOAD);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sent: 0, failed: 0, total: 0, batchTotal: 0, nextOffset: null, results: [] });
    // Nothing may be dispatched, and the send-batch loop must terminate.
    expect(sendMessagesPooled).not.toHaveBeenCalled();
    expect(body.nextOffset).toBeNull();
  });

  it('removes excludeEmails case-insensitively from the target list', async () => {
    const res = await sendFollowUp({ ...BASE_PAYLOAD, excludeEmails: ['A@EXAMPLE.COM'] });
    const body = await res.json();
    expect(body.total).toBe(2);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    expect(sentMessages.map((m: { to: string }) => m.to).sort()).toEqual(['b@example.com', 'c@example.com']);
  });

  it('prefers the campaign snapshot template/subject over the global settings', async () => {
    await sendFollowUp(BASE_PAYLOAD);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    const msg = sentMessages.find((m: { to: string }) => m.to === 'a@example.com');
    expect(msg.body).toContain('Hi there, following up on https://drive.example.com/x');
    expect(msg.subject).toBe('Following up: Track');
  });

  it('falls back to the global template when the campaign has no snapshot', async () => {
    listCampaigns.mockResolvedValue([{ ...BASE_CAMPAIGN, followUpTemplate: undefined, followUpSubject: undefined }]);
    hgetall.mockResolvedValue({ tp_followup_template: 'Global body {{driveLink}}', tp_followup_subject: 'Global subject {{trackTitle}}' });
    await sendFollowUp(BASE_PAYLOAD);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    const msg = sentMessages.find((m: { to: string }) => m.to === 'a@example.com');
    expect(msg.body).toContain('Global body https://drive.example.com/x');
    expect(msg.subject).toBe('Global subject Track');
  });

  it('falls back to the app default follow-up subject, not the old "Following Up:" wording, when both the campaign snapshot and global settings are blank', async () => {
    listCampaigns.mockResolvedValue([{ ...BASE_CAMPAIGN, followUpTemplate: undefined, followUpSubject: undefined }]);
    hgetall.mockResolvedValue({ tp_followup_template: 'Global body {{driveLink}}', tp_followup_subject: '' });
    await sendFollowUp(BASE_PAYLOAD);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    const msg = sentMessages.find((m: { to: string }) => m.to === 'a@example.com');
    // DEFAULT_FOLLOWUP_SUBJECT is `Re: {{trackTitle}} for {{artistName}}` — Track's
    // artist isn't set on BASE_CAMPAIGN, so it renders with an empty {{artistName}}.
    expect(msg.subject).toBe('Re: Track for ');
  });

  it('400s when the resolved template is blank', async () => {
    listCampaigns.mockResolvedValue([{ ...BASE_CAMPAIGN, followUpTemplate: undefined, followUpSubject: undefined }]);
    hgetall.mockResolvedValue({ tp_followup_template: '', tp_followup_subject: '' });
    const res = await sendFollowUp(BASE_PAYLOAD);
    expect(res.status).toBe(400);
    expect(sendMessagesPooled).not.toHaveBeenCalled();
  });

  it('threads onto the original pitch using campaign.messageIds', async () => {
    await sendFollowUp(BASE_PAYLOAD);
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    const msg = sentMessages.find((m: { to: string }) => m.to === 'a@example.com');
    expect(msg.inReplyTo).toBe('<pitch-a>');
  });

  it('stops with a 429 when the send cap allows nothing at all', async () => {
    checkCapAllows.mockResolvedValue({ allowed: 0, error: 'Daily send limit reached' });
    const res = await sendFollowUp(BASE_PAYLOAD);
    expect(res.status).toBe(429);
    expect(sendMessagesPooled).not.toHaveBeenCalled();
  });

  it('trims the batch to a partial cap allowance and still returns a non-null nextOffset', async () => {
    checkCapAllows.mockResolvedValue({ allowed: 2 });
    const res = await sendFollowUp(BASE_PAYLOAD);
    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(body.batchTotal).toBe(2);
    expect(body.nextOffset).not.toBeNull();
    const sentMessages = sendMessagesPooled.mock.calls[0][1];
    expect(sentMessages).toHaveLength(2);
    expect(recordSends).toHaveBeenCalledWith(2, 'acct-1');
  });

  it('records permanent failures in bounced', async () => {
    sendMessagesPooled.mockResolvedValue([
      { to: 'a@example.com', success: true, messageId: '<followup-a>' },
      { to: 'b@example.com', success: false, permanent: true, error: '550 no such user' },
      { to: 'c@example.com', success: true, messageId: '<followup-c>' },
    ]);
    await sendFollowUp(BASE_PAYLOAD);
    const saved = saveCampaign.mock.calls[0][0];
    expect(saved.bounced).toContain('b@example.com');
    expect(saved.followUpSent).toEqual(expect.arrayContaining(['a@example.com', 'c@example.com']));
  });

  it('sets followUpSentAt only once no targets remain', async () => {
    await sendFollowUp(BASE_PAYLOAD);
    const saved = saveCampaign.mock.calls[0][0];
    expect(saved.followUpSentAt).toBeTypeOf('number');
  });

  it('does not set followUpSentAt when a transient failure leaves a target unresolved', async () => {
    sendMessagesPooled.mockResolvedValue([
      { to: 'a@example.com', success: true, messageId: '<followup-a>' },
      { to: 'b@example.com', success: false, permanent: false, error: 'ETIMEDOUT' },
      { to: 'c@example.com', success: true, messageId: '<followup-c>' },
    ]);
    await sendFollowUp(BASE_PAYLOAD);
    const saved = saveCampaign.mock.calls[0][0];
    expect(saved.followUpSentAt).toBeUndefined();
  });
});
