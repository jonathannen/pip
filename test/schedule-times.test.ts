import { describe, expect, it } from 'vitest';
import { list, timesIn, ZONES } from '../src/web/schedule-times';

const NEW_YORK = 'America/New_York';
const SYDNEY = 'Australia/Sydney';
const PACIFIC = 'America/Los_Angeles';

/** A schedule's line for each clock the page shows, as the page puts it. */
function lines(times: readonly string[], from: string, now: string): readonly string[] {
  return ZONES.map(
    (zone) => `${list(timesIn(times, from, zone.timeZone, new Date(now)))} ${zone.label}`,
  );
}

describe('schedule times', () => {
  it('shows a time set in a third zone on the Sydney and Pacific clocks', () => {
    // Late November: New York is on standard time, Sydney on daylight time.
    const now = '2026-11-27T16:48:00Z';
    expect(lines(['05:17'], NEW_YORK, now)).toEqual(['9:17pm Sydney', '2:17am Pacific']);
    expect(lines(['04:43'], NEW_YORK, now)).toEqual(['8:43pm Sydney', '1:43am Pacific']);
  });

  it('leaves a time alone on the clock it was set on', () => {
    const now = '2026-11-27T16:48:00Z';
    expect(lines(['06:34'], SYDNEY, now)).toEqual(['6:34am Sydney', '11:34am Pacific']);
    expect(lines(['07:36', '12:36', '17:36'], PACIFIC, now)).toEqual([
      '2:36am, 7:36am and 12:36pm Sydney',
      '7:36am, 12:36pm and 5:36pm Pacific',
    ]);
  });

  it('follows both places through their clock changes', () => {
    // July: New York on daylight time, Sydney on standard time.
    expect(lines(['05:17'], NEW_YORK, '2026-07-15T12:00:00Z')).toEqual([
      '7:17pm Sydney',
      '2:17am Pacific',
    ]);
    expect(lines(['06:34'], SYDNEY, '2026-07-15T12:00:00Z')).toEqual([
      '6:34am Sydney',
      '1:34pm Pacific',
    ]);
    // The weeks both are on daylight time: after Sydney's change on 4 October, before New York's
    // on 1 November.
    expect(lines(['05:17'], NEW_YORK, '2026-10-20T12:00:00Z')).toEqual([
      '8:17pm Sydney',
      '2:17am Pacific',
    ]);
    expect(lines(['06:34'], SYDNEY, '2026-10-20T12:00:00Z')).toEqual([
      '6:34am Sydney',
      '12:34pm Pacific',
    ]);
  });

  it('is right on the day the clocks change', () => {
    // 8 March 2026: New York goes forward at 2am, three hours before Los Angeles does, so that
    // morning's 5:17am run is at 1:17am Pacific, and 2:17am again from the next day.
    expect(timesIn(['05:17'], NEW_YORK, PACIFIC, new Date('2026-03-07T12:00:00Z'))).toEqual([
      '2:17am',
    ]);
    expect(timesIn(['05:17'], NEW_YORK, PACIFIC, new Date('2026-03-08T12:00:00Z'))).toEqual([
      '1:17am',
    ]);
    expect(timesIn(['05:17'], NEW_YORK, PACIFIC, new Date('2026-03-09T12:00:00Z'))).toEqual([
      '2:17am',
    ]);
    // 4 October 2026: Sydney goes forward at 2am, so 6:34am there is an hour earlier everywhere
    // else than the day before.
    expect(timesIn(['06:34'], SYDNEY, PACIFIC, new Date('2026-10-02T22:00:00Z'))).toEqual([
      '1:34pm',
    ]);
    expect(timesIn(['06:34'], SYDNEY, PACIFIC, new Date('2026-10-03T22:00:00Z'))).toEqual([
      '12:34pm',
    ]);
  });

  it('lists times that cross midnight earliest in the day first', () => {
    expect(
      timesIn(['03:00', '09:00', '17:00'], PACIFIC, SYDNEY, new Date('2026-11-27T16:48:00Z')),
    ).toEqual(['4:00am', '12:00pm', '10:00pm']);
    expect(timesIn(['05:00'], PACIFIC, SYDNEY, new Date('2026-11-27T16:48:00Z'))).toEqual([
      '12:00am',
    ]);
  });

  it('joins a list with commas and a final and', () => {
    expect(list(['a'])).toBe('a');
    expect(list(['a', 'b'])).toBe('a and b');
    expect(list(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
