import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bubbleBounds, CLUSTER_COLOURS } from './bubble-map';

const source = readFileSync(fileURLToPath(new URL('./bubble-map.tsx', import.meta.url)), 'utf8');

describe('bubble map (redesign, 2026-09-26)', () => {
  it('fits its own circles plus a margin, so there is no empty canvas above the drawing', () => {
    const box = bubbleBounds([
      { x: 0, y: 0, r: 50 },
      { x: 120, y: 10, r: 20 },
    ]);
    expect(box).toEqual({ x: -74, y: -74, width: 238, height: 148 });
  });

  it('draws flat fills: no radial gradient, no glow', () => {
    expect(source).not.toMatch(/radialGradient/);
    expect(source).not.toMatch(/drop-shadow|feGaussianBlur/);
  });

  it('never colours a cluster with builder green or a warning tone', () => {
    for (const colour of CLUSTER_COLOURS) {
      expect(colour).not.toMatch(/status-|accent|market-/);
    }
  });
});
