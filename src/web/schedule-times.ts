/** A place whose clock the Schedules page shows times on. */
export interface Zone {
  readonly label: string;
  /** Its IANA name, so the offset follows that place's clock changes. */
  readonly timeZone: string;
}

/** Every schedule is shown on both of these clocks, whichever one it was set on. */
export const ZONES: readonly Zone[] = [
  { label: 'Sydney', timeZone: 'Australia/Sydney' },
  { label: 'Pacific', timeZone: 'America/Los_Angeles' },
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** What the clock in `timeZone` reads at `instant`, as the instant UTC reads the same. */
function wallClock(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((found) => found.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
}

/** The instant the clock in `timeZone` reads `wall` (as `wallClock` gives it). */
function instantAt(wall: number, timeZone: string): number {
  // The offset at a first guess, then at the instant that guess gives: the two differ when a clock
  // change falls between them.
  const guess = wall - (wallClock(wall, timeZone) - wall);
  return wall - (wallClock(guess, timeZone) - guess);
}

/** Minutes past midnight as `5:17am`. */
function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = String(minutes % 60).padStart(2, '0');
  return `${hour % 12 || 12}:${minute}${hour < 12 ? 'am' : 'pm'}`;
}

/**
 * A daily schedule's times (`05:17`, on the clock in `from`, where it was set) as the clock in `to`
 * reads them, earliest in the day first. The two places change their clocks on different dates, so
 * the answer is for the runs on the day it is at `now` in `from`.
 */
export function timesIn(
  times: readonly string[],
  from: string,
  to: string,
  now: Date,
): readonly string[] {
  const today = wallClock(now.getTime(), from);
  const midnight = today - (today % DAY);
  return times
    .map((time) => {
      const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      return (wallClock(instantAt(midnight + minutes * MINUTE, from), to) % DAY) / MINUTE;
    })
    .sort((a, b) => a - b)
    .map(clock);
}

/** `a`, `a and b`, `a, b and c`. */
export function list(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
