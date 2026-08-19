import { describe, it, expect, vi, beforeEach } from 'vitest';

const getArtistsByGenres = vi.fn();
const resolveAccount = vi.fn();
const checkCapAllows = vi.fn();
const recordSends = vi.fn();
const getBlacklist = vi.fn();
// sendDemos goes through sendMessagesPooled (which owns the transport's
// create/send/close lifecycle) — same seam broadcastSend.test.ts/followUpSend.test.ts mock.
const sendMessagesPooled = vi.fn();

vi.mock('@/lib/roster', () => ({ getArtistsByGenres: (...args: unknown[]) => getArtistsByGenres(...args) }));
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

import { sendDemos, DemosSendPayload } from './demosSend';
import type { Artist } from '@/lib/roster';
import { MAX_CAMPAIGN_RECIPIENTS } from './sendLimits';

function makeArtist(i: number): Artist {
  return {
    name: `Artist ${i}`, rostrUrl: '', genres: ['Pop'], type: 'Person', gender: 'FEMALE',
    spotifyFollowers: 1000, instagramFollowers: 0, youtubeSubscribers: 0,
    managementCompany: '', agencies: '', labels: '', publishers: '',
    managerNames: [`Manager ${i}`], managerEmails: [`artist${i}@example.com`],
    instagramHandle: '', avatarUrl: '',
  };
}

const BASE_PAYLOAD: DemosSendPayload = {
  trackTitle: 'Track',
  driveLink: 'https://drive.example.com/x',
  genres: ['Pop'],
  emailTemplate: 'Hi {{managerName}}, check out {{trackTitle}}: {{driveLink}}',
  senderName: 'Sender',
};

describe('sendDemos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getArtistsByGenres.mockReturnValue([]);
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
    const res = await sendDemos({ ...BASE_PAYLOAD, trackTitle: '' });
    expect(res.status).toBe(400);
  });

  it('sends one message per matched artist and fills in the template', async () => {
    getArtistsByGenres.mockReturnValue([makeArtist(1), makeArtist(2)]);
    const res = await sendDemos(BASE_PAYLOAD);
    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(recordSends).toHaveBeenCalledWith(2, undefined);
  });

  describe('MAX_CAMPAIGN_RECIPIENTS ceiling', () => {
    it('sends normally at exactly the ceiling (25 is allowed)', async () => {
      getArtistsByGenres.mockReturnValue(Array.from({ length: MAX_CAMPAIGN_RECIPIENTS }, (_, i) => makeArtist(i)));
      // limit raised past DEFAULT_SEND_BATCH_SIZE (10) so this one request covers
      // the whole 25-recipient audience in a single page — the point of this test
      // is the ceiling's boundary, not pagination.
      const res = await sendDemos({ ...BASE_PAYLOAD, limit: MAX_CAMPAIGN_RECIPIENTS });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total).toBe(MAX_CAMPAIGN_RECIPIENTS);
      expect(body.sent).toBe(MAX_CAMPAIGN_RECIPIENTS);
      expect(recordSends).toHaveBeenCalledWith(MAX_CAMPAIGN_RECIPIENTS, undefined);
    });

    it('refuses outright one over the ceiling (26 is not allowed): HTTP 400, no mail sent, no quota recorded', async () => {
      getArtistsByGenres.mockReturnValue(Array.from({ length: MAX_CAMPAIGN_RECIPIENTS + 1 }, (_, i) => makeArtist(i)));
      const res = await sendDemos(BASE_PAYLOAD);
      expect(res.status).toBe(400);
      const body = await res.json();
      // Error names both the real matched total and the ceiling, in plain English.
      expect(body.error).toContain(String(MAX_CAMPAIGN_RECIPIENTS + 1));
      expect(body.error).toContain(String(MAX_CAMPAIGN_RECIPIENTS));
      expect(body.error).toContain('recipients');
      expect(sendMessagesPooled).not.toHaveBeenCalled();
      expect(recordSends).not.toHaveBeenCalled();
    });

    it('counts customContacts alongside roster-derived recipients toward the ceiling', async () => {
      // 20 roster artists + 6 custom contacts = 26 unique recipients, one over the ceiling.
      getArtistsByGenres.mockReturnValue(Array.from({ length: 20 }, (_, i) => makeArtist(i)));
      const customContacts = Array.from({ length: 6 }, (_, i) => ({
        artistName: `Custom ${i}`, managerName: `Custom Manager ${i}`, managerEmail: `custom${i}@example.com`,
      }));
      const res = await sendDemos({ ...BASE_PAYLOAD, customContacts });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('26');
      expect(sendMessagesPooled).not.toHaveBeenCalled();
    });

    it('cannot be walked around by paging: an over-limit audience is still refused on a request with a non-zero offset', async () => {
      // Simulates the dashboard's sendInBatches mid-campaign: it keeps paging with
      // a rising offset, but the full recipient set (allMessages) is rebuilt from
      // scratch on every request, so the ceiling check must fire identically no
      // matter what offset/limit this particular request carries.
      getArtistsByGenres.mockReturnValue(Array.from({ length: MAX_CAMPAIGN_RECIPIENTS + 1 }, (_, i) => makeArtist(i)));
      const res = await sendDemos({ ...BASE_PAYLOAD, offset: 10, limit: 5 });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain(String(MAX_CAMPAIGN_RECIPIENTS + 1));
      expect(sendMessagesPooled).not.toHaveBeenCalled();
      expect(recordSends).not.toHaveBeenCalled();
    });
  });
});
