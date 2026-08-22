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
import { assignSubjectVariant } from '@/lib/mailSend';

function makeArtist(i: number): Artist {
  return {
    name: `Artist ${i}`, rostrUrl: '', genres: ['Pop'], type: 'Person', gender: 'FEMALE',
    spotifyFollowers: 1000, instagramFollowers: 0, youtubeSubscribers: 0,
    managementCompany: '', agencies: '', labels: '', publishers: '',
    managerNames: [`Manager ${i}`], managerEmails: [`artist${i}@example.com`],
    instagramHandle: '', avatarUrl: '',
  };
}

// Builds an artist sharing one manager address with any others given the same
// `email` — the shape needed to exercise groupArtistsByManagerEmail's "one
// manager, several matched artists" grouping without touching data/roster.json.
function makeSharedArtist(
  name: string,
  followers: number,
  overrides: Partial<Pick<Artist, 'genres' | 'gender' | 'managerNames' | 'managerEmails' | 'managementCompany'>> = {}
): Artist {
  return {
    name, rostrUrl: '', genres: ['Pop'], type: 'Person', gender: 'FEMALE',
    spotifyFollowers: followers, instagramFollowers: 0, youtubeSubscribers: 0,
    managementCompany: 'Acme Mgmt', agencies: '', labels: '', publishers: '',
    managerNames: ['Shared Manager'], managerEmails: ['shared@example.com'],
    instagramHandle: '', avatarUrl: '',
    ...overrides,
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

  describe('multi-artist grouping (phase 2: one manager, several matched artists)', () => {
    // Helper to reach the single OutboundMessage built for a send: every test
    // below sends to exactly one address (all matched artists share it).
    async function sendAndGetMessage(payload: Partial<DemosSendPayload>) {
      const res = await sendDemos({ ...BASE_PAYLOAD, ...payload });
      const body = await res.json();
      expect(sendMessagesPooled).toHaveBeenCalledTimes(1);
      const sentMessages = sendMessagesPooled.mock.calls[0][1] as { to: string; subject: string; body: string }[];
      return { res, body, sentMessages };
    }

    it('a group of exactly 1 artist is unchanged, even when multiArtistTemplate is supplied', async () => {
      getArtistsByGenres.mockReturnValue([makeSharedArtist('Solo', 500)]);
      const { sentMessages } = await sendAndGetMessage({
        multiArtistTemplate: 'MULTI: {{artistNames}}',
        multiArtistSubject: 'MULTI SUBJECT',
      });
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].subject).toBe('Track for Solo'); // DEFAULT_DEMOS_SUBJECT, not the multi subject
      expect(sentMessages[0].body).toContain('Hi Shared Manager, check out Track');
      expect(sentMessages[0].body).not.toContain('MULTI');
    });

    it('a group of 2+ artists with multiArtistTemplate gets one email naming both, using multiArtistSubject with no A/B split', async () => {
      const a1 = makeSharedArtist('Nori', 500);
      const a2 = makeSharedArtist('Cayo', 2000); // same genre, so followers break the tie: Cayo leads
      getArtistsByGenres.mockReturnValue([a1, a2]);
      const { sentMessages } = await sendAndGetMessage({
        multiArtistTemplate: 'Hi {{managerName}}, sharing {{artistNames}} ({{artistCount}} artists, {{otherCount}} others, pronoun: {{pronoun}}): {{trackTitle}} {{driveLink}} from {{senderName}}',
        multiArtistSubject: '{{trackTitle}} for {{artistNames}}',
        subjectTemplateB: 'SHOULD NEVER BE USED', // proves no A/B split reaches the multi-artist subject
      });
      expect(sentMessages).toHaveLength(1);
      const [msg] = sentMessages;
      expect(msg.to).toBe('shared@example.com');
      expect(msg.subject).toBe('Track for Cayo and Nori');
      expect(msg.body).toContain('sharing Cayo and Nori (2 artists, 0 others, pronoun: they)');
      expect(msg.body).not.toContain('SHOULD NEVER BE USED');
    });

    it('a group over NAMED_ARTIST_CAP caps the named artists and words the overflow correctly', async () => {
      const artists = [
        makeSharedArtist('D', 4000),
        makeSharedArtist('C', 3000),
        makeSharedArtist('B', 2000),
        makeSharedArtist('A', 1000),
      ];
      getArtistsByGenres.mockReturnValue(artists);
      const { sentMessages } = await sendAndGetMessage({
        multiArtistTemplate: '{{artistSummary}} -- all: {{allArtistNames}} -- count {{artistCount}} other {{otherCount}}',
        multiArtistSubject: 'New music',
      });
      const [msg] = sentMessages;
      // Ranked by followers (same genre, so genreFitScore ties): D, C, B, A.
      // Cap is 3, so D/C/B are named and A collapses into "1 other".
      expect(msg.body).toContain('D, C, B and 1 other -- all: D, C, B and A -- count 4 other 1');
    });

    it('no multiArtistTemplate: a 2+ artist group falls back to exactly today\'s single-artist email', async () => {
      const a1 = makeSharedArtist('Nori', 500);
      const a2 = makeSharedArtist('Cayo', 2000);
      getArtistsByGenres.mockReturnValue([a1, a2]);
      const { sentMessages } = await sendAndGetMessage({}); // no multiArtistTemplate at all
      expect(sentMessages).toHaveLength(1);
      const [msg] = sentMessages;
      // The one visible behavior change: rankArtistsForPitch (genre fit, then
      // followers), not raw followers alone, picks the winner — same result
      // here since genres tie, but it's rankArtistsForPitch making the call now.
      expect(msg.subject).toBe('Track for Cayo');
      expect(msg.body).toContain('Hi Shared Manager, check out Track');
      expect(msg.body).not.toContain('Nori');
    });

    it('blank/whitespace-only multiArtistTemplate is treated the same as absent', async () => {
      const a1 = makeSharedArtist('Nori', 500);
      const a2 = makeSharedArtist('Cayo', 2000);
      getArtistsByGenres.mockReturnValue([a1, a2]);
      const { sentMessages } = await sendAndGetMessage({ multiArtistTemplate: '   \n\t  ' });
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].subject).toBe('Track for Cayo');
      expect(sentMessages[0].body).not.toContain('Nori');
    });

    it('renders pronoun as the literal "they" for a multi-artist email even when the lead artist is FEMALE', async () => {
      const a1 = makeSharedArtist('Nori', 500, { gender: 'FEMALE' });
      const a2 = makeSharedArtist('Cayo', 2000, { gender: 'FEMALE' }); // lead artist, still not "she"
      getArtistsByGenres.mockReturnValue([a1, a2]);
      const { sentMessages } = await sendAndGetMessage({
        multiArtistTemplate: 'Thought {{pronoun}} might like this for {{trackTitle}}',
        multiArtistSubject: 'Subject',
      });
      expect(sentMessages[0].body).toContain('Thought they might like this');
    });

    it('a hand-added custom contact still beats a roster manager address collision', async () => {
      const a1 = makeSharedArtist('Nori', 500);
      const a2 = makeSharedArtist('Cayo', 2000);
      getArtistsByGenres.mockReturnValue([a1, a2]);
      const { sentMessages } = await sendAndGetMessage({
        multiArtistTemplate: 'MULTI ARTIST BODY',
        multiArtistSubject: 'MULTI SUBJECT',
        customContacts: [{ artistName: 'Custom Artist', managerName: 'Custom Mgr', managerEmail: 'shared@example.com' }],
      });
      expect(sentMessages).toHaveLength(1);
      const [msg] = sentMessages;
      expect(msg.body).toContain('Hi Custom Mgr, check out Track');
      expect(msg.body).not.toContain('MULTI ARTIST BODY');
    });

    it('multi-artist subject never splits A/B, regardless of which variant the address would hash to', async () => {
      // Find an address groupArtistsByManagerEmail/assignSubjectVariant would put
      // in the 'B' bucket, so a code path that mistakenly called
      // subjectTemplateFor for the multi-artist subject would visibly pick up
      // subjectTemplateB instead of multiArtistSubject.
      let email = '';
      for (let i = 0; i < 100; i++) {
        const candidate = `group${i}@example.com`;
        if (assignSubjectVariant(candidate) === 'B') { email = candidate; break; }
      }
      expect(email).not.toBe(''); // sanity check the search above actually found one

      const overrides = { managerNames: ['Shared Manager'], managerEmails: [email] };
      const a1 = makeSharedArtist('Nori', 500, overrides);
      const a2 = makeSharedArtist('Cayo', 2000, overrides);
      getArtistsByGenres.mockReturnValue([a1, a2]);
      const { sentMessages } = await sendAndGetMessage({
        multiArtistTemplate: 'Body for {{artistNames}}',
        multiArtistSubject: 'THE MULTI SUBJECT',
        subjectTemplateB: 'THE B VARIANT SUBJECT',
      });
      expect(sentMessages[0].subject).toBe('THE MULTI SUBJECT');
    });
  });
});
