import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  buildChartModel,
  candleDirection,
  dayCoverage,
  niceTicks,
  type CandleDay,
  type ChartEvent,
} from './terminal-chart';
import { DailyCandleChart } from './terminal-chart-view';

const TODAY = '2026-09-26';
const candle = (
  day: string,
  open: number,
  close: number,
  extra: Partial<CandleDay> = {},
): CandleDay => ({
  day,
  open,
  high: Math.max(open, close) * 1.02,
  low: Math.min(open, close) * 0.98,
  close,
  readings: 24,
  ohlcSource: 'price',
  ...extra,
});

/*
 * CLAUDE.md UI rule 13 (2026-09-26): conventional green up and red down, for a
 * measured direction only. Everything else — a doji, a missing open, two
 * series in one candle, today — is never given a direction.
 */
describe('candleDirection', () => {
  it('is up when the close is above the open, down when below', () => {
    expect(candleDirection(candle('2026-09-20', 1, 1.1), TODAY)).toBe('up');
    expect(candleDirection(candle('2026-09-20', 1.1, 1), TODAY)).toBe('down');
  });

  it('is flat for a doji, exactly and within the relative tolerance', () => {
    expect(candleDirection(candle('2026-09-20', 0.0000211, 0.0000211), TODAY)).toBe('flat');
    expect(candleDirection(candle('2026-09-20', 0.0000211, 0.0000211 * (1 + 1e-12)), TODAY)).toBe(
      'flat',
    );
    // Just outside the tolerance is a real, if tiny, move.
    expect(candleDirection(candle('2026-09-20', 0.0000211, 0.0000211 * (1 + 1e-6)), TODAY)).toBe(
      'up',
    );
  });

  it('is unknown when the open, high or low is missing — never up by default', () => {
    expect(candleDirection({ ...candle('2026-09-20', 1, 1.1), open: undefined }, TODAY)).toBe(
      'unknown',
    );
    expect(candleDirection({ ...candle('2026-09-20', 1, 1.1), high: undefined }, TODAY)).toBe(
      'unknown',
    );
    expect(candleDirection({ ...candle('2026-09-20', 1, 1.1), low: undefined }, TODAY)).toBe(
      'unknown',
    );
  });

  it('is unknown when the prices came from two series', () => {
    expect(candleDirection(candle('2026-09-20', 1, 1.1, { ohlcSource: 'mixed' }), TODAY)).toBe(
      'unknown',
    );
  });

  it('is partial for today, whatever the prices say', () => {
    expect(candleDirection(candle(TODAY, 1, 1.5), TODAY)).toBe('partial');
    expect(candleDirection(candle(TODAY, 1.5, 1), TODAY)).toBe('partial');
  });

  it('is unknown when a price is zero or negative', () => {
    expect(candleDirection(candle('2026-09-20', 1, 0), TODAY)).toBe('unknown');
    expect(candleDirection(candle('2026-09-20', 0, 1), TODAY)).toBe('unknown');
    expect(candleDirection(candle('2026-09-20', -1, 1), TODAY)).toBe('unknown');
  });
});

describe('buildChartModel', () => {
  const days: CandleDay[] = [
    candle('2026-09-01', 1, 1.2), // up
    candle('2026-09-02', 1.2, 1.1), // down
    candle('2026-09-03', 1.1, 1.1), // doji
    { day: '2026-09-04', close: 1.15, readings: 3, ohlcSource: 'trade' }, // close only
    candle('2026-09-05', 1.1, 1.3, { ohlcSource: 'mixed' }), // mixed
    // 2026-09-06 … 2026-09-11: six days HEY did not read.
    candle('2026-09-12', 1.3, 1.25), // down
  ];

  it('carries the server’s day, so the island dates its labels against it rather than the browser clock', () => {
    // React #418 (2026-09-26): a label that hides "this year" must hide it on both renders.
    expect(buildChartModel(days, [], { todayUtc: TODAY })!.model.today).toBe(TODAY);
  });

  it('never passes a gap to the direction function and keeps it as a bare day', () => {
    const built = buildChartModel(days, [], { todayUtc: TODAY })!;
    const gaps = built.model.rows.filter((row) => row.length === 1);
    expect(gaps.map((row) => row[0])).toEqual([
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
    ]);
    // One run of six, named on the plot; every gap gets its tick.
    expect(built.model.gapRuns).toHaveLength(1);
    expect(built.model.gapTicks).toEqual([[5, 10]]);
  });

  it('codes every direction and strips the open from close-only and mixed days', () => {
    const { rows } = buildChartModel(days, [], { todayUtc: TODAY })!.model;
    const codes = rows.filter((row) => row.length > 1).map((row) => row[7]);
    expect(codes).toEqual(['u', 'd', 'f', 'n', 'm', 'd']);
    const mixed = rows[4]!;
    expect(mixed.slice(1, 4)).toEqual([null, null, null]);
    expect(mixed[4]).toBe(1.3);
  });

  it('counts directions for the accessible summary', () => {
    const built = buildChartModel(days, [], { todayUtc: TODAY })!;
    expect(built.counts).toEqual({ up: 1, down: 2, flat: 1, closeOnly: 2, partial: 0, gaps: 6 });
    expect(built.summary).toContain('1 up day, 2 down, 1 unchanged, 2 close-only');
    expect(built.summary).toContain('6 days without a reading');
  });

  it('opens the readout on the latest complete day, not on today', () => {
    const withToday = [...days, candle(TODAY, 1.25, 1.4)];
    const { model } = buildChartModel(withToday, [], { todayUtc: TODAY })!;
    expect(model.rows[model.rows.length - 1]![7]).toBe('p');
    expect(model.rows[model.latest]![0]).toBe('2026-09-12');
    expect(model.initial).toBe(model.latest);
  });

  it('opens on the day asked for when it is in range', () => {
    const { model } = buildChartModel(days, [], { todayUtc: TODAY, selectedDay: '2026-09-02' })!;
    expect(model.rows[model.initial]![0]).toBe('2026-09-02');
  });

  it('pads the domain so the highest wick never touches the frame', () => {
    const { model } = buildChartModel(days, [], { todayUtc: TODAY })!;
    const highs = days.map((d) => d.high ?? d.close ?? 0);
    expect(model.hi).toBeGreaterThan(Math.max(...highs));
    expect(model.lo).toBeLessThan(Math.min(...days.map((d) => d.low ?? d.close ?? Infinity)));
  });

  it('needs two priced days', () => {
    expect(
      buildChartModel([candle('2026-09-01', 1, 1.1)], [], { todayUtc: TODAY }),
    ).toBeUndefined();
  });

  it('numbers the newest events for the phone list and gives a week no number', () => {
    const events: ChartEvent[] = [
      {
        id: 'a',
        day: '2026-09-01',
        title: 'A',
        layer: 'ship',
        precision: 'exact',
        precisionLabel: 'exact',
        timeLabel: '',
      },
      {
        id: 'w',
        day: '2026-09-02',
        title: 'W',
        layer: 'code',
        precision: 'week',
        precisionLabel: 'week precision',
        timeLabel: 'week of 2026-08-31',
      },
      {
        id: 'b',
        day: '2026-09-12',
        title: 'B',
        layer: 'release',
        precision: 'day',
        precisionLabel: 'date precision',
        timeLabel: '',
      },
      {
        id: 'out',
        day: '2025-01-01',
        title: 'Out of range',
        layer: 'ship',
        precision: 'exact',
        precisionLabel: 'exact',
        timeLabel: '',
      },
    ];
    const { lane } = buildChartModel(days, events, { todayUtc: TODAY })!.model;
    expect(lane.map((e) => e.t)).toEqual(['A', 'W', 'B']);
    expect(lane.map((e) => e.n)).toEqual(['①', undefined, '②']);
    expect(lane[1]!.w).toBe('week of 2026-08-31');
  });
});

describe('niceTicks', () => {
  it('lands on 1-2-5 steps, four to six of them', () => {
    const ticks = niceTicks(0.0000121, 0.000036);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(6);
    const step = ticks[1]! - ticks[0]!;
    const norm = step / 10 ** Math.floor(Math.log10(step));
    expect([1, 2, 5, 10].some((n) => Math.abs(norm - n) < 1e-6)).toBe(true);
  });

  it('survives a zero span', () => {
    expect(niceTicks(1, 1)).toEqual([1]);
  });
});

describe('DailyCandleChart render', () => {
  const days: CandleDay[] = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
    return candle(day, 1 + (i % 3) * 0.1, 1 + ((i + 1) % 3) * 0.1, { volume: 1000 + i });
  });
  const events: ChartEvent[] = [
    {
      id: 'r',
      day: '2026-08-10',
      title: 'Agent SDK v0.4',
      layer: 'release',
      precision: 'exact',
      precisionLabel: 'exact',
      timeLabel: '',
      tone: 'var(--hey-layer-release)',
      kindLabel: 'Release',
      glyph: '■',
      shape: 'square',
      href: '/terminal/agentos/timeline?open=ship%3Ar#t-ship-r',
    },
  ];
  const html = renderToStaticMarkup(
    createElement(DailyCandleChart, { days, events, todayUtc: TODAY }),
  );
  const plot = /<svg[^>]*data-plot[^>]*>([\s\S]*?)<\/svg>/.exec(html)?.[1] ?? '';

  it('draws the price plot in market tokens only, never a builder or event tone', () => {
    expect(plot).toContain('--hey-market-up');
    expect(plot).toContain('--hey-market-down');
    expect(plot).not.toMatch(/--hey-accent|--hey-status-|--hey-layer/);
  });

  it('draws with a handful of aggregated paths and no per-candle titles', () => {
    expect((plot.match(/<path/g) ?? []).length).toBeLessThanOrEqual(16);
    expect(html).not.toContain('<title>');
  });

  it('carries the direction counts in the figure caption', () => {
    expect(html).toMatch(/<figcaption[^>]*>[^<]*\d+ up days?, \d+ down, \d+ unchanged/);
  });

  it('renders the readout for the latest complete day with O/H/L/C and an arrow or a word', () => {
    expect(html).toContain('data-testid="chart-readout"');
    expect(html).toMatch(/data-day="2026-08-30"/);
    expect(html).toMatch(/>O<\/span>[\s\S]*>C<\/span>/);
    expect(html).toMatch(/[▲▼]|0\.0%/);
  });

  it('keeps the event lane out of market colour', () => {
    const lane = /data-testid="event-lane"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    expect(lane).not.toMatch(/--hey-market-|--hey-accent/);
  });
});

describe('dayCoverage', () => {
  /*
   * A day HEY never read has no row to return, so counting gaps from the rows
   * gives zero every time. It has to be counted from the range.
   */
  it('counts unread days from the range, not from the rows', () => {
    expect(
      dayCoverage([
        { day: '2026-09-01', readings: 1 },
        { day: '2026-09-05', readings: 1 },
      ]),
    ).toEqual({ span: 5, indexed: 2, gaps: 3 });
  });

  it('reports nothing for an empty series rather than throwing', () => {
    expect(dayCoverage([])).toEqual({ span: 0, indexed: 0, gaps: 0 });
  });

  it('treats a row with no readings as a gap', () => {
    expect(
      dayCoverage([
        { day: '2026-09-01', readings: 1 },
        { day: '2026-09-02', readings: 0 },
      ]),
    ).toEqual({ span: 2, indexed: 1, gaps: 1 });
  });
});
