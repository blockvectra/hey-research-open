import { describe, expect, it } from 'vitest';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { layoutMapNodes, MAP_VIEWBOX, MapClusterList, mapHueFor, mapLabelBox, mapNodeShips, mapNodeTooltip, UNCLASSIFIED_HUE, type MapNodeData } from './map';

/**
 * Map layout invariants (UI/UX V2 section 28).
 *
 * The layout is deterministic and runs on the server, so it can be checked
 * directly rather than through a rendered snapshot.
 */
const node = (slug: string, narrativeSlug: string | null, size: number): MapNodeData => ({
  slug,
  name: slug,
  narrativeSlug,
  narrative: narrativeSlug,
  activityStatus: 'ACTIVE',
  // The layout tests need varied circles: the figure is the ships the circle is sized by.
  countedShips: size,
});

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('layoutMapNodes', () => {
  it('is deterministic', () => {
    const nodes = [node('a', 'one', 1000), node('b', 'two', 500), node('c', null, 250)];

    expect(layoutMapNodes(nodes, ['one', 'two'])).toEqual(layoutMapNodes(nodes, ['one', 'two']));
  });

  it('keeps every node inside the canvas', () => {
    const nodes = Array.from({ length: 120 }, (_, index) =>
      node(`p${index}`, index % 5 === 0 ? null : `n${index % 7}`, (index + 1) * 1000),
    );

    for (const placed of layoutMapNodes(nodes, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'])) {
      expect(placed.x).toBeGreaterThanOrEqual(0);
      expect(placed.x).toBeLessThanOrEqual(960);
      expect(placed.y).toBeGreaterThanOrEqual(0);
      expect(placed.y).toBeLessThanOrEqual(640);
    }
  });

  it('never stacks a cluster onto a single point, even in a cramped cell', () => {
    // One dominant cluster leaves the rest very little room — the shape of the
    // live chain, where most projects are still unclassified.
    const nodes = [
      ...Array.from({ length: 60 }, (_, index) => node(`bulk${index}`, null, 10_000)),
      ...Array.from({ length: 6 }, (_, index) => node(`tiny${index}`, 'small', 10_000)),
    ];

    const placed = layoutMapNodes(nodes, ['small']);
    const tiny = placed.filter((item) => item.slug.startsWith('tiny'));

    expect(tiny).toHaveLength(6);
    for (let i = 0; i < tiny.length; i += 1) {
      for (let j = i + 1; j < tiny.length; j += 1) {
        const a = tiny[i];
        const b = tiny[j];
        if (!a || !b) throw new Error('missing node');
        expect(distance(a, b)).toBeGreaterThan(0);
      }
    }
  });

  it('gives the dominant cluster most of the canvas', () => {
    const nodes = [
      ...Array.from({ length: 54 }, (_, index) => node(`bulk${index}`, null, 10_000)),
      node('solo', 'lonely', 10_000),
    ];

    const placed = layoutMapNodes(nodes, ['lonely']);
    const bulk = placed.filter((item) => item.slug.startsWith('bulk'));
    const spans = {
      x: Math.max(...bulk.map((item) => item.x)) - Math.min(...bulk.map((item) => item.x)),
      y: Math.max(...bulk.map((item) => item.y)) - Math.min(...bulk.map((item) => item.y)),
    };

    // The big cluster spreads across the canvas rather than being boxed into an
    // equal share with the one-project narrative.
    expect(spans.x).toBeGreaterThan(300);
    expect(spans.y).toBeGreaterThan(300);
  });

  it('labels only a handful of the largest nodes', () => {
    const nodes = Array.from({ length: 40 }, (_, index) =>
      node(`p${index}`, null, (index + 1) * 100_000),
    );

    const labelled = layoutMapNodes(nodes, []).filter((item) => item.labelled);

    expect(labelled.length).toBeLessThanOrEqual(8);
    expect(labelled.length).toBeGreaterThan(0);
  });

  it('never places two labels close enough to overlap', () => {
    // A dense single cluster is where labels used to collide into mush.
    const nodes = Array.from({ length: 60 }, (_, index) =>
      node(`p${index}`, null, (index + 1) * 250_000),
    );

    const labelled = layoutMapNodes(nodes, []).filter((item) => item.labelled);

    for (let i = 0; i < labelled.length; i += 1) {
      for (let j = i + 1; j < labelled.length; j += 1) {
        const a = labelled[i];
        const b = labelled[j];
        if (!a || !b) throw new Error('missing node');
        const apart = Math.abs(a.x - b.x) >= 96 || Math.abs(a.y + a.r - (b.y + b.r)) >= 22;
        expect(apart).toBe(true);
      }
    }
  });

  it('sizes circles by counted ships, never by the market (founder, 2026-10-30)', () => {
    // A valuation the domain still reads rides along and sizes nothing.
    const read = (slug: string, countedShips: number, marketCapUsd: number): MapNodeData =>
      Object.assign({ ...node(slug, null, 0), countedShips }, { marketCapUsd });
    const busy = read('busy', 24, 1_000);
    const rich = read('rich', 1, 50_000_000);
    const idle = read('idle', 0, 900_000_000);
    const placed = layoutMapNodes([busy, rich, idle], []);

    const r = (slug: string) => placed.find((item) => item.slug === slug)?.r ?? 0;
    expect(r('busy')).toBeGreaterThan(r('rich'));
    expect(r('rich')).toBeGreaterThan(r('idle'));
    expect(mapNodeTooltip(busy, new Date())).toContain('24 counted ships in 8 weeks');
  });

  /*
   * No valuation on the map (2026-10-30, V2 phase 6): the tooltip and the phone list printed a bare figure, "—" where
   * there was none, ungated by UI rule 3's R5. Both now say the ships the circle is sized by, and nothing when unread.
   */
  it('prints the ships a circle is sized by, never a valuation or a placeholder', () => {
    const pool = Object.assign({ ...node('pool', null, 3) }, { marketCapUsd: 10_000_000, launchPool: true, valuationKind: 'fdv' });
    expect(mapNodeShips(pool)).toBe('3 counted ships in 8 weeks');
    expect(mapNodeShips({ ...node('one', null, 1) })).toBe('1 counted ship in 8 weeks');
    expect(mapNodeTooltip(pool, new Date())).not.toMatch(/valuation|launch pool|\$10M/i);
    const { countedShips: _unread, ...unread } = node('unread', null, 0);
    expect(mapNodeShips(unread)).toBeUndefined();

    const html = renderToStaticMarkup(createElement(MapClusterList, { nodes: [pool, unread], legend: [] }));
    expect(html).toContain('3 counted ships in 8 weeks');
    expect(html).not.toMatch(/\$10M|launch pool|—/);
  });
});

/** The pad around the canvas (2026-10-30, V2 phase 6): a name at the canvas edge was cut ("Executability Ren…"). */
describe('map canvas', () => {
  it('draws every label inside the SVG', () => {
    const nodes = Array.from({ length: 120 }, (_, index) =>
      node(`a-long-project-name-${index}`, index % 4 === 0 ? null : `n${index % 6}`, (index % 30) + 1),
    );
    const placed = layoutMapNodes(nodes, ['n1', 'n2', 'n3', 'n4', 'n5']);
    for (const item of placed) {
      const box = mapLabelBox(item);
      expect(box.x).toBeGreaterThanOrEqual(MAP_VIEWBOX.x);
      expect(box.x + box.w).toBeLessThanOrEqual(MAP_VIEWBOX.x + MAP_VIEWBOX.w);
      expect(box.y + box.h).toBeLessThanOrEqual(MAP_VIEWBOX.y + MAP_VIEWBOX.h);
      expect(item.y - item.r - 3).toBeGreaterThanOrEqual(MAP_VIEWBOX.y);
    }
  });
});

/** Audit #10 (2026-10-16): seventeen narratives cycled through seven colours, and Unclassified had no legend entry. */
describe('mapHueFor', () => {
  const order = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'];

  it('gives the six largest narratives six different colours and never repeats one', () => {
    const hues = order.slice(0, 6).map((slug) => mapHueFor(slug, order));
    expect(new Set(hues).size).toBe(6);
  });

  it('folds every narrative past the sixth into one grey that no top narrative uses', () => {
    const top = order.slice(0, 6).map((slug) => mapHueFor(slug, order));
    expect(mapHueFor('n6', order)).toBe(mapHueFor('n7', order));
    expect(top).not.toContain(mapHueFor('n6', order));
  });

  it('draws a project with no narrative in its own style, never a narrative colour', () => {
    expect(mapHueFor(null, order)).toBe(UNCLASSIFIED_HUE);
    expect(order.map((slug) => mapHueFor(slug, order))).not.toContain(UNCLASSIFIED_HUE);
  });
});

describe('map labels', () => {
  it('never places a name over another project\'s circle', () => {
    const nodes = Array.from({ length: 80 }, (_, index) =>
      node(`project-${index}`, index % 3 === 0 ? null : `n${index % 4}`, (index + 1) * 50_000),
    );
    const placed = layoutMapNodes(nodes, ['n1', 'n2', 'n3']);
    expect(placed.filter((item) => item.labelled).length).toBeGreaterThan(0);
    for (const label of placed.filter((item) => item.labelled)) {
      const box = mapLabelBox(label);
      for (const other of placed) {
        if (other.slug === label.slug) continue;
        const nx = Math.max(box.x, Math.min(other.x, box.x + box.w));
        const ny = Math.max(box.y, Math.min(other.y, box.y + box.h));
        expect(Math.hypot(other.x - nx, other.y - ny)).toBeGreaterThanOrEqual(other.r + 3);
      }
    }
  });
});
