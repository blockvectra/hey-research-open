import { TOKEN_MARKET, type TokenMarketStatusValue } from './token-market';

/**
 * Market Integrity (2026-09-25).
 *
 * Builder activity says whether people are still building. Market Integrity
 * says what happened to the token. The conflicts below say when those two
 * stories stop matching. None of it feeds the other side: a dead market never
 * changes activity status, Build Momentum, the Discovery Gap or the Builder
 * Radar, and a busy repository never makes a market look alive.
 *
 * This is the one evaluator. Cards, the project page, the Terminal, the API,
 * the MCP server and the admin review all read what it returned, as stored in
 * `token_market_integrity`; nothing re-derives a piece of it.
 *
 * Every figure comes from HEY's own tables — the daily market index, the pools
 * the chain reports, the locker, the token's own distribution snapshot — and
 * every threshold below was chosen against Robinhood Chain's production data
 * on 2026-09-25 (README, "Market Integrity"). Unknown stays unknown: a day
 * with no reading is not a day of zero liquidity, and a figure the evidence
 * cannot support is left out rather than estimated.
 *
 * The words are observations. "Liquidity declined 98% from the level it held"
 * is a fact HEY measured; "rugged" is a verdict about intent that on-chain
 * evidence cannot establish, and HEY does not make it.
 */
/*
 * mi-v2 (2026-09-25, after the first production run): a fall that coincides
 * with a change of the index's winning source is two sources disagreeing, not
 * a collapse (eel-on-musk: DEX Screener's pool at $5.0K, then another
 * aggregator's pair at $10, while the chain's own pool reading held $5,011
 * throughout; piacentini: a launch curve's reserve, then a DEX pool); and
 * when the chain still reports half the level in the token's pools, the
 * liquidity is there — a conflict to review, not a migration or a collapse.
 */
export const MARKET_INTEGRITY_RULES_VERSION = 'mi-v2';

export const MARKET_INTEGRITY = {
  /** A market is established once liquidity held at least this much … */
  establishedMinUsd: TOKEN_MARKET.removedMinPeakUsd,
  /** … on at least this many days. One launch-day reading is not a market. */
  establishedMinDays: 3,
  /**
   * Collapse levels, as a share of the peak the market held. Production on
   * 2026-09-25: of 76 single-day closes at or below 5% of an established peak,
   * 25 were back above half the peak the next day — one bad reading, not a
   * drained pool. At 5–10% none recovered. So every level needs the last two
   * observed days at or below it, never one.
   */
  declineShare: 0.25,
  collapseShare: 0.1,
  severeShare: 0.05,
  confirmDays: 2,
  /** Where "deterioration began": the start of the run of days below half the peak. */
  deteriorationShare: 0.5,
  /** Two readings further apart than this are not "consecutive". */
  maxGapDays: 2,
  /** From half the peak to a collapse in this many days or fewer is a rapid collapse. */
  rapidDays: 3,
  /** A daily index whose newest day is older than this says nothing about now. */
  staleIndexDays: 3,
  /** Trading breadth: a market that averaged at least this many trades a day … */
  activityPeakMinTradesPerDay: 10,
  /** … and now averages this share of that or less has lost its trading. */
  activityCollapseShare: 0.1,
  /** Days of trade counts needed before an average means anything. */
  activityMinDays: 3,
  /** No trade for this many days after an established market: trading stopped. */
  inactiveTradeDays: 7,
  /** A new pool first seen this close to the fall can be where the liquidity went. */
  migrationWindowDays: 7,
  /** … and holds at least this share of the old peak (high) or this share (medium). */
  migrationStrongShare: 0.5,
  migrationWeakShare: 0.25,
  /** A launch-stage move this close to the fall explains it as a graduation. */
  graduationWindowDays: 3,
  /** Two current figures further apart than this factor are two different markets. */
  disagreementFactor: 5,
  /** A lock or a project-linked move this close to the collapse is shown beside it. */
  correlationWindowDays: 7,
} as const;

export type CollapseLevel = 'NONE' | 'DECLINE' | 'COLLAPSE' | 'SEVERE';
export type ExitPatternLevel = 'NONE' | 'EXIT_PATTERN' | 'EXIT_PATTERN_HIGH_CONFIDENCE';
export type LockState = 'NONE' | 'ACTIVE' | 'EXPIRED' | 'WITHDRAWN';
export type MigrationKind = 'POOL' | 'OTHER_POOLS' | 'GRADUATION';
export type IntegrityConfidence = 'high' | 'medium' | 'low';

export type BuilderMarketConflict =
  | 'BUILDER_ACTIVE_MARKET_GONE'
  | 'RECENT_SHIP_AFTER_LIQUIDITY_REMOVAL'
  | 'RECENT_RELEASE_AFTER_MARKET_ABANDONED'
  | 'BUILDING_WITH_LOW_LIQUIDITY'
  | 'BUILDER_DORMANT_MARKET_ACTIVE'
  | 'MARKET_ACTIVITY_WITHOUT_RECENT_BUILDING'
  | 'BUILDER_RESUMED_AFTER_MARKET_COLLAPSE';

export const BUILDER_MARKET_CONFLICTS: readonly BuilderMarketConflict[] = [
  'BUILDER_ACTIVE_MARKET_GONE',
  'RECENT_SHIP_AFTER_LIQUIDITY_REMOVAL',
  'RECENT_RELEASE_AFTER_MARKET_ABANDONED',
  'BUILDING_WITH_LOW_LIQUIDITY',
  'BUILDER_DORMANT_MARKET_ACTIVE',
  'MARKET_ACTIVITY_WITHOUT_RECENT_BUILDING',
  'BUILDER_RESUMED_AFTER_MARKET_COLLAPSE',
];

export type IntegrityEventKind =
  | 'LIQUIDITY_COLLAPSE'
  | 'MARKET_ACTIVITY_COLLAPSE'
  | 'TRADING_STOPPED'
  | 'MIGRATION_DETECTED'
  | 'LOCK_EXPIRED'
  | 'LOCK_WITHDRAWN'
  | 'MARKET_DATA_CONFLICT'
  | 'EXIT_PATTERN'
  | 'EXIT_PATTERN_HIGH_CONFIDENCE'
  | BuilderMarketConflict;

/** One UTC day of HEY's own market index (`token_market_days`), oldest first. */
export type IntegrityDay = {
  day: string;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  /** Decoded trades that day; null when the trade read did not answer. */
  trades: number | null;
  /** The source that won the day's liquidity figure, when known. */
  source?: string | null;
};

/** A pool the token has been read in (`market_snapshots.pair_address`). Same token, so same identity. */
export type IntegrityPool = {
  pairAddress: string;
  venue: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  maxLiquidityUsd: number | null;
  lastLiquidityUsd: number | null;
};

export type IntegrityLock = {
  assetKind: 'TOKEN' | 'LP';
  lockId: number;
  unlockAt: Date;
  withdrawn: boolean;
  /** When HEY last read the lock. A withdrawal happened no later than this. */
  observedAt: Date;
};

/** A move by an address tied to this project by evidence (CLAUDE.md rule 1, 2026-09-25 amendment). */
export type IntegrityLinkedMove = {
  day: string;
  kind: 'PROJECT_LINKED_SELL' | 'PROJECT_LINKED_BUY' | 'PROJECT_LINKED_LIQUIDITY_REMOVAL' | 'PROJECT_LINKED_LIQUIDITY_ADD' | 'PROJECT_LINKED_BALANCE_REDUCTION';
  relationship: string;
  supplySharePct: number | null;
};

export type IntegrityShip = { at: Date; release: boolean };

export type MarketIntegrityInput = {
  now: Date;
  /** The canonical token market status (`tokens.market_status`) — echoed, never recomputed here. */
  marketStatus: TokenMarketStatusValue;
  marketStatusReason: string | null;
  /** The card's current liquidity reading and when it was observed. */
  currentLiquidityUsd: number | null;
  currentLiquidityAt: Date | null;
  launchStage: 'CURVE' | 'GRADUATED' | 'DEX' | null;
  launchStageAt: Date | null;
  days: readonly IntegrityDay[];
  pools: readonly IntegrityPool[];
  /** The chain's own total across the token's pools, newest day. */
  chainPools: { day: string; pools: number | null; liquidityUsd: number | null } | null;
  locks: readonly IntegrityLock[];
  linkedMoves: readonly IntegrityLinkedMove[];
  builder: {
    activityStatus: string | null;
    /** Meaningful ships (the scoring's own definition), newest last. */
    ships: readonly IntegrityShip[];
  };
};

export type IntegrityEventDraft = {
  kind: IntegrityEventKind;
  /** Stable within a token: same event, same key, so a re-evaluation writes nothing new. */
  key: string;
  eventAt: Date;
  precision: 'exact' | 'day' | 'window';
  eventUntil?: Date;
  confidence: IntegrityConfidence;
  evidence: Record<string, unknown>;
};

export type MarketIntegrity = {
  rulesVersion: string;
  marketStatus: TokenMarketStatusValue;
  established: boolean;
  history: {
    firstMarketDay: string | null;
    peakLiquidityUsd: number | null;
    peakDay: string | null;
    currentLiquidityUsd: number | null;
    currentDay: string | null;
    liquidityChangePct: number | null;
    deteriorationStartDay: string | null;
    collapseDay: string | null;
    lastTradeDay: string | null;
    lastLiquidityDay: string | null;
    indexStale: boolean;
  };
  collapse: CollapseLevel;
  rapidCollapse: boolean;
  activity: { peakTradesPerDay: number; recentTradesPerDay: number; changePct: number } | null;
  tradingStopped: boolean;
  migration: {
    kind: MigrationKind;
    confidence: IntegrityConfidence;
    fromPool: string | null;
    toPool: string | null;
    fromLiquidityUsd: number | null;
    toLiquidityUsd: number | null;
    windowStart: string;
    windowEnd: string;
  } | null;
  lock: { state: LockState; locks: number; nextUnlockAt: Date | null; precededCollapse: boolean };
  linked: { moves: number; nearCollapse: readonly IntegrityLinkedMove[] };
  dataConflict: { kind: 'STATUS_REMOVED_INDEX_LIVE' | 'READINGS_DISAGREE' | 'SOURCE_CHANGED_AT_FALL' | 'CHAIN_STILL_HOLDS'; detail: string } | null;
  exitPattern: { level: ExitPatternLevel; reasons: readonly string[]; supporting: readonly string[] };
  conflicts: readonly BuilderMarketConflict[];
  events: readonly IntegrityEventDraft[];
  reviewReasons: readonly string[];
};

const DAY_MS = 86_400_000;
const dayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const dayEnd = (day: string): Date => new Date(dayStart(day).getTime() + DAY_MS);
const dayOf = (at: Date): string => at.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number => Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / DAY_MS);
const round = (value: number, places = 2): number => Math.round(value * 10 ** places) / 10 ** places;
const usd = (value: number): string =>
  value >= 1_000_000 ? `$${round(value / 1_000_000, 1)}M` : value >= 1_000 ? `$${round(value / 1_000, 1)}K` : `$${Math.round(value)}`;

const BUILDING = new Set(['SHIPPING', 'ACTIVE', 'RESUMED']);
const LIVE_REASONS = new Set(['liquidity_and_volume', 'trades_observed']);

/**
 * The level liquidity held for two consecutive observations, at its highest.
 * A single reading can be a provider glitch or a launch-hour spike; a level
 * held across two days is what the market actually carried.
 */
function sustainedPeak(days: readonly IntegrityDay[]): { usd: number; day: string } | null {
  let best: { usd: number; day: string } | null = null;
  for (let i = 1; i < days.length; i += 1) {
    const a = days[i - 1]!;
    const b = days[i]!;
    if (a.liquidityUsd === null || b.liquidityUsd === null) continue;
    if (daysBetween(a.day, b.day) > MARKET_INTEGRITY.maxGapDays) continue;
    const held = Math.min(a.liquidityUsd, b.liquidityUsd);
    if (!best || held > best.usd) best = { usd: held, day: a.liquidityUsd >= b.liquidityUsd ? a.day : b.day };
  }
  return best;
}

/** Average trades a day over the observed days in `[from, to]`; null with fewer than the minimum days observed. */
function tradesPerDay(days: readonly IntegrityDay[], from: string, to: string): number | null {
  const observed = days.filter((d) => d.day >= from && d.day <= to && d.trades !== null);
  if (observed.length < MARKET_INTEGRITY.activityMinDays) return null;
  return observed.reduce((sum, d) => sum + (d.trades ?? 0), 0) / observed.length;
}

const shiftDay = (day: string, by: number): string => dayOf(new Date(dayStart(day).getTime() + by * DAY_MS));

export function evaluateMarketIntegrity(input: MarketIntegrityInput): MarketIntegrity {
  const C = MARKET_INTEGRITY;
  const days = input.days.filter((d) => d.liquidityUsd !== null || d.trades !== null || d.volumeUsd !== null);
  const liquid = days.filter((d): d is IntegrityDay & { liquidityUsd: number } => d.liquidityUsd !== null);
  const today = dayOf(input.now);

  const peak = sustainedPeak(liquid);
  const liveDays = liquid.filter((d) => d.liquidityUsd >= C.establishedMinUsd).length;
  const established = peak !== null && peak.usd >= C.establishedMinUsd && liveDays >= C.establishedMinDays;
  const firstMarketDay = liquid.find((d) => d.liquidityUsd >= C.establishedMinUsd)?.day ?? null;
  const last = liquid.at(-1) ?? null;
  const prior = liquid.at(-2) ?? null;
  const indexStale = !last || daysBetween(last.day, today) > C.staleIndexDays;
  const lastLiquidityDay = [...liquid].reverse().find((d) => d.liquidityUsd > TOKEN_MARKET.dustLiquidityUsd)?.day ?? null;
  const lastTradeDay =
    [...days].reverse().find((d) => (d.trades !== null ? d.trades > 0 : d.volumeUsd !== null && d.volumeUsd > TOKEN_MARKET.inactiveVolumeUsd))?.day ?? null;

  // Collapse: the last two observations, consecutive, both at or below the level.
  let collapse: CollapseLevel = 'NONE';
  let collapseDay: string | null = null;
  let deteriorationStartDay: string | null = null;
  let rapidCollapse = false;
  let liquidityChangePct: number | null = null;
  if (established && peak && last) {
    liquidityChangePct = round(((last.liquidityUsd - peak.usd) / peak.usd) * 100);
    const confirmed = (share: number) =>
      !indexStale &&
      prior !== null &&
      daysBetween(prior.day, last.day) <= C.maxGapDays &&
      last.liquidityUsd <= peak.usd * share &&
      prior.liquidityUsd <= peak.usd * share &&
      last.day > peak.day;
    collapse = confirmed(C.severeShare) ? 'SEVERE' : confirmed(C.collapseShare) ? 'COLLAPSE' : confirmed(C.declineShare) ? 'DECLINE' : 'NONE';
    const runStart = (share: number): string | null => {
      let start: string | null = null;
      for (let i = liquid.length - 1; i >= 0; i -= 1) {
        const d = liquid[i]!;
        if (d.day <= peak.day || d.liquidityUsd > peak.usd * share) break;
        start = d.day;
      }
      return start;
    };
    if (collapse !== 'NONE') deteriorationStartDay = runStart(C.deteriorationShare);
    if (collapse === 'COLLAPSE' || collapse === 'SEVERE') {
      collapseDay = runStart(C.collapseShare);
      rapidCollapse = deteriorationStartDay !== null && collapseDay !== null && daysBetween(deteriorationStartDay, collapseDay) <= C.rapidDays;
    }
  }
  /*
   * Like with like (mi-v2): the level the market held and the level it fell to
   * must come from the same source. A fall that starts on the day the winning
   * source changed is two sources disagreeing.
   */
  let sourceChange: { from: string; to: string; day: string } | null = null;
  if (collapse !== 'NONE' && peak && deteriorationStartDay) {
    const sourceOn = (day: string) => liquid.find((d) => d.day === day)?.source ?? null;
    const from = sourceOn(peak.day);
    const firstLow = liquid.find((d) => d.day === deteriorationStartDay);
    const to = firstLow?.source ?? null;
    if (from && to && from !== to) sourceChange = { from, to, day: deteriorationStartDay };
  }
  const chainHolds =
    peak !== null &&
    input.chainPools !== null &&
    input.chainPools.liquidityUsd !== null &&
    daysBetween(input.chainPools.day, today) <= C.staleIndexDays &&
    input.chainPools.liquidityUsd >= peak.usd * C.migrationStrongShare;
  const chainSinglePoolHolds = chainHolds && (input.chainPools?.pools ?? 0) <= 1;
  const measuredCollapse = collapse;
  const measuredFrom = deteriorationStartDay;
  // A fall HEY cannot compare like with like is no collapse: the level, its day and its speed are all withdrawn.
  if (sourceChange || (collapse !== 'NONE' && chainSinglePoolHolds)) {
    collapse = 'NONE';
    collapseDay = null;
    deteriorationStartDay = null;
    rapidCollapse = false;
  }
  const collapsed = collapse === 'COLLAPSE' || collapse === 'SEVERE';

  // Trading breadth: the busiest seven days against the last seven.
  let activity: MarketIntegrity['activity'] = null;
  const traded = days.filter((d) => d.trades !== null);
  if (traded.length >= C.activityMinDays) {
    let peakRate = 0;
    for (const d of traded) {
      const rate = tradesPerDay(days, shiftDay(d.day, -6), d.day);
      if (rate !== null && rate > peakRate) peakRate = rate;
    }
    const recent = tradesPerDay(days, shiftDay(today, -6), today);
    if (recent !== null && peakRate > 0) activity = { peakTradesPerDay: round(peakRate, 1), recentTradesPerDay: round(recent, 1), changePct: round(((recent - peakRate) / peakRate) * 100) };
  }
  const activityCollapsed = activity !== null && activity.peakTradesPerDay >= C.activityPeakMinTradesPerDay && activity.recentTradesPerDay <= activity.peakTradesPerDay * C.activityCollapseShare;
  const tradingStopped = established && lastTradeDay !== null && daysBetween(lastTradeDay, today) >= C.inactiveTradeDays;

  // Migration: did the liquidity go somewhere HEY can see, for the same token?
  let migration: MarketIntegrity['migration'] = null;
  if (established && peak && (collapse !== 'NONE' || input.marketStatus === 'LIQUIDITY_REMOVED')) {
    const anchor = deteriorationStartDay ?? collapseDay ?? last?.day ?? today;
    const windowStart = shiftDay(anchor, -C.migrationWindowDays);
    const windowEnd = shiftDay(collapseDay ?? anchor, C.migrationWindowDays);
    // The pool the market lived in: the deepest one HEY had already seen before the fall began.
    const old = input.pools.filter((p) => dayOf(p.firstSeenAt) < windowStart).sort((a, b) => (b.maxLiquidityUsd ?? 0) - (a.maxLiquidityUsd ?? 0))[0] ?? null;
    const fresh = input.pools
      .filter((p) => p !== old && dayOf(p.firstSeenAt) >= windowStart && dayOf(p.firstSeenAt) <= windowEnd && (p.lastLiquidityUsd ?? 0) >= peak.usd * C.migrationWeakShare)
      .sort((a, b) => (b.lastLiquidityUsd ?? 0) - (a.lastLiquidityUsd ?? 0))[0];
    if (fresh) {
      migration = {
        kind: 'POOL',
        confidence: (fresh.lastLiquidityUsd ?? 0) >= peak.usd * C.migrationStrongShare ? 'high' : 'medium',
        fromPool: old?.pairAddress ?? null,
        toPool: fresh.pairAddress,
        fromLiquidityUsd: old?.maxLiquidityUsd ?? null,
        toLiquidityUsd: fresh.lastLiquidityUsd,
        windowStart,
        windowEnd,
      };
    } else if (
      input.chainPools &&
      input.chainPools.liquidityUsd !== null &&
      daysBetween(input.chainPools.day, today) <= C.staleIndexDays &&
      input.chainPools.liquidityUsd >= peak.usd * C.migrationStrongShare &&
      (input.chainPools.pools ?? 0) > 1
    ) {
      // The pool HEY priced is drained, but the chain still reports the token's liquidity across its other pools.
      migration = {
        kind: 'OTHER_POOLS',
        confidence: 'medium',
        fromPool: old?.pairAddress ?? null,
        toPool: null,
        fromLiquidityUsd: old?.maxLiquidityUsd ?? null,
        toLiquidityUsd: input.chainPools.liquidityUsd,
        windowStart,
        windowEnd,
      };
    } else if (
      input.launchStageAt &&
      (input.launchStage === 'GRADUATED' || input.launchStage === 'DEX') &&
      Math.abs(daysBetween(dayOf(input.launchStageAt), anchor)) <= C.graduationWindowDays
    ) {
      migration = { kind: 'GRADUATION', confidence: 'medium', fromPool: old?.pairAddress ?? null, toPool: null, fromLiquidityUsd: old?.maxLiquidityUsd ?? null, toLiquidityUsd: null, windowStart, windowEnd };
    }
  }
  const migrated = migration !== null && migration.confidence !== 'low';

  // Two current figures that describe different markets.
  let dataConflict: MarketIntegrity['dataConflict'] = null;
  if (sourceChange) {
    dataConflict = { kind: 'SOURCE_CHANGED_AT_FALL', detail: `the fall starts ${sourceChange.day}, the day the winning source changed from ${sourceChange.from} to ${sourceChange.to}` };
  } else if (measuredCollapse !== 'NONE' && chainSinglePoolHolds && input.chainPools && input.chainPools.liquidityUsd !== null) {
    dataConflict = { kind: 'CHAIN_STILL_HOLDS', detail: `the index shows a fall from ${measuredFrom ?? 'recently'}, but the chain's own reading on ${input.chainPools.day} is ${usd(input.chainPools.liquidityUsd)} in the token's pool` };
  }
  if (!dataConflict && last && !indexStale && peak) {
    const statusGone = input.marketStatus === 'LIQUIDITY_REMOVED' || input.marketStatus === 'NO_LIQUIDITY';
    if (statusGone && last.liquidityUsd >= Math.max(C.establishedMinUsd, peak.usd * C.deteriorationShare)) {
      dataConflict = { kind: 'STATUS_REMOVED_INDEX_LIVE', detail: `status ${input.marketStatus} while the daily index closed ${last.day} at ${usd(last.liquidityUsd)}` };
    }
  }
  if (!dataConflict && last && !indexStale && input.currentLiquidityUsd !== null && input.currentLiquidityAt) {
    const hi = Math.max(input.currentLiquidityUsd, last.liquidityUsd);
    const lo = Math.min(input.currentLiquidityUsd, last.liquidityUsd);
    const close = Math.abs(daysBetween(dayOf(input.currentLiquidityAt), last.day)) <= 1;
    if (close && hi >= C.establishedMinUsd && hi > Math.max(lo, 1) * C.disagreementFactor) {
      dataConflict = { kind: 'READINGS_DISAGREE', detail: `current reading ${usd(input.currentLiquidityUsd)} against the daily index ${usd(last.liquidityUsd)} on ${last.day}` };
    }
  }

  // Locks: the locker's own record. Correlation, never cause.
  const anchorDay = collapseDay ?? deteriorationStartDay;
  const lockEvents: IntegrityEventDraft[] = [];
  let precededCollapse = false;
  for (const lock of input.locks) {
    if (lock.withdrawn) {
      lockEvents.push({
        kind: 'LOCK_WITHDRAWN',
        key: `lock:${lock.lockId}:withdrawn`,
        eventAt: lock.unlockAt,
        precision: 'window',
        eventUntil: lock.observedAt,
        confidence: 'high',
        evidence: { lockId: lock.lockId, assetKind: lock.assetKind, unlockAt: lock.unlockAt.toISOString(), observedAt: lock.observedAt.toISOString() },
      });
    } else if (lock.unlockAt.getTime() <= input.now.getTime()) {
      lockEvents.push({
        kind: 'LOCK_EXPIRED',
        key: `lock:${lock.lockId}:expired`,
        eventAt: lock.unlockAt,
        precision: 'exact',
        confidence: 'high',
        evidence: { lockId: lock.lockId, assetKind: lock.assetKind, unlockAt: lock.unlockAt.toISOString() },
      });
    }
    if (anchorDay && lock.unlockAt.getTime() <= dayEnd(anchorDay).getTime() && lock.unlockAt.getTime() >= dayStart(shiftDay(anchorDay, -C.correlationWindowDays)).getTime()) {
      precededCollapse = true;
    }
  }
  const lockState: LockState = input.locks.some((l) => l.withdrawn)
    ? 'WITHDRAWN'
    : input.locks.some((l) => l.unlockAt.getTime() <= input.now.getTime())
      ? 'EXPIRED'
      : input.locks.length > 0
        ? 'ACTIVE'
        : 'NONE';
  const upcoming = input.locks.filter((l) => !l.withdrawn && l.unlockAt.getTime() > input.now.getTime()).map((l) => l.unlockAt.getTime());
  const nextUnlockAt = upcoming.length > 0 ? new Date(Math.min(...upcoming)) : null;

  const outgoing = new Set(['PROJECT_LINKED_SELL', 'PROJECT_LINKED_LIQUIDITY_REMOVAL', 'PROJECT_LINKED_BALANCE_REDUCTION']);
  const nearCollapse = anchorDay
    ? input.linkedMoves.filter((m) => outgoing.has(m.kind) && Math.abs(daysBetween(m.day, anchorDay)) <= C.correlationWindowDays)
    : [];

  // Exit pattern: several independent pieces of evidence, never one.
  const supporting: string[] = [];
  const reasons: string[] = [];
  let exitLevel: ExitPatternLevel = 'NONE';
  if (established && collapsed && peak && last && !migrated && !dataConflict) {
    reasons.push(`Liquidity declined ${Math.abs(liquidityChangePct ?? 0)}% from the ${usd(peak.usd)} it held (${peak.day}) to ${usd(last.liquidityUsd)} (${last.day}).`);
    if (activityCollapsed && activity) {
      supporting.push('trading');
      reasons.push(`Trading fell from ${activity.peakTradesPerDay} to ${activity.recentTradesPerDay} trades a day.`);
    } else if (tradingStopped && lastTradeDay) {
      supporting.push('trading');
      reasons.push(`No trade recorded since ${lastTradeDay}.`);
    }
    if (rapidCollapse && deteriorationStartDay && collapseDay) {
      supporting.push('rapid');
      const took = daysBetween(deteriorationStartDay, collapseDay);
      reasons.push(took === 0 ? 'Liquidity went from over half the level to under a tenth between two daily readings.' : `The fall from half the level to under a tenth took ${took} day${took === 1 ? '' : 's'}.`);
    }
    if (precededCollapse) {
      supporting.push('lock');
      reasons.push('A lock on this token expired or was withdrawn in the week before the fall.');
    }
    if (nearCollapse.length > 0) {
      supporting.push('linked');
      reasons.push(`An address tied to the project by evidence reduced its balance within a week of the fall (${nearCollapse.length} day(s)).`);
    }
    reasons.push('No replacement pool for the same token was found.');
    if (supporting.length >= 1) exitLevel = 'EXIT_PATTERN';
    if (collapse === 'SEVERE' && supporting.length >= 2 && (supporting.includes('lock') || supporting.includes('linked'))) exitLevel = 'EXIT_PATTERN_HIGH_CONFIDENCE';
  }

  // Builder × market: when the two stories stop matching.
  const activityStatus = input.builder.activityStatus;
  const building = activityStatus !== null && BUILDING.has(activityStatus);
  /*
   * "Gone" only when nothing HEY holds says otherwise (mi-v2): a status of
   * removed beside an index that is live, a chain reading that still holds the
   * level, or liquidity that moved to another pool of the same token is a
   * disagreement to review — not a market that is gone.
   */
  const marketGone =
    !migrated &&
    !dataConflict &&
    (input.marketStatus === 'LIQUIDITY_REMOVED' || input.marketStatus === 'MARKET_ABANDONED' || (established && collapsed));
  const liveMarket = input.marketStatus === 'ACTIVE_MARKET' && LIVE_REASONS.has(input.marketStatusReason ?? '');
  const conflicts: BuilderMarketConflict[] = [];
  const shipsAfter = (day: string | null, releaseOnly = false) =>
    day === null ? [] : input.builder.ships.filter((s) => s.at.getTime() >= dayEnd(day).getTime() && (!releaseOnly || s.release));
  const afterCollapse = shipsAfter(collapseDay ?? (input.marketStatus === 'LIQUIDITY_REMOVED' ? lastLiquidityDay : null));
  if (building && marketGone) conflicts.push('BUILDER_ACTIVE_MARKET_GONE');
  if (marketGone && afterCollapse.length > 0) conflicts.push('RECENT_SHIP_AFTER_LIQUIDITY_REMOVAL');
  if (input.marketStatus === 'MARKET_ABANDONED' && shipsAfter(lastLiquidityDay, true).length > 0) conflicts.push('RECENT_RELEASE_AFTER_MARKET_ABANDONED');
  if (building && input.marketStatus === 'LOW_LIQUIDITY') conflicts.push('BUILDING_WITH_LOW_LIQUIDITY');
  if (activityStatus === 'DORMANT' && liveMarket) conflicts.push('BUILDER_DORMANT_MARKET_ACTIVE');
  if (activityStatus === 'QUIET' && liveMarket) conflicts.push('MARKET_ACTIVITY_WITHOUT_RECENT_BUILDING');
  if (activityStatus === 'RESUMED' && collapseDay && afterCollapse.length > 0) conflicts.push('BUILDER_RESUMED_AFTER_MARKET_COLLAPSE');

  // Events, each with its own time and how precise that time is.
  const events: IntegrityEventDraft[] = [...lockEvents];
  if (collapsed && collapseDay && peak && last) {
    events.push({
      kind: 'LIQUIDITY_COLLAPSE',
      key: `collapse:${collapseDay}`,
      eventAt: dayStart(collapseDay),
      precision: 'day',
      confidence: collapse === 'SEVERE' ? 'high' : 'medium',
      evidence: { peakUsd: peak.usd, peakDay: peak.day, currentUsd: last.liquidityUsd, currentDay: last.day, changePct: liquidityChangePct, level: collapse, deteriorationStartDay, rapid: rapidCollapse },
    });
  }
  if (activityCollapsed && activity) {
    events.push({
      kind: 'MARKET_ACTIVITY_COLLAPSE',
      key: `activity:${today}`.slice(0, 'activity:'.length + 7), // one per month at most
      eventAt: dayStart(today),
      precision: 'day',
      confidence: 'medium',
      evidence: activity,
    });
  }
  if (tradingStopped && lastTradeDay) {
    events.push({ kind: 'TRADING_STOPPED', key: `stopped:${lastTradeDay}`, eventAt: dayStart(lastTradeDay), precision: 'day', confidence: 'medium', evidence: { lastTradeDay } });
  }
  if (migration) {
    events.push({
      kind: 'MIGRATION_DETECTED',
      key: `migration:${migration.kind}:${migration.toPool ?? migration.windowStart}`,
      eventAt: dayStart(migration.windowStart),
      precision: 'window',
      eventUntil: dayEnd(migration.windowEnd),
      confidence: migration.confidence,
      evidence: { ...migration },
    });
  }
  if (dataConflict) {
    events.push({ kind: 'MARKET_DATA_CONFLICT', key: `conflict:${dataConflict.kind}:${last?.day ?? today}`, eventAt: dayStart(last?.day ?? today), precision: 'day', confidence: 'high', evidence: dataConflict });
  }
  if (exitLevel !== 'NONE' && collapseDay) {
    events.push({
      kind: exitLevel,
      key: `${exitLevel.toLowerCase()}:${collapseDay}`,
      eventAt: dayStart(collapseDay),
      precision: 'day',
      confidence: exitLevel === 'EXIT_PATTERN_HIGH_CONFIDENCE' ? 'high' : 'medium',
      evidence: { reasons, supporting },
    });
  }
  for (const conflict of conflicts) {
    const at = afterCollapse.at(-1)?.at ?? input.now;
    events.push({ kind: conflict, key: `${conflict.toLowerCase()}:${dayOf(at).slice(0, 7)}`, eventAt: dayStart(dayOf(at)), precision: 'day', confidence: 'medium', evidence: { activityStatus, marketStatus: input.marketStatus, shipsAfterCollapse: afterCollapse.length } });
  }

  const reviewReasons: string[] = [];
  if (dataConflict) reviewReasons.push('data_conflict');
  if (migration) reviewReasons.push('migration_candidate');
  if (exitLevel !== 'NONE') reviewReasons.push('exit_pattern');
  if (conflicts.includes('BUILDER_ACTIVE_MARKET_GONE')) reviewReasons.push('builder_active_market_gone');

  return {
    rulesVersion: MARKET_INTEGRITY_RULES_VERSION,
    marketStatus: input.marketStatus,
    established,
    history: {
      firstMarketDay,
      peakLiquidityUsd: peak ? peak.usd : null,
      peakDay: peak ? peak.day : null,
      currentLiquidityUsd: last ? last.liquidityUsd : null,
      currentDay: last ? last.day : null,
      liquidityChangePct,
      deteriorationStartDay,
      collapseDay,
      lastTradeDay,
      lastLiquidityDay,
      indexStale,
    },
    collapse,
    rapidCollapse,
    activity,
    tradingStopped,
    migration,
    lock: { state: lockState, locks: input.locks.length, nextUnlockAt, precededCollapse },
    linked: { moves: input.linkedMoves.length, nearCollapse },
    dataConflict,
    exitPattern: { level: exitLevel, reasons: exitLevel === 'NONE' ? [] : reasons, supporting },
    conflicts,
    events,
    reviewReasons,
  };
}

/**
 * Where other events sit relative to one anchor (Phase 10, 2026-09-25): the
 * signed gap and the narrowest window of ±1 h, ±6 h, ±24 h, ±72 h, 7 d or 30 d
 * it falls in. A fact about timing; what caused what is not HEY's to say.
 */
export const CORRELATION_WINDOWS_HOURS = [1, 6, 24, 72, 168, 720] as const;

export type Correlated<T> = T & { gapHours: number; window: number | null };

export function correlate<T extends { at: Date }>(anchor: Date, items: readonly T[]): Correlated<T>[] {
  return items.map((item) => {
    const gapHours = round((item.at.getTime() - anchor.getTime()) / 3_600_000, 1);
    const window = CORRELATION_WINDOWS_HOURS.find((w) => Math.abs(gapHours) <= w) ?? null;
    return { ...item, gapHours, window };
  });
}

/** Plain words for each conflict, for every surface to share. */
export const CONFLICT_COPY: Record<BuilderMarketConflict, string> = {
  BUILDER_ACTIVE_MARKET_GONE: 'HEY observed recent builder activity while the tracked token market had already lost most of its liquidity.',
  RECENT_SHIP_AFTER_LIQUIDITY_REMOVAL: 'The project shipped after the tracked token lost its liquidity.',
  RECENT_RELEASE_AFTER_MARKET_ABANDONED: 'The project published a release after HEY last saw a market for its token.',
  BUILDING_WITH_LOW_LIQUIDITY: 'The project is building while its token trades with little liquidity.',
  BUILDER_DORMANT_MARKET_ACTIVE: 'The token keeps trading while HEY has seen no meaningful building for a long time.',
  MARKET_ACTIVITY_WITHOUT_RECENT_BUILDING: 'The token keeps trading while recent building has gone quiet.',
  BUILDER_RESUMED_AFTER_MARKET_COLLAPSE: 'Building resumed after the tracked token market collapsed.',
};

/** Plain words for each market-integrity event kind. */
export const INTEGRITY_EVENT_COPY: Record<IntegrityEventKind, string> = {
  LIQUIDITY_COLLAPSE: 'Liquidity fell far below the level it held',
  MARKET_ACTIVITY_COLLAPSE: 'Trading fell far below its busiest week',
  TRADING_STOPPED: 'No trades recorded for a week or more',
  MIGRATION_DETECTED: 'Liquidity appears to have moved',
  LOCK_EXPIRED: 'A lock on this token expired',
  LOCK_WITHDRAWN: 'A locked deposit was withdrawn',
  MARKET_DATA_CONFLICT: 'Market sources disagree',
  EXIT_PATTERN: 'Potential exit pattern detected',
  EXIT_PATTERN_HIGH_CONFIDENCE: 'Potential exit pattern detected (several independent signals)',
  ...CONFLICT_COPY,
};
