import { describe, it, expect } from 'vitest';
import { getLocalHour, isWithinSendWindow, nextWindowOpenTime, describeScheduledSend, type SendWindowSettings } from './sendWindow';

function settings(overrides: Partial<SendWindowSettings> = {}): SendWindowSettings {
  return { enabled: true, startHour: 9, endHour: 17, timezone: 'UTC', ...overrides };
}

describe('getLocalHour', () => {
  it('reads the wall-clock hour in the given timezone, not UTC', () => {
    // 2026-01-15T06:00:00Z is 09:00 in Europe/Istanbul (UTC+3 year-round since 2016).
    expect(getLocalHour(Date.UTC(2026, 0, 15, 6, 0, 0), 'Europe/Istanbul')).toBe(9);
    expect(getLocalHour(Date.UTC(2026, 0, 15, 6, 0, 0), 'UTC')).toBe(6);
  });

  it('handles a non-hour UTC offset (Asia/Kolkata, UTC+5:30)', () => {
    // 2026-01-15T00:00:00Z is 05:30 in Kolkata — still hour 5.
    expect(getLocalHour(Date.UTC(2026, 0, 15, 0, 0, 0), 'Asia/Kolkata')).toBe(5);
    // 2026-01-15T18:30:00Z is 00:00 the next day in Kolkata.
    expect(getLocalHour(Date.UTC(2026, 0, 15, 18, 30, 0), 'Asia/Kolkata')).toBe(0);
  });
});

describe('isWithinSendWindow', () => {
  it('is always true when the feature is disabled, regardless of hour', () => {
    const s = settings({ enabled: false, startHour: 9, endHour: 17 });
    expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 2, 0, 0), s)).toBe(true);
    expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 23, 0, 0), s)).toBe(true);
  });

  it('treats a same-hour start/end as no restriction (a zero-width window would never open)', () => {
    const s = settings({ startHour: 9, endHour: 9 });
    expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 3, 0, 0), s)).toBe(true);
  });

  it('respects a normal same-day window, start inclusive and end exclusive', () => {
    const s = settings({ startHour: 9, endHour: 17 });
    expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 9, 0, 0), s)).toBe(true); // exactly at start
    expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 16, 59, 0), s)).toBe(true);
    expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 17, 0, 0), s)).toBe(false); // exactly at end — excluded
    expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 8, 59, 0), s)).toBe(false);
    expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 3, 0, 0), s)).toBe(false);
  });

  describe('a window crossing midnight (e.g. 22:00-06:00)', () => {
    const s = settings({ startHour: 22, endHour: 6 });

    it('is open late at night and early morning', () => {
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 22, 0, 0), s)).toBe(true);
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 23, 30, 0), s)).toBe(true);
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 0, 0, 0), s)).toBe(true);
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 5, 59, 0), s)).toBe(true);
    });

    it('is closed during the day', () => {
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 6, 0, 0), s)).toBe(false);
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 12, 0, 0), s)).toBe(false);
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 21, 59, 0), s)).toBe(false);
    });
  });

  describe('a timezone far from UTC (Europe/Istanbul, UTC+3)', () => {
    const s = settings({ startHour: 9, endHour: 17, timezone: 'Europe/Istanbul' });

    it('evaluates the window in local time, not UTC', () => {
      // 06:00Z = 09:00 Istanbul: inside. 05:59Z = 08:59 Istanbul: outside.
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 6, 0, 0), s)).toBe(true);
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 5, 59, 0), s)).toBe(false);
      // 14:00Z = 17:00 Istanbul: at the end boundary, excluded.
      expect(isWithinSendWindow(Date.UTC(2026, 0, 15, 14, 0, 0), s)).toBe(false);
    });
  });

  describe('DST transitions (America/New_York)', () => {
    it('spring-forward: the skipped hour (2am-3am on 2024-03-10) never reports as open, and the window resumes the instant the clock jumps', () => {
      const s = settings({ startHour: 2, endHour: 4, timezone: 'America/New_York' });
      // 06:59:59Z = 01:59:59 EST — outside [2,4).
      expect(isWithinSendWindow(Date.UTC(2024, 2, 10, 6, 59, 59), s)).toBe(false);
      // 07:00:00Z is the transition instant — local jumps straight to 03:00 EDT, which is inside [2,4).
      expect(isWithinSendWindow(Date.UTC(2024, 2, 10, 7, 0, 0), s)).toBe(true);
    });

    it('fall-back: the repeated hour (1am occurs twice on 2024-11-03) reports as open both times, not just once', () => {
      const s = settings({ startHour: 1, endHour: 2, timezone: 'America/New_York' });
      // 05:30Z = 01:30 EDT (first occurrence of 1am).
      expect(isWithinSendWindow(Date.UTC(2024, 10, 3, 5, 30, 0), s)).toBe(true);
      // 06:30Z = 01:30 EST (second occurrence of 1am, after the clocks fell back).
      expect(isWithinSendWindow(Date.UTC(2024, 10, 3, 6, 30, 0), s)).toBe(true);
      // 04:30Z = 00:30 EDT — outside, before either occurrence.
      expect(isWithinSendWindow(Date.UTC(2024, 10, 3, 4, 30, 0), s)).toBe(false);
      // 07:30Z = 02:30 EST — outside, after both occurrences.
      expect(isWithinSendWindow(Date.UTC(2024, 10, 3, 7, 30, 0), s)).toBe(false);
    });
  });
});

describe('nextWindowOpenTime', () => {
  it('returns the same instant when the window is already open', () => {
    const s = settings({ startHour: 9, endHour: 17 });
    const now = Date.UTC(2026, 0, 15, 12, 0, 0);
    expect(nextWindowOpenTime(now, s)).toBe(now);
  });

  it('returns the same instant when the feature is disabled', () => {
    const s = settings({ enabled: false, startHour: 9, endHour: 17 });
    const now = Date.UTC(2026, 0, 15, 3, 0, 0);
    expect(nextWindowOpenTime(now, s)).toBe(now);
  });

  it('finds later today when the window has not opened yet', () => {
    const s = settings({ startHour: 9, endHour: 17 });
    const now = Date.UTC(2026, 0, 15, 3, 0, 0);
    expect(nextWindowOpenTime(now, s)).toBe(Date.UTC(2026, 0, 15, 9, 0, 0));
  });

  it('rolls over to tomorrow when today\'s window has already closed', () => {
    const s = settings({ startHour: 9, endHour: 17 });
    const now = Date.UTC(2026, 0, 15, 20, 0, 0);
    expect(nextWindowOpenTime(now, s)).toBe(Date.UTC(2026, 0, 16, 9, 0, 0));
  });

  it('handles a window crossing midnight', () => {
    const s = settings({ startHour: 22, endHour: 6 });
    // 10:00 is inside the closed part of the day (window is 22:00-06:00) — next
    // opening is 22:00 the same day.
    expect(nextWindowOpenTime(Date.UTC(2026, 0, 15, 10, 0, 0), s)).toBe(Date.UTC(2026, 0, 15, 22, 0, 0));
  });

  it('resolves correctly in a timezone far from UTC (Europe/Istanbul, UTC+3)', () => {
    const s = settings({ startHour: 9, endHour: 17, timezone: 'Europe/Istanbul' });
    // Istanbul local 02:00 (23:00Z the previous day) — window opens at Istanbul
    // 09:00 the same local day, which is 06:00Z.
    const now = Date.UTC(2026, 0, 14, 23, 0, 0);
    const opened = nextWindowOpenTime(now, s);
    expect(opened).toBe(Date.UTC(2026, 0, 15, 6, 0, 0));
    expect(isWithinSendWindow(opened, s)).toBe(true);
  });

  describe('DST transitions (America/New_York)', () => {
    it('spring-forward: a window opening at the skipped hour (2am on 2024-03-10) opens the instant the clock jumps to 3am instead', () => {
      const s = settings({ startHour: 2, endHour: 4, timezone: 'America/New_York' });
      // 05:00Z = 00:00 EST, well before the window.
      const now = Date.UTC(2024, 2, 10, 5, 0, 0);
      const opened = nextWindowOpenTime(now, s);
      expect(opened).toBe(Date.UTC(2024, 2, 10, 7, 0, 0)); // the transition instant itself, local reads 03:00 EDT
      expect(isWithinSendWindow(opened, s)).toBe(true);
      expect(opened).toBeGreaterThanOrEqual(now);
    });

    it('fall-back: a window opening at the repeated hour (1am on 2024-11-03) opens at its first occurrence, not the second', () => {
      const s = settings({ startHour: 1, endHour: 2, timezone: 'America/New_York' });
      // 04:00Z = 00:00 EDT, before either occurrence of 1am.
      const now = Date.UTC(2024, 10, 3, 4, 0, 0);
      const opened = nextWindowOpenTime(now, s);
      expect(opened).toBe(Date.UTC(2024, 10, 3, 5, 0, 0)); // first (EDT) occurrence of 1am
      expect(isWithinSendWindow(opened, s)).toBe(true);
      expect(opened).toBeGreaterThanOrEqual(now);
    });

    it('never returns a time before "now", scanning every hour across both 2024 transition days', () => {
      const s = settings({ startHour: 3, endHour: 5, timezone: 'America/New_York' });
      for (const day of [10, 11] as const) { // March 10 (spring-forward) checked via UTC hours below
        for (let hour = 0; hour < 24; hour++) {
          const now = Date.UTC(2024, 2, day, hour, 0, 0);
          const opened = nextWindowOpenTime(now, s);
          expect(opened).toBeGreaterThanOrEqual(now);
          expect(isWithinSendWindow(opened, s)).toBe(true);
        }
      }
      for (let hour = 0; hour < 24; hour++) {
        const now = Date.UTC(2024, 10, 3, hour, 0, 0);
        const opened = nextWindowOpenTime(now, s);
        expect(opened).toBeGreaterThanOrEqual(now);
        expect(isWithinSendWindow(opened, s)).toBe(true);
      }
    });
  });
});

describe('describeScheduledSend', () => {
  const tz = 'Asia/Kolkata'; // UTC+5:30 — also exercises a non-whole-hour offset.

  it('describes a past-due schedule as about to start', () => {
    const now = Date.UTC(2026, 0, 15, 10, 0, 0);
    const scheduledFor = now - 60_000;
    expect(describeScheduledSend(scheduledFor, now, tz)).toMatch(/any moment/);
  });

  it('describes a same local day schedule as "today"', () => {
    // now = 04:00Z = 09:30 IST. scheduledFor = 06:00Z = 11:30 IST, same local day.
    const now = Date.UTC(2026, 0, 15, 4, 0, 0);
    const scheduledFor = Date.UTC(2026, 0, 15, 6, 0, 0);
    expect(describeScheduledSend(scheduledFor, now, tz)).toBe('Scheduled to start today at 11:30 AM');
  });

  it('describes a next local day schedule as "tomorrow"', () => {
    // now = 20:00Z Jan 15 = 01:30 IST Jan 16. scheduledFor = 04:00Z Jan 16 = 09:30 IST Jan 16 — still "today" relative to now's IST day (Jan 16)? Use a clearer case below instead.
    const now = Date.UTC(2026, 0, 15, 4, 0, 0); // 09:30 IST Jan 15
    const scheduledFor = Date.UTC(2026, 0, 16, 4, 0, 0); // 09:30 IST Jan 16
    expect(describeScheduledSend(scheduledFor, now, tz)).toBe('Scheduled to start tomorrow at 9:30 AM');
  });

  it('describes anything further out with a short date', () => {
    const now = Date.UTC(2026, 0, 15, 4, 0, 0);
    const scheduledFor = Date.UTC(2026, 0, 20, 4, 0, 0);
    expect(describeScheduledSend(scheduledFor, now, tz)).toBe('Scheduled to start Jan 20 at 9:30 AM');
  });
});

// Property-style sweeps rather than hand-picked instants. The per-case tests above
// pin down behaviour at boundaries someone reasoned about in advance; these two
// exist to catch the boundaries nobody thought of — the failure mode that actually
// matters here, since a wrong answer means real pitches going out at the wrong hour.
describe('nextWindowOpenTime invariants', () => {
  const NY = 'America/New_York'; // has both DST transitions, unlike UTC

  // Each nextWindowOpenTime call builds several Intl.DateTimeFormat instances, which
  // are expensive enough that a naive minute-by-minute sweep of a full year takes
  // long enough to trip vitest's default 5s timeout once the whole suite is running
  // in parallel. So the sweep is split: coarse across the year for broad coverage,
  // dense only around the two days where the arithmetic can actually go wrong.
  function sweep(fromMs: number, toMs: number, strideMs: number) {
    const s = settings({ timezone: NY });
    for (let cursor = fromMs; cursor < toMs; cursor += strideMs) {
      const open = nextWindowOpenTime(cursor, s);
      expect(open).toBeGreaterThanOrEqual(cursor);
      expect(isWithinSendWindow(open, s)).toBe(true);
    }
  }

  it('never returns a past instant, and always returns an open one, across a whole year', () => {
    // Deliberately not a whole number of hours, so the sweep lands on varied minute
    // offsets within the hour rather than repeatedly probing the top of it.
    sweep(Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1), 373 * 60_000);
  });

  it('holds minute-by-minute across both 2026 DST transitions', () => {
    // The two days the year-long sweep above could stride straight over: New York
    // springs forward on 8 Mar 2026 and falls back on 1 Nov 2026. A minute-level
    // stride either side of each is where an off-by-one-hour bug would surface.
    sweep(Date.UTC(2026, 2, 7, 12), Date.UTC(2026, 2, 9, 12), 60_000);
    sweep(Date.UTC(2026, 9, 31, 12), Date.UTC(2026, 10, 2, 12), 60_000);
  });

  it('rolls to the next day when the window spans an hour DST skips entirely', () => {
    // 2026 spring forward in New York: 02:00 EST jumps straight to 03:00 EDT on
    // 8 Mar, so a 02:00-03:00 window simply has no occurrence that day. The answer
    // has to be the 9th, not a nonexistent instant on the 8th and not a hang.
    const s = settings({ startHour: 2, endHour: 3, timezone: NY });
    const before = Date.parse('2026-03-08T06:30:00Z'); // 01:30 EST, half an hour before the jump
    const open = nextWindowOpenTime(before, s);
    expect(isWithinSendWindow(open, s)).toBe(true);
    const day = new Intl.DateTimeFormat('en-US', { timeZone: NY, dateStyle: 'medium' }).format(open);
    expect(day).toBe('Mar 9, 2026');
  });
});
