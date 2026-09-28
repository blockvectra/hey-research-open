/**
 * Calendar days in UTC — the one rule every relative-day word follows
 * (final production review, 2026-09-28).
 *
 * One ship at 2026-09-27T19:56Z, read at 2026-09-28T08:50Z, was "last ship
 * today" in the MCP render and "Today: …" in the snapshot summary (both
 * counted elapsed 24-hour blocks), while the Terminal's HEY Today said
 * "unlock on 2026-09-28 · in 1 day" and "on 2026-09-29 · in 1 day" for two
 * different dates (it rounded elapsed time up). A day word is a claim about a
 * date, so it is computed on dates: the UTC calendar date of the instant
 * against the UTC calendar date of `now`.
 *
 * - "today" only when both instants share a UTC date;
 * - "yesterday" when the instant is on the previous UTC date;
 * - "N days ago" / "in N days" is the difference between the two UTC dates.
 *
 * Surfaces keep their own long-range tail ("on 2026-01-02", "3 months ago")
 * and their own sub-day wording ("13h ago" is an elapsed time, not a day
 * word); what they may not do is call a date "today" that is not today.
 *
 * `@hey/mcp-core` is published on its own and cannot import this; it keeps a
 * copy that `apps/web/src/lib/relative-day-parity.test.ts` holds equal.
 */

export const UTC_DAY_MS = 86_400_000;

/** Midnight UTC of the instant's calendar date, in epoch milliseconds. */
export function utcDateStart(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/**
 * Whole UTC calendar days from `at`'s date to `now`'s date: 0 on the same
 * date, 1 when `at` was the previous date, negative when `at` is on a later
 * date than `now`.
 */
export function utcDaysAgo(at: Date, now: Date): number {
  return Math.round((utcDateStart(now) - utcDateStart(at)) / UTC_DAY_MS);
}

/**
 * The day word for a signed UTC date difference (`utcDaysAgo`): "today",
 * "yesterday", "3 days ago", "in 1 day", "in 3 days". No long-range tail.
 */
export function utcDayWords(daysAgo: number): string {
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo > 1) return `${daysAgo} days ago`;
  const ahead = -daysAgo;
  return `in ${ahead} day${ahead === 1 ? '' : 's'}`;
}

/** `utcDayWords(utcDaysAgo(at, now))`. */
export function utcRelativeDay(at: Date, now: Date): string {
  return utcDayWords(utcDaysAgo(at, now));
}
