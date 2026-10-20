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
  rulesVersion: 'peers-v2',
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

  it('never prints a second Build Momentum: no comparison is an unknown comparison, and an earlier run is named (persona audit PB-20)', () => {
    const few = dimension({ metric: 'build_momentum', label: 'Build Momentum', value: 45, cohortSize: 2, median: null, range: null, statsReason: 'not_enough_comparable_projects', comparison: null, line: 'Build Momentum 45 — not enough comparable projects (2 measured RWA projects; 8 needed).' });
    const lines = peerContextLines(context({ dimensions: [few] }), { buildMomentum: 43.1 }).join('\n');
    expect(lines).toContain('- UNKNOWN peer comparison, not enough comparable projects in the cohort: Build Momentum (2 measured; 8 needed).');
    expect(lines).not.toMatch(/UNKNOWN Build Momentum/);
    expect(lines).not.toContain('45');
    // A compared value the daily run read before the current score: whose reading it is, and the current one.
    const compared = dimension({ metric: 'build_momentum', label: 'Build Momentum', value: 44.7, line: 'Build Momentum 44.7 — above the median (30) of 9 researched DEX projects.' });
    const text = peerContextLines(context({ dimensions: [compared] }), { buildMomentum: 43.1 }).join('\n');
    expect(text).toContain("- DERIVED Build Momentum 44.7 — above the median (30) of 9 researched DEX projects. (the peer run's reading of 2026-09-26 02:00 UTC; the current Build Momentum is 43.1)");
    expect(peerContextLines(context({ dimensions: [compared] }), { buildMomentum: 44.7 }).join('\n')).not.toContain("peer run's reading");
  });
});
