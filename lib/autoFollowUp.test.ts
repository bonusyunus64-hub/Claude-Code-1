import { describe, it, expect } from 'vitest';
import { isCampaignDueForFollowUp, nonRespondedRecipients, buildFollowUpMessage } from './autoFollowUp';
import type { CampaignRecord } from './campaigns';

const NOW = Date.parse('2026-07-29T12:00:00Z');
const SIX_DAYS_AGO = new Date(NOW - 6 * 24 * 60 * 60 * 1000).toISOString();
const TWO_DAYS_AGO = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
const CUTOFF = NOW - 5 * 24 * 60 * 60 * 1000;

function baseCampaign(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: '1', trackTitle: 'Track', date: SIX_DAYS_AGO, type: 'demos',
    emails: ['a@example.com', 'b@example.com'],
    accountId: 'acct-1', driveLink: 'https://drive.example.com/x',
    ...overrides,
  };
}

describe('isCampaignDueForFollowUp', () => {
  it('is due when old enough, demos, and has what it needs', () => {
    expect(isCampaignDueForFollowUp(baseCampaign(), CUTOFF)).toBe(true);
  });

  it('is not due for non-demos campaigns (no follow-up template exists for them)', () => {
    expect(isCampaignDueForFollowUp(baseCampaign({ type: 'radio' }), CUTOFF)).toBe(false);
    expect(isCampaignDueForFollowUp(baseCampaign({ type: 'playlists' }), CUTOFF)).toBe(false);
  });

  it('is not due if a follow-up was already sent', () => {
    expect(isCampaignDueForFollowUp(baseCampaign({ followUpSentAt: Date.now() }), CUTOFF)).toBe(false);
  });

  it('is not due while a send is still in progress', () => {
    expect(isCampaignDueForFollowUp(baseCampaign({ pendingSend: { endpoint: '/api/send', payload: {} } }), CUTOFF)).toBe(false);
  });

  it('is not due without an account or drive link on record', () => {
    expect(isCampaignDueForFollowUp(baseCampaign({ accountId: undefined }), CUTOFF)).toBe(false);
    expect(isCampaignDueForFollowUp(baseCampaign({ driveLink: undefined }), CUTOFF)).toBe(false);
  });

  it('is not due if it was sent too recently', () => {
    expect(isCampaignDueForFollowUp(baseCampaign({ date: TWO_DAYS_AGO }), CUTOFF)).toBe(false);
  });
});

describe('nonRespondedRecipients', () => {
  it('excludes both responded and bounced addresses', () => {
    const campaign = baseCampaign({
      emails: ['a@example.com', 'b@example.com', 'c@example.com'],
      responded: ['a@example.com'],
      bounced: ['b@example.com'],
    });
    expect(nonRespondedRecipients(campaign)).toEqual(['c@example.com']);
  });

  it('is case-insensitive', () => {
    const campaign = baseCampaign({ emails: ['A@Example.com'], responded: ['a@example.com'] });
    expect(nonRespondedRecipients(campaign)).toEqual([]);
  });

  it('returns everyone when nobody has responded or bounced', () => {
    const campaign = baseCampaign({ emails: ['a@example.com', 'b@example.com'] });
    expect(nonRespondedRecipients(campaign)).toEqual(['a@example.com', 'b@example.com']);
  });

  it('excludes blacklisted addresses', () => {
    const campaign = baseCampaign({ emails: ['a@example.com', 'b@example.com'] });
    expect(nonRespondedRecipients(campaign, new Set(['a@example.com']))).toEqual(['b@example.com']);
  });

  it('is case-insensitive on the blacklist', () => {
    const campaign = baseCampaign({ emails: ['A@Example.com'] });
    expect(nonRespondedRecipients(campaign, new Set(['a@example.com']))).toEqual([]);
  });
});

describe('buildFollowUpMessage', () => {
  const template = 'Hi {{managerName}}, following up on {{trackTitle}} for {{artistName}}: {{driveLink}}';
  const subjectTemplate = 'Following Up: {{trackTitle}} for {{artistName}}';

  it('fills in recipient metadata when available', () => {
    const campaign = baseCampaign({
      recipients: [{ email: 'a@example.com', artistName: 'Nova', managerName: 'Sam', avatarUrl: '', genres: [], instagramHandle: '', spotifyFollowers: 0 }],
    });
    const msg = buildFollowUpMessage(campaign, 'a@example.com', template, subjectTemplate, '');
    expect(msg.to).toBe('a@example.com');
    expect(msg.body).toContain('Hi Sam');
    expect(msg.body).toContain('for Nova');
    expect(msg.body).toContain('https://drive.example.com/x');
    expect(msg.subject).toBe('Following Up: Track for Nova');
  });

  it('falls back to blank/generic fields when recipient metadata is missing', () => {
    const campaign = baseCampaign({ recipients: [] });
    const msg = buildFollowUpMessage(campaign, 'a@example.com', template, subjectTemplate, '');
    expect(msg.body).toContain('Hi there');
  });

  it('appends the sign-off when provided', () => {
    const campaign = baseCampaign({ recipients: [] });
    const msg = buildFollowUpMessage(campaign, 'a@example.com', template, subjectTemplate, 'Cheers,\nMe');
    expect(msg.body).toContain('Cheers,\nMe');
  });

  it('threads onto the original pitch when a Message-ID was recorded', () => {
    const campaign = baseCampaign({ messageIds: { 'a@example.com': '<original@example.com>' } });
    const msg = buildFollowUpMessage(campaign, 'a@example.com', template, subjectTemplate, '');
    expect(msg.inReplyTo).toBe('<original@example.com>');
  });

  it('omits inReplyTo when no Message-ID was recorded for that recipient', () => {
    const campaign = baseCampaign({ messageIds: {} });
    const msg = buildFollowUpMessage(campaign, 'a@example.com', template, subjectTemplate, '');
    expect(msg.inReplyTo).toBeUndefined();
  });
});
