import { describe, it, expect } from 'vitest';
import { buildPreviewEntries, type PreviewCandidate } from './previewEntries';

// The email-preview modal has to agree with what the server will actually send:
// dedupeByRecipient (lib/mailSend.ts) collapses every message to the same address
// down to one, keeping the highest `rank` (ties keep the first seen). These tests
// exercise buildPreviewEntries against that same contract directly, without needing
// to render the Dashboard component or any templates.

function candidate(overrides: Partial<PreviewCandidate> & { to: string }): PreviewCandidate {
  return {
    subject: '', body: '', label: overrides.to, vars: {},
    ...overrides,
  };
}

const passthroughRender = (vars: Record<string, string>) => ({ subject: `subject:${vars.id ?? ''}`, body: `body:${vars.id ?? ''}` });

describe('buildPreviewEntries', () => {
  it('collapses several messages to the same address into one, keeping the highest rank', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'manager@label.com', rank: 500, label: 'Small Artist', vars: { id: 'small' } }),
      candidate({ to: 'manager@label.com', rank: 900000, label: 'Big Artist', vars: { id: 'big' } }),
      candidate({ to: 'manager@label.com', rank: 12000, label: 'Medium Artist', vars: { id: 'medium' } }),
    ];
    const { entries, total } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(total).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Big Artist');
    expect(entries[0].subject).toBe('subject:big');
  });

  it('address matching is case-insensitive, matching dedupeByRecipient', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'Manager@Label.com', rank: 10, label: 'A' }),
      candidate({ to: 'manager@label.com', rank: 20, label: 'B' }),
    ];
    const { total, entries } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(total).toBe(1);
    expect(entries[0].label).toBe('B');
  });

  it('keeps the first-seen entry when ranks tie, same as dedupeByRecipient', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'x@y.com', rank: 100, label: 'first' }),
      candidate({ to: 'x@y.com', rank: 100, label: 'second' }),
    ];
    const { entries } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(entries[0].label).toBe('first');
  });

  it('treats missing rank as 0, same as dedupeByRecipient\'s (msg.rank ?? 0)', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'x@y.com', label: 'no-rank' }),
      candidate({ to: 'x@y.com', rank: 1, label: 'has-rank' }),
    ];
    const { entries } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(entries[0].label).toBe('has-rank');
  });

  it('total is the deduped count, not the raw candidate count', () => {
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'a@x.com', label: 'a1' }),
      candidate({ to: 'a@x.com', label: 'a2' }),
      candidate({ to: 'b@x.com', label: 'b1' }),
    ];
    const { total } = buildPreviewEntries(candidates, 20, passthroughRender);
    expect(total).toBe(2);
  });

  it('applies the cap after dedup, not before', () => {
    // Three distinct addresses collapse to two after dedup; capping at 1 before
    // dedup would wrongly drop b@x.com from the total.
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'a@x.com', rank: 1, label: 'a-low' }),
      candidate({ to: 'a@x.com', rank: 2, label: 'a-high' }),
      candidate({ to: 'b@x.com', label: 'b' }),
    ];
    const { entries, total } = buildPreviewEntries(candidates, 1, passthroughRender);
    expect(total).toBe(2);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('a-high');
  });

  it('only calls render for candidates surviving dedup and the cap', () => {
    let renderCalls = 0;
    const countingRender = (vars: Record<string, string>) => { renderCalls++; return passthroughRender(vars); };
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'a@x.com', rank: 1 }),
      candidate({ to: 'a@x.com', rank: 2 }), // dedup drops this one's twin, not itself
      candidate({ to: 'b@x.com' }),
      candidate({ to: 'c@x.com' }),
    ];
    buildPreviewEntries(candidates, 2, countingRender);
    // 3 distinct addresses total, capped at 2 -> render should run exactly twice.
    expect(renderCalls).toBe(2);
  });

  it('returns an empty result for an empty candidate list', () => {
    expect(buildPreviewEntries([], 20, passthroughRender)).toEqual({ entries: [], total: 0, excludedByBlacklist: 0 });
  });

  it('passes the deduped recipient\'s address to render, not just their vars', () => {
    // Needed for subject-line A/B testing (lib/recipients.ts's subjectTemplateFor):
    // a caller has to know which address it's rendering for to pick the same
    // subject variant the server will actually send.
    const candidates: PreviewCandidate[] = [
      candidate({ to: 'a@x.com', rank: 1 }),
      candidate({ to: 'b@x.com' }),
    ];
    const seenAddresses: string[] = [];
    const recordingRender = (vars: Record<string, string>, to: string) => { seenAddresses.push(to); return passthroughRender(vars); };
    buildPreviewEntries(candidates, 20, recordingRender);
    expect(seenAddresses.sort()).toEqual(['a@x.com', 'b@x.com']);
  });

  describe('blacklist filtering', () => {
    it('drops a blacklisted address from both entries and total, and reports it as excluded', () => {
      const candidates: PreviewCandidate[] = [
        candidate({ to: 'a@x.com', label: 'A' }),
        candidate({ to: 'b@x.com', label: 'B' }),
      ];
      const { entries, total, excludedByBlacklist } = buildPreviewEntries(candidates, 20, passthroughRender, ['b@x.com']);
      expect(entries.map(e => e.to)).toEqual(['a@x.com']);
      expect(total).toBe(1);
      expect(excludedByBlacklist).toBe(1);
    });

    it('matches the blacklist case-insensitively', () => {
      const candidates: PreviewCandidate[] = [candidate({ to: 'Manager@Label.com', label: 'M' })];
      const { entries, total, excludedByBlacklist } = buildPreviewEntries(candidates, 20, passthroughRender, ['manager@label.com']);
      expect(entries).toEqual([]);
      expect(total).toBe(0);
      expect(excludedByBlacklist).toBe(1);
    });

    it('filters before dedup collapses to the final address, so a blacklisted duplicate is not double-counted', () => {
      const candidates: PreviewCandidate[] = [
        candidate({ to: 'a@x.com', rank: 1, label: 'a-low' }),
        candidate({ to: 'a@x.com', rank: 2, label: 'a-high' }),
      ];
      const { total, excludedByBlacklist } = buildPreviewEntries(candidates, 20, passthroughRender, ['a@x.com']);
      expect(total).toBe(0);
      expect(excludedByBlacklist).toBe(1);
    });

    it('defaults to no filtering when no blacklist is passed, matching pre-existing callers', () => {
      const candidates: PreviewCandidate[] = [candidate({ to: 'a@x.com' })];
      const { total, excludedByBlacklist } = buildPreviewEntries(candidates, 20, passthroughRender);
      expect(total).toBe(1);
      expect(excludedByBlacklist).toBe(0);
    });
  });
});
