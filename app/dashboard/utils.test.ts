import { describe, it, expect } from 'vitest';
import { csvEscape, parseContactsCsv, shuffle } from './utils';

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
