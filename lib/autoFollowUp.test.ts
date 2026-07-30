import { describe, it, expect } from 'vitest';
import {
  isCampaignDueForFollowUp, nonRespondedRecipients, buildFollowUpMessage,
  computeFollowUpBudget, mergeEmailList,
} from './autoFollowUp';
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

  it('is still due when only some recipients have followUpSent (a partial run) and followUpSentAt is unset', () => {
    expect(isCampaignDueForFollowUp(
      baseCampaign({ emails: ['a@example.com', 'b@example.com'], followUpSent: ['a@example.com'] }),
      CUTOFF
    )).toBe(true);
  });

  it('is not due once followUpSentAt is set, even if followUpSent only covers some recipients', () => {
    expect(isCampaignDueForFollowUp(
      baseCampaign({
        emails: ['a@example.com', 'b@example.com'],
        followUpSent: ['a@example.com'],
        followUpSentAt: Date.now(),
      }),
      CUTOFF
    )).toBe(false);
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

  it('excludes addresses already recorded in followUpSent (a previous partial run)', () => {
    const campaign = baseCampaign({
      emails: ['a@example.com', 'b@example.com', 'c@example.com'],
      followUpSent: ['a@example.com'],
    });
    expect(nonRespondedRecipients(campaign)).toEqual(['b@example.com', 'c@example.com']);
  });

  it('is case-insensitive on followUpSent', () => {
    const campaign = baseCampaign({ emails: ['A@Example.com'], followUpSent: ['a@example.com'] });
    expect(nonRespondedRecipients(campaign)).toEqual([]);
  });

  it('behaves exactly as before when followUpSent is absent (older campaign records)', () => {
    const campaign = baseCampaign({
      emails: ['a@example.com', 'b@example.com'],
      responded: ['a@example.com'],
    });
    expect(nonRespondedRecipients(campaign)).toEqual(['b@example.com']);
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

describe('computeFollowUpBudget', () => {
  it('allows the most messages when there is no configured delay', () => {
    expect(computeFollowUpBudget(0)).toBe(30);
    expect(computeFollowUpBudget(undefined)).toBe(30);
  });

  it('shrinks the budget as sendDelay grows, so a run still fits inside maxDuration', () => {
    // 50 messages at a 2s delay would take 100s+ (the case this exists to prevent) —
    // the budget must come in well under 50.
    expect(computeFollowUpBudget(2000)).toBe(12);
    expect(computeFollowUpBudget(2000)).toBeLessThan(50);
  });

  it('never drops below the floor, even at the largest configured send delay', () => {
    expect(computeFollowUpBudget(10000)).toBe(3);
  });

  it('is monotonically non-increasing as delay increases', () => {
    const noDelay = computeFollowUpBudget(0);
    const shortDelay = computeFollowUpBudget(1000);
    const longDelay = computeFollowUpBudget(5000);
    expect(shortDelay).toBeLessThanOrEqual(noDelay);
    expect(longDelay).toBeLessThanOrEqual(shortDelay);
  });

  it('never exceeds the ceiling', () => {
    expect(computeFollowUpBudget(0)).toBeLessThanOrEqual(100);
  });
});

describe('mergeEmailList', () => {
  it('adds newly-sent addresses to an empty/absent list', () => {
    expect(mergeEmailList(undefined, ['a@example.com'])).toEqual(['a@example.com']);
  });

  it('keeps existing entries alongside new ones', () => {
    expect(mergeEmailList(['a@example.com'], ['b@example.com']).sort())
      .toEqual(['a@example.com', 'b@example.com']);
  });

  it('lowercases and dedupes', () => {
    expect(mergeEmailList(['A@Example.com'], ['a@example.com', 'B@Example.com']).sort())
      .toEqual(['a@example.com', 'b@example.com']);
  });
});

describe('retiring permanently-rejected follow-up recipients', () => {
  // The cron route records addresses that sendMessages flagged as `permanent` into
  // the campaign's `bounced` list. This covers the reason that matters: without it
  // such an address is never excluded by anything, so it stays a target and gets
  // retried on every single run forever (a synchronous SMTP rejection produces no
  // bounce message, so lib/checkReplies.ts can never discover it independently).
  const campaign: CampaignRecord = {
    id: 'c1', trackTitle: 'Track', date: new Date().toISOString(), type: 'demos',
    emails: ['good@example.com', 'dead@example.com'],
  };

  it('drops an address out of the target list once recorded as bounced', () => {
    const before = nonRespondedRecipients(campaign);
    expect(before).toContain('dead@example.com');

    const bounced = mergeEmailList(campaign.bounced, ['dead@example.com']);
    const after = nonRespondedRecipients({ ...campaign, bounced });
    expect(after).toEqual(['good@example.com']);
  });

  it('lets a campaign reach done once every recipient is either followed up or bounced', () => {
    const followUpSent = mergeEmailList(undefined, ['good@example.com']);
    const bounced = mergeEmailList(undefined, ['dead@example.com']);
    expect(nonRespondedRecipients({ ...campaign, followUpSent, bounced })).toEqual([]);
  });

  it('leaves a transient failure as a target, so it gets a fresh attempt next run', () => {
    // Only permanent failures are recorded, so a transiently-failed address is in
    // neither list and must still show up as work to do.
    const followUpSent = mergeEmailList(undefined, ['good@example.com']);
    expect(nonRespondedRecipients({ ...campaign, followUpSent })).toEqual(['dead@example.com']);
  });
});
