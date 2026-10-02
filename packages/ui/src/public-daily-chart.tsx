import type { CSSProperties, ReactNode } from 'react';

import { cn } from './cn';
import { formatTerminalPriceLong } from './format';
import { ChartNote } from './market-charts';
import { buildChartModel, type CandleDay, type ChartEvent } from './terminal-chart';
import type { ChartRow, LaneEvent, RowDirection } from './terminal-chart-client';

/**
 * The public market page's daily candles (OA-G item 8, 2026-10-02).
 *
 * The Terminal's chart, reduced: 1D only, no timeframe switcher, no intraday,
 * no volume or indicators, no client island. The server half is the
 * Terminal's own — `buildChartModel` decides every candle's direction, the
 * price scale, the date ticks and where each ship sits on the time axis — and
 * this file only draws that model as one server-rendered SVG with HTML axes,
 * so it scales to a 320px phone without shrinking its text.
 *
 * CLAUDE.md UI rule 13, as the Terminal holds it:
 * - green (`--hey-market-up`) only for a measured close above open, red
 *   (`--hey-market-down`) only below, `--hey-market-flat` for a doji;
 * - a day HEY did not read draws nothing (a gap, never a zero); a close-only
 *   or mixed-series day and today (still open) are never green or red;
 * - a stale series (no reading in the last week) keeps its history but loses
 *   every direction colour, and a withheld series is not drawn at all;
 * - never colour alone: the legend says what the colours mean, and a
 *   screen-reader table carries each day's open, high, low, close and
 *   direction in words.
 *
 * Ship markers sit on the date axis by their time and precision, never on a
 * price, and say "Shipped" — placed by time, never a cause.
 */

/** The fields of HEY's daily index a candle reads (`TokenMarketDay` in the domain, restated: this package cannot import it). */
export type MarketDayForCandle = {
  day: string;
  priceOpenUsd?: number | undefined;
  priceHighUsd?: number | undefined;
  priceLowUsd?: number | undefined;
  priceCloseUsd?: number | undefined;
  tradeCloseUsd?: number | undefined;
  volume24hUsd?: number | undefined;
  readings: number;
  source?: string | undefined;
};

/**
 * A candle from ONE series, by the Terminal Market tab's rule (2026-09-26):
 * the price series when the day has a price close, else the trade close alone
 * — and a trade close beside price fields is `mixed`, which never takes a
 * direction.
 */
export function candleOfMarketDay(day: MarketDayForCandle): CandleDay {
  const base = { day: day.day, volume: day.volume24hUsd, readings: day.readings, source: day.source };
  if (day.priceCloseUsd !== undefined) {
    return { ...base, open: day.priceOpenUsd, high: day.priceHighUsd, low: day.priceLowUsd, close: day.priceCloseUsd, ohlcSource: 'price' };
  }
  if (day.tradeCloseUsd !== undefined) {
    const mixed = day.priceOpenUsd !== undefined || day.priceHighUsd !== undefined || day.priceLowUsd !== undefined;
    return { ...base, close: day.tradeCloseUsd, ohlcSource: mixed ? 'mixed' : 'trade' };
  }
  return base;
}

/** The one family the public chart draws. */
export const PUBLIC_SHIP_FAMILY = { key: 'ships', label: 'Ships', shape: 'circle', tone: 'var(--hey-ink-soft)' } as const;

const DIRECTION_WORDS: Readonly<Record<RowDirection, string>> = {
  u: 'Up: close above open',
  d: 'Down: close below open',
  f: 'Unchanged: close equals open',
  n: 'Close only: no direction',
  m: 'Mixed series: no direction',
  p: 'Today so far: no direction until the day closes',
  x: 'Read, no price',
};

const UP = 'var(--hey-market-up)';
const DOWN = 'var(--hey-market-down)';
const FLAT = 'var(--hey-market-flat)';

/** Plot units: each day is a 10-unit column; the price runs 0 (high) to 1000 (low). */
const COL = 10;
const PLOT_H = 1000;

const priceText = (value: number | null | undefined) => (typeof value === 'number' ? formatTerminalPriceLong(value) : 'not read');

/** A label's place on the axis that never pushes past either edge: the ends align inward. */
function edgeStyle(position: number): CSSProperties {
  if (position < 8) return { left: `${position}%` };
  if (position > 92) return { right: `${100 - position}%` };
  return { left: `${position}%`, transform: 'translateX(-50%)' };
}

function Candle({ row, index, y, coloured }: { row: ChartRow; index: number; y: (v: number) => number; coloured: boolean }) {
  if (row.length === 1) return null; // a day HEY did not read: nothing, never a zero
  const [day, open, high, low, close, , , dir] = row;
  if (dir === 'x' || close === null) return null;
  const x0 = index * COL;
  const mid = x0 + COL / 2;
  const measured = dir === 'u' || dir === 'd' || dir === 'f';
  // Only a measured, closed day in a current series takes a market colour.
  const colour = coloured && dir === 'u' ? UP : coloured && dir === 'd' ? DOWN : FLAT;
  const common = { 'data-day': day, 'data-dir': coloured ? dir : `${dir}-uncoloured` };
  if (!measured && dir !== 'p') {
    // Close only or mixed: a short tick at the close, no body and no wick.
    return (
      <g {...common}>
        <line x1={x0 + 2} x2={x0 + COL - 2} y1={y(close)} y2={y(close)} stroke={FLAT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </g>
    );
  }
  const hi = typeof high === 'number' ? high : Math.max(open ?? close, close);
  const lo = typeof low === 'number' ? low : Math.min(open ?? close, close);
  const o = open ?? close;
  const top = y(Math.max(o, close));
  const bottom = y(Math.min(o, close));
  const filled = coloured && (dir === 'u' || dir === 'd');
  return (
    <g {...common}>
      <line x1={mid} x2={mid} y1={y(hi)} y2={y(lo)} stroke={colour} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {dir === 'f' ? (
        <line x1={x0 + 1.5} x2={x0 + COL - 1.5} y1={top} y2={top} stroke={FLAT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ) : (
        <rect
          x={x0 + 1.5}
          y={top}
          width={COL - 3}
          height={Math.max(4, bottom - top)}
          fill={filled ? colour : 'none'}
          stroke={colour}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/** Up to three marker rows, so two ships a day apart never sit on one another. */
function laneRows(lane: readonly LaneEvent[], n: number): number[] {
  const lastAt: number[] = [];
  return lane.map((event) => {
    const at = ((event.i + (event.f ?? 0.5)) / n) * 100;
    let row = lastAt.findIndex((prev) => at - prev >= 7);
    if (row < 0) row = lastAt.length < 3 ? lastAt.length : 2;
    lastAt[row] = at;
    return row;
  });
}

export function PublicDailyCandleChart({
  days,
  ships = [],
  todayUtc,
  now,
  symbol,
  stale,
  withheld,
  id = 'daily-candles',
  className,
}: {
  /** HEY's daily index, oldest first (`candleOfMarketDay`). */
  days: readonly CandleDay[];
  /** The project's meaningful ships, as chart events (family `ships`). */
  ships?: readonly ChartEvent[];
  /** The current UTC day: its candle is drawn as still open. */
  todayUtc: string;
  now?: Date | undefined;
  symbol?: string | undefined;
  /**
   * HEY has no current reading of this market (none in the last week): the
   * history is drawn, every direction colour is off, and the caption says why.
   */
  stale?: { reason: string } | undefined;
  /** HEY does not stand behind this market's prices: no candle is drawn, and the reason is shown. */
  withheld?: string | undefined;
  id?: string;
  className?: string;
}) {
  const headingId = `${id}-heading`;
  const built = withheld ? undefined : buildChartModel(days, ships, { todayUtc, now, families: [PUBLIC_SHIP_FAMILY] });
  const unit = symbol ? `US dollars per ${symbol}` : 'US dollars per token';

  const frame = (body: ReactNode, answer?: string) => (
    <section className={cn('min-w-0', className)} data-testid="public-daily-chart-section">
      <figure className="min-w-0" aria-labelledby={headingId} data-testid="public-daily-chart">
        <figcaption>
          <h2 id={headingId} className="hey-eyebrow text-hey-muted">
            Daily candles
          </h2>
          {answer ? (
            <p className="mt-2 max-w-2xl text-[14.5px] text-hey-ink" data-testid="public-daily-chart-answer">
              {answer}
            </p>
          ) : null}
        </figcaption>
        <div className="mt-4 min-w-0">{body}</div>
      </figure>
    </section>
  );

  if (withheld) {
    return frame(
      <div data-testid="public-daily-chart-withheld">
        <ChartNote message="Not drawn: HEY does not stand behind this market's prices." hint={withheld} />
      </div>,
    );
  }
  if (!built) {
    return frame(
      <div data-testid="public-daily-chart-empty">
        <ChartNote message="No daily readings yet to draw candles from." hint="HEY reads the market daily; the candles appear from the second priced day." />
      </div>,
    );
  }

  const { model, summary } = built;
  const n = model.rows.length;
  const coloured = !stale;
  const span = model.hi - model.lo || 1;
  const y = (v: number) => ((model.hi - v) / span) * PLOT_H;
  const topPct = (v: number) => ((model.hi - v) / span) * 100;
  const rows = laneRows(model.lane, n);
  const firstDay = model.rows[0]![0];
  const lastDay = model.rows[n - 1]![0];

  return frame(
    <>
      {stale ? (
        <p className="mb-3 max-w-2xl text-[13px] text-hey-secondary" data-testid="public-daily-chart-stale">
          Colours are off: {stale.reason} The candles below are history, not the market now.
        </p>
      ) : null}

      {/* Price axis title, then the plot with its price ticks. */}
      <p className="text-[11.5px] text-hey-muted" data-testid="public-daily-chart-y-title">
        Price ({unit})
      </p>
      <div className="mt-1 grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-x-2">
        <div className="relative h-[180px]" aria-hidden="true">
          {model.ticks.map(([value, label]) => (
            <span key={value} className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-hey-muted" style={{ top: `${topPct(value)}%` }}>
              {label}
            </span>
          ))}
        </div>
        <div className="relative h-[180px] min-w-0 border-b border-l border-hey-border">
          <svg
            viewBox={`0 0 ${n * COL} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            role="img"
            aria-label={`Daily candles, ${unit}, ${firstDay} to ${lastDay}. ${summary}`}
            data-testid="public-daily-chart-svg"
          >
            {model.ticks.map(([value]) => (
              <line key={value} x1={0} x2={n * COL} y1={y(value)} y2={y(value)} stroke="var(--hey-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {model.rows.map((row, i) => (
              <Candle key={row[0]} row={row} index={i} y={y} coloured={coloured} />
            ))}
          </svg>
        </div>

        {/* Date axis. */}
        <span aria-hidden="true" />
        <div className="relative h-5 min-w-0 overflow-hidden" aria-hidden="true" data-testid="public-daily-chart-x-axis">
          {model.months.map(([i, label]) => (
            <span key={`${i}-${label}`} className="absolute top-1 whitespace-nowrap text-[11px] tabular-nums text-hey-muted" style={edgeStyle(((i + 0.5) / n) * 100)}>
              {label}
            </span>
          ))}
        </div>

        {/* Ship lane: on the date axis by time, never on a price. */}
        {model.lane.length > 0 ? (
          <>
            <span className="self-center text-right text-[11px] text-hey-muted">Ships</span>
            <div className="relative min-w-0 overflow-hidden" style={{ height: `${(Math.max(...rows) + 1) * 22}px` }} data-testid="public-daily-chart-ships">
              {model.lane.map((event, k) => {
                const at = ((event.i + (event.f ?? 0.5)) / n) * 100;
                const label = `Shipped: ${event.t} — ${event.dl}`;
                const week = event.j !== undefined;
                const style: CSSProperties = week
                  ? { left: `${(event.i / n) * 100}%`, width: `${((event.j! - event.i + 1) / n) * 100}%`, top: `${rows[k]! * 22}px` }
                  : { left: `clamp(0px, calc(${at}% - 9px), calc(100% - 18px))`, top: `${rows[k]! * 22}px` };
                const mark = week ? (
                  <span className="absolute inset-x-0 top-[9px] h-[6px] rounded-t-[2px] border border-b-0 border-hey-ink-soft" aria-hidden="true" />
                ) : null;
                const number = (
                  <span className="relative inline-flex size-[18px] items-center justify-center rounded-full border border-hey-ink-soft bg-hey-surface text-[10px] font-medium tabular-nums text-hey-ink">
                    {k + 1}
                  </span>
                );
                const inner = (
                  <>
                    {mark}
                    {week ? <span className="relative flex justify-center">{number}</span> : number}
                  </>
                );
                return event.h ? (
                  <a
                    key={event.id}
                    href={event.h}
                    className="absolute block rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                    style={style}
                    aria-label={label}
                    title={label}
                    data-testid="public-daily-chart-ship"
                    data-day={model.rows[event.i]![0]}
                  >
                    {inner}
                  </a>
                ) : (
                  <span key={event.id} className="absolute block" style={style} role="img" aria-label={label} title={label} data-testid="public-daily-chart-ship" data-day={model.rows[event.i]![0]}>
                    {inner}
                  </span>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
      <p className="mt-1 text-right text-[11.5px] text-hey-muted" data-testid="public-daily-chart-x-title">
        Date (UTC day)
      </p>

      {/* The legend: never colour alone. */}
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-hey-secondary" data-testid="public-daily-chart-legend">
        {coloured ? (
          <>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-2 rounded-[1px]" style={{ background: UP }} />
              ▲ Green: close above open
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-2 rounded-[1px]" style={{ background: DOWN }} />
              ▼ Red: close below open
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-[2px] w-2.5" style={{ background: FLAT }} />
              Grey: unchanged, close only, or today still open (outline)
            </li>
          </>
        ) : (
          <li>Outlines only: no direction colour while HEY has no current reading.</li>
        )}
        <li>Missing days are gaps, not zero.</li>
        {model.lane.length > 0 ? <li>Numbered marks: ships, placed by date. Placed by time only, never a cause.</li> : null}
      </ul>

      {/* The ships the marks number, in words. */}
      {model.lane.length > 0 ? (
        <ol className="mt-3 space-y-1 text-[13px] text-hey-secondary" data-testid="public-daily-chart-ship-list">
          {model.lane.map((event, k) => (
            <li key={event.id} className="flex min-w-0 gap-2">
              <span className="w-5 shrink-0 text-right tabular-nums text-hey-muted">{k + 1}</span>
              <span className="min-w-0 break-words">
                <span className="tabular-nums">{event.d}</span>
                <span aria-hidden="true"> · </span>
                Shipped:{' '}
                {event.h ? (
                  <a href={event.h} className="text-hey-ink underline underline-offset-4">
                    {event.t}
                  </a>
                ) : (
                  <span className="text-hey-ink">{event.t}</span>
                )}
                {event.p !== 'EXACT' && event.p !== 'DATE' ? <span className="text-hey-muted"> ({event.w})</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="mt-3 max-w-2xl text-[12.5px] text-hey-muted">
        One candle per UTC day from HEY&apos;s own daily index: the day&apos;s first, highest, lowest and last price from the source that ranked highest that
        day. Price only — the valuation is not drawn. Market context, never a buy signal, and never an input to activity status or any HEY score.
      </p>

      {/* Every day in words, for a screen reader. */}
      <table className="sr-only" data-testid="public-daily-chart-table">
        <caption>Daily candles, oldest first, in {unit}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Open</th>
            <th scope="col">High</th>
            <th scope="col">Low</th>
            <th scope="col">Close</th>
            <th scope="col">Direction</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) =>
            row.length === 1 ? (
              <tr key={row[0]}>
                <th scope="row">{row[0]}</th>
                <td colSpan={5}>Not read by HEY: a gap, not zero</td>
              </tr>
            ) : (
              <tr key={row[0]}>
                <th scope="row">{row[0]}</th>
                <td>Open {priceText(row[1])}</td>
                <td>High {priceText(row[2])}</td>
                <td>Low {priceText(row[3])}</td>
                <td>Close {priceText(row[4])}</td>
                <td>{DIRECTION_WORDS[row[7]]}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </>,
    summary,
  );
}
