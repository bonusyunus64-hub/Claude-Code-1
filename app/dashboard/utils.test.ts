import { describe, it, expect, vi, afterEach } from 'vitest';
import { csvEscape, parseContactsCsv, shuffle, countUniqueRecipients, sendInBatches, findDuplicateRecipients, messageIdsFromResults, computeAnalyticsStats } from './utils';
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

  /** A fake /api/send-shaped server: 10 recipients total, 4 per batch. */
  function stubPaginatedServer() {
    const totalRecipients = 10;
    const batchSize = 4;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { offset: number };
      const offset = body.offset ?? 0;
      const batch = Array.from({ length: Math.min(batchSize, totalRecipients - offset) }, (_, i) => offset + i);
      const results = batch.map(i => ({ to: `r${i}@example.com`, success: true, messageId: `m${i}` }));
      const nextOffset = offset + batch.length < totalRecipients ? offset + batch.length : null;
      return { ok: true, json: async () => ({ results, total: totalRecipients, nextOffset }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('pages through every batch starting from offset 0 by default', async () => {
    stubPaginatedServer();
    const ticks: number[] = [];
    const outcome = await sendInBatches('/api/send', {}, (progress) => { ticks.push(progress.sent); });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.results).toHaveLength(10);
    expect(ticks).toEqual([4, 8, 10]);
  });

  it('reports the offset the next batch would start from, and null once done', async () => {
    stubPaginatedServer();
    const nextOffsets: (number | null)[] = [];
    await sendInBatches('/api/send', {}, (_progress, _results, nextOffset) => { nextOffsets.push(nextOffset); });
    expect(nextOffsets).toEqual([4, 8, null]);
  });

  it('resumes from a given startOffset instead of restarting at 0', async () => {
    const fetchMock = stubPaginatedServer();
    const outcome = await sendInBatches('/api/send', {}, () => {}, 8);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.results.map(r => r.to)).toEqual(['r8@example.com', 'r9@example.com']);
    // Never re-requests the already-sent offset=0 batch.
    const requestedOffsets = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).offset);
    expect(requestedOffsets).toEqual([8]);
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
    expect(stats.replyRate).toBe(0.25);
    expect(stats.bounceRate).toBe(0.25);
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

  it('ignores recipient metadata from non-Demos campaigns for genre/follower-tier breakdowns', () => {
    const stats = computeAnalyticsStats([
      campaign({ id: '1', type: 'radio', emails: ['a@x.com'], recipients: [recipient({ email: 'a@x.com', genres: ['Rock'] })] }),
    ]);
    expect(stats.byGenre).toEqual([]);
  });
});
