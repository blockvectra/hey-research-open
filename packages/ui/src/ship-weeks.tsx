import { cn } from './cn';

/**
 * The 8-week counted-ship chart of a builder-list row (V2, founder 2026-10-29). The UI package restates the domain's
 * `ShipWeekSeries` as props (it does not import the domain).
 *
 * Three states a week can be in, each drawn differently and each said in words:
 *  - counted ships: a bar, its height relative to the row's own busiest week (never compared across rows: the chart is
 *    context beside a row the list already ordered, never a rank);
 *  - a measured zero: a short solid tick on the baseline;
 *  - not observed (the week ended before HEY first read the project): no bar and no tick, only a dotted baseline —
 *    never drawn as 0 (free-data rule 11, machine-layer rule 9).
 *
 * The last week is the one still running, so its mark is drawn lighter (`data-current`): this week so far.
 *
 * The bars are one labelled image whose label is the whole series in words, and the total stands beside it as text,
 * so no figure lives behind a hover.
 */
export type ShipWeekData = { week: string; ships: number | null };
export type ShipWeekSeriesData = { weeks: readonly ShipWeekData[]; total: number; observed: number };

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

/** The chart's text equivalent: "3 counted ships in 8 weeks, oldest first: not observed, 0, 1, 0, 0, 2, 0, 0." */
export function shipWeeksSentence(series: ShipWeekSeriesData): string {
  const weeks = series.weeks.length;
  if (series.observed === 0) return `Not observed: HEY had not read this project in these ${weeks} weeks.`;
  const list = series.weeks.map((entry) => (entry.ships === null ? 'not observed' : entry.ships.toLocaleString('en-US'))).join(', ');
  return `${plural(series.total, 'counted ship')} in ${weeks} weeks, oldest first: ${list}.`;
}

/** The bar heights of one row, 0–1: the row's busiest week is full, on a floor of four ships, so a lone ship is never a full bar. */
export function shipWeekHeights(series: ShipWeekSeriesData): (number | null)[] {
  const max = Math.max(4, ...series.weeks.map((entry) => entry.ships ?? 0));
  return series.weeks.map((entry) => (entry.ships === null ? null : entry.ships / max));
}

export function ShipWeeksChart({ series, className }: { series: ShipWeekSeriesData | undefined; className?: string }) {
  // No series at all: the read did not answer for this row. Unknown, said as such — never an empty chart that reads as 0.
  if (!series) {
    return (
      <span className={cn('text-t-meta text-hey-unavailable', className)} data-testid="ship-weeks" data-state="not-read">
        Not read
      </span>
    );
  }
  const heights = shipWeekHeights(series);
  const sentence = shipWeeksSentence(series);
  return (
    <span className={cn('v2-weeks', className)} data-testid="ship-weeks" data-state={series.observed === 0 ? 'not-observed' : 'observed'}>
      <span className="v2-weeks-bars" role="img" aria-label={sentence}>
        {series.weeks.map((entry, index) => {
          const height = heights[index] ?? null;
          return (
            <span
              key={entry.week}
              aria-hidden="true"
              className="v2-weeks-week"
              data-week={entry.week}
              data-ships={entry.ships === null ? 'not-observed' : String(entry.ships)}
              // The last week is still running (`ShipWeekSeries.weeks`): drawn lighter, so a short bar reads as "so far".
              {...(index === series.weeks.length - 1 ? { 'data-current': 'true' } : {})}
            >
              {height === null ? null : height === 0 ? <span className="v2-weeks-zero" /> : <span className="v2-weeks-bar" style={{ height: `${Math.round(height * 100)}%` }} />}
            </span>
          );
        })}
      </span>
      {/* The total as text beside the bars, with its unit (no hover-only data); assistive tech reads the sentence. */}
      <span aria-hidden="true" className="v2-weeks-total tabular-nums" data-testid="ship-weeks-total">
        {series.observed === 0 ? 'not observed' : plural(series.total, 'ship')}
      </span>
    </span>
  );
}
