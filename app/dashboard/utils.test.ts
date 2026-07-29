import { describe, it, expect, vi, afterEach } from 'vitest';
import { csvEscape, parseContactsCsv, shuffle, countUniqueRecipients, sendInBatches } from './utils';

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
