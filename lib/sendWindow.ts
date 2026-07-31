// Pure send-window scheduling logic: is a given instant inside the user's chosen
// "civilised hours" window, and if not, when does the window next open. Kept in
// its own module, away from hooks/components (see app/dashboard/hooks/useDemosFlow.ts
// and usePromotionChannel.ts for the callers), because timezone/DST arithmetic is
// exactly the kind of logic that's easy to get subtly wrong in a dozen small ways —
// it deserves its own focused tests (sendWindow.test.ts) rather than being
// re-derived and re-verified piecemeal wherever a send flow happens to need it.
//
// Every timestamp this module accepts or returns is a UTC epoch millisecond
// (Date.now()/getTime()) — the one unambiguous reference frame the rest of the app
// already uses for CampaignRecord.date etc. Local wall-clock time only ever exists
// transiently inside this file, to answer "is this instant within the window" or
// "what instant is the window's next opening" — it's never itself the thing stored
// or compared across timezones. Getting this backwards (storing a local wall time,
// or a raw UTC offset) is exactly what breaks twice a year at DST transitions —
// see isWithinSendWindow's and nextWindowOpenTime's doc comments for how each one
// avoids that.

export interface SendWindowSettings {
  /** Off = no restriction at all; isWithinSendWindow always returns true. */
  enabled: boolean;
  /** Local hour (0-23) the window opens, inclusive. */
  startHour: number;
  /** Local hour (0-23) the window closes, exclusive. */
  endHour: number;
  /** IANA zone name (e.g. "Europe/Istanbul") — never a raw UTC offset; see module doc comment. */
  timezone: string;
}

const MINUTE_MS = 60_000;

/** The wall-clock date/time components `utcMs` renders as in `timeZone`, per the
 *  platform's own ICU timezone database — this is the one place this module
 *  leans on the environment rather than computing offsets itself, which is
 *  deliberate: DST rules change over time (countries add/drop/move them), and
 *  Intl's tzdata is what actually stays current. */
function localPartsAt(utcMs: number, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  // hourCycle:'h23' should never produce 24, but some ICU builds have historically
  // returned "24" for midnight instead of "00" — `% 24` guards against that rather
  // than trusting the runtime to always get it right.
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/** Local hour (0-23) that `utcMs` falls in, within `timeZone`. */
export function getLocalHour(utcMs: number, timeZone: string): number {
  return localPartsAt(utcMs, timeZone).hour;
}

/** utcMs - (the UTC instant that reads as the same wall clock as utcMs, in timeZone) —
 *  i.e. how far ahead of UTC that zone's wall clock is at this instant. Positive east
 *  of Greenwich, negative west, and it changes across a DST transition, which is why
 *  this is computed fresh at whatever instant it's asked about rather than cached. */
function offsetMs(utcMs: number, timeZone: string): number {
  const p = localPartsAt(utcMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - utcMs;
}

/**
 * The UTC instant at which `timeZone`'s wall clock reads `year-month-day hour:minute:00`.
 * Iterates the offset correction a couple of times because the offset itself can
 * differ between "now" and the candidate instant (exactly the case across a DST
 * transition) — one correction alone can land a few minutes short when that happens.
 *
 * A wall-clock time that doesn't exist (spring-forward skips it) or that exists
 * twice (fall-back repeats it) has no single correct answer here; the iteration
 * still terminates and returns *some* nearby instant either way; callers that need
 * an exact guarantee (nextWindowOpenTime below) verify the result themselves rather
 * than trusting this blindly.
 */
function zonedWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const offset = offsetMs(guess, timeZone);
    const next = Date.UTC(year, month - 1, day, hour, minute, 0) - offset;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/**
 * Whether `utcMs` falls within the send window, evaluated in the window's own
 * timezone. Handles a window that crosses midnight (startHour > endHour, e.g.
 * 22:00-06:00) by treating it as "outside [endHour, startHour)" instead of
 * "inside [startHour, endHour)". startHour === endHour is treated as no
 * restriction at all (a zero-width window would otherwise never be open, which
 * isn't a useful setting for anyone to land in by picking the same hour twice).
 */
export function isWithinSendWindow(utcMs: number, settings: SendWindowSettings): boolean {
  if (!settings.enabled) return true;
  const { startHour, endHour, timezone } = settings;
  if (startHour === endHour) return true;
  const hour = getLocalHour(utcMs, timezone);
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour; // crosses midnight
}

// Upper bound on how far forward nextWindowOpenTime will search for the window's
// next opening. A window always recurs at least once every 24h, and DST shifts
// the clock by at most a couple of hours, so 3 days is generous headroom rather
// than a bound this is ever expected to actually hit — it exists purely so a
// pathological settings combination can't turn into an infinite loop.
const MAX_SEARCH_MINUTES = 60 * 24 * 3;

/**
 * The next UTC instant at or after `utcMs` at which the send window is open.
 * Returns `utcMs` itself when the window is already open (including when the
 * feature is off entirely) — so a caller can both ask "should I send right now"
 * (compare the result to `utcMs`) and "when should I schedule this for" with the
 * same function.
 *
 * Implementation: construct a candidate at the window's start hour on the
 * nearest applicable local day, correcting for that zone's UTC offset — then walk
 * forward a minute at a time (bounded by MAX_SEARCH_MINUTES) until the window is
 * actually open. The walk-forward isn't just a fallback for exotic edge cases: on
 * the day a clock springs forward, the constructed candidate's wall-clock hour may
 * not exist at all (the local clock jumps straight over it), so
 * zonedWallTimeToUtc's own answer can land close to, but not exactly on, the real
 * opening instant. The forward walk always terminates on the actual first minute
 * isWithinSendWindow reports true, regardless of how good the initial guess was —
 * that's what makes this correct across both DST transitions rather than merely
 * "usually correct except at the boundary."
 */
export function nextWindowOpenTime(utcMs: number, settings: SendWindowSettings): number {
  if (isWithinSendWindow(utcMs, settings)) return utcMs;

  const { startHour, timezone } = settings;
  const nowParts = localPartsAt(utcMs, timezone);
  // If today's local wall clock has already passed the start hour, the window
  // isn't open again until tomorrow (isWithinSendWindow already ruled out
  // "today, window opens later today" by returning false above only when we're
  // past today's opening — for a same-day-still-ahead case hour < startHour, so
  // dayOffset stays 0 and the candidate below lands on today).
  const dayOffset = nowParts.hour >= startHour ? 1 : 0;
  let candidate = zonedWallTimeToUtc(nowParts.year, nowParts.month, nowParts.day + dayOffset, startHour, 0, timezone);

  // Never walk backward past `utcMs` — a DST fall-back can make the offset
  // correction above land the initial guess slightly earlier than "now" (the
  // repeated hour resolving to its first occurrence), which would otherwise
  // report a "next" opening that's actually in the past.
  if (candidate < utcMs) candidate = utcMs;

  for (let i = 0; i < MAX_SEARCH_MINUTES && !isWithinSendWindow(candidate, settings); i++) {
    candidate += MINUTE_MS;
  }
  return candidate;
}

/**
 * Plain-English description of when a queued campaign will start, in the send
 * window's own timezone — "Scheduled to start today/tomorrow at 9:00 AM", falling
 * back to a short date further out, or a "should start any moment" message once
 * `scheduledForMs` has already passed (the drain hasn't caught up yet, but it
 * will on its next check — see useCampaignHistory's drain effect). Purely a
 * display helper: no scheduling decision anywhere in this module or its callers
 * ever goes through this, only through isWithinSendWindow/nextWindowOpenTime.
 */
export function describeScheduledSend(scheduledForMs: number, nowMs: number, timezone: string): string {
  const time = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(scheduledForMs);
  if (scheduledForMs <= nowMs) return `Waiting for your send window to open — should start any moment now (around ${time}).`;

  const dayKey = (ms: number) => {
    const p = localPartsAt(ms, timezone);
    return `${p.year}-${p.month}-${p.day}`;
  };
  const nowParts = localPartsAt(nowMs, timezone);
  // Built from "now"'s own local date +1 (rather than nowMs + 24h of raw
  // milliseconds) so a DST shift on the intervening night can't nudge which
  // calendar day this lands on.
  const tomorrowRepresentative = zonedWallTimeToUtc(nowParts.year, nowParts.month, nowParts.day + 1, nowParts.hour, nowParts.minute, timezone);

  const scheduledDay = dayKey(scheduledForMs);
  if (scheduledDay === dayKey(nowMs)) return `Scheduled to start today at ${time}`;
  if (scheduledDay === dayKey(tomorrowRepresentative)) return `Scheduled to start tomorrow at ${time}`;
  const dateStr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric' }).format(scheduledForMs);
  return `Scheduled to start ${dateStr} at ${time}`;
}
