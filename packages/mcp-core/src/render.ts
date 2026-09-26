import type {
  HeyAccelerating,
  HeyAskAnswer,
  HeyBuildersPage,
  HeyChain,
  HeyChangesPage,
  HeyCompare,
  HeyMarketIntegrity,
  HeyMarketMoves,
  HeyPage,
  HeyProject,
  HeySilentBuilders,
  HeyThisWeek,
  HeyThisWeekProject,
  HeyTimeline,
  HeyTokenLookup,
  HeyTokenMarket,
  HeyUnlocks,
  HeyWeeklyReport,
} from '@hey-research/sdk';

/**
 * HEY's answers, as text a model reads (2026-09-05; reworked 2026-09-26).
 *
 * An agent will quote whatever comes back, so the rendering carries the same
 * discipline the pages do. Four rules decide everything here:
 *
 *  1. **Say what the claim is.** "Still Building" is a specific, narrow claim —
 *     verified activity through a market drawdown HEY tracked — and an agent
 *     that reads it as "this will go up" has been misled by the rendering, not
 *     by the reader. So the phrase never appears without its meaning.
 *  2. **Never invent a figure.** A project with no market reading gets no
 *     market line at all; a project HEY has not researched says so. Nothing is
 *     rendered as zero, "n/a" or "—" that an agent might average or compare.
 *  3. **Carry the source and the kind of statement.** Every figure shows how it
 *     is backed; lines are tagged FACT (a value HEY recorded, with its source),
 *     DERIVED (a rule HEY applied) or UNKNOWN (HEY does not hold it) — and never
 *     a stronger tag than the API's own explain engine gives the same fact
 *     (activity status and Build Momentum are DERIVED, never FACT).
 *  4. **Say what was shown of the whole.** Every listing prints "Showing n of
 *     N" and the exact parameter that reads on.
 *
 * Pure functions over the API's own shapes: unit-tested without a network.
 */
export const STILL_BUILDING_MEANING =
  'Still Building = verified activity continuing through a market drawdown HEY tracked. It is a record of what happened, not a prediction and not a buy signal.';

/** Printed once per answer that carries tags, so a model reads them the way HEY means them. */
export const TAG_LEGEND =
  'Tags: FACT = a value HEY recorded, with its source; DERIVED = a rule HEY applied to recorded values; UNKNOWN = HEY does not hold it (never a zero).';

export const money = (usd: number): string => {
  // Thresholds sit where two-decimal rounding would print 1000.00 (2026-09-17).
  if (usd >= 999_995_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 999_995) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  // Anything under a dollar rounded to `$0`, which reads as nothing at all.
  if (usd > 0 && usd < 1) return '<$1';
  return `$${usd.toFixed(0)}`;
};

/**
 * A valuation's name by the kind the API sent (2026-09-26, M2 G9). An
 * unknown kind is a "valuation", never a "market cap": calling an FDV a
 * market cap overstates what circulates.
 */
export function valuationWord(kind: 'marketCap' | 'fdv' | undefined): string {
  return kind === 'fdv' ? 'FDV' : kind === 'marketCap' ? 'market cap' : 'valuation';
}

/** Activity status is a rule applied to recorded ships (the explain engine says DERIVED); UNKNOWN is its own tag. */
export const activityTag = (status: string | null | undefined): 'DERIVED' | 'UNKNOWN' => (!status || status === 'UNKNOWN' ? 'UNKNOWN' : 'DERIVED');

/** The state keys whose transitions are a rule HEY applied: activity status, market status and research level are DERIVED in the explain engine. */
const DERIVED_STATE_KEYS: ReadonlySet<string> = new Set(['activity_status', 'market_status', 'catalog_status']);

/**
 * The tag one HEY record carries, read from its typed id (2026-09-26, audit
 * §45 #8). One rule for receipts, change events and timeline entries.
 *
 * A state transition HEY computed (activity status, market status, research
 * level), a signal over a window HEY measured (`signal:`, and the timeline's
 * `resumed:`) and a market-integrity reading are rules HEY applied: DERIVED,
 * as the explain engine and the snapshot tag the same facts. A ship, a
 * release, a lock, a contract change, a verified claim, token verification
 * and launch stage are records with a source: FACT.
 */
export function recordTag(id: string): 'FACT' | 'DERIVED' {
  const [family, , key] = id.split(':');
  if (family === 'signal' || family === 'resumed' || family === 'integrity') return 'DERIVED';
  if (family === 'state') return DERIVED_STATE_KEYS.has(key ?? '') ? 'DERIVED' : 'FACT';
  return 'FACT';
}

/** "in 2 days" for an instant ahead; "expired" once it has passed. */
export function until(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const ms = then.getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'in under an hour';
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** "3 days ago" against a stated now, so an agent is not left doing date arithmetic. */
export function ago(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  // A future instant is a deadline, not "today" (2026-09-17).
  if (then.getTime() > now.getTime()) return until(iso, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

/**
 * A time at the precision HEY knows it (2026-09-26): "week of 2026-09-14"
 * for a week of code activity, a date for a date, and "HEY saw it on …" when
 * only HEY's own observation dates it. Never a precision the record lacks.
 */
export function atPrecision(iso: string | null | undefined, precision: string, observed?: string): string {
  if (!iso) return observed ? `no source time; HEY saw it ${observed.slice(0, 10)}` : 'no source time';
  const date = iso.slice(0, 10);
  switch (precision) {
    case 'EXACT':
      return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
    case 'WEEK':
      return `week of ${date}`;
    case 'WINDOW':
      return `window ending ${date}`;
    case 'SCHEDULED':
      return `scheduled ${iso.slice(0, 16).replace('T', ' ')} UTC`;
    case 'OBSERVED':
      return `HEY saw it ${date}`;
    default:
      return date;
  }
}

const STAGE_WORDS: Record<'CURVE' | 'GRADUATED' | 'DEX', string> = {
  CURVE: 'on its launch curve',
  GRADUATED: 'graduated from its curve',
  DEX: 'trading in a DEX pool',
};

/**
 * The evidence behind Still Building, as a clause (round-7 audit 2026-09-18):
 * "down 62% from the HEY-tracked high, 5 verified ships since". Two facts and
 * no verdict, so the claim never travels as a bare badge.
 */
export function stillBuildingEvidence(project: Pick<HeyProject, 'stillBuildingEvidence'>): string | undefined {
  const evidence = project.stillBuildingEvidence;
  if (!evidence) return undefined;
  const drawdown = `down ${Math.round(Math.abs(evidence.drawdownPercent))}% from the HEY-tracked high`;
  if (evidence.shipsSinceDecline === undefined) return drawdown;
  return `${drawdown}, ${evidence.shipsSinceDecline} verified ship${evidence.shipsSinceDecline === 1 ? '' : 's'} since`;
}

/**
 * The site's words for a token's market state, lower-cased for a line
 * (2026-09-25). A copy of `tokenMarketLabel` in `@hey/ui`, which this
 * package cannot import: it is published on its own and depends on the SDK
 * alone. `LIQUIDITY_REMOVED` is "liquidity no longer detected" on the site —
 * an observation, not a verdict on why — and so it is here.
 */
const TOKEN_MARKET_WORDS: Record<string, string> = {
  ACTIVE_MARKET: 'active market',
  LOW_LIQUIDITY: 'low liquidity',
  NO_LIQUIDITY: 'no liquidity',
  TRADING_INACTIVE: 'trading inactive',
  LIQUIDITY_REMOVED: 'liquidity no longer detected',
  MARKET_ABANDONED: 'market not detected',
  INSUFFICIENT_DATA: 'market data insufficient',
  TOKEN_NOT_LAUNCHED: 'no token',
};

export function tokenMarketWords(status: string): string {
  return TOKEN_MARKET_WORDS[status] ?? status.toLowerCase().replace(/_/g, ' ');
}

/**
 * A liquidity figure in words, by its kind (2026-09-25). A launch pool's own
 * supply is not depth, and the project page says so; so does this. A figure
 * with no provider is the token's last recorded depth, dated rather than
 * attributed to a source that did not report it.
 */
export function liquidityWords(liquidity: NonNullable<HeyProject['liquidity']>, now?: Date): string {
  const provenance = liquidity.source ? liquidity.source : liquidity.observedAt ? `last recorded ${ago(liquidity.observedAt, now)}` : 'last recorded';
  return liquidity.kind === 'launch_inventory'
    ? `${money(liquidity.usd)} of its own supply in the launch pool — not a market reading (${provenance})`
    : `${money(liquidity.usd)} liquidity (${provenance})`;
}

/** One project on one line: identity, what HEY claims, and the context behind it. */
export function projectLine(project: HeyProject, now?: Date): string {
  const parts = [project.symbol ? `${project.name} ($${project.symbol})` : project.name];

  // What HEY is actually claiming about activity comes before anything else.
  parts.push(
    // Not beside a last ship (2026-09-25): a project with a recorded ship has had a builder signal.
    project.activityStatus === 'UNKNOWN' && project.hasBuilderSource === false && !project.lastShippedAt
      ? 'UNKNOWN activity: no builder signal yet (no repository, changelog or feed to read; trading is not building)'
      : project.researchLevel === 'INDEXED'
        ? 'UNKNOWN activity: not researched yet'
        : project.activityStatus === 'UNKNOWN'
          ? 'UNKNOWN activity: too few public sources to say either way'
          : `DERIVED ${project.activityStatus.toLowerCase()}`,
  );
  if (project.stillBuilding) {
    const evidence = stillBuildingEvidence(project);
    parts.push(evidence ? `STILL BUILDING (${evidence})` : 'STILL BUILDING');
  }
  if (project.lastShippedAt) parts.push(`last shipped ${ago(project.lastShippedAt, now)}`);
  if (project.primaryNarrative) parts.push(project.primaryNarrative.name);
  if (project.launchedVia) parts.push(`via ${project.launchedVia.name}`);
  // The market's state before its figures: it is why a dead market prints no valuation (2026-09-25).
  if (project.tokenMarket) parts.push(`market: ${tokenMarketWords(project.tokenMarket.status)}`);
  // Context, and only ever with the provider that reported it; an unknown kind is a valuation, never a market cap.
  if (project.marketCap) parts.push(`${money(project.marketCap.usd)} ${valuationWord(project.marketCap.kind)} (${project.marketCap.source})`);
  if (project.liquidity) parts.push(liquidityWords(project.liquidity, now));
  if (project.volume24h) parts.push(`${money(project.volume24h.usd)} 24h volume${project.volume24h.source ? ` (${project.volume24h.source})` : ''}`);
  if (project.launchStage) parts.push(STAGE_WORDS[project.launchStage]);
  if (project.trades24h) parts.push(`${project.trades24h.buys} buys / ${project.trades24h.sells} sells in 24h${project.trades24h.source ? ` (${project.trades24h.source})` : ''}`);
  if (project.priceChange24hPct !== undefined) parts.push(`${project.priceChange24hPct >= 0 ? '+' : ''}${project.priceChange24hPct.toFixed(1)}% 24h`);
  if (project.venue) parts.push(`trades on ${project.venue}`);

  return `- ${parts.join(' · ')}\n  ${project.url}`;
}

/**
 * The query as HEY read it (2026-09-17). The listing routes drop an
 * unrecognised filter rather than refusing it, and echo what they understood;
 * printing the echo is how a model notices that a filter it invented did
 * nothing.
 */
export function queryEcho(query: Record<string, unknown> | undefined): string {
  if (!query) return 'A filter HEY does not recognise is ignored rather than refused.';
  return `Query as HEY read it: ${JSON.stringify(query)}. A filter HEY does not recognise is ignored rather than refused.`;
}

/**
 * "Showing n of N" and exactly how to read the rest (2026-09-26, M2 G3). A
 * listing that announced a total and then printed a page let a model answer
 * about the whole from a part without knowing it.
 */
export function shownOf(shown: number, total: number, more: string | undefined): string {
  if (total <= shown) return `Showing all ${total}.`;
  return `Showing ${shown} of ${total}.${more ? ` ${more}` : ''}`;
}

const offsetOf = (query: Record<string, unknown> | undefined): number => (typeof query?.offset === 'number' ? query.offset : Number(query?.offset ?? 0) || 0);

/** A page of projects, with the count, how it was filtered, and how to get more. */
export function renderProjects(page: HeyPage<HeyProject>, now?: Date): string {
  if (page.items.length === 0) {
    const offset = offsetOf(page.query);
    // Past the end is not "nothing matches" (2026-09-26, M2 G9).
    if (page.total > 0 && offset >= page.total) {
      return `This page is past the end: ${page.total} published projects match, and offset=${offset} starts after the last. Call find_projects again with offset=0.\n${queryEcho(page.query)}`;
    }
    return `No published project matches that. ${queryEcho(page.query)}`;
  }

  const lines = page.items.map((project) => projectLine(project, now));
  const more = page.nextOffset === undefined ? undefined : `For more, call find_projects again with the same arguments and offset=${page.nextOffset}.`;
  const shown = `${shownOf(page.items.length, page.total, more)} (published projects)`;
  const stillBuilding = page.items.some((project) => project.stillBuilding) ? `\n\n${STILL_BUILDING_MEANING}` : '';
  // A market order over rows that mostly lack the figure must say so (Market Lens, 2026-09-12).
  const coverage = page.catalogue?.marketCoverage;
  const sort = page.query.sort;
  const denominator = coverage
    ? sort === 'liquidity'
      ? `\n${coverage.liquidity} of ${coverage.base} matching projects have a liquidity reading; the rest follow in activity order, not by liquidity.`
      : sort === 'volume24h'
        ? `\n${coverage.volume24h} of ${coverage.base} matching projects have a 24h volume reading; the rest follow in activity order.`
        : sort === 'marketCap'
          ? `\n${coverage.marketCap} of ${coverage.base} matching projects have a valuation reading; the rest follow in activity order.`
          : `\nOf ${coverage.base} matching projects: ${coverage.activeMarket} traded in the last day, ${coverage.liveMarket} whose market is not gone, ${coverage.verifiedToken} with a verified token, ${coverage.marketCap} with a valuation reading.`
    : '';

  return `${shown}${denominator}\n${queryEcho(page.query)}\nActivity is DERIVED from recorded ships (UNKNOWN where HEY holds no builder source or has not researched the record); market figures are FACT readings with their provider, context only.\n\n${lines.join('\n')}${stillBuilding}\n\n${page.disclaimer}`;
}

/**
 * The stage's stamp is when HEY recorded the stage, not when the token reached
 * it (2026-09-26): a pool can exist for days before HEY reads it.
 */
function launchStageSeenWords(stage: string): string {
  if (stage === 'DEX') return 'HEY first saw it on DEX on';
  if (stage === 'GRADUATED') return 'HEY first saw it graduated on';
  if (stage === 'CURVE') return 'HEY saw it on the curve on';
  return 'HEY recorded this stage on';
}

const signed = (value: number | undefined) => (value === undefined ? undefined : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`);

/** How many day rows a series prints before it says it stopped. */
const DAY_ROWS = 14;

/** One day of trading, with no unknown count printed as zero (2026-09-26, M2 G9). */
function tradesWords(d: HeyTokenMarket['days'][number]): string | undefined {
  if (d.trades === undefined) return undefined;
  const split = d.buys !== undefined && d.sells !== undefined ? ` (${d.buys} buys / ${d.sells} sells)` : '';
  return `${d.trades} trades${split}`;
}

function tradedWords(d: HeyTokenMarket['days'][number]): string | undefined {
  if (d.buyVolumeUsd !== undefined && d.sellVolumeUsd !== undefined) return `traded ${money(d.buyVolumeUsd + d.sellVolumeUsd)}`;
  if (d.buyVolumeUsd !== undefined) return `bought ${money(d.buyVolumeUsd)} (sells not read)`;
  if (d.sellVolumeUsd !== undefined) return `sold ${money(d.sellVolumeUsd)} (buys not read)`;
  return d.volume24hUsd === undefined ? undefined : `24h volume ${money(d.volume24hUsd)}`;
}

/** One token's market in depth, as prose an agent can quote with its sources. */
export function renderTokenMarket(market: HeyTokenMarket, now: Date): string {
  const lines: string[] = [
    `# ${market.name}${market.symbol ? ` ($${market.symbol})` : ''} — market, from HEY's own daily index`,
    `Contract ${market.token.contractAddress} on chain ${market.token.chainId}.`,
    `DERIVED market status: ${tokenMarketWords(market.marketStatus)}${market.marketStatusReason ? ` (${market.marketStatusReason.replace(/_/g, ' ')})` : ''}. A reading of the market, not of the team.`,
    `${market.verification === 'UNVERIFIED' ? 'UNKNOWN' : 'FACT'} token verification: ${market.verification.toLowerCase()}.`,
  ];
  /*
   * Who deployed the contract, and when (2026-09-25). A fact about the
   * contract read from the chain; a shared deployer is a launch service, and
   * the line says so rather than let the address read as one team's.
   */
  const k = market.contract;
  if (k) {
    const facts = [
      k.deployer ? `deployed by ${k.deployer}${k.deployerShared ? ' (a deployer that launched other projects HEY tracks: a launch service, not one team)' : ''}` : undefined,
      k.createdAt ? `created ${k.createdAt.slice(0, 10)}` : undefined,
      k.creationTx ? `in transaction ${k.creationTx}` : undefined,
    ].filter((v): v is string => v !== undefined);
    if (facts.length > 0) lines.push(`FACT contract: ${facts.join(', ')}.`);
  }
  lines.push('');
  if (market.current) {
    const c = market.current;
    const parts = [
      c.priceUsd === undefined ? undefined : `price $${c.priceUsd >= 1 ? c.priceUsd.toFixed(2) : c.priceUsd.toPrecision(3)}`,
      // By the kind the API sent (2026-09-26): an unknown kind is a valuation, never a market cap.
      c.marketCapUsd === undefined ? undefined : `${valuationWord(c.valuationKind)} ${money(c.marketCapUsd)}`,
      c.liquidityUsd === undefined
        ? undefined
        : c.liquidityKind === 'launch_inventory'
          ? `launch pool holds ${money(c.liquidityUsd)} of its own supply (not a market reading)`
          : `liquidity ${money(c.liquidityUsd)}`,
      c.volume24hUsd === undefined ? undefined : `24h volume ${money(c.volume24hUsd)}`,
      c.buys24h === undefined || c.sells24h === undefined ? undefined : `${c.buys24h} buys / ${c.sells24h} sells in 24h`,
      signed(c.priceChange24hPct) === undefined ? undefined : `${signed(c.priceChange24hPct)} in 24h`,
      c.venue ? `pool on ${c.venue}` : undefined,
    ].filter((v): v is string => v !== undefined);
    lines.push(`FACT now (${c.source}, ${ago(c.observedAt, now)}): ${parts.length > 0 ? parts.join(', ') : 'a reading with no figures HEY publishes'}.`);
    if (c.marketCapUsd === undefined) lines.push('UNKNOWN valuation: none published for this reading (a market that is not live has its valuation withheld).');
  } else {
    lines.push('UNKNOWN current market: no market reading in the last week.');
  }
  const l = market.lifecycle;
  const life = [
    l.deployedAt ? `deployed ${l.deployedAt.slice(0, 10)} (read from the block)` : undefined,
    l.launchpadLaunchAt ? `the launchpad (${l.launchpadLaunchAt.source}) says it launched ${l.launchpadLaunchAt.at.slice(0, 10)} — the launchpad's claim` : undefined,
    l.launchSeenAt ? `launch recorded ${l.launchSeenAt.slice(0, 10)}` : undefined,
    l.pairCreatedAt ? `pool created ${l.pairCreatedAt.slice(0, 10)}` : undefined,
    l.launchStage ? `stage ${l.launchStage.toLowerCase()}${(l.launchStageObservedAt ?? l.launchStageAt) ? ` (${launchStageSeenWords(l.launchStage)} ${(l.launchStageObservedAt ?? l.launchStageAt)!.slice(0, 10)})` : ''}` : undefined,
    l.firstTradeDay ? `first indexed trade ${l.firstTradeDay}${l.firstTradeCensored ? ` (the index starts ${l.tradeIndexFrom ?? 'later than the launch'}, so earlier trades may exist)` : ''}` : undefined,
    l.lastTradeDay ? `last indexed trade ${l.lastTradeDay}` : undefined,
    l.peakLiquidityUsd === undefined ? undefined : `highest liquidity HEY saw ${money(l.peakLiquidityUsd)}${l.liquidityBelowPeakPct === undefined ? '' : ` (now ${Math.round(100 - l.liquidityBelowPeakPct)}% of it)`}`,
    signed(l.priceChange7dPct) === undefined ? undefined : `${signed(l.priceChange7dPct)} over 7 days`,
    signed(l.priceChange30dPct) === undefined ? undefined : `${signed(l.priceChange30dPct)} over 30 days`,
  ].filter((v): v is string => v !== undefined);
  if (life.length > 0) lines.push(`FACT lifecycle: ${life.join('; ')}.`);
  const pool = market.pools;
  if (pool) {
    const pools = [
      pool.pools === undefined ? undefined : `${pool.pools} ${pool.pools === 1 ? 'pool' : 'pools'}`,
      pool.liquidityUsd === undefined ? undefined : `liquidity ${money(pool.liquidityUsd)}`,
      pool.depthOnePctUsd === undefined ? undefined : `about ${money(pool.depthOnePctUsd)} can be sold before the price moves 1%`,
      pool.dominantPoolShare === undefined ? undefined : `the largest pool holds ${Math.round(pool.dominantPoolShare * 100)}% of measured pool liquidity`,
    ].filter((v): v is string => v !== undefined);
    if (pools.length > 0) lines.push(`FACT pools (read from the chain, ${pool.day}): ${pools.join(', ')}.`);
  }
  const dist = market.distribution;
  if (dist) {
    const share = (v: number) => `${Math.round(v * 10) / 10}%`;
    const supply = [
      dist.holdersTotal === undefined ? undefined : `${dist.holdersTotal.toLocaleString('en-US')} holders`,
      dist.top10SharePct === undefined ? undefined : `largest 10 balances hold ${share(dist.top10SharePct)}`,
      dist.top50SharePct === undefined ? undefined : `largest 50 hold ${share(dist.top50SharePct)}`,
      dist.burnedSharePct === undefined ? undefined : `${share(dist.burnedSharePct)} burned`,
      dist.pooledSharePct === undefined ? undefined : `${share(dist.pooledSharePct)} in pools`,
    ].filter((v): v is string => v !== undefined);
    if (supply.length > 0) lines.push(`FACT supply (HEY's snapshot, ${dist.day}; burned and pooled supply left out of the top shares): ${supply.join(', ')}.`);
  }
  /*
   * An EMPTY run is not "no holders" (2026-09-25): the holder source reports
   * only balances that moved in about the last nine days.
   */
  const read = market.distributionRead;
  if (read && read.outcome !== 'mapped' && read.note) {
    lines.push(dist ? `Latest distribution read (${read.checkedAt.slice(0, 10)}): ${read.note} The snapshot above is from ${dist.day}.` : `UNKNOWN distribution (${read.checkedAt.slice(0, 10)}): ${read.note}`);
  }
  /*
   * The series is capped for readability, and the cap is stated (2026-09-17).
   */
  const shown = Math.min(market.days.length, DAY_ROWS);
  lines.push(
    '',
    shown < market.days.length
      ? `Days indexed: ${market.days.length}. Showing the ${shown} most recent; the rest are in GET /api/projects/${market.slug}/market?days=${market.days.length}. Latest first:`
      : `Days indexed: ${market.days.length}. Latest first:`,
  );
  for (const d of [...market.days].reverse().slice(0, DAY_ROWS)) {
    const parts = [
      d.priceCloseUsd === undefined ? undefined : `close $${d.priceCloseUsd >= 1 ? d.priceCloseUsd.toFixed(2) : d.priceCloseUsd.toPrecision(3)}`,
      d.liquidityCloseUsd === undefined ? (d.liquidityCloseWithheld ? `liquidity withheld (${d.liquidityCloseWithheld.replace(/_/g, ' ')})` : undefined) : `liquidity ${money(d.liquidityCloseUsd)}`,
      tradesWords(d),
      tradedWords(d),
      d.transfers === undefined ? undefined : `${d.transfers} transfers`,
    ].filter((v): v is string => v !== undefined);
    lines.push(`- ${d.day}: ${parts.length > 0 ? parts.join(', ') : 'no figures'}${d.source ? ` (${d.source})` : ''}`);
  }
  if (market.checks.length > 0) {
    lines.push('', 'What HEY checked on the contract (facts, never verdicts):');
    for (const check of market.checks) lines.push(`- FACT ${check.label}: ${check.finding}${check.tone === 'noted' ? ' [noted]' : ''}${check.provenance ? ` — ${check.provenance}` : ''}`);
  }
  if (market.onchainDays.length > 0) lines.push('', `FACT contract events by day (UTC; "not indexed" is unknown, not zero): ${market.onchainDays.slice(-DAY_ROWS).map((d) => `${d.day} ${d.events === null ? 'not indexed' : d.events}${d.truncated ? '+' : ''}`).join(', ')}.`);
  if (market.tvlDays.length > 0) lines.push(`FACT value locked (DefiLlama, ${market.tvlDays[0]!.protocolName}): latest ${money(market.tvlDays[market.tvlDays.length - 1]!.tvlUsd)}.`);
  lines.push(
    '',
    TAG_LEGEND,
    `Counts, never a wallet: ${k?.deployer ? 'no address but the contract’s deployer is named, and none is' : 'no address is named,'} scored, ranked or followed here. Context only: nothing here reaches activity status or any HEY score, and none of it is a buy signal.`,
    market.url,
  );
  return lines.join('\n');
}

/** How many chain days print before the answer says where the rest are. */
const CHAIN_ROWS = 31;

/** Robinhood Chain day by day, as prose; bounded, and says so (2026-09-26, M2 R17). */
export function renderChain(chain: HeyChain): string {
  const lines: string[] = [`# Robinhood Chain (chain ${chain.chainId}), day by day`, chain.lastFullDay ? `Last full day: ${chain.lastFullDay}.${chain.today ? ` ${chain.today} is still being indexed.` : ''}` : 'UNKNOWN: no full day indexed yet.', ''];
  const days = [...chain.days].reverse();
  for (const d of days.slice(0, CHAIN_ROWS)) {
    const parts = [
      d.dexTrades === undefined ? undefined : `${d.dexTrades.toLocaleString('en-US')} DEX trades`,
      d.dexVolumeUsd === undefined ? undefined : `${money(d.dexVolumeUsd)} volume`,
      d.tokensTraded === undefined ? undefined : `${d.tokensTraded.toLocaleString('en-US')} tokens traded`,
      d.poolsTraded === undefined ? undefined : `${d.poolsTraded.toLocaleString('en-US')} pools`,
      d.transactions === undefined ? undefined : `${d.transactions.toLocaleString('en-US')} transactions`,
      d.launches === undefined ? undefined : `${d.launches.toLocaleString('en-US')} launches recorded by HEY`,
      d.projectsPublished === undefined ? undefined : `${d.projectsPublished} projects published`,
      d.ships === undefined ? undefined : `${d.ships} verified ships${d.buildersShipping === undefined ? '' : ` from ${d.buildersShipping} builders`}`,
      d.buildersVerified === undefined ? undefined : `${d.buildersVerified} newly verified builders`,
    ].filter((v): v is string => v !== undefined);
    lines.push(`- FACT ${d.day}: ${parts.length > 0 ? parts.join(', ') : 'no figure indexed (unknown, not zero)'}`);
  }
  lines.push('', shownOf(Math.min(days.length, CHAIN_ROWS), days.length, `Newest first; the older days are in GET /api/chain?days=${days.length}.`));
  // The API's own disclaimer travels with the answer, as on every other listing (audit §45 #9).
  lines.push(chain.volumeNote, 'Aggregates only; nobody is named. Context, never a ranking input.', TAG_LEGEND, chain.disclaimer);
  return lines.join('\n');
}

/** The Builder Radar as prose, with the method stated. */
export function renderBuilders(page: HeyBuildersPage, now: Date): string {
  const lines: string[] = [`# Builder Radar — ${page.ranked} projects ranked${page.day ? ` for ${page.day}` : ''}`, page.method, 'Each rank is DERIVED: a rule over verified development, on-chain use and research standing. Market cap, price and volume take no part in it.', ''];
  if (page.items.length === 0) lines.push('No builders match this view.');
  for (const b of page.items) {
    const move = b.rank7d === undefined ? 'new' : b.rank7d === b.rank ? 'unchanged' : `${b.rank7d > b.rank ? '▲' : '▼'} ${Math.abs(b.rank7d - b.rank)} in 7d`;
    lines.push(
      `- DERIVED #${b.rank} ${b.name}${b.symbol ? ` ($${b.symbol})` : ''} · overall ${Math.round(b.scores.overall)} (dev ${Math.round(b.scores.development)}, on-chain ${Math.round(b.scores.onchain)}, research ${Math.round(b.scores.research)}) · ${move} · ${b.activityStatus.toLowerCase()}${b.lastShippedAt ? ` · shipped ${ago(b.lastShippedAt, now)}` : ''}${b.liquidityHealth === undefined ? '' : ` · liquidity health ${Math.round(b.liquidityHealth)} (context)`}`,
      `  ${b.url}`,
    );
  }
  lines.push('', shownOf(page.items.length, page.total, `For the rest, call find_projects again with surface=builder-radar and offset=${offsetOf(page.query) + page.items.length}.`));
  // A ranking above all keeps the API's "not investment advice" (audit §45 #9).
  lines.push(queryEcho(page.query), TAG_LEGEND, page.disclaimer);
  return lines.join('\n');
}

/** One weekly report as prose. */
export function renderWeeklyReport(report: HeyWeeklyReport): string {
  const o = report.overview;
  const lines: string[] = [`# Robinhood Chain, ${report.week} (${report.window.start.slice(0, 10)} → ${report.window.end.slice(0, 10)}${report.final ? '' : ', in progress'})`, report.headline, ''];
  // Ships and pages are records; a status move, a research level, Still Building and Under the Radar are rules HEY applied (audit §45 #8).
  lines.push(`FACT overview: ${o.ships} verified ships from ${o.projectsShipping} projects · ${o.published} pages published in total.`);
  lines.push(`DERIVED overview: ${o.newBuilders} new verified builders · ${o.backToShipping} back to shipping · ${o.stillBuilding} Still Building · ${o.underTheRadar} Under the Radar · ${o.verifiedBuilders} verified builders in total.`);
  const c = report.chain;
  const chain = [c.dexTrades === undefined ? undefined : `${c.dexTrades.toLocaleString('en-US')} DEX trades`, c.dexVolumeUsd === undefined ? undefined : `${money(c.dexVolumeUsd)} volume (USDG/WETH/ETH pairs)`, c.launches === undefined ? undefined : `${c.launches.toLocaleString('en-US')} launches recorded`, c.projectsPublished === undefined ? undefined : `${c.projectsPublished} pages published`].filter((v): v is string => Boolean(v));
  if (chain.length > 0) lines.push(`FACT chain (${c.days} days): ${chain.join(' · ')}.`);
  if (report.shipped.length > 0) lines.push('', 'Most active builders:', ...report.shipped.map((g) => `- ${g.name}: ${g.ships} ${g.ships === 1 ? 'ship' : 'ships'} · ${g.latest}`));
  if (report.movers.length > 0) lines.push('', 'Biggest movers (Builder Radar, 7 days; DERIVED ranks):', ...report.movers.map((m) => `- ${m.name}: #${m.rank7d} → #${m.rank} (▲ ${m.gained})`));
  if (report.topBuilders.length > 0) lines.push('', 'Top builders (DERIVED ranks):', ...report.topBuilders.map((b) => `- #${b.rank} ${b.name} (overall ${Math.round(b.overall)})`));
  if (report.newBuilders.length > 0) lines.push('', `New verified builders: ${report.newBuilders.map((b) => b.name).join(', ')}.`);
  if (report.backToShipping.length > 0) lines.push(`Back to shipping: ${report.backToShipping.map((b) => b.name).join(', ')}.`);
  if (report.signals.length > 0) lines.push('', 'Signals of the week:', ...report.signals.map((s) => `- ${s.name}: ${s.label} — ${s.title}`));
  if (o.stillBuilding > 0) lines.push('', STILL_BUILDING_MEANING);
  lines.push('', "Every figure was measured from HEY's tables at generation time. Not a recommendation.", TAG_LEGEND, report.url);
  return lines.join('\n');
}

/** Rows per section of the weekly rollup; the page holds the rest. */
const WEEK_ROWS = 10;

/**
 * HEY's weekly rollup as prose (2026-09-17). The rollup's valuations travel
 * without a provider, so the caveat is stated once, and a valuation whose kind
 * the API did not send is a "valuation", never a market cap (2026-09-26).
 */
export function renderThisWeek(week: HeyThisWeek): string {
  const w = week.window;
  const one = (p: HeyThisWeekProject) =>
    `${p.name}${p.symbol ? ` ($${p.symbol})` : ''} · ${p.activityStatus.toLowerCase()}${p.marketCapUsd === undefined ? '' : ` · ${valuationWord(p.valuationKind)} ${money(p.marketCapUsd)} (context)`} — ${p.url}`;
  const lines: string[] = [
    `# This week on Robinhood Chain (${w.label})`,
    week.summary,
    `Counted over the ${w.days} days to ${w.until.slice(0, 10)}, from HEY's own tables.`,
    '',
    `FACT ships: ${week.shipped.ships.toLocaleString('en-US')} from ${week.shipped.projects.toLocaleString('en-US')} ${week.shipped.projects === 1 ? 'project' : 'projects'}.`,
    `DERIVED newly verified builders: ${week.newBuilders.total.toLocaleString('en-US')}.`,
    `DERIVED back to shipping: ${week.backToShipping.total.toLocaleString('en-US')}.`,
    `DERIVED Still Building: ${week.stillBuilding.total.toLocaleString('en-US')}.`,
    ...(week.underTheRadar ? [`DERIVED Under the Radar: ${week.underTheRadar.total.toLocaleString('en-US')}.`] : []),
  ];
  const section = (label: string, rows: string[]) => {
    if (rows.length === 0) return;
    lines.push('', `${label}:`, ...rows.slice(0, WEEK_ROWS));
    if (rows.length > WEEK_ROWS) lines.push(`  …and ${rows.length - WEEK_ROWS} more on ${week.links.page}`);
  };
  section(
    'Shipped most',
    week.shipped.items.map((i) => `- ${one(i.project)} — ${i.ships} ${i.ships === 1 ? 'ship' : 'ships'}${i.latest ? `; latest: ${i.latest.title}${i.latest.sourceUrl ? ` (${i.latest.sourceUrl})` : ''}` : ''}`),
  );
  section('New builders', week.newBuilders.items.map((i) => `- ${one(i.project)} — verified ${i.verifiedAt.slice(0, 10)}`));
  section('Back to shipping', week.backToShipping.items.map((i) => `- ${one(i.project)} — ${i.from.toLowerCase()} → ${i.to.toLowerCase()} on ${i.changedAt.slice(0, 10)}`));
  section('Still Building', week.stillBuilding.items.map((p) => `- ${one(p)}`));
  if (week.underTheRadar) section('Under the Radar', week.underTheRadar.items.map((p) => `- ${one(p)}`));

  if (week.stillBuilding.total > 0) lines.push('', STILL_BUILDING_MEANING);
  lines.push(
    '',
    'Any valuation here (a market cap, or an FDV where no circulating figure exists) is context HEY recorded and does not name its provider in this rollup; get_project_snapshot carries the figure with the source that reported it.',
    TAG_LEGEND,
    week.disclaimer,
    `Page: ${week.links.page}`,
  );
  return lines.join('\n');
}

/**
 * One project by the contract address someone pasted (2026-09-17). The line a
 * bot would render, in the words HEY uses for it: `activityLabel` rather than
 * the enum, because integrators left to translate `DORMANT` write *dead*.
 */
export function renderTokenLookup(lookup: HeyTokenLookup, now: Date): string {
  if (lookup.status !== 'published' || !lookup.project) {
    return [
      `# ${lookup.contractAddress} — HEY publishes no page for this address`,
      '',
      'UNKNOWN: that is an answer, not an error. Most addresses are not indexed projects, and an address HEY holds but has not reviewed reads the same way.',
      `A live read of the chain for it: ${lookup.scanUrl}`,
      '',
      lookup.disclaimer,
    ].join('\n');
  }

  const p = lookup.project;
  const ships = p.shipsLast30Days === 1 ? '1 ship record' : `${p.shipsLast30Days} ship records`;
  // An indexed record is not a measured zero (2026-09-17).
  const notResearched = p.researchLevel === 'INDEXED';
  const lines = [
    `# ${p.name}${p.symbol ? ` ($${p.symbol})` : ''} — ${notResearched ? 'Activity not researched yet' : p.activityLabel}`,
    notResearched ? 'UNKNOWN activity: HEY indexed this record from the chain but has not yet read its sources for building activity.' : `${activityTag(p.activityStatus)} activity: ${p.activityHelp}`,
    '',
    ...(notResearched
      ? []
      : p.activityMeasured === false
        ? ['- UNKNOWN activity: HEY holds no repository, changelog or feed it can read building from, so no ship count here is a measured zero.']
        : [
            `- FACT ${ships} in the last 30 days, counted the way the project page counts them.`,
            ...(p.meaningfulShipsLast30Days === undefined ? [] : [`- DERIVED ${p.meaningfulShipsLast30Days} meaningful ships in 30 days, by the rule behind the status.`]),
          ]),
  ];
  if (p.lastShip) lines.push(`- FACT last ship ${ago(p.lastShip.publishedAt, now)}: ${p.lastShip.title}${p.lastShip.sourceUrl ? ` — ${p.lastShip.sourceUrl}` : ''}`);
  if (p.deployedAt) lines.push(`- FACT contract deployed ${p.deployedAt.slice(0, 10)}, read from the block.`);
  // Whose contract this is, beside whose activity (2026-09-25).
  /*
   * The API's own field (2026-09-27, F7), and the verification it comes from
   * as well, so a server that predates the field cannot turn a disowned token
   * back into an invitation.
   */
  const applies = p.activityAppliesToToken !== false && p.tokenVerification?.status !== 'MISMATCH';
  if (!applies) {
    lines.push('- FACT MISMATCH: the project’s own site names a different contract. The activity above is the project’s; do not treat this address as its token.');
    lines.push('- FACT activity applies to this token: no. HEY sends no link from this address to the project.');
  } else if (p.tokenVerification?.status === 'UNVERIFIED') {
    lines.push('- UNKNOWN whose token: HEY has not seen the project name this contract itself.');
  } else if (p.tokenVerification?.status === 'VERIFIED') {
    lines.push('- FACT verified: the project names this contract itself.');
  }
  if (p.asOf) lines.push(`- Scored ${p.asOf.slice(0, 16).replace('T', ' ')} UTC.`);
  // No invitation from a token the project's own site disowns (F7): the project page is not this token's page.
  if (applies) lines.push(`- ${p.url}`);
  lines.push('', TAG_LEGEND, lookup.disclaimer);
  return lines.join('\n');
}

/** Ask HEY's evidence answer (2026-09-24): each line keeps its FACT / DERIVED / UNKNOWN tag and its source. */
export function renderAskAnswer(answer: HeyAskAnswer): string {
  const lines: string[] = [`# Ask HEY about ${answer.project.name}`, answer.project.url, '', `Question: ${answer.question}`];
  if (answer.notice) lines.push(`${answer.notice.tag} ${answer.notice.text}`);
  if (answer.fallback) lines.push('HEY could not tell which part of its record this is about; here is what changed and what it does not know.');
  for (const section of answer.sections) {
    lines.push('', `## ${section.question}`);
    for (const line of section.lines) lines.push(`${line.tag} ${line.text}${line.source ? ` (source: ${line.source})` : ''}`);
  }
  lines.push('', TAG_LEGEND, answer.disclaimer);
  return lines.join('\n');
}

const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : undefined);

/** Eligible under the Under the Radar rule and below the 40th market-attention percentile (2026-09-24; audit §45 #25). Not a buy signal. */
export function renderSilentBuilders(page: HeySilentBuilders): string {
  if (page.items.length === 0) return `No project meets the bar right now.\nMethod: ${page.method}\n\n${page.disclaimer}`;
  const lines = page.items.map(
    (item) =>
      `- DERIVED ${item.name}${item.symbol ? ` ($${item.symbol})` : ''} — FACT ${item.meaningfulShips30d} verified ships in 30 days${item.marketAttention ? `, market attention ${item.marketAttention.toLowerCase().replace('_', ' ')} (context)` : ''}${item.lastShipAt ? `, last ship ${day(item.lastShipAt)}` : ''} — ${item.url}`,
  );
  return `Eligible under the Under the Radar rule (the gap itself not required) and below the 40th market-attention percentile:\n${lines.join('\n')}\n${shownOf(page.items.length, page.total, 'The API lists at most 100; the Radar page holds the rest.')}\nMethod: ${page.method}\nContinued building is not a buy signal.\n${TAG_LEGEND}\n\n${page.disclaimer}`;
}

export function renderAccelerating(page: HeyAccelerating): string {
  if (page.items.length === 0) return `No builder is shipping measurably faster right now.\nMethod: ${page.method}\n\n${page.disclaimer}`;
  // `previous: null` is "not watched long enough to compare", never "none" (2026-09-26, M2 G9).
  const lines = page.items.map(
    (item) =>
      `- DERIVED ${item.name}${item.symbol ? ` ($${item.symbol})` : ''} — ${item.velocity.current} meaningful events in ${item.velocity.windowDays} days vs ${item.velocity.previous === null ? 'an earlier window HEY did not watch (unknown)' : `${item.velocity.previous} before`}${item.lastShipAt ? `, last ship ${day(item.lastShipAt)}` : ''} — ${item.url}`,
  );
  return `Shipping faster (showing ${page.items.length}; the API lists at most 100):\n${lines.join('\n')}\nMethod: ${page.method}\n${TAG_LEGEND}\n\n${page.disclaimer}`;
}

/**
 * Market Integrity for one project (2026-09-25): the builder line first, the
 * market facts second, the conflicts third — each tagged — and always the
 * sentence that the market is not the builder.
 */
export function renderMarketIntegrity(page: HeyMarketIntegrity): string {
  const builder = `${activityTag(page.builderActivity.status)} builder activity: ${page.builderActivity.status?.toLowerCase() ?? 'unknown'}${page.builderActivity.lastMeaningfulShipAt ? `, last meaningful ship ${page.builderActivity.lastMeaningfulShipAt.slice(0, 10)}` : ''}`;
  const m = page.marketIntegrity;
  if (!m) return `# ${page.slug} — market integrity\n${page.url}\n${builder}\nUNKNOWN HEY holds no market-integrity evaluation for this project (no tracked token, or not evaluated yet).\n\n${page.note}`;
  const lines = [
    `DERIVED token market: ${m.state.toLowerCase().replace(/_/g, ' ')}`,
    m.liquidityPeakUsd !== null && m.liquidityNowUsd !== null
      ? `DERIVED liquidity ${Math.round(m.liquidityPeakUsd).toLocaleString('en-US')} USD (held, ${m.liquidityPeakDay}) → ${Math.round(m.liquidityNowUsd).toLocaleString('en-US')} USD (${m.liquidityNowDay})${m.liquidityChangePct !== null ? `, ${m.liquidityChangePct}%` : ''}`
      : 'UNKNOWN no established liquidity level to measure against',
    ...(m.collapseDay ? [`DERIVED liquidity under a tenth of that level since ${m.collapseDay} (two consecutive daily readings)`] : []),
    ...(m.lastTradeDay ? [`FACT last trade recorded ${m.lastTradeDay}`] : []),
    m.migrationDetected && m.migration ? `DERIVED liquidity appears to have moved (${m.migration.kind.toLowerCase()}, ${m.migration.confidence} confidence)` : m.collapse === 'COLLAPSE' || m.collapse === 'SEVERE' ? 'DERIVED no verified replacement pool for the same token found' : '',
    ...(m.sourcesDisagree ? ['UNKNOWN two market sources disagree; HEY holds this for review'] : []),
    ...(m.exitPattern && m.exitPattern.level !== 'NONE' ? [`DERIVED potential exit pattern (an evidence classification, not a finding about intent): ${m.exitPattern.reasons.join(' ')}`] : []),
    ...page.conflicts.map((conflict) => `DERIVED signal conflict: ${conflict.text}`),
  ].filter(Boolean);
  /*
   * The events, each with its id, its time as precisely as HEY knows it, and
   * its words with the reading dates and sources (2026-09-27). Shown of the
   * whole, and where to read each one.
   */
  const shown = page.events.slice(0, 12);
  const events = shown.map(
    (event) => `- DERIVED ${event.at === null ? `observed, first seen ${event.detectedAt.slice(0, 10)}` : `${event.precision} ${event.at}${event.until ? ` to ${event.until.slice(0, 10)}` : ''}`} · ${event.summary} (${event.confidence} confidence; ${event.id})`,
  );
  const eventBlock = page.events.length
    ? `\n\nEvents HEY stands behind (${shown.length} of ${page.events.length}; open one with get_evidence and its id):\n${events.join('\n')}`
    : '';
  const readings = m.liquidityPeakSource || m.liquidityNowSource ? `\nReadings: level from ${m.liquidityPeakSource ?? 'unknown'}, now from ${m.liquidityNowSource ?? 'unknown'}.` : '';
  return `# ${page.slug} — market integrity (rules ${m.rulesVersion})\n${page.url}\n${builder}\n${lines.join('\n')}${readings}${eventBlock}\n\n${page.note}\n${TAG_LEGEND}`;
}

export function renderMarketMoves(page: HeyMarketMoves): string {
  const head = `# ${page.project.name} — market moves and what came before (${page.threshold.windowDays} days, moves of ${page.threshold.minChangePct}% or more)\n${page.project.url}`;
  // A withheld index is not a missing one (2026-09-26): the valuation exists and is not published while the market is not live.
  if (page.daysRead < 2 && page.withheldDays) {
    return `${head}\nDERIVED valuation withheld on ${page.withheldDays} indexed days${page.withheldReason ? ` (${page.withheldReason.replace(/_/g, ' ')})` : ''}: the market is not live, so HEY publishes no move.\n\n${page.disclaimer}`;
  }
  if (page.daysRead < 2) return `${head}\nUNKNOWN HEY holds too few daily market readings for this project to measure a move.\n\n${page.disclaimer}`;
  if (page.items.length === 0) return `${head}\nFACT no day-on-day move of ${page.threshold.minChangePct}% or more in ${page.daysRead} recorded days.\n\n${page.method}\n${page.disclaimer}`;
  const blocks = page.items.map((move) => {
    const events = move.eventsBefore.length
      ? move.eventsBefore.map((event) => `  - FACT ${event.publishedAt.slice(0, 10)} · ${event.title}${event.source ? ` — ${event.source}` : ''}`).join('\n')
      : `  - FACT no corroborated building event in the ${page.threshold.lookbackDays} days up to it`;
    return `- FACT ${move.day}: ${valuationWord(move.valuationKind)} ${move.changePct > 0 ? '+' : ''}${move.changePct}% on ${move.previousDay} (${Math.round(move.previousMarketCapUsd).toLocaleString('en-US')} → ${Math.round(move.marketCapUsd).toLocaleString('en-US')} USD)\n${events}`;
  });
  return `${head}\n${blocks.join('\n')}\n\nA sequence, never a cause. ${page.method}\n${page.disclaimer}`;
}

export function renderUnlocks(page: HeyUnlocks): string {
  if (page.items.length === 0) return `No HoodLock lock reaches its unlock date in the next ${page.days} days. HoodLock is the one locker HEY reads: this is not "no lock anywhere".\n\n${page.disclaimer}`;
  const lines = page.items.map(
    (item) =>
      `- SCHEDULED ${item.unlockAt.slice(0, 16).replace('T', ' ')} UTC · ${item.project.name} · lock #${item.lockId} (${item.id})${item.assetKind === 'LP' ? ' · LP position' : item.lockedTokens !== undefined ? ` · ${item.lockedTokens.toLocaleString('en-US')} tokens` : ''}${item.shareOfSupplyPct !== undefined ? ` (${item.shareOfSupplyPct}% of recorded supply)` : ''} — proof ${item.proof}`,
  );
  return `Scheduled HoodLock unlocks, next ${page.days} days (FACT from the locker's own records; an unlock date is when supply may move, not that it will):\n${lines.join('\n')}\n${shownOf(page.items.length, page.total, 'The API lists at most 100; ask for fewer days.')}\nHoodLock only: locks at other lockers are not read.\n\n${page.disclaimer}`;
}

export function renderTimeline(timeline: HeyTimeline, limit = 30): string {
  const shown = timeline.items.slice(0, limit);
  const lines = shown.map(
    (item) =>
      `- ${recordTag(item.id)} ${item.precision} ${atPrecision(item.at, item.precision)} · ${item.kind.replace(/_/g, ' ')} · ${item.title}${item.countsAsBuilding ? ' · counts as building' : ''}${item.discoveryLagHours !== undefined ? ` (recorded ${Math.round(item.discoveryLagHours)}h later)` : ''}${item.source ? ` — ${item.source}` : ''}`,
  );
  /*
   * Shown of the whole, and the parameter that reads on (2026-09-26, M2 G3).
   */
  const total = typeof timeline.total === 'number' ? timeline.total : timeline.items.length;
  const more =
    shown.length < timeline.items.length
      ? `Call get_project_timeline again with limit=${shown.length} and follow the before= cursor it gives to read on.`
      : timeline.nextCursor
        ? `For older entries, call get_project_timeline again with before=${timeline.nextCursor}.`
        : undefined;
  return `# ${timeline.project.name} — timeline (lens: ${timeline.lens})\n${timeline.project.url}\nEach entry is tagged FACT (a record with its source) or DERIVED (a rule HEY applied: a return to building HEY detected, a market-integrity reading), dated at the precision shown (EXACT, DATE, WEEK, WINDOW, OBSERVED = HEY's own observation, SCHEDULED = not yet happened).\n${lines.length ? lines.join('\n') : 'Nothing HEY holds falls under this lens.'}\n\n${shownOf(shown.length, total, more)}\n\n${timeline.disclaimer}`;
}

/**
 * The change ledger as prose (2026-09-26): each event's own time and how
 * exactly HEY knows it, when HEY first knew, what it says, and its evidence.
 * A retraction says only that an id is gone. The page ends with how to read
 * on, so a model never mistakes a page for the whole.
 */
export function renderChanges(page: HeyChangesPage): string {
  const lines: string[] = ['# What changed — the HEY change ledger', 'Each event is tagged FACT (a record with its source) or DERIVED (a rule HEY applied: a status or market-state move, a window HEY measured, a market-integrity reading); `occurredAt` only when a source dates it, else OBSERVED (HEY\'s own knowledge time).', ''];
  if (page.items.length === 0) lines.push('No change matches in this page.');
  for (const item of page.items) {
    if (item.op === 'retract') {
      lines.push(`- RETRACTED ${item.id} (revision ${item.revision}, ${item.recordedAt.slice(0, 16).replace('T', ' ')} UTC): HEY no longer makes this claim; drop it.`);
      continue;
    }
    const when = item.occurredAt ? `${item.precision} ${item.occurredAt.slice(0, 10)}${item.occurredUntil ? `–${item.occurredUntil.slice(0, 10)}` : ''}` : `OBSERVED (no source time; HEY saw it ${item.detectedAt.slice(0, 10)})`;
    const move = item.before !== undefined || item.after !== undefined ? ` (${String(item.before ?? '—')} → ${String(item.after ?? '—')})` : '';
    lines.push(`- ${recordTag(item.id)} ${when} · ${item.type} · ${item.project.name} (${item.project.slug}): ${item.summary}${move}`);
    lines.push(`  id ${item.id} · revision ${item.revision}${item.origin === 'live' ? '' : ` · ${item.origin}`} · detected ${item.detectedAt.slice(0, 10)}${item.countsAsBuilding ? ' · counts as building' : ''}`);
    for (const evidence of item.evidence) if (evidence.url) lines.push(`  evidence: ${evidence.label} — ${evidence.url}`);
  }
  lines.push('');
  const sync = page.query.mode === 'sync';
  if (page.hasMore && page.nextCursor) lines.push(`Showing ${page.items.length}; more exist. Call get_changes again with ${sync ? 'after' : 'before'}=${page.nextCursor}.`);
  else lines.push(`Showing ${page.items.length}; that is the end of this ${sync ? 'sync (keep the cursor to read what comes next)' : 'listing'}.${sync && page.nextCursor ? ` Cursor: ${page.nextCursor}.` : ''}`);
  const facts = [
    page.ledger.collectionStart ? `ledger from ${page.ledger.collectionStart.slice(0, 10)}` : undefined,
    page.ledger.transitionsFrom ? `status and market moves recorded from ${page.ledger.transitionsFrom.slice(0, 10)} (none earlier exist)` : undefined,
    page.ledger.projectorRanAt ? `last indexed ${page.ledger.projectorRanAt.slice(0, 16).replace('T', ' ')} UTC` : undefined,
  ].filter((fact): fact is string => Boolean(fact));
  if (facts.length > 0) lines.push(`Ledger: ${facts.join('; ')}.`);
  lines.push(queryEcho(page.query), 'A change is a record HEY kept, never a cause and never a recommendation.', TAG_LEGEND, '', page.disclaimer);
  return lines.join('\n');
}

export function renderCompare(page: HeyCompare): string {
  const rows = page.projects.map((project) =>
    [
      `## ${project.name} — ${project.url}`,
      `${activityTag(project.activityStatus)} activity status: ${project.activityStatus.toLowerCase().replace(/_/g, ' ')}${project.lastMeaningfulShipAt ? `; last meaningful ship ${day(project.lastMeaningfulShipAt)}` : ''}`,
      project.buildMomentum === undefined ? 'UNKNOWN Build Momentum: not measured' : `DERIVED Build Momentum ${Math.round(project.buildMomentum)}`,
      project.velocity && project.velocity.current !== null
        ? `DERIVED velocity: ${project.velocity.state.toLowerCase()} (${project.velocity.current}${project.velocity.previous === null ? '' : ` vs ${project.velocity.previous}`})`
        : 'UNKNOWN velocity',
      project.cadence?.medianIntervalDays !== undefined ? `DERIVED release cadence: every ${project.cadence.medianIntervalDays} days` : 'UNKNOWN release cadence',
      `FACT verified builder: ${project.verifiedBuilder ? 'yes' : 'no'}; sources ${project.sources.verified} verified of ${project.sources.total}`,
      // By the kind the API sends, not by comparing figures (2026-09-25); an unknown kind is a valuation (2026-09-26).
      project.marketCapUsd === undefined
        ? 'UNKNOWN valuation'
        : `FACT ${project.valuationKind === 'fdv' ? 'fully diluted valuation' : valuationWord(project.valuationKind)} ${project.marketCapUsd.toLocaleString('en-US')} USD (context)`,
      project.liquidityUsd === undefined
        ? 'UNKNOWN liquidity'
        : project.liquidityKind === 'launch_inventory'
          ? `FACT launch pool holds ${project.liquidityUsd.toLocaleString('en-US')} USD of its own supply — not a market reading`
          : `FACT liquidity ${project.liquidityUsd.toLocaleString('en-US')} USD (context)`,
    ].join('\n'),
  );
  const missing = page.missing.length ? `\nNot published: ${page.missing.join(', ')}.` : '';
  const ignored = page.ignoredSlugs?.length ? `\nNot compared (malformed or past the fourth): ${page.ignoredSlugs.join(', ')}.` : '';
  return `${rows.join('\n\n')}${missing}${ignored}\n\n${page.method}\n${TAG_LEGEND}\n${page.disclaimer}`;
}
