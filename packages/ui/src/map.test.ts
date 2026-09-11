import { describe, expect, it } from 'vitest';

import { layoutMapNodes, type MapNodeData } from './map';

/**
 * Map layout invariants (UI/UX V2 section 28).
 *
 * The layout is deterministic and runs on the server, so it can be checked
 * directly rather than through a rendered snapshot.
 */
const node = (slug: string, narrativeSlug: string | null, marketCapUsd: number): MapNodeData => ({
  slug,
  name: slug,
  narrativeSlug,
  narrative: narrativeSlug,
  activityStatus: 'ACTIVE',
  marketCapUsd,
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

  it('sizes circles by market cap, so a bigger cap is never a smaller circle', () => {
    const placed = layoutMapNodes([node('small', null, 1_000), node('big', null, 10_000_000)], []);

    const small = placed.find((item) => item.slug === 'small');
    const big = placed.find((item) => item.slug === 'big');
    expect(big?.r ?? 0).toBeGreaterThan(small?.r ?? 0);
  });
});
