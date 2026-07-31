import { describe, it, expect, vi, afterEach } from 'vitest';
import { csvEscape, parseContactsCsv, shuffle, countUniqueRecipients, sendInBatches, findDuplicateRecipients, messageIdsFromResults, computeAnalyticsStats, payloadForPendingSend, subjectTestWinner, countedResponders, deliveredCount } from './utils';
import type { Campaign, CampaignRecipient } from './types';

describe('shuffle', () => {
  it('preserves every element (no drops or duplicates)', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const result = shuffle(input);
    expect(result).toHaveLength(input.length);
    expect([...result].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it('every position is reachable by some element over many trials', () => {
    // A biased shuffle (e.g. Math.random() - 0.5 comparator) tends to leave some
    // elements stuck near their original index. Fisher-Yates shouldn't.
    const input = [0, 1, 2, 3, 4];
    const seenAtIndex: Set<number>[] = input.map(() => new Set());
    for (let trial = 0; trial < 500; trial++) {
      shuffle(input).forEach((value, idx) => seenAtIndex[idx].add(value));
    }
    seenAtIndex.forEach(seen => expect(seen.size).toBe(input.length));
  });
});

describe('payloadForPendingSend', () => {
  it('drops signOffImage but keeps every other field', () => {
    const payload = {
      trackTitle: 'Track', emailTemplate: 'Hi {{managerName}}', signOff: 'Best', signOffImage: 'data:image/png;base64,AAAA',
      customContacts: [{ artistName: 'A', managerName: 'M', managerEmail: 'm@x.com' }],
    };
    expect(payloadForPendingSend(payload)).toEqual({
      trackTitle: 'Track', emailTemplate: 'Hi {{managerName}}', signOff: 'Best',
      customContacts: [{ artistName: 'A', managerName: 'M', managerEmail: 'm@x.com' }],
    });
  });

  it('does not mutate the payload passed in', () => {
    const payload = { signOffImage: 'data:image/png;base64,AAAA' };
    payloadForPendingSend(payload);
    expect(payload.signOffImage).toBe('data:image/png;base64,AAAA');
  });

  it('is a no-op when the payload has no signOffImage', () => {
    const payload = { trackTitle: 'Track' };
    expect(payloadForPendingSend(payload)).toEqual({ trackTitle: 'Track' });
  });
});

describe('csvEscape', () => {
  it('quotes values containing commas, quotes, or newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
  });

  it('leaves plain values untouched', () => {
    expect(csvEscape('plain')).toBe('plain');
  });
});

describe('countUniqueRecipients', () => {
  it('counts each distinct address once across lists', () => {
    expect(countUniqueRecipients(['a@example.com', 'b@example.com'], ['b@example.com'])).toBe(2);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(countUniqueRecipients(['Manager@Example.com', ' manager@example.com '])).toBe(1);
  });

  it('matches the server dedupe scenario: one manager address covering many artists', () => {
    const managerEmails = Array.from({ length: 40 }, () => 'manager@label.com');
    expect(countUniqueRecipients(managerEmails, ['other@label.com'])).toBe(2);
  });

  it('returns 0 for no lists or empty lists', () => {
    expect(countUniqueRecipients()).toBe(0);
    expect(countUniqueRecipients([], [])).toBe(0);
  });
});

describe('sendInBatches', () => {
  afterEach(() => vi.unstubAllGlobals());

  type StubResult = { to: string; success: boolean; messageId?: string };

  /**
   * A fake /api/send-shaped server that mimics the real route's behavior: it
   * rebuilds `fullList` fresh on every call, unions the request's `excludeEmails`
   * into exclusion, and slices the first `batchSize` of what's left starting at
   * offset 0 — same semantics as paginate() in lib/mailSend.ts. `hardFail` marks
   * addresses that "send" but come back as a permanent failure, the way a 5xx SMTP
   * rejection would.
   */
  function stubExclusionServer(fullList: string[], batchSize: number, hardFail: Set<string> = new Set()) {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { offset: number; excludeEmails?: string[] };
      const exclude = new Set((body.excludeEmails ?? []).map(e => e.toLowerCase()));
      const remaining = fullList.filter(e => !exclude.has(e.toLowerCase()));
      const batch = remaining.slice(0, batchSize);
      const results: StubResult[] = batch.map(to => ({ to, success: !hardFail.has(to), messageId: hardFail.has(to) ? undefined : `<${to}>` }));
      const nextOffset = batch.length < remaining.length ? batch.length : null;
      return { ok: true, json: async () => ({ results, total: remaining.length, nextOffset }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('pages through every recipient across multiple rounds and terminates, always requesting offset 0', async () => {
    const list = Array.from({ length: 10 }, (_, i) => `r${i}@example.com`);
    const fetchMock = stubExclusionServer(list, 4);
    const outcome = await sendInBatches('/api/send', {}, () => {});
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.results.map(r => r.to).sort()).toEqual(list.slice().sort());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requestedOffsets = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).offset);
    expect(requestedOffsets).toEqual([0, 0, 0]);
  });

  it('carries every address attempted so far — not just successes — into the next round\'s excludeEmails', async () => {
    const list = Array.from({ length: 6 }, (_, i) => `r${i}@example.com`);
    const fetchMock = stubExclusionServer(list, 3, new Set(['r0@example.com']));
    const outcome = await sendInBatches('/api/send', {}, () => {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // r0 failed in round 1 — if it weren't excluded from round 2's request it would
    // be re-sent forever and the loop would never terminate.
    const roundExcludes = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).excludeEmails.sort());
    expect(roundExcludes[0]).toEqual([]);
    expect(roundExcludes[1]).toEqual(['r0@example.com', 'r1@example.com', 'r2@example.com']);
    // r0 shows up exactly once overall, marked failed, never retried.
    expect(outcome.results.filter(r => r.to === 'r0@example.com')).toHaveLength(1);
    expect(outcome.results.find(r => r.to === 'r0@example.com')?.success).toBe(false);
    expect(outcome.results).toHaveLength(6);
  });

  it('keeps the first round\'s total as the progress denominator even as the server-reported total shrinks', async () => {
    const list = Array.from({ length: 10 }, (_, i) => `r${i}@example.com`);
    stubExclusionServer(list, 4);
    const totals: number[] = [];
    await sendInBatches('/api/send', {}, (progress) => { totals.push(progress.total); });
    // The server's own total each round is 10, then 6, then 2 (post-exclusion) — the
    // callback must still report 10 every time, or the progress bar counts down.
    expect(totals).toEqual([10, 10, 10]);
  });

  it('still reaches every remaining recipient exactly once when the list shrinks mid-flight (simulated blacklist drift)', async () => {
    const list = Array.from({ length: 10 }, (_, i) => `r${i}@example.com`);
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      call++;
      const body = JSON.parse(init.body as string) as { excludeEmails?: string[] };
      const exclude = new Set((body.excludeEmails ?? []).map(e => e.toLowerCase()));
      // After the first round lands, someone unsubscribes r9 (still un-attempted) —
      // the server's rebuilt list no longer contains it from here on, same as a
      // real mid-send unsubscribe/bounce.
      const serverList = call > 1 ? list.filter(e => e !== 'r9@example.com') : list;
      const remaining = serverList.filter(e => !exclude.has(e.toLowerCase()));
      const batch = remaining.slice(0, 4);
      const results: StubResult[] = batch.map(to => ({ to, success: true }));
      const nextOffset = batch.length < remaining.length ? batch.length : null;
      return { ok: true, json: async () => ({ results, total: remaining.length, nextOffset }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await sendInBatches('/api/send', {}, () => {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const sentTo = outcome.results.map(r => r.to).sort();
    // Every recipient except the one that unsubscribed mid-send — none skipped,
    // none duplicated. (The old offset-based bug would have silently dropped a
    // *different*, still-eligible recipient here instead.)
    expect(sentTo).toEqual(list.filter(e => e !== 'r9@example.com').sort());
  });

  it('seeds the exclusion set from alreadyAttempted, so a resumed send never re-requests addresses already sent', async () => {
    const list = Array.from({ length: 5 }, (_, i) => `r${i}@example.com`);
    const fetchMock = stubExclusionServer(list, 5);
    const outcome = await sendInBatches('/api/send', {}, () => {}, ['r0@example.com', 'r1@example.com']);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.results.map(r => r.to).sort()).toEqual(['r2@example.com', 'r3@example.com', 'r4@example.com']);
    const firstExclude = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).excludeEmails.sort();
    expect(firstExclude).toEqual(['r0@example.com', 'r1@example.com']);
  });

  it('merges a payload-level excludeEmails (e.g. manually excluded artists) with attempted addresses', async () => {
    const list = Array.from({ length: 4 }, (_, i) => `r${i}@example.com`);
    const fetchMock = stubExclusionServer(list, 4);
    await sendInBatches('/api/send', { excludeEmails: ['r0@example.com'] }, () => {});
    const firstExclude = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).excludeEmails;
    expect(firstExclude).toEqual(['r0@example.com']);
  });

  it('bails out instead of looping forever when a round reports more work but returns no recipients', async () => {
    // A 200 response with no `results` (an edge/proxy error answering in place of the
    // route) leaves the exclusion set unchanged, so the next request would be
    // byte-for-byte identical — an infinite loop, since there's no longer a numeric
    // offset advancing on its own to break out of it.
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ nextOffset: 10, total: 40 }) }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await sendInBatches('/api/send', {}, () => {});
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/stopped returning recipients/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('parseContactsCsv', () => {
  it('parses artist,manager,email rows', () => {
    expect(parseContactsCsv('Nova,Sam,sam@example.com')).toEqual([
      { artistName: 'Nova', managerName: 'Sam', managerEmail: 'sam@example.com' },
    ]);
  });

  it('treats a 2-column row as artist,email', () => {
    expect(parseContactsCsv('Nova,sam@example.com')).toEqual([
      { artistName: 'Nova', managerName: '', managerEmail: 'sam@example.com' },
    ]);
  });

  it('skips a header row', () => {
    expect(parseContactsCsv('Artist,Email\nNova,sam@example.com')).toEqual([
      { artistName: 'Nova', managerName: '', managerEmail: 'sam@example.com' },
    ]);
  });

  it('skips rows without a valid email', () => {
    expect(parseContactsCsv('Nova,not-an-email')).toEqual([]);
  });
});

describe('findDuplicateRecipients', () => {
  const pitchedEmailMap = new Map<string, string[]>([
    ['a@example.com', ['Song One', 'Song Two']],
    ['b@example.com', ['Song Two']],
  ]);

  it('flags addresses already pitched the current track', () => {
    expect(findDuplicateRecipients(pitchedEmailMap, 'Song One', ['a@example.com', 'c@example.com'])).toEqual(['a@example.com']);
  });

  it('is case- and whitespace-insensitive on both the track title and the email', () => {
    expect(findDuplicateRecipients(pitchedEmailMap, '  song one  ', ['A@Example.com'])).toEqual(['A@Example.com']);
  });

  it('returns nothing when the track title is blank', () => {
    expect(findDuplicateRecipients(pitchedEmailMap, '', ['a@example.com'])).toEqual([]);
  });

  it('does not flag an address that was pitched a different track', () => {
    expect(findDuplicateRecipients(pitchedEmailMap, 'Song Three', ['a@example.com'])).toEqual([]);
  });

  it('dedupes repeated addresses in the input list', () => {
    expect(findDuplicateRecipients(pitchedEmailMap, 'Song Two', ['b@example.com', 'B@Example.com'])).toEqual(['b@example.com']);
  });
});

describe('messageIdsFromResults', () => {
  it('maps lowercased recipient to Message-ID for successful sends', () => {
    const ids = messageIdsFromResults([
      { to: 'Manager@Example.com', success: true, messageId: '<abc@mail>' },
      { to: 'b@example.com', success: true, messageId: '<def@mail>' },
    ]);
    expect(ids).toEqual({ 'manager@example.com': '<abc@mail>', 'b@example.com': '<def@mail>' });
  });

  it('skips failed sends and successes with no Message-ID', () => {
    const ids = messageIdsFromResults([
      { to: 'a@example.com', success: false, error: 'bounced' },
      { to: 'b@example.com', success: true },
    ]);
    expect(ids).toEqual({});
  });
});

describe('countedResponders', () => {
  function campaign(overrides: Partial<Campaign> = {}): Campaign {
    return { id: '1', trackTitle: 'Track', date: new Date().toISOString(), type: 'demos', emails: [], ...overrides };
  }

  it('excludes addresses classified as auto-reply, matching case-insensitively against lowercased classification keys', () => {
    const c = campaign({ responded: ['A@x.com', 'b@x.com'], classifications: { 'a@x.com': 'auto-reply', 'b@x.com': 'interested' } });
    expect(countedResponders(c)).toEqual(['b@x.com']);
  });

  it('keeps every responder unchanged when the campaign has no classifications at all (older records)', () => {
    const c = campaign({ responded: ['a@x.com', 'b@x.com'] });
    expect(countedResponders(c)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns an empty list when responded is missing', () => {
    expect(countedResponders(campaign())).toEqual([]);
  });
});

describe('deliveredCount', () => {
  function campaign(overrides: Partial<Campaign> = {}): Campaign {
    return { id: '1', trackTitle: 'Track', date: new Date().toISOString(), type: 'demos', emails: [], ...overrides };
  }

  it('subtracts bounced addresses that appear in emails, case-insensitively', () => {
    const c = campaign({ emails: ['a@x.com', 'B@x.com', 'c@x.com'], bounced: ['b@x.com'] });
    expect(deliveredCount(c)).toBe(2);
  });

  it('does not under- or over-subtract when bounced names an address not present in emails (stale record)', () => {
    const c = campaign({ emails: ['a@x.com'], bounced: ['a@x.com', 'ghost@x.com'] });
    expect(deliveredCount(c)).toBe(0);
  });

  it('equals emails.length when nothing bounced', () => {
    expect(deliveredCount(campaign({ emails: ['a@x.com', 'b@x.com'] }))).toBe(2);
  });
});

describe('computeAnalyticsStats', () => {
  function recipient(overrides: Partial<CampaignRecipient> = {}): CampaignRecipient {
    return { email: 'a@example.com', artistName: 'Nova', managerName: 'Sam', avatarUrl: '', genres: [], instagramHandle: '', spotifyFollowers: 0, ...overrides };
  }

  function campaign(overrides: Partial<Campaign> = {}): Campaign {
    return { id: '1', trackTitle: 'Track', date: new Date().toISOString(), type: 'demos', emails: [], ...overrides };
  }

  it('returns all-zero stats for no campaigns', () => {
    const stats = computeAnalyticsStats([]);
    expect(stats.totalCampaigns).toBe(0);
    expect(stats.totalEmailsSent).toBe(0);
    expect(stats.replyRate).toBe(0);
    expect(stats.bounceRate).toBe(0);
    expect(stats.lastCampaignDate).toBeNull();
    expect(stats.byType).toEqual([]);
  });

  it('totals emails sent and reply/bounce rates across campaigns', () => {
    const stats = computeAnalyticsStats([
      campaign({ id: '1', emails: ['a@x.com', 'b@x.com'], responded: ['a@x.com'] }),
      campaign({ id: '2', type: 'radio', emails: ['c@x.com', 'd@x.com'], bounced: ['c@x.com'] }),
    ]);
    expect(stats.totalCampaigns).toBe(2);
    expect(stats.totalEmailsSent).toBe(4);
    expect(stats.totalResponded).toBe(1);
    expect(stats.totalBounced).toBe(1);
    // replyRate divides by totalDelivered (4 emails - 1 bounced = 3), not totalEmailsSent.
    expect(stats.totalDelivered).toBe(3);
    expect(stats.replyRate).toBe(1 / 3);
    // bounceRate deliberately keeps dividing by every email sent, bounces included.
    expect(stats.bounceRate).toBe(0.25);
  });

  it('excludes auto-reply classified responders from totalResponded/replyRate, and reports them as totalAutoReplies', () => {
    const stats = computeAnalyticsStats([
      campaign({
        id: '1', emails: ['a@x.com', 'b@x.com', 'c@x.com'],
        responded: ['a@x.com', 'b@x.com'],
        classifications: { 'a@x.com': 'interested', 'b@x.com': 'auto-reply' },
      }),
    ]);
    expect(stats.totalResponded).toBe(1);
    expect(stats.totalAutoReplies).toBe(1);
    expect(stats.totalDelivered).toBe(3);
    expect(stats.replyRate).toBe(1 / 3);
  });

  it('excludes bounced addresses from the reply-rate denominator (totalDelivered), but bounceRate still divides by every email sent', () => {
    const stats = computeAnalyticsStats([
      campaign({
        id: '1', emails: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'],
        responded: ['a@x.com'],
        bounced: ['d@x.com'],
      }),
    ]);
    expect(stats.totalEmailsSent).toBe(4);
    expect(stats.totalDelivered).toBe(3);
    expect(stats.replyRate).toBe(1 / 3);
    expect(stats.bounceRate).toBe(0.25);
  });

  it('behaves exactly as before when a campaign has no classifications and no bounces at all (backward compatibility with older records)', () => {
    const stats = computeAnalyticsStats([
      campaign({ id: '1', emails: ['a@x.com', 'b@x.com'], responded: ['a@x.com'] }),
    ]);
    expect(stats.totalResponded).toBe(1);
    expect(stats.totalAutoReplies).toBe(0);
    expect(stats.totalDelivered).toBe(2);
    expect(stats.replyRate).toBe(0.5);
    expect(stats.bounceRate).toBe(0);
  });

  it('breaks reply rate down by campaign type, excluding types with no sends', () => {
    const stats = computeAnalyticsStats([
      campaign({ id: '1', type: 'demos', emails: ['a@x.com', 'b@x.com'], responded: ['a@x.com'] }),
    ]);
    expect(stats.byType).toEqual([{ label: 'Song Demos', sent: 2, responded: 1, replyRate: 0.5 }]);
  });

  it('picks the most recent campaign date', () => {
    const stats = computeAnalyticsStats([
      campaign({ id: '1', date: '2026-01-01T00:00:00.000Z' }),
      campaign({ id: '2', date: '2026-06-15T00:00:00.000Z' }),
      campaign({ id: '3', date: '2026-03-01T00:00:00.000Z' }),
    ]);
    expect(stats.lastCampaignDate).toBe('2026-06-15T00:00:00.000Z');
  });

  it('counts reply classifications across campaigns', () => {
    const stats = computeAnalyticsStats([
      campaign({ id: '1', classifications: { 'a@x.com': 'interested', 'b@x.com': 'pass' } }),
      campaign({ id: '2', classifications: { 'c@x.com': 'auto-reply', 'd@x.com': 'unclassified' } }),
    ]);
    expect(stats.classificationCounts).toEqual({ interested: 1, pass: 1, autoReply: 1, unclassified: 1 });
  });

  it('breaks reply rate down by genre and follower tier, using Demos recipient metadata only', () => {
    const stats = computeAnalyticsStats([
      campaign({
        id: '1', type: 'demos',
        emails: ['a@x.com', 'b@x.com'],
        responded: ['a@x.com'],
        recipients: [
          recipient({ email: 'a@x.com', genres: ['Pop'], spotifyFollowers: 5_000 }),
          recipient({ email: 'b@x.com', genres: ['Pop', 'Indie'], spotifyFollowers: 500_000 }),
        ],
      }),
    ]);
    expect(stats.byGenre).toEqual(expect.arrayContaining([
      { label: 'Pop', sent: 2, responded: 1, replyRate: 0.5 },
      { label: 'Indie', sent: 1, responded: 0, replyRate: 0 },
    ]));
    expect(stats.byFollowerTier).toEqual(expect.arrayContaining([
      { label: 'Under 10K', sent: 1, responded: 1, replyRate: 1 },
      { label: '100K–1M', sent: 1, responded: 0, replyRate: 0 },
    ]));
  });

  it('excludes bounced recipients from the genre/follower-tier `sent` counts, and auto-replies from `responded`', () => {
    const stats = computeAnalyticsStats([
      campaign({
        id: '1', type: 'demos',
        emails: ['a@x.com', 'b@x.com', 'c@x.com'],
        responded: ['a@x.com', 'c@x.com'],
        bounced: ['b@x.com'],
        classifications: { 'c@x.com': 'auto-reply' },
        recipients: [
          recipient({ email: 'a@x.com', genres: ['Pop'], spotifyFollowers: 5_000 }),
          recipient({ email: 'b@x.com', genres: ['Pop'], spotifyFollowers: 5_000 }), // bounced — excluded entirely
          recipient({ email: 'c@x.com', genres: ['Pop'], spotifyFollowers: 5_000 }), // auto-reply — counted as sent, not responded
        ],
      }),
    ]);
    expect(stats.byGenre).toEqual([{ label: 'Pop', sent: 2, responded: 1, replyRate: 0.5 }]);
    expect(stats.byFollowerTier).toEqual([{ label: 'Under 10K', sent: 2, responded: 1, replyRate: 0.5 }]);
  });

  it('ignores recipient metadata from non-Demos campaigns for genre/follower-tier breakdowns', () => {
    const stats = computeAnalyticsStats([
      campaign({ id: '1', type: 'radio', emails: ['a@x.com'], recipients: [recipient({ email: 'a@x.com', genres: ['Rock'] })] }),
    ]);
    expect(stats.byGenre).toEqual([]);
  });

  describe('subjectTests', () => {
    it('is empty when no campaign ran a subject test', () => {
      const stats = computeAnalyticsStats([campaign({ id: '1', emails: ['a@x.com'] })]);
      expect(stats.subjectTests).toEqual([]);
    });

    it('splits sent/responded per variant using subjectVariants, newest campaign first', () => {
      const stats = computeAnalyticsStats([
        campaign({
          id: '1', date: '2026-01-01T00:00:00.000Z',
          emails: ['a@x.com', 'b@x.com', 'c@x.com'],
          responded: ['a@x.com'],
          subjectA: 'Subject A', subjectB: 'Subject B',
          subjectVariants: { 'a@x.com': 'A', 'b@x.com': 'A', 'c@x.com': 'B' },
        }),
        campaign({
          id: '2', date: '2026-02-01T00:00:00.000Z',
          emails: ['d@x.com'], subjectA: 'Other A', subjectB: 'Other B',
          subjectVariants: { 'd@x.com': 'B' },
        }),
      ]);
      expect(stats.subjectTests).toHaveLength(2);
      expect(stats.subjectTests[0].campaignId).toBe('2'); // newest first
      expect(stats.subjectTests[1]).toMatchObject({
        campaignId: '1', subjectA: 'Subject A', subjectB: 'Subject B',
        sentA: 2, respondedA: 1, sentB: 1, respondedB: 0,
      });
    });

    it('excludes campaigns without subjectB (no test ran), even if subjectVariants somehow exists', () => {
      const stats = computeAnalyticsStats([
        campaign({ id: '1', emails: ['a@x.com'], subjectVariants: { 'a@x.com': 'A' } }),
      ]);
      expect(stats.subjectTests).toEqual([]);
    });

    it('excludes recipients with no recorded variant from both sides, rather than guessing', () => {
      const stats = computeAnalyticsStats([
        campaign({
          id: '1', emails: ['a@x.com', 'unknown@x.com'],
          subjectA: 'A', subjectB: 'B', subjectVariants: { 'a@x.com': 'A' },
        }),
      ]);
      expect(stats.subjectTests[0].sentA).toBe(1);
      expect(stats.subjectTests[0].sentB).toBe(0);
    });

    it('excludes a bounced recipient from sentA/sentB and an auto-reply from respondedA/respondedB, feeding subjectTestWinner the corrected counts', () => {
      const aEmails = Array.from({ length: 25 }, (_, i) => `a${i}@x.com`);
      const bEmails = Array.from({ length: 25 }, (_, i) => `b${i}@x.com`);
      const bouncedExtra = 'bbounced@x.com'; // assigned to B, bounced — must not land in sentB
      const autoReplyExtra = 'bauto@x.com'; // assigned to B, replied but classified auto-reply — must not land in respondedB

      const subjectVariants: Record<string, 'A' | 'B'> = {};
      aEmails.forEach(e => { subjectVariants[e] = 'A'; });
      bEmails.forEach(e => { subjectVariants[e] = 'B'; });
      subjectVariants[bouncedExtra] = 'B';
      subjectVariants[autoReplyExtra] = 'B';

      const respondedA = aEmails.slice(0, 10); // 10 of 25 => 40% reply rate
      const respondedBGenuine = bEmails.slice(0, 5); // 5 of 25 => 20% reply rate

      const stats = computeAnalyticsStats([
        campaign({
          id: '1',
          emails: [...aEmails, ...bEmails, bouncedExtra, autoReplyExtra],
          subjectA: 'Subject A', subjectB: 'Subject B', subjectVariants,
          responded: [...respondedA, ...respondedBGenuine, autoReplyExtra],
          bounced: [bouncedExtra],
          classifications: { [autoReplyExtra]: 'auto-reply' },
        }),
      ]);

      const test = stats.subjectTests[0];
      expect(test.sentA).toBe(25);
      expect(test.respondedA).toBe(10);
      // bouncedExtra never landed, so it's excluded from sentB entirely; autoReplyExtra
      // *was* delivered (it didn't bounce), so it still counts toward sentB — only its
      // reply is excluded, from respondedB.
      expect(test.sentB).toBe(26);
      expect(test.respondedB).toBe(5); // auto-reply extra excluded from the numerator
      // The winner call downstream must be made on these corrected counts, not
      // the raw sentB=27/respondedB=6 that ignoring bounces/auto-replies would produce.
      expect(test.winner).toBe(subjectTestWinner(25, 10, 26, 5));
    });
  });
});

describe('subjectTestWinner', () => {
  it('says too early to tell below the per-variant sample floor, no matter the gap', () => {
    // 19 sent apiece is just under the floor — even a lopsided-looking gap
    // shouldn't be called yet.
    expect(subjectTestWinner(19, 10, 19, 2)).toBeNull();
  });

  it('the illustrative example this feature was scoped around — 40 total, a 5-point gap — reads as noise', () => {
    // 20/20 split, 5-point gap (10% vs 15% reply rate): exactly the "too early
    // to tell" example from this feature's own spec.
    expect(subjectTestWinner(20, 2, 20, 3)).toBeNull();
  });

  it('calls a winner once the gap clearly clears the z-threshold at a healthy sample size', () => {
    // 200 sent apiece, 10% vs 30% reply rate — a real, obvious gap.
    expect(subjectTestWinner(200, 20, 200, 60)).toBe('B');
    expect(subjectTestWinner(200, 60, 200, 20)).toBe('A');
  });

  it('returns null rather than dividing by zero when nobody in either group has replied yet', () => {
    expect(subjectTestWinner(50, 0, 50, 0)).toBeNull();
  });

  it('is symmetric: swapping A and B swaps the winner', () => {
    expect(subjectTestWinner(100, 30, 100, 10)).toBe('A');
    expect(subjectTestWinner(100, 10, 100, 30)).toBe('B');
  });
});
