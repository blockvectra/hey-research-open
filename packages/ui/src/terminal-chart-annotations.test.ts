import { describe, expect, it } from 'vitest';

import { buildChartModel, type CandleDay, type ChartEvent } from './terminal-chart';
import {
  axisOf,
  bandsFor,
  calloutWidth,
  clusterLabel,
  coversColumn,
  layoutAnnotations,
  type AnnotationItem,
  type AnnotationLayout,
} from './terminal-chart-annotations';
import { annotationItems, calloutRankOrder, rankEvents } from './terminal-chart-client';

/*
 * The market chart's callout layout (founder brief §21A, 2026-09-29): x is
 * time, the band is layout, and nothing is hidden without a count.
 */

/** A small deterministic generator, so the property checks are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function items(count: number, seed: number, spread = 1): AnnotationItem[] {
  const next = rng(seed);
  return Array.from({ length: count }, (_, k) => ({
    id: `e${k}`,
    x: Math.min(1, next() * spread),
    rank: k,
    width: calloutWidth('x'.repeat(8 + Math.floor(next() * 30)), 'Release · 14 Sep'),
  }));
}

function check(layout: AnnotationLayout, input: readonly AnnotationItem[], plotWidth: number, bands: number) {
  // Every event is in exactly one callout or one cluster: the counts sum to the total.
  const ids = [...layout.callouts.flatMap((c) => [c.id, ...c.more]), ...layout.clusters.flatMap((c) => c.ids)];
  expect(ids.slice().sort()).toEqual(input.map((i) => i.id).sort());
  const boxes = [...layout.callouts, ...layout.clusters];
  for (const box of boxes) {
    expect(box.band).toBeGreaterThanOrEqual(0);
    expect(box.band).toBeLessThan(bands);
    // Never outside the plot: the band spans the plot, not the price scale.
    expect(box.left).toBeGreaterThanOrEqual(-1e-6);
    expect(box.left + box.width).toBeLessThanOrEqual(plotWidth + 1e-6);
  }
  // No two marks in one band overlap.
  for (let band = 0; band < bands; band += 1) {
    const row = boxes.filter((b) => b.band === band).sort((a, b) => a.left - b.left);
    for (let k = 1; k < row.length; k += 1) expect(row[k]!.left).toBeGreaterThanOrEqual(row[k - 1]!.left + row[k - 1]!.width - 1e-6);
  }
  // No stem runs down behind a mark nearer the plot, where it would read as that mark's.
  for (const mark of boxes) {
    for (const lower of boxes.filter((b) => b.band < mark.band)) {
      expect(mark.anchor < lower.left - 2 || mark.anchor > lower.left + lower.width + 2).toBe(true);
    }
  }
  // A callout's stem starts under the callout: its anchor is inside its own edges — or, only for a
  // lone event with no room over its time, beside it within reach (joined by a connector, as a chip is).
  for (const callout of layout.callouts) {
    const outside = Math.max(0, callout.left - callout.anchor, callout.anchor - callout.left - callout.width);
    if (outside > 1e-6) expect(callout.more).toEqual([]);
    expect(outside).toBeLessThanOrEqual(2 * 56 + callout.width + 1e-6);
  }
  // "+1 change" is never drawn: a chip always counts two or more.
  for (const cluster of layout.clusters) expect(cluster.ids.length).toBeGreaterThanOrEqual(2);
}

describe('axisOf: x is the event’s time', () => {
  it('moves an exact event inside its day, and only an exact one', () => {
    expect(axisOf({ i: 10, f: 0.75, p: 'EXACT' }, 100).x).toBeCloseTo(0.1075);
    expect(axisOf({ i: 10, f: 0.75, p: 'DATE' }, 100).x).toBeCloseTo(0.105);
    expect(axisOf({ i: 10, p: 'OBSERVED' }, 100).x).toBeCloseTo(0.105);
    expect(axisOf({ i: 10, p: 'SCHEDULED' }, 100).x).toBeCloseTo(0.105);
  });

  it('gives a week and a window their span, never one day of it', () => {
    const week = axisOf({ i: 7, j: 13, p: 'WEEK' }, 70);
    expect(week.span).toEqual([0.1, 0.2]);
    expect(week.x).toBeCloseTo(0.15);
    expect(axisOf({ i: 7, j: 9, p: 'WINDOW' }, 70).span).toEqual([0.1, 10 / 70]);
  });

  it('is monotonic in time', () => {
    const xs = [0, 1, 2, 3].map((i) => axisOf({ i, f: 0.2, p: 'EXACT' }, 4).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('knows which columns an event covers', () => {
    expect(coversColumn({ i: 3 }, 3)).toBe(true);
    expect(coversColumn({ i: 3 }, 4)).toBe(false);
    expect(coversColumn({ i: 3, j: 9 }, 7)).toBe(true);
  });
});

describe('layoutAnnotations', () => {
  it('places a few spread events as callouts, each over its own time', () => {
    const input = [0.1, 0.4, 0.8].map((x, k) => ({ id: `e${k}`, x, rank: k, width: 140 }));
    const layout = layoutAnnotations(input, { plotWidth: 1000, bands: 1, maxCallouts: 12 });
    expect(layout.clusters).toHaveLength(0);
    expect(layout.callouts.map((c) => c.anchor)).toEqual([100, 400, 800]);
    for (const c of layout.callouts) expect(c.left + c.width / 2).toBeCloseTo(c.anchor);
    check(layout, input, 1000, 1);
  });

  it('keeps every invariant across densities, widths and bands', () => {
    for (const [count, width, bands, spread, max] of [
      [5, 1000, 1, 1, 12],
      [12, 1000, 2, 1, 12],
      [30, 1000, 3, 1, 12],
      [60, 720, 3, 0.3, 7],
      [200, 1200, 3, 1, 12],
      [40, 400, 2, 0.05, 7],
      [9, 160, 1, 1, 7],
    ] as const) {
      for (const seed of [1, 7, 42]) {
        const input = items(count, seed, spread);
        const layout = layoutAnnotations(input, { plotWidth: width, bands, maxCallouts: max });
        check(layout, input, width, bands);
        expect(layout.callouts.length).toBeLessThanOrEqual(max);
      }
    }
  });

  it('keeps a dense week as one mark: its most important title, and the rest counted', () => {
    const input = Array.from({ length: 14 }, (_, k) => ({ id: `d${k}`, x: 0.5 + k * 0.002, rank: k, width: 150 }));
    const layout = layoutAnnotations(input, { plotWidth: 1000, bands: 2, maxCallouts: 12 });
    expect(layout.clusters).toHaveLength(0);
    expect(layout.callouts).toHaveLength(1);
    expect(layout.callouts[0]!.id).toBe('d0');
    expect(layout.callouts[0]!.more).toHaveLength(13);
    check(layout, input, 1000, 2);
  });

  it('turns a dense week into "+N changes" when its title has no room, and says how many', () => {
    const input = Array.from({ length: 14 }, (_, k) => ({ id: `d${k}`, x: 0.5 + k * 0.002, rank: k, width: 150 }));
    const layout = layoutAnnotations(input, {
      plotWidth: 1000,
      bands: 1,
      maxCallouts: 12,
      reserved: [{ band: 0, left: 380, right: 640 }],
    });
    expect(layout.callouts).toHaveLength(0);
    expect(layout.clusters).toHaveLength(1);
    const clustered = layout.clusters.reduce((sum, c) => sum + c.ids.length, 0);
    expect(clustered).toBe(14);
    expect(clusterLabel(clustered)).toBe('+14 changes');
    expect(clusterLabel(2)).toBe('+2 changes');
    // A cluster covers the time of its members: its bracket runs from the first to the last.
    for (const c of layout.clusters) {
      const xs = c.ids.map((id) => input.find((i) => i.id === id)!.x * 1000);
      expect(c.from).toBeCloseTo(Math.min(...xs));
      expect(c.to).toBeCloseTo(Math.max(...xs));
    }
    check(layout, input, 1000, 1);
  });

  it('gives the place to the more important event, never the bigger price move', () => {
    const input = [
      { id: 'minor', x: 0.5, rank: 1, width: 180 },
      { id: 'major', x: 0.5, rank: 0, width: 180 },
    ];
    const layout = layoutAnnotations(input, { plotWidth: 1000, bands: 1, maxCallouts: 12 });
    expect(layout.callouts.map((c) => c.id)).toEqual(['major']);
    // The minor one is counted beside it — folded into its "+N" or a chip — never given the place.
    expect([...layout.callouts.flatMap((c) => c.more), ...layout.clusters.flatMap((c) => c.ids)]).toEqual(['minor']);
  });

  it('is deterministic and does not depend on input order', () => {
    const input = items(40, 3);
    const a = layoutAnnotations(input, { plotWidth: 900, bands: 3, maxCallouts: 10 });
    const b = layoutAnnotations([...input].reverse(), { plotWidth: 900, bands: 3, maxCallouts: 10 });
    expect(b).toEqual(a);
  });

  it('keeps out of reserved space', () => {
    const input = [{ id: 'e', x: 0.95, rank: 0, width: 120 }];
    const layout = layoutAnnotations(input, {
      plotWidth: 1000,
      bands: 1,
      maxCallouts: 12,
      reserved: [{ band: 0, left: 900, right: 1000 }],
      tolerance: 80,
    });
    const placed = [...layout.callouts, ...layout.clusters];
    expect(placed).toHaveLength(1);
    expect(placed[0]!.left + placed[0]!.width).toBeLessThanOrEqual(900);
  });

  it('reserves the same band count on the server and in the browser for a given number of events', () => {
    expect([0, 1, 4, 5, 20, 21, 200].map(bandsFor)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('the layout never sees a price', () => {
  const TODAY = '2026-09-26';
  const events: ChartEvent[] = [
    { id: 'ship:a', at: '2026-09-03T10:00:00Z', title: 'Consumer app beta', family: 'ships', precision: 'EXACT' },
    { id: 'ship:b', at: '2026-09-05T00:00:00Z', title: 'Agent SDK v0.4', family: 'releases', precision: 'DATE' },
    { id: 'ship:c', at: '2026-09-09T12:00:00Z', title: 'Code activity', family: 'code', precision: 'WEEK' },
  ];
  const series = (scale: number, wild: boolean): CandleDay[] =>
    Array.from({ length: 20 }, (_, k) => {
      const day = new Date(Date.UTC(2026, 8, 1 + k)).toISOString().slice(0, 10);
      const open = scale * (1 + (wild ? Math.sin(k) * 0.9 : 0.01 * k));
      const close = open * (wild ? 1.5 - (k % 2) : 1.01);
      return { day, open, close, high: Math.max(open, close) * 1.1, low: Math.min(open, close) * 0.9, readings: 3, ohlcSource: 'price' };
    });

  it('takes only id, time, span, rank and width', () => {
    const { model } = buildChartModel(series(1, false), events, { todayUtc: TODAY })!;
    for (const item of annotationItems(model.lane, ['ships', 'releases', 'code'], model.rows.length)) {
      expect(Object.keys(item).every((key) => ['id', 'x', 'span', 'rank', 'width'].includes(key))).toBe(true);
    }
  });

  it('lays the same events out identically over two unrelated price histories', () => {
    const calm = buildChartModel(series(0.00002, false), events, { todayUtc: TODAY })!.model;
    const wild = buildChartModel(series(900, true), events, { todayUtc: TODAY })!.model;
    const order = ['ships', 'releases', 'code'];
    const a = annotationItems(calm.lane, order, calm.rows.length);
    const b = annotationItems(wild.lane, order, wild.rows.length);
    expect(b).toEqual(a);
    const options = { plotWidth: 800, bands: 2, maxCallouts: 10 };
    expect(layoutAnnotations(b, options)).toEqual(layoutAnnotations(a, options));
  });

  it('ranks by family order, then the newest — the order the caller gave, not price', () => {
    const { model } = buildChartModel(series(1, true), events, { todayUtc: TODAY })!;
    expect(rankEvents(model.lane, ['releases', 'ships', 'code']).map((e) => e.id)).toEqual(['ship:b', 'ship:a', 'ship:c']);
  });
});

describe('the newest and most important events keep their titles (review repair, 2026-09-29)', () => {
  /*
   * The AgentOS shape that failed at 1440: 90 days on the axis, eight ships
   * in one week, a release inside that week, the oldest ship three weeks
   * before, and the newest release two days ago at the plot's right edge.
   * Before the repair only the oldest ship kept a title: the newest release
   * was a "+1 change" chip and the other release sat inside "+9 changes".
   */
  const TODAY = '2026-09-29';
  const FAMILIES = [
    { key: 'ships', label: 'Ships', shape: 'circle', tone: 'var(--hey-layer-ship)', rank: 2 },
    { key: 'releases', label: 'Releases', shape: 'square', tone: 'var(--hey-layer-release)', rank: 0 },
    { key: 'deployments', label: 'Deployments', shape: 'plus', tone: 'var(--hey-layer-deployment)', rank: 1 },
    { key: 'more', label: 'More', shape: 'dot', tone: 'var(--hey-secondary)', rank: 7 },
  ] as const;
  const days: CandleDay[] = Array.from({ length: 90 }, (_, k) => {
    const day = new Date(Date.UTC(2026, 5, 30 + k)).toISOString().slice(0, 10);
    // Only the last 30 days were read, as on the demo token.
    if (k < 60) return { day, readings: 0 };
    const open = 0.00024 + (k % 5) * 0.000001;
    return { day, open, close: open * (k % 2 ? 1.02 : 0.98), high: open * 1.05, low: open * 0.95, readings: 4, ohlcSource: 'price' };
  });
  const events: ChartEvent[] = [
    { id: 'ship:beta', at: '2026-09-02T00:00:00Z', title: 'Product beta', family: 'ships', precision: 'DATE' },
    ...Array.from({ length: 8 }, (_, k): ChartEvent => ({
      id: `ship:week-${k}`,
      at: `2026-09-${String(17 + (k % 4)).padStart(2, '0')}T${String(8 + k).padStart(2, '0')}:00:00Z`,
      title: `Weekly ship ${k + 1}`,
      family: 'ships',
      precision: 'EXACT',
    })),
    { id: 'ship:api', at: '2026-09-20T12:00:00Z', title: 'Public API launched', family: 'releases', precision: 'EXACT' },
    { id: 'ship:sdk', at: '2026-09-27T19:18:00Z', title: 'Agent SDK v0.4', family: 'releases', precision: 'EXACT' },
  ];
  const built = buildChartModel(days, events, { todayUtc: TODAY, families: FAMILIES })!;
  const order = calloutRankOrder(built.model.families);

  it('ranks releases, then deployments, then ships, then the rest — newest first inside each', () => {
    expect(order).toEqual(['releases', 'ships']);
    expect(calloutRankOrder(FAMILIES)).toEqual(['releases', 'deployments', 'ships', 'more']);
    const ranked = rankEvents(built.model.lane, order).map((e) => e.id);
    expect(ranked.slice(0, 2)).toEqual(['ship:sdk', 'ship:api']);
    expect(ranked.at(-1)).toBe('ship:beta');
    // Inside a family, the newest first.
    const weekly = ranked.filter((id) => id.startsWith('ship:week-'));
    const at = (id: string) => Date.parse(events.find((e) => e.id === id)!.at);
    expect(weekly.map(at)).toEqual(weekly.map(at).sort((a, b) => b - a));
  });

  for (const plotWidth of [938, 1030, 1200, 700, 560]) {
    it(`gives both releases titled callouts at a ${plotWidth}px plot, and never a chip of one`, () => {
      const input = annotationItems(built.model.lane, order, built.model.rows.length);
      const bands = bandsFor(input.length);
      const layout = layoutAnnotations(input, {
        plotWidth,
        bands,
        maxCallouts: plotWidth < 900 ? 7 : plotWidth < 1200 ? 10 : 12,
      });
      check(layout, input, plotWidth, bands);
      const titled = layout.callouts.map((c) => c.id);
      expect(titled).toContain('ship:sdk');
      expect(titled).toContain('ship:api');
      // Over its own time: the newest release's stem starts under its callout, at the right edge,
      // and the callout stays over the plot — the latest-price label has its own gutter beside it.
      const sdk = layout.callouts.find((c) => c.id === 'ship:sdk')!;
      expect(sdk.anchor).toBeGreaterThanOrEqual(sdk.left);
      expect(sdk.anchor).toBeLessThanOrEqual(sdk.left + sdk.width);
      expect(sdk.left + sdk.width).toBeLessThanOrEqual(plotWidth);
      expect(sdk.anchor / plotWidth).toBeGreaterThan(0.95);
      expect(sdk.more).toEqual([]);
      // The busy week is one mark, titled by the release inside it, the ships counted beside it.
      const week = layout.callouts.find((c) => c.id === 'ship:api')!;
      expect(week.more.slice().sort()).toEqual(Array.from({ length: 8 }, (_, k) => `ship:week-${k}`));
      expect(layout.clusters.every((c) => c.ids.length > 1)).toBe(true);
    });
  }

  it('is the same layout for the same input, in any order', () => {
    const input = annotationItems(built.model.lane, order, built.model.rows.length);
    const options = { plotWidth: 938, bands: 2, maxCallouts: 10 };
    expect(layoutAnnotations([...input].reverse(), options)).toEqual(layoutAnnotations(input, options));
  });
});
