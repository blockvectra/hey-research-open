import { describe, expect, it } from 'vitest';

import { shapeTimeline, TIMELINE_SHOWN, type TimelineItem, type TimelineRun } from './timeline';

const ship = (id: string, notCounted = false): TimelineItem => ({
  id,
  title: `Ship ${id}`,
  eventType: 'CODE_ACTIVITY',
  publishedAt: new Date('2026-10-20T00:00:00Z'),
  verificationStatus: 'SOURCE_LINKED',
  ...(notCounted ? { notCounted: true } : {}),
});

describe('shapeTimeline (2026-10-24 full audit, UI-2)', () => {
  it('shows the newest eight entries and puts the rest behind "Earlier ships"', () => {
    const items = Array.from({ length: 27 }, (_, index) => ship(`s${index}`));
    const { shown, earlier, earlierCount } = shapeTimeline(items);
    expect(TIMELINE_SHOWN).toBe(8);
    expect(shown).toHaveLength(8);
    expect(earlier).toHaveLength(19);
    expect(earlierCount).toBe(19);
  });

  it('folds two or more consecutive not-counted weeks into one line, never a single one', () => {
    const items = [ship('a'), ship('b', true), ship('c', true), ship('d', true), ship('e'), ship('f', true), ship('g')];
    const { shown } = shapeTimeline(items);
    expect(shown.map((entry) => ('kind' in entry ? `${entry.kind}:${entry.items.length}` : entry.id))).toEqual(['a', 'not_counted:3', 'e', 'f', 'g']);
  });

  it('keeps every item exactly once and counts folded items in the earlier total', () => {
    const run: TimelineRun = { kind: 'release_burst', id: 'r', line: '3 releases', items: [ship('r1'), ship('r2'), ship('r3')] };
    const items = [ship('a'), run, ship('b', true), ship('c', true), ship('d')];
    const { shown, earlier, earlierCount } = shapeTimeline(items, 1);
    expect(shown).toHaveLength(1);
    expect(earlier).toHaveLength(3);
    expect(earlierCount).toBe(3 + 2 + 1);
  });
});
