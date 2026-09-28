import { describe, expect, it } from 'vitest';

import type { HeyPeerContext, HeyPeerDimension } from '@hey-research-lab/sdk';

import { peerContextLines } from './render-machine';

/**
 * Peer context in the MCP snapshot (2026-09-28 review repair): a run the daily
 * job has not replaced says STALE with its date, and a Build Momentum figure
 * from before a scoring change is UNKNOWN with the API's own line — never a
 * DERIVED comparison.
 */
const dimension = (over: Partial<HeyPeerDimension>): HeyPeerDimension => ({
  metric: 'meaningful_events_30d',
  label: 'Meaningful events (30 d)',
  unit: 'count',
  windowDays: 30,
  definition: 'x',
  state: 'MEASURED',
  reason: 'measured',
  value: 12,
  cohortSize: 9,
  median: 8,
  range: { p10: 2, p90: 20 },
  statsReason: null,
  percentile: null,
  percentileReason: 'cohort_below_percentile_minimum',
  comparison: 'above_median',
  line: 'Meaningful events (30 d) 12 — above the median (8) of 9 researched DEX projects.',
  ...over,
});

const context = (over: Partial<HeyPeerContext>): HeyPeerContext => ({
  rulesVersion: 'peers-v1',
  state: 'COMPUTED',
  reason: null,
  computedAt: '2026-09-26T02:00:00.000Z',
  freshness: { state: 'CURRENT', asOf: '2026-09-26T02:00:00.000Z', staleAfterHours: 36 },
  cohort: { key: 'dex:product', label: 'DEX projects', narrative: { slug: 'dex', name: 'DEX' }, family: 'product' },
  minimums: { median: 8, percentile: 20 },
  dimensions: [dimension({})],
  methodology: 'https://hey.test/methodology#peers',
  ...over,
});

describe('peerContextLines', () => {
  it('says a context the daily run has not replaced is stale, with its date', () => {
    expect(peerContextLines(context({})).join('\n')).not.toContain('STALE');
    const stale = peerContextLines(context({ freshness: { state: 'STALE', asOf: '2026-09-26T02:00:00.000Z', staleAfterHours: 36 } })).join('\n');
    expect(stale).toContain('STALE: not recomputed in 36 hours; as of 2026-09-26.');
  });

  it('prints a Build Momentum figure from before a scoring change as UNKNOWN, recomputing', () => {
    const lines = peerContextLines(
      context({
        dimensions: [
          dimension({
            metric: 'build_momentum',
            label: 'Build Momentum',
            state: 'NOT_MEASURED',
            reason: 'recomputing_after_scoring_change',
            value: null,
            comparison: null,
            line: 'Build Momentum: recomputing after a scoring change, so it is not compared yet.',
          }),
          dimension({}),
        ],
      }),
    );
    expect(lines).toContain('- UNKNOWN Build Momentum: recomputing after a scoring change, so it is not compared yet.');
    expect(lines.join('\n')).not.toMatch(/DERIVED Build Momentum/);
    expect(lines.join('\n')).not.toContain('not measured for this project, so not compared: Build Momentum');
  });
});
