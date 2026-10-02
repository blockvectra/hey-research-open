import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  bucketKey,
  buildChartModel,
  candleDirection,
  dayCoverage,
  niceTicks,
  placeEventIntraday,
  buildCodeLane,
  type CandleDay,
  type ChartEvent,
} from './terminal-chart';
import { LANE_COUNT_ROOM, LANE_HIT_HALF, codeFacts, lastCloseMark, laneRooms, type ChartRow } from './terminal-chart-client';
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

  const ev = (id: string, at: string, family: string, precision: ChartEvent['precision'], extra: Partial<ChartEvent> = {}): ChartEvent => ({
    id,
    at,
    title: id.toUpperCase(),
    family,
    precision,
    ...extra,
  });

  it('keeps the events in range, in time order, and leaves out one before it', () => {
    const events: ChartEvent[] = [
      ev('b', '2026-09-12T00:00:00Z', 'releases', 'DATE'),
      ev('a', '2026-09-01T09:30:00Z', 'ships', 'EXACT'),
      ev('w', '2026-09-02T15:00:00Z', 'code', 'WEEK'),
      ev('out', '2025-01-01T10:00:00Z', 'ships', 'EXACT'),
    ];
    const { lane } = buildChartModel(days, events, { todayUtc: TODAY })!.model;
    expect(lane.map((e) => e.t)).toEqual(['A', 'W', 'B']);
    // The phone list numbers nothing: no circled digits to fall back to a system font.
    expect(JSON.stringify(lane)).not.toMatch(/[①-⑳]/);
  });

  it('places an exact event at its hour, a date mid-day, and a week over its ISO week', () => {
    const events: ChartEvent[] = [
      ev('a', '2026-09-01T18:00:00Z', 'ships', 'EXACT'),
      ev('d', '2026-09-03T00:00:00Z', 'releases', 'DATE'),
      // Wednesday 2 September: its ISO week runs Monday 31 August to Sunday 6 September, clipped to the range.
      ev('w', '2026-09-02T15:00:00Z', 'code', 'WEEK'),
    ];
    const { lane } = buildChartModel(days, events, { todayUtc: TODAY })!.model;
    const by = new Map(lane.map((e) => [e.id, e]));
    expect(by.get('a')).toMatchObject({ i: 0, f: 0.75, p: 'EXACT', d: '1 Sep' });
    expect(by.get('a')!.dl).toBe('1 September 2026, 18:00 UTC');
    expect(by.get('d')).toMatchObject({ i: 2, p: 'DATE', w: 'date precision' });
    expect(by.get('d')!.f).toBeUndefined();
    expect(by.get('w')).toMatchObject({ i: 0, j: 5, p: 'WEEK', d: 'wk of 31 Aug' });
  });

  it('keeps an event on a day HEY did not read on the axis, with no candle for it', () => {
    const { model } = buildChartModel(days, [ev('g', '2026-09-08T12:00:00Z', 'ships', 'EXACT')], {
      todayUtc: TODAY,
    })!;
    const e = model.lane[0]!;
    expect(model.rows[e.i]).toEqual(['2026-09-08']);
    expect(e.p).toBe('EXACT');
  });

  it('never puts a scheduled event on a day that has not happened: it waits ahead of the axis', () => {
    const { model } = buildChartModel(
      days,
      [ev('lock:1', '2026-10-20T00:00:00Z', 'more', 'SCHEDULED', { kindLabel: 'Unlock' })],
      { todayUtc: TODAY },
    )!;
    expect(model.lane).toHaveLength(0);
    expect(model.ahead).toMatchObject([{ id: 'lock:1', day: '2026-10-20', p: 'SCHEDULED', d: 'due 20 Oct' }]);
  });

  it('labels an observation as seen by HEY and a bounded window as a span', () => {
    const { lane } = buildChartModel(
      days,
      [
        ev('o', '2026-09-04T08:00:00Z', 'contract', 'OBSERVED'),
        ev('win', '2026-09-02T00:00:00Z', 'more', 'WINDOW', { until: '2026-09-04T00:00:00Z' }),
      ],
      { todayUtc: TODAY },
    )!.model;
    const by = new Map(lane.map((e) => [e.id, e]));
    expect(by.get('o')).toMatchObject({ i: 3, p: 'OBSERVED', w: 'seen by HEY', d: 'seen 4 Sep' });
    expect(by.get('o')!.f).toBeUndefined();
    expect(by.get('win')).toMatchObject({ i: 1, j: 3, p: 'WINDOW' });
  });

  it('counts only the families present, in the caller’s order', () => {
    const families = [
      { key: 'ships', label: 'Ships', shape: 'circle' as const, tone: 'var(--hey-layer-ship)' },
      { key: 'releases', label: 'Releases', shape: 'square' as const, tone: 'var(--hey-layer-release)' },
      { key: 'code', label: 'Code activity', shape: 'bar' as const, tone: 'var(--hey-layer-code)' },
    ];
    const { model } = buildChartModel(
      days,
      [ev('a', '2026-09-01T09:00:00Z', 'code', 'EXACT'), ev('b', '2026-09-02T09:00:00Z', 'ships', 'EXACT'), ev('c', '2026-09-03T09:00:00Z', 'ships', 'EXACT')],
      { todayUtc: TODAY, families },
    )!;
    expect(model.families.map((f) => [f.key, f.count])).toEqual([
      ['ships', 2],
      ['code', 1],
    ]);
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
      id: 'ship:r',
      at: '2026-08-10T12:00:00Z',
      title: 'Agent SDK v0.4',
      family: 'releases',
      precision: 'EXACT',
      kindLabel: 'Release',
      href: '/terminal/agentos/timeline?open=ship%3Ar#t-ship-r',
    },
  ];
  const families = [{ key: 'releases', label: 'Releases', shape: 'square' as const, tone: 'var(--hey-layer-release)' }];
  const html = renderToStaticMarkup(
    createElement(DailyCandleChart, { days, events, families, todayUtc: TODAY }),
  );
  const plot = /<svg[^>]*data-plot[^>]*>([\s\S]*?)<\/svg>/.exec(html)?.[1] ?? '';

  it('draws the price plot in market tokens only, never a builder or event tone', () => {
    expect(plot).toContain('--hey-market-up');
    expect(plot).toContain('--hey-market-down');
    expect(plot).not.toMatch(/--hey-accent|--hey-status-|--hey-layer|--hey-chart-family/);
  });

  it('draws with a handful of aggregated paths and no per-candle titles', () => {
    expect((plot.match(/<path/g) ?? []).length).toBeLessThanOrEqual(16);
    expect(html).not.toContain('<title>');
  });

  it('carries the direction counts and the event count in the figure caption', () => {
    expect(html).toMatch(/<figcaption[^>]*>[^<]*\d+ up days?, \d+ down, \d+ unchanged/);
    expect(html).toMatch(/1 builder and research event in range, aligned by time only/);
  });

  it('renders the readout for the latest complete day with O/H/L/C and an arrow or a word', () => {
    expect(html).toContain('data-testid="chart-readout"');
    expect(html).toMatch(/data-day="2026-08-30"/);
    expect(html).toMatch(/>O<\/span>[\s\S]*>C<\/span>/);
    expect(html).toMatch(/[▲▼]|0\.0%/);
  });

  it('keeps the event lane and the filter chips out of market colour', () => {
    const lane = /data-testid="event-lane"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    expect(lane).toContain('data-testid="lane-marker"');
    expect(lane).not.toMatch(/--hey-market-|--hey-accent/);
    const filters = /data-testid="chart-event-filters"[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
    expect(filters).toContain('aria-pressed');
    expect(filters).not.toMatch(/--hey-market-|--hey-accent/);
  });

  it('names every lane mark in words, with its evidence', () => {
    expect(html).toContain('aria-label="Release: Agent SDK v0.4. 10 August 2026, 12:00 UTC. Evidence available."');
  });

  it('carries the methodology note: aligned by time, no inferred cause', () => {
    expect(html).toContain(
      'Events are aligned by time to market history. HEY does not infer that an event caused a price move.',
    );
  });

  it('reserves the callout band on the server, so the plot does not jump when the callouts arrive', () => {
    expect(html).toMatch(/data-chart-band="" class="relative max-md:hidden" style="height:46px"/);
    // The callouts themselves wait for the measured width.
    expect(html).not.toContain('data-testid="chart-callout"');
  });

  it('draws nothing of the events in the market-only lens but the chips', () => {
    const market = renderToStaticMarkup(
      createElement(DailyCandleChart, { days, events, families, todayUtc: TODAY, lens: 'market' }),
    );
    expect(market).toContain('data-lens="market"');
    expect(market).not.toContain('data-testid="lane-marker"');
    expect(market).not.toContain('data-chart-band');
    expect(market).toContain('data-testid="chart-family-chip"');
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

describe('the event lane and the lens, for touch and for screen readers (review repairs, 2026-09-29)', () => {
  it('gives each day mark a 24px target where there is room, never taking a neighbour’s ground', () => {
    // Far apart: 12px each side of the time — a 24px target around a 7px glyph.
    expect(laneRooms([100, 300])).toEqual([
      { left: 12, right: 12, count: true },
      { left: 12, right: 12, count: true },
    ]);
    // Ten pixels apart (90 days on a desk): each reaches half-way, so the targets meet and never overlap.
    const tight = laneRooms([100, 110, 120]);
    expect(tight.map((r) => [r.left, r.right])).toEqual([[12, 5], [5, 5], [5, 12]]);
    for (let k = 1; k < tight.length; k += 1) expect(tight[k - 1]!.right + tight[k]!.left).toBeLessThanOrEqual(10);
    // A busy day prints its count only with room beside it; the order of the input is kept.
    expect(laneRooms([300, 100, 110]).map((r) => r.count)).toEqual([true, false, false]);
    expect(LANE_HIT_HALF * 2).toBeGreaterThanOrEqual(24);
    expect(LANE_COUNT_ROOM).toBeGreaterThanOrEqual(3 + 8 + 7);
  });

  const week: CandleDay[] = Array.from({ length: 10 }, (_, k) => ({
    day: `2026-09-${String(k + 1).padStart(2, '0')}`,
    open: 1,
    close: 1.01,
    high: 1.02,
    low: 0.99,
    readings: 3,
    ohlcSource: 'price',
  }));
  const ships = [{ key: 'ships', label: 'Ships', shape: 'circle' as const, tone: 'var(--hey-layer-ship)' }];

  it('draws one glyph a day with its count, never three glyphs running into the next day', () => {
    const busy: ChartEvent[] = Array.from({ length: 4 }, (_, k) => ({ id: `ship:b${k}`, at: `2026-09-05T0${k}:00:00Z`, title: `Ship ${k}`, family: 'ships', precision: 'EXACT' }));
    const html = renderToStaticMarkup(createElement(DailyCandleChart, { days: week, events: busy, families: ships, todayUtc: '2026-09-20' }));
    const lane = /data-testid="event-lane"[\s\S]*?<\/button>/.exec(html)![0];
    expect((lane.match(/hey-lane-glyph/g) ?? []).length).toBe(1);
    expect(lane).toContain('hey-chart-lane-count">4<');
    expect(lane).toContain('data-count="4"');
  });

  it('names the lens button once at every width: the phone’s short label is hidden from assistive tech', () => {
    const html = renderToStaticMarkup(
      createElement(DailyCandleChart, {
        days: week,
        events: [{ id: 'ship:a', at: '2026-09-02T00:00:00Z', title: 'A', family: 'ships', precision: 'DATE' }],
        families: ships,
        todayUtc: '2026-09-20',
      }),
    );
    const button = /<button[^>]*data-testid="lens-events"[^>]*>([\s\S]*?)<\/button>/.exec(html)![1]!;
    expect(button).toMatch(/<span class="max-sm:sr-only">Market \+ build events<\/span>/);
    expect(button).toMatch(/<span aria-hidden="true" class="sm:hidden">\+ Events<\/span>/);
  });
});

/*
 * Intraday (2026-09-29): the model steps by the bar, keeps a bar the source
 * did not list as a gap with no colour, and draws the bar still open as an
 * outline, never green or red.
 */
describe('buildChartModel at 1H', () => {
  const HOUR = 3_600_000;
  const start = Date.UTC(2026, 8, 29, 0);
  const bar = (h: number, open: number, close: number): CandleDay => ({ ...candle(bucketKey(start + h * HOUR, HOUR), open, close), readings: 1 });

  it('keys each row by its bar, keeps a missing bar a gap, and colours only measured bars', () => {
    const bars = [bar(0, 1, 1.1), bar(1, 1.1, 1.0), bar(4, 1.0, 1.2), bar(5, 1.2, 1.3)];
    const built = buildChartModel(bars, [], { todayUtc: '2026-09-29', timeframe: '1h', openBucket: bucketKey(start + 5 * HOUR, HOUR) })!;
    const rows = built.model.rows;
    expect(rows.map((row) => row[0])).toEqual(['2026-09-29T00:00Z', '2026-09-29T01:00Z', '2026-09-29T02:00Z', '2026-09-29T03:00Z', '2026-09-29T04:00Z', '2026-09-29T05:00Z']);
    // The two bars the source did not list stay gaps: a key and nothing else, never a zero candle.
    expect(rows[2]).toEqual(['2026-09-29T02:00Z']);
    expect(rows[3]).toEqual(['2026-09-29T03:00Z']);
    expect(rows.map((row) => (row.length > 1 ? row[7] : 'gap'))).toEqual(['u', 'd', 'gap', 'gap', 'u', 'p']);
    expect(built.counts).toMatchObject({ up: 2, down: 1, partial: 1, gaps: 2 });
    expect(built.model.tf).toBe('1h');
    expect(built.summary).toContain('over 6 hours');
    expect(built.summary).toContain('2 bars without a bar');
    expect(dayCoverage(bars, HOUR)).toEqual({ span: 6, indexed: 4, gaps: 2 });
  });

  it('keeps the daily model exactly as it was when no timeframe is named', () => {
    const days = [candle('2026-09-20', 1, 1.1), candle('2026-09-22', 1.1, 1.2)];
    const built = buildChartModel(days, [], { todayUtc: TODAY })!;
    expect(built.model.tf).toBeUndefined();
    expect(built.model.rows.map((row) => row[0])).toEqual(['2026-09-20', '2026-09-21', '2026-09-22']);
    expect(built.summary).toContain('over 3 days');
  });

  it('puts an exact time on its bar at its minute, and a date over its whole day', () => {
    const grid = { firstMs: start, bucketMs: HOUR, n: 48 };
    const now = new Date('2026-09-30T12:00:00Z');
    const exact = placeEventIntraday({ id: 'ship:x', at: '2026-09-29T14:30:00Z', title: 'v0.7.1', family: 'releases', precision: 'EXACT' }, grid, now, undefined)!;
    expect(exact).toMatchObject({ i: 14, f: 0.5, d: '29 Sep 14:30' });
    expect(exact.dl).toContain('14:30 UTC');
    const date = placeEventIntraday({ id: 'ship:y', at: '2026-09-30T00:00:00Z', title: 'Docs', family: 'ships', precision: 'DATE' }, grid, now, undefined)!;
    expect(date).toMatchObject({ i: 24, j: 47 });
    expect(date.f).toBeUndefined();
    expect(date.d).not.toMatch(/\d{2}:\d{2}/);
    // Outside the axis: nothing.
    expect(placeEventIntraday({ id: 'ship:z', at: '2026-09-27T09:00:00Z', title: 'Old', family: 'ships', precision: 'EXACT' }, grid, now, undefined)).toBeUndefined();
  });
});

/*
 * The code lane (2026-09-29): absent is never zero, a cut page is a floor
 * ("100+"), merged PRs sit at their minute, and the facts read in words.
 */
describe('the code lane', () => {
  const HOUR = 3_600_000;
  const start = Date.UTC(2026, 8, 29, 0);
  const keys = Array.from({ length: 6 }, (_, h) => bucketKey(start + h * HOUR, HOUR));

  it('leaves columns before the counts start absent, keeps a measured empty column at zero, and counts a floor', () => {
    const lane = buildCodeLane(
      {
        state: 'MEASURED',
        measuredFrom: '2026-09-29T02:30:00Z',
        buckets: [
          { start: '2026-09-29T02:00:00Z', commits: 100, substantive: 60, lowInformation: 10, unknown: 30, atLeast: true },
          { start: '2026-09-29T04:00:00Z', commits: 3, substantive: 2, lowInformation: 1, unknown: 0 },
        ],
        pullMerges: ['2026-09-29T04:30:00Z', '2026-09-28T23:00:00Z'],
        pullsFrom: '2026-09-29T01:00:00Z',
      },
      keys,
      HOUR,
    );
    expect(lane.cells).toEqual([null, null, [100, 60, 10, 30, 1], [0, 0, 0, 0, 0], [3, 2, 1, 0, 0], [0, 0, 0, 0, 0]]);
    expect(lane).toMatchObject({ state: 'MEASURED', max: 100, total: 103, floor: true, prs: [[4, 0.5]], prsFrom: 1 });
    const model = { code: lane, tf: '1h' as const };
    expect(codeFacts(model, 0, [])).toBe('Commits not collected for this bar');
    expect(codeFacts(model, 2, [])).toBe('100+ commits (60 substantive, 10 low-information)');
    expect(codeFacts(model, 3, [])).toBe('0 commits');
    const release = { id: 'ship:r', i: 4, f: 0.1, fam: 'releases', t: 'v0.7.1', k: 'Release', s: 'square', p: 'EXACT' as const, w: 'exact', d: '29 Sep 04:06', dl: '29 September 2026, 04:06 UTC', c: 'x' };
    expect(codeFacts(model, 4, [release])).toBe('3 commits (2 substantive, 1 low-information) · 1 PR merged · Release v0.7.1 04:06');
  });

  it('says there is no repository, or that it is not read, instead of drawing zeros', () => {
    expect(buildCodeLane({ state: 'NO_REPOSITORY', buckets: [], pullMerges: [] }, keys, HOUR)).toMatchObject({ state: 'NO_REPOSITORY', cells: [] });
    expect(codeFacts({ code: buildCodeLane({ state: 'NOT_READ', buckets: [], pullMerges: [] }, keys, HOUR) }, 0, [])).toBe('Repository not read yet');
  });

  it('offers the lane’s chip even with no code event in range, with no count to show', () => {
    const bars = keys.map((key, h) => ({ ...candle(key, 1 + h * 0.01, 1.01 + h * 0.01), readings: 1 }));
    const built = buildChartModel(bars, [], {
      todayUtc: '2026-09-29',
      timeframe: '1h',
      families: [
        { key: 'releases', label: 'Releases', shape: 'square', tone: 't' },
        { key: 'code', label: 'Code activity', shape: 'bar', tone: 't', codeLane: true, noCallout: true },
      ],
      code: { state: 'MEASURED', measuredFrom: '2026-09-29T00:00:00Z', buckets: [], pullMerges: [] },
    })!;
    expect(built.model.families).toEqual([{ key: 'code', label: 'Code activity', shape: 'bar', tone: 't', codeLane: true, noCallout: true, count: 0 }]);
    expect(built.model.code?.cells.every((cell) => cell !== null && cell[0] === 0)).toBe(true);
  });
});

describe('lastCloseMark (full audit, 2026-09-30)', () => {
  const row = (day: string, close: number, dir: 'u' | 'd' | 'f' | 'p'): ChartRow => [day, close, close, close, close, null, 1, dir];

  it('a measured direction carries its arrow, never colour alone', () => {
    expect(lastCloseMark([row('2026-09-28', 1, 'f'), row('2026-09-29', 1.2, 'u')])).toEqual({ index: 1, close: 1.2, direction: 'up', arrow: '▲' });
    expect(lastCloseMark([row('2026-09-28', 1, 'f'), row('2026-09-29', 0.8, 'd')])).toMatchObject({ direction: 'down', arrow: '▼' });
    // Today, still open, has no direction yet.
    expect(lastCloseMark([row('2026-09-29', 1, 'p')])).toMatchObject({ direction: 'flat', arrow: '' });
  });

  it('a close older than the axis end (trailing gaps) is flat, with no arrow', () => {
    expect(lastCloseMark([row('2026-09-27', 1.2, 'u'), ['2026-09-28'], ['2026-09-29']])).toEqual({ index: 0, close: 1.2, direction: 'flat', arrow: '' });
  });

  it('no close at all is no label', () => {
    expect(lastCloseMark([['2026-09-28'], ['2026-09-29']])).toBeNull();
    expect(lastCloseMark([])).toBeNull();
  });
});

/*
 * The provider's daily archive (2026-10-02): its candles keep their measured
 * direction (the provider measured them, UI rule 13), are marked in the row,
 * drawn inside a named band, and counted apart in the figure's sentence.
 */
describe('provider archive days on the daily chart', () => {
  const archived = (day: string, open: number, close: number) => candle(day, open, close, { readings: 1, basis: 'provider_archive' });
  const days: CandleDay[] = [
    archived('2026-09-01', 1, 1.1),
    archived('2026-09-02', 1.1, 1.0),
    archived('2026-09-03', 1.0, 1.05),
    archived('2026-09-04', 1.05, 1.07),
    archived('2026-09-05', 1.07, 1.02),
    candle('2026-09-06', 1.02, 1.04),
    candle('2026-09-07', 1.04, 1.01),
  ];

  it('marks each archive row, keeps its direction, and names the run as one band', () => {
    const built = buildChartModel(days, [], { todayUtc: TODAY })!;
    const rows = built.model.rows;
    expect(rows.slice(0, 5).every((row) => row.length === 9 && row[8] === 'a')).toBe(true);
    expect(rows.slice(5).every((row) => row.length === 8)).toBe(true);
    expect(rows[0]![7]).toBe('u');
    expect(rows[1]![7]).toBe('d');
    expect(built.model.archive).toEqual([[0, 4]]);
    expect(built.summary).toMatch(/5 days drawn from the provider’s daily archive, not from HEY’s own readings\.$/);
  });

  it('draws no band and says nothing of an archive when every day is HEY’s own', () => {
    const own = days.map((day) => ({ ...day, basis: undefined, readings: 24 }));
    const built = buildChartModel(own, [], { todayUtc: TODAY })!;
    expect(built.model.archive).toBeUndefined();
    expect(built.summary).not.toMatch(/archive/);
  });
});
