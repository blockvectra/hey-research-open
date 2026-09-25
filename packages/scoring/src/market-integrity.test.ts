import { describe, expect, it } from 'vitest';

import {
  correlate,
  evaluateMarketIntegrity,
  MARKET_INTEGRITY_RULES_VERSION,
  type IntegrityDay,
  type MarketIntegrityInput,
} from './market-integrity';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const day = (offset: number): string => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

/** Daily liquidity closes ending today, oldest first; `null` is a day HEY has no reading for. */
function series(values: readonly (number | null)[], trades?: readonly (number | null)[]): IntegrityDay[] {
  return values.map((liquidityUsd, i) => ({
    day: day(i - values.length + 1),
    liquidityUsd,
    volumeUsd: null,
    trades: trades ? (trades[i] ?? null) : null,
  }));
}

function input(overrides: Partial<MarketIntegrityInput> = {}): MarketIntegrityInput {
  return {
    now: NOW,
    marketStatus: 'ACTIVE_MARKET',
    marketStatusReason: 'liquidity_and_volume',
    currentLiquidityUsd: null,
    currentLiquidityAt: null,
    launchStage: 'DEX',
    launchStageAt: null,
    days: [],
    pools: [],
    chainPools: null,
    locks: [],
    linkedMoves: [],
    builder: { activityStatus: 'UNKNOWN', ships: [] },
    ...overrides,
  };
}

const HEALTHY = [80_000, 82_000, 81_000, 83_000, 79_000, 80_500, 82_400, 81_200, 80_000, 82_000];
/** A healthy market drained in two days, then a week of near-empty pool and no trades. */
const CRASH = [...HEALTHY, 30_000, 400, 350, 330, 320, 310, 300, 290];
const CRASH_TRADES = [...HEALTHY.map(() => 120), 60, 0, 0, 0, 0, 0, 0, 0];
/** The day liquidity first sat under a tenth of the peak, in CRASH. */
const CRASH_DAY = -6;

describe('market integrity: the market side', () => {
  it('a healthy live market is established, with no collapse and nothing to review', () => {
    const result = evaluateMarketIntegrity(input({ days: series(HEALTHY) }));
    expect(result.rulesVersion).toBe(MARKET_INTEGRITY_RULES_VERSION);
    expect(result.established).toBe(true);
    expect(result.collapse).toBe('NONE');
    expect(result.exitPattern.level).toBe('NONE');
    expect(result.reviewReasons).toEqual([]);
    expect(result.history.firstMarketDay).toBe(day(-9));
  });

  it('a temporary dip that recovers is not a collapse', () => {
    const result = evaluateMarketIntegrity(input({ days: series([...HEALTHY, 30_000, 78_000]) }));
    expect(result.collapse).toBe('NONE');
  });

  it('one bad reading cannot trigger a collapse or an exit pattern', () => {
    const result = evaluateMarketIntegrity(input({ days: series([...HEALTHY, 900]) }));
    expect(result.collapse).toBe('NONE');
    expect(result.exitPattern.level).toBe('NONE');
    expect(result.events.filter((e) => e.kind === 'LIQUIDITY_COLLAPSE')).toEqual([]);
  });

  it('a one-day spike does not become the peak a collapse is measured against', () => {
    const days = series([20_000, 21_000, 900_000, 20_500, 19_800, 20_200, 19_900]);
    const result = evaluateMarketIntegrity(input({ days }));
    expect(result.history.peakLiquidityUsd).toBe(21_000);
    expect(result.collapse).toBe('NONE');
  });

  it('a token with no real market yet is not established and never collapses', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'NO_LIQUIDITY', marketStatusReason: 'no_liquidity', days: series([40, 60, 20, 0, 0]) }));
    expect(result.established).toBe(false);
    expect(result.collapse).toBe('NONE');
    expect(result.conflicts).toEqual([]);
  });

  it('a launch token with no pool and no readings stays unknown, never zero', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'INSUFFICIENT_DATA', marketStatusReason: 'no_readings', launchStage: 'CURVE' }));
    expect(result.established).toBe(false);
    expect(result.history.peakLiquidityUsd).toBeNull();
    expect(result.history.currentLiquidityUsd).toBeNull();
    expect(result.history.liquidityChangePct).toBeNull();
    expect(result.activity).toBeNull();
  });

  it('a collapse confirmed over two days is recorded with its day, peak and change', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'LIQUIDITY_REMOVED', days: series([...HEALTHY, 60_000, 1_200, 1_129]) }));
    expect(result.collapse).toBe('SEVERE');
    expect(result.history.collapseDay).toBe(day(-1));
    expect(result.history.deteriorationStartDay).toBe(day(-1));
    expect(result.history.liquidityChangePct).toBeCloseTo(-98.64, 1);
    const event = result.events.find((e) => e.kind === 'LIQUIDITY_COLLAPSE');
    expect(event?.precision).toBe('day');
    expect(event?.eventAt.toISOString()).toBe(`${day(-1)}T00:00:00.000Z`);
  });

  it('complete removal with trading gone and a rapid fall is an exit pattern, but not high confidence on market evidence alone', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'LIQUIDITY_REMOVED', days: series(CRASH, CRASH_TRADES) }));
    expect(result.collapse).toBe('SEVERE');
    expect(result.history.collapseDay).toBe(day(CRASH_DAY));
    expect(result.rapidCollapse).toBe(true);
    expect(result.exitPattern.level).toBe('EXIT_PATTERN');
    expect(result.exitPattern.supporting).toEqual(expect.arrayContaining(['trading', 'rapid']));
    expect(result.exitPattern.reasons.join(' ')).not.toMatch(/rug|scam|safe/i);
  });

  it('high confidence needs lock or project-linked evidence on top of the market evidence', () => {
    const result = evaluateMarketIntegrity(
      input({
        marketStatus: 'LIQUIDITY_REMOVED',
        days: series(CRASH, CRASH_TRADES),
        locks: [{ assetKind: 'LP', lockId: 7, unlockAt: new Date(`${day(CRASH_DAY - 2)}T10:00:00Z`), withdrawn: true, observedAt: new Date(`${day(-1)}T06:00:00Z`) }],
      }),
    );
    expect(result.exitPattern.level).toBe('EXIT_PATTERN_HIGH_CONFIDENCE');
    expect(result.lock.state).toBe('WITHDRAWN');
    const withdrawn = result.events.find((e) => e.kind === 'LOCK_WITHDRAWN');
    expect(withdrawn?.precision).toBe('window');
  });

  it('a collapse alone, with nothing supporting it, is not an exit pattern', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'LIQUIDITY_REMOVED', days: series([...HEALTHY, 40_000, 30_000, 20_000, 12_000, 9_000, 3_000, 2_500]) }));
    expect(result.collapse).toBe('SEVERE');
    expect(result.rapidCollapse).toBe(false);
    expect(result.exitPattern.level).toBe('NONE');
  });

  it('trading that stops while liquidity remains is not a liquidity collapse', () => {
    const trades = [...HEALTHY.map(() => 50), 0, 0, 0, 0, 0, 0, 0, 0];
    const result = evaluateMarketIntegrity(input({ marketStatus: 'TRADING_INACTIVE', marketStatusReason: 'no_volume_24h', days: series([...HEALTHY, ...HEALTHY.slice(0, 8)], trades) }));
    expect(result.collapse).toBe('NONE');
    expect(result.tradingStopped).toBe(true);
    expect(result.exitPattern.level).toBe('NONE');
  });

  it('a legitimate pool migration is not an exit', () => {
    const result = evaluateMarketIntegrity(
      input({
        marketStatus: 'LIQUIDITY_REMOVED',
        days: series(CRASH, CRASH_TRADES),
        pools: [
          { pairAddress: '0xold', venue: 'uniswap_v3', firstSeenAt: new Date(`${day(-40)}T00:00:00Z`), lastSeenAt: new Date(`${day(-1)}T00:00:00Z`), maxLiquidityUsd: 83_000, lastLiquidityUsd: 350 },
          { pairAddress: '0xnew', venue: 'uniswap_v4', firstSeenAt: new Date(`${day(CRASH_DAY)}T00:00:00Z`), lastSeenAt: NOW, maxLiquidityUsd: 76_000, lastLiquidityUsd: 76_000 },
        ],
      }),
    );
    expect(result.migration?.kind).toBe('POOL');
    expect(result.migration?.confidence).toBe('high');
    expect(result.migration?.toPool).toBe('0xnew');
    expect(result.exitPattern.level).toBe('NONE');
    expect(result.reviewReasons).toContain('migration_candidate');
  });

  it('a bonding-curve graduation explains the fall of the curve liquidity', () => {
    const result = evaluateMarketIntegrity(
      input({ marketStatus: 'LIQUIDITY_REMOVED', launchStage: 'GRADUATED', launchStageAt: new Date(`${day(-1)}T08:00:00Z`), days: series([...HEALTHY, 30_000, 400, 350], [...HEALTHY.map(() => 90), 40, 0, 0]) }),
    );
    expect(result.migration?.kind).toBe('GRADUATION');
    expect(result.exitPattern.level).toBe('NONE');
  });

  it('liquidity the chain still reports across other pools is a migration candidate, not an exit', () => {
    const result = evaluateMarketIntegrity(
      input({ marketStatus: 'LIQUIDITY_REMOVED', chainPools: { day: day(0), pools: 4, liquidityUsd: 70_000 }, days: series([...HEALTHY, 30_000, 400, 350], [...HEALTHY.map(() => 90), 40, 0, 0]) }),
    );
    expect(result.migration?.kind).toBe('OTHER_POOLS');
    expect(result.exitPattern.level).toBe('NONE');
  });

  it('reads ACTIVE while any lock still holds, whatever an older lock did (mi-v3)', () => {
    const result = evaluateMarketIntegrity(
      input({
        days: series(HEALTHY),
        locks: [
          { assetKind: 'TOKEN', lockId: 1, unlockAt: new Date(`${day(-30)}T00:00:00Z`), withdrawn: true, observedAt: NOW },
          { assetKind: 'TOKEN', lockId: 2, unlockAt: new Date('2027-01-01T00:00:00Z'), withdrawn: false, observedAt: NOW },
        ],
      }),
    );
    expect(result.lock.state).toBe('ACTIVE');
    expect(result.events.some((event) => event.kind === 'LOCK_WITHDRAWN')).toBe(true);
  });

  it('a lock expiry without a market failure is only a lock event', () => {
    const result = evaluateMarketIntegrity(
      input({ days: series(HEALTHY), locks: [{ assetKind: 'LP', lockId: 3, unlockAt: new Date(`${day(-3)}T00:00:00Z`), withdrawn: false, observedAt: NOW }] }),
    );
    expect(result.lock.state).toBe('EXPIRED');
    expect(result.lock.precededCollapse).toBe(false);
    expect(result.events.map((e) => e.kind)).toEqual(['LOCK_EXPIRED']);
    expect(result.exitPattern.level).toBe('NONE');
  });

  it('when the status and the daily index describe different markets, it is a conflict to review, never an exit', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'LIQUIDITY_REMOVED', marketStatusReason: 'liquidity_far_below_peak', days: series(HEALTHY) }));
    expect(result.dataConflict?.kind).toBe('STATUS_REMOVED_INDEX_LIVE');
    expect(result.exitPattern.level).toBe('NONE');
    expect(result.reviewReasons).toContain('data_conflict');
  });

  it('a fall that starts the day the winning source changed is two sources disagreeing, not a collapse (eel-on-musk, mi-v2)', () => {
    const days = series([5_000, 5_050, 5_070, 5_020, 5_019, 10, 10, 10]).map((d, i) => ({ ...d, source: i < 5 ? 'dexscreener' : 'geckoterminal' }));
    const result = evaluateMarketIntegrity(input({ marketStatus: 'LIQUIDITY_REMOVED', days, builder: { activityStatus: 'SHIPPING', ships: [] } }));
    expect(result.collapse).toBe('NONE');
    expect(result.dataConflict?.kind).toBe('SOURCE_CHANGED_AT_FALL');
    expect(result.exitPattern.level).toBe('NONE');
    expect(result.events.some((e) => e.kind === 'LIQUIDITY_COLLAPSE')).toBe(false);
    expect(result.reviewReasons).toContain('data_conflict');
  });

  it('when the chain still reports the level in the token’s one pool, the index fall is withdrawn and held for review (mi-v2)', () => {
    const result = evaluateMarketIntegrity(
      input({ marketStatus: 'LIQUIDITY_REMOVED', chainPools: { day: day(0), pools: 1, liquidityUsd: 79_000 }, days: series(CRASH, CRASH_TRADES) }),
    );
    expect(result.collapse).toBe('NONE');
    expect(result.history.collapseDay).toBeNull();
    expect(result.dataConflict?.kind).toBe('CHAIN_STILL_HOLDS');
    expect(result.exitPattern.level).toBe('NONE');
  });

  it('a stale index (market-data outage) confirms nothing', () => {
    const days = series([...HEALTHY, 400, 350]).map((d) => ({ ...d, day: new Date(new Date(`${d.day}T00:00:00Z`).getTime() - 10 * 86_400_000).toISOString().slice(0, 10) }));
    const result = evaluateMarketIntegrity(input({ marketStatus: 'MARKET_ABANDONED', days }));
    expect(result.history.indexStale).toBe(true);
    expect(result.collapse).toBe('NONE');
    expect(result.exitPattern.level).toBe('NONE');
  });

  it('a gap in the index is unknown, not zero: missing days never count as no trades', () => {
    const days = series([...HEALTHY, null, null, 79_000], [...HEALTHY.map(() => 30), null, null, 28]);
    const result = evaluateMarketIntegrity(input({ days }));
    expect(result.activity?.recentTradesPerDay).toBeGreaterThan(20);
    expect(result.tradingStopped).toBe(false);
  });
});

describe('market integrity: builder × market', () => {
  const ship = (offsetDays: number, release = false) => ({ at: new Date(NOW.getTime() + offsetDays * 86_400_000), release });

  it('a shipping builder whose token lost its liquidity is a signal conflict', () => {
    const result = evaluateMarketIntegrity(
      input({ marketStatus: 'LIQUIDITY_REMOVED', days: series([...HEALTHY, 60_000, 1_200, 1_129]), builder: { activityStatus: 'SHIPPING', ships: [ship(-20), ship(-0.3, true)] } }),
    );
    expect(result.conflicts).toEqual(expect.arrayContaining(['BUILDER_ACTIVE_MARKET_GONE', 'RECENT_SHIP_AFTER_LIQUIDITY_REMOVAL']));
    expect(result.reviewReasons).toContain('builder_active_market_gone');
  });

  it('no "market gone" while HEY holds a reading that says otherwise: live index, or a pool the liquidity moved to (mi-v2)', () => {
    const live = evaluateMarketIntegrity(input({ marketStatus: 'LIQUIDITY_REMOVED', days: series(HEALTHY), builder: { activityStatus: 'SHIPPING', ships: [ship(-1)] } }));
    expect(live.dataConflict?.kind).toBe('STATUS_REMOVED_INDEX_LIVE');
    expect(live.conflicts).not.toContain('BUILDER_ACTIVE_MARKET_GONE');
    const moved = evaluateMarketIntegrity(
      input({
        marketStatus: 'LIQUIDITY_REMOVED',
        days: series(CRASH, CRASH_TRADES),
        pools: [{ pairAddress: '0xnew', venue: null, firstSeenAt: new Date(`${day(CRASH_DAY)}T00:00:00Z`), lastSeenAt: NOW, maxLiquidityUsd: 60_000, lastLiquidityUsd: 60_000 }],
        builder: { activityStatus: 'SHIPPING', ships: [ship(-1)] },
      }),
    );
    expect(moved.migration?.kind).toBe('POOL');
    expect(moved.conflicts).not.toContain('BUILDER_ACTIVE_MARKET_GONE');
  });

  it('a dead market and a dormant builder is no conflict: the two stories match', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'LIQUIDITY_REMOVED', days: series([...HEALTHY, 60_000, 1_200, 1_129]), builder: { activityStatus: 'DORMANT', ships: [ship(-200)] } }));
    expect(result.conflicts).toEqual([]);
  });

  it('a dormant builder with a live market, and a quiet one, are named', () => {
    expect(evaluateMarketIntegrity(input({ days: series(HEALTHY), builder: { activityStatus: 'DORMANT', ships: [] } })).conflicts).toEqual(['BUILDER_DORMANT_MARKET_ACTIVE']);
    expect(evaluateMarketIntegrity(input({ days: series(HEALTHY), builder: { activityStatus: 'QUIET', ships: [] } })).conflicts).toEqual(['MARKET_ACTIVITY_WITHOUT_RECENT_BUILDING']);
  });

  it('building with low liquidity is named', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'LOW_LIQUIDITY', marketStatusReason: 'liquidity_below_threshold', days: series([3_000, 2_900, 3_100]), builder: { activityStatus: 'ACTIVE', ships: [] } }));
    expect(result.conflicts).toEqual(['BUILDING_WITH_LOW_LIQUIDITY']);
  });

  it('a migrated market with an active builder is not "market gone"', () => {
    const result = evaluateMarketIntegrity(
      input({
        marketStatus: 'ACTIVE_MARKET',
        days: series([...HEALTHY, 30_000, 400, 350]),
        pools: [{ pairAddress: '0xnew', venue: null, firstSeenAt: new Date(`${day(-2)}T00:00:00Z`), lastSeenAt: NOW, maxLiquidityUsd: 76_000, lastLiquidityUsd: 76_000 }],
        builder: { activityStatus: 'SHIPPING', ships: [ship(-1)] },
      }),
    );
    expect(result.conflicts).not.toContain('BUILDER_ACTIVE_MARKET_GONE');
  });

  it('the evaluator never reads or returns an activity status of its own: builder facts pass through untouched', () => {
    const builder = { activityStatus: 'SHIPPING', ships: [ship(-1)] } as const;
    const result = evaluateMarketIntegrity(input({ marketStatus: 'LIQUIDITY_REMOVED', days: series([...HEALTHY, 1_200, 1_129]), builder }));
    expect(builder.activityStatus).toBe('SHIPPING');
    expect(Object.keys(result)).not.toContain('activityStatus');
    expect(result.marketStatus).toBe('LIQUIDITY_REMOVED');
  });

  it('an active builder never makes a dead market look alive', () => {
    const result = evaluateMarketIntegrity(input({ marketStatus: 'MARKET_ABANDONED', marketStatusReason: 'no_recent_reading_after_market', builder: { activityStatus: 'SHIPPING', ships: [ship(-1, true)] } }));
    expect(result.marketStatus).toBe('MARKET_ABANDONED');
  });
});

describe('timeline correlation', () => {
  it('reports the signed gap and the narrowest window, without saying which caused which', () => {
    const anchor = new Date('2026-09-23T03:17:00Z');
    const out = correlate(anchor, [
      { at: new Date('2026-09-22T11:04:00Z'), label: 'Release' },
      { at: new Date('2026-09-23T03:45:00Z'), label: 'Push' },
      { at: new Date('2026-10-30T00:00:00Z'), label: 'Far' },
    ]);
    expect(out[0]).toMatchObject({ gapHours: -16.2, window: 24 });
    expect(out[1]).toMatchObject({ gapHours: 0.5, window: 1 });
    expect(out[2]?.window).toBeNull();
  });
});
