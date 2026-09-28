import { describe, expect, it } from 'vitest';

import { utcDaysAgo, utcDayWords, utcRelativeDay } from './calendar';

const at = (iso: string) => new Date(iso);

describe('UTC calendar days (final production review, 2026-09-28)', () => {
  it('the reviewed case: 19:56 the evening before is yesterday, not today', () => {
    expect(utcRelativeDay(at('2026-09-27T19:56:00Z'), at('2026-09-28T08:50:00Z'))).toBe('yesterday');
  });

  it('"today" only on the same UTC date, either side of midnight', () => {
    expect(utcRelativeDay(at('2026-09-28T00:00:00Z'), at('2026-09-28T23:59:59Z'))).toBe('today');
    expect(utcRelativeDay(at('2026-09-27T23:59:59Z'), at('2026-09-28T00:00:01Z'))).toBe('yesterday');
    expect(utcRelativeDay(at('2026-09-28T23:59:59Z'), at('2026-09-28T00:00:01Z'))).toBe('today');
  });

  it('ahead is the date difference, never elapsed time rounded up', () => {
    const now = at('2026-09-28T08:50:00Z');
    expect(utcRelativeDay(at('2026-09-28T20:00:00Z'), now)).toBe('today');
    expect(utcRelativeDay(at('2026-09-29T00:00:00Z'), now)).toBe('in 1 day');
    expect(utcRelativeDay(at('2026-09-29T23:00:00Z'), now)).toBe('in 1 day');
    expect(utcRelativeDay(at('2026-09-30T01:00:00Z'), now)).toBe('in 2 days');
  });

  it('counts dates across a month end', () => {
    expect(utcDaysAgo(at('2026-09-29T23:30:00Z'), at('2026-10-02T00:10:00Z'))).toBe(3);
    expect(utcDayWords(3)).toBe('3 days ago');
    expect(utcDayWords(-3)).toBe('in 3 days');
  });
});
