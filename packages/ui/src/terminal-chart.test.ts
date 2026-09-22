import { describe, expect, it } from 'vitest';

import { dayCoverage, pickLabels, type ChartEvent } from './terminal-chart';

/**
 * The two rules in this chart that shipped wrong on 2026-09-22 and were caught
 * by review rather than by a test.
 *
 * Both were silent: nothing threw, nothing failed to compile, and the drawing
 * looked plausible. A chart that quietly annotates the wrong events, or
 * quietly reports a day it never read as a day it did, is the failure mode
 * this whole surface exists to avoid.
 */
const event = (id: string, day: string): ChartEvent => ({
  id,
  day,
  title: id,
  layer: 'ship',
  precision: 'exact',
  precisionLabel: 'exact',
  timeLabel: day,
});

/** A 100-column range, so a percentage of it is easy to reason about. */
const columns = 100;
const indexOf = new Map(Array.from({ length: columns }, (_, i) => [`d${i}`, i]));

describe('pickLabels', () => {
  /*
   * The bug. The caller hands events over newest-first; the loop used to walk
   * from the end, which labelled the three oldest and left the callouts naming
   * events the timeline below never mentioned.
   */
  it('labels the newest events, not the oldest', () => {
    const newestFirst = [event('newest', 'd90'), event('middle', 'd60'), event('oldest', 'd30')];
    expect(pickLabels(newestFirst, indexOf, columns).map((l) => l.event.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('never labels more than three', () => {
    const many = Array.from({ length: 20 }, (_, i) => event(`e${i}`, `d${95 - i * 4}`));
    expect(pickLabels(many, indexOf, columns)).toHaveLength(3);
  });

  /* Two cards closer than the minimum gap would overlap at every width. */
  it('skips a candidate too close to one already kept', () => {
    const crowded = [event('a', 'd90'), event('b', 'd89'), event('c', 'd88'), event('d', 'd50')];
    const picked = pickLabels(crowded, indexOf, columns).map((l) => l.event.id);
    expect(picked).toContain('a');
    expect(picked).not.toContain('b');
    expect(picked).toContain('d');
  });

  /* A card at the very left edge hangs off the plot. */
  it('leaves the leftmost sliver alone', () => {
    expect(pickLabels([event('edge', 'd2')], indexOf, columns)).toEqual([]);
  });

  it('ignores an event on a day the range does not contain', () => {
    expect(pickLabels([event('orphan', 'nope')], indexOf, columns)).toEqual([]);
  });

  it('survives a range of one column without dividing by zero', () => {
    const single = new Map([['d0', 0]]);
    expect(() => pickLabels([event('a', 'd0')], single, 1)).not.toThrow();
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
