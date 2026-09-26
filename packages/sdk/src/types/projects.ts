/**
 * The shapes the public API returns (2026-09-19): projects, ships, one token
 * by address, a token's market and a project's intelligence.
 *
 * Each `Hey*` type in `types/` is a copy of the serialiser type in `apps/web`
 * that produces the route body — `ApiProject`, `ApiShip`, `ApiSignalsPage` and
 * so on — and the `apps/web/src/lib/public-api-contract.*.test.ts` files assert
 * the two are identical in both directions at typecheck time. A field the API
 * starts sending and these files do not name fails the gate; so does a field
 * named here that the API does not send. The SDK cannot import from the web
 * app (it is published on its own), which is why the shapes are spelled twice
 * and held together by a test rather than by an import.
 *
 * The one rule every shape follows: **absent means HEY does not know.** A
 * missing market cap is not zero, a project with no `score` has not been
 * measured, and no field is `null` unless the API itself sends `null`
 * (`HeyStatus` does, because "never captured" is a fact about the platform).
 *
 * One file per family (2026-09-26, split unchanged out of `types.ts`);
 * `index.ts` re-exports each with `export type *`, so a type added to a
 * family file is public without an `index.ts` edit.
 */

import type { HeySignal } from './feeds';
import type { HeyBuilderRadarDay } from './misc';

/* ------------------------------------------------------------------ enums */

/** What HEY claims about a project's activity. */
export type HeyActivityStatus = 'SHIPPING' | 'ACTIVE' | 'QUIET' | 'DORMANT' | 'RESUMED' | 'UNKNOWN';

/* ---------------------------------------------------------------- projects */

/** Canonical token identity: `(chainId, contractAddress)`, never a ticker alone. */
export type HeyToken = { chainId: number; contractAddress: string };

/**
 * What a liquidity figure is (2026-09-25): `market` is depth a trader could
 * use; `launch_inventory` is a launch pool's own supply at its last price,
 * which the project page prints as "Not a market reading".
 */
export type HeyLiquidityKind = 'market' | 'launch_inventory';

/**
 * What HEY's latest attempt to read a token's distribution found.
 * `no_balance_change_in_window`: the holder source reports only balances that
 * moved in about the last nine days, and none of this token's did — not "no
 * holders".
 */
export type HeyDistributionReadOutcome = 'mapped' | 'no_balance_change_in_window' | 'no_supply' | 'read_failed';

export type HeyProject = {
  slug: string;
  name: string;
  symbol?: string;
  shortDescription?: string;
  projectKind: string;
  /** What HEY is claiming about activity, and how far its research went. */
  activityStatus: string;
  researchLevel: string;
  catalogStatus: string;
  stillBuilding: boolean;
  lastShippedAt?: string;
  primaryNarrative?: { slug: string; name: string };
  /** Canonical identity. Absent for a project without a token. */
  token?: HeyToken;
  /** Where the token launched, when HEY observed the launch. */
  launchedVia?: { name: string; url?: string };
  /** The pool the current market reading came from, in words ("Uniswap v4"): where the token trades, not where it launched. */
  venue?: string;
  /** Trades in the reading's last day and the price move over it, from the same provider as `marketCap`. Counts of trades, never of accounts. */
  trades24h?: { buys: number; sells: number; source?: string; observedAt?: string };
  /**
   * Supply held at HoodLock, when HEY found a live lock. Absent means HEY
   * found none, which is the ordinary case and is not a finding about the
   * project. Context, never a score or a safety verdict.
   */
  /**
   * `until` is when the *last* of the locked supply opens; `nextUnlockAt` is
   * the nearest unlock date and `nextUnlockPct` the share of total supply
   * that opens that day (2026-09-25).
   */
  tokenLock?: { supplyPct?: number; until?: string; nextUnlockAt?: string; nextUnlockPct?: number; pairLocked: boolean };
  priceChange24hPct?: number;
  /** Whether HEY holds a repository, org, changelog or feed to read building from; false explains an UNKNOWN status. */
  hasBuilderSource?: boolean;
  websiteUrl?: string;
  officialX?: { handle: string; url: string };
  /** The artwork the project chose. Absent where HEY does not know it; draw a monogram. */
  logoUrl?: string;
  /** The drawdown behind a `stillBuilding: true`: the decline HEY tracked and the verified ships since it began. Absent when the claim is not being made. */
  stillBuildingEvidence?: { drawdownPercent: number; shipsSinceDecline?: number };
  /** Market context only, with the provider that reported it and when. Context, never a ranking input. */
  /** `kind: 'fdv'` when the provider reported no circulating figure and the fully diluted valuation stands in. */
  marketCap?: { usd: number; source: string; observedAt?: string; kind?: 'marketCap' | 'fdv' };
  /**
   * The liquidity the project page prints. Absent means HEY holds no such
   * figure — never zero. `kind: 'launch_inventory'` is a launch pool's own
   * supply, left out of `minLiquidity` and `sort: 'liquidity'` (2026-09-25).
   * When the current reading carries no liquidity this is the token's last
   * recorded depth, dated by its own `observedAt` and with no `source`.
   */
  liquidity?: { usd: number; source?: string; observedAt?: string; kind: HeyLiquidityKind };
  volume24h?: { usd: number; source?: string; observedAt?: string };
  /** Where the launch stands: on its curve, graduated, or trading in a DEX pool. */
  launchStage?: 'CURVE' | 'GRADUATED' | 'DEX';
  /**
   * The tracked token's market state, as the card shows it: `ACTIVE_MARKET`,
   * `LOW_LIQUIDITY`, `NO_LIQUIDITY`, `TRADING_INACTIVE`, `LIQUIDITY_REMOVED`,
   * `MARKET_ABANDONED` or `INSUFFICIENT_DATA`, with HEY's reason code. It is
   * why a listing sometimes carries no `marketCap`: a dead market's valuation
   * is withheld. Absent for a project without a token. About the market,
   * never about the team.
   */
  tokenMarket?: { status: string; reason?: string };
  /**
   * Whether the project itself names the tracked contract (on every project
   * since 2026-09-25): `MISMATCH` means its own site names a different one.
   * Absent for a project without a token.
   */
  tokenVerification?: { status: 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH'; reason?: string; verifiedAt?: string };
  /** The project's page on HEY. */
  url: string;
};

export type HeyShip = {
  id: string;
  title: string;
  summary?: string;
  eventType: string;
  publishedAt: string;
  /**
   * When HEY observed it, which is not when the project shipped it. Mirror
   * along this and `sort: 'detected'`, never along `publishedAt`, or a
   * late-ingested ship is missed permanently rather than seen late.
   */
  detectedAt: string;
  /** How the claim is backed; self-reported and verified are different states. */
  verification: string;
  /** The public source HEY recorded it from, when there is one. */
  sourceUrl?: string;
  project: HeyProject;
  /** The ship on HEY's own page. */
  url: string;
};

/** Present when the request named a market field: how many matching rows carry each figure. */
export type HeyMarketCoverage = {
  /** Rows under every non-market filter of the request. */
  base: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  /** Tokens whose market is not gone. */
  liveMarket: number;
  /** Tokens that actually traded in the last day. */
  activeMarket: number;
  verifiedToken: number;
  /** Projects with a public repository HEY reads commits from. */
  github: number;
  stage: { curve: number; graduated: number; dex: number };
};

/** The denominators behind the strict states: three of 3,600 reads as broken without the 3,600. */
export type HeyCatalogueCounts = {
  verifiedBuilders: number;
  stillBuilding: number;
  underTheRadar: number;
  marketCoverage?: HeyMarketCoverage;
};

export type HeyPage<T> = {
  /** What the caller asked for, as it was understood after validation. */
  query: Record<string, string | number>;
  total: number;
  /** Pass back as `offset` for the next page; absent when the listing ends. */
  nextOffset?: number;
  items: T[];
  catalogue?: HeyCatalogueCounts;
  disclaimer: string;
};

export type HeyProjectDetail = HeyProject & {
  longDescription?: string;
  /** The newest ships, as `/api/ships?project=` would list them. */
  ships: HeyShip[];
  firstSeenAt: string;
  /** Ownership: claimed by a verified builder, or self-reported at submission. */
  isClaimed: boolean;
  submitted: boolean;
  narratives: { slug: string; name: string; isPrimary: boolean }[];
  sources: { url: string; sourceType: string; isVerified: boolean; confidence: string; contextOnly: boolean; contextReason?: string }[];
  market?: {
    marketCapUsd?: number;
    fdvUsd?: number;
    liquidityUsd?: number;
    /** `launch_inventory` when `liquidityUsd` is a launch pool's own supply (2026-09-25). */
    liquidityKind?: HeyLiquidityKind;
    volume24hUsd?: number;
    priceUsd?: number;
    buys24h?: number;
    sells24h?: number;
    priceChange1hPct?: number;
    priceChange6hPct?: number;
    priceChange24hPct?: number;
    venue?: string;
    pairAddress?: string;
    observedAt: string;
    source: string;
  };
  /** Present only when HEY actually ran the pipeline. A momentum of zero is "measured, nothing found"; absent is "not measured". */
  score?: {
    buildMomentum?: number;
    discoveryGap?: number;
    stillBuilding: boolean;
    calculatedAt: string;
    /** The algorithm version the figures were produced by. */
    scoringVersion: string;
  };
  /** Events the token contract emitted, as HEY last read them from the chain. Context; never a ranking input. */
  onchainActivity?: {
    /**
     * Absent when HEY could not read the contract's events on any day in the
     * window (2026-09-22). The decoded source does not index every contract,
     * and a day with no indexed events beside real calls is a gap in what HEY
     * can read — not a quiet contract. It used to be reported as `0`, on 147
     * published projects, one of which took 448,951 calls the day it said
     * none. Absent is unknown; a present `0` is a day HEY read and found none.
     */
    events24h?: number;
    events7d?: number;
    /** Days HEY holds a row for. */
    daysCovered: number;
    /** Days HEY could read events from; below `daysCovered` when the decoder is blind. */
    daysMeasured: number;
    truncated: boolean;
    observedAt: string;
    calls24h?: number;
    transactions24h?: number;
    methods?: number;
    eventKinds?: number;
  };
  /** TVL DefiLlama reports for the project's protocol on this chain. Context; never a ranking input. */
  defiTvl?: { tvlUsd: number; protocol: string; protocolName: string; matchedBy: string; source: 'defillama'; observedAt: string };
  /** The tracked token's market state, kept apart from activity. Never a verdict on the team. */
  tokenMarket?: {
    status: string;
    reason?: string;
    evaluatedAt?: string;
    liquidityUsd?: number;
    /** What `liquidityUsd` is, by the same rule as `liquidity.kind` (2026-09-25). */
    liquidityKind?: HeyLiquidityKind;
    volume24hUsd?: number;
    peakLiquidityUsd?: number;
    pairCreatedAt?: string;
  };
  disclaimer: string;
};

/* ------------------------------------------------------------------ market */

/** `GET /api/projects/{slug}/market`: HEY's own daily index of one token. Counts of trades and events, never of accounts. */
export type HeyTokenMarket = {
  slug: string;
  name: string;
  symbol?: string;
  token: { chainId: number; contractAddress: string };
  marketStatus: string;
  /** The reason code behind `marketStatus` (`launch_pool_no_trades`, `no_volume_24h`, …), when HEY recorded one. */
  marketStatusReason?: string;
  verification: string;
  /**
   * The contract's own provenance, read from the chain: who deployed it, in
   * which transaction, and when. `deployerShared` is true when that deployer
   * launched other projects HEY tracks — a launch service, not one team.
   * Absent when HEY holds none of it. A fact about a contract, never a label
   * on a person.
   */
  contract?: { deployer?: string; deployerShared?: boolean; creationTx?: string; createdAt?: string };
  /** The token's pools on the latest day HEY read: how many, their liquidity, and how much can be sold before the price moves 1%, added across them. */
  pools?: { day: string; observedAt: string; pools?: number; liquidityUsd?: number; depthOnePctUsd?: number };
  /**
   * How concentrated the supply is, from HEY's daily snapshot of the token's
   * largest balances. Shares are 0–100; burned and pooled supply are excluded
   * from the top-10 and top-50 shares and reported beside them. A summary
   * only — no address is published. Absent when HEY has not read it. Context,
   * never a score.
   */
  distribution?: {
    day: string;
    observedAt: string;
    holdersTotal?: number;
    top10SharePct?: number;
    top50SharePct?: number;
    burnedSharePct?: number;
    pooledSharePct?: number;
  };
  /**
   * HEY's latest attempt to read the distribution. When it found no balance
   * change in the provider's window, `distribution` (if present) is the last
   * map HEY did read, dated by its own `day`. Absent when HEY has never tried.
   */
  distributionRead?: {
    outcome: HeyDistributionReadOutcome;
    checkedAt: string;
    /** A plain sentence for every outcome but `mapped`. */
    note?: string;
  };
  current?: {
    priceUsd?: number;
    marketCapUsd?: number;
    /** Fully diluted valuation from the same reading; equal to `marketCapUsd` when it stands in for one (2026-09-25). */
    fdvUsd?: number;
    liquidityUsd?: number;
    /** `launch_inventory` when `liquidityUsd` is a launch pool's own supply rather than market depth (2026-09-25). */
    liquidityKind?: HeyLiquidityKind;
    volume24hUsd?: number;
    buys24h?: number;
    sells24h?: number;
    priceChange24hPct?: number;
    venue?: string;
    pairAddress?: string;
    source: string;
    observedAt: string;
  };
  days: {
    day: string;
    priceOpenUsd?: number;
    priceCloseUsd?: number;
    priceHighUsd?: number;
    priceLowUsd?: number;
    liquidityCloseUsd?: number;
    volume24hUsd?: number;
    /** The day's closing valuation; `marketCapCloseKind` says which measure (2026-09-25). */
    marketCapCloseUsd?: number;
    /** `fdv` when the close equals price × total supply, `marketCap` when it is a circulating figure; absent when HEY does not know the supply. */
    marketCapCloseKind?: 'marketCap' | 'fdv';
    source?: string;
    trades?: number;
    buys?: number;
    sells?: number;
    buyVolumeUsd?: number;
    sellVolumeUsd?: number;
    tradeCloseUsd?: number;
    transfers?: number;
    /** Counts of the addresses behind the day's trades, and of the pools traded; absent means unread. Counts, never the addresses. */
    distinctAddresses?: number;
    distinctBuyers?: number;
    distinctSellers?: number;
    poolsTraded?: number;
    tradesSource?: string;
  }[];
  lifecycle: {
    launchSeenAt?: string;
    publishedAt?: string;
    pairCreatedAt?: string;
    launchStage?: string;
    launchStageAt?: string;
    firstTradeDay?: string;
    lastTradeDay?: string;
    peakLiquidityUsd?: number;
    liquidityBelowPeakPct?: number;
    priceChange7dPct?: number;
    priceChange30dPct?: number;
  };
  checks: { key: string; label: string; finding: string; provenance?: string; checkedAt?: string; tone: 'plain' | 'noted' }[];
  /** `callers` is how many distinct addresses called the contract that day, when HEY read it: a count, never the addresses. */
  onchainDays: { day: string; events: number; truncated: boolean; callers?: number }[];
  tvlDays: { day: string; tvlUsd: number; protocolName: string }[];
  url: string;
  disclaimer: string;
};

/** The market summary `/api/projects/{slug}/intelligence` carries. */
export type HeyIntelligenceMarket = {
  status: string;
  verification: string;
  current?: NonNullable<HeyTokenMarket['current']>;
  lifecycle: HeyTokenMarket['lifecycle'];
  checks: HeyTokenMarket['checks'];
  url: string;
};

/* ---------------------------------------------------- one token, by address */

export type HeyTokenLookupProject = {
  slug: string;
  name: string;
  symbol?: string;
  url: string;
  activityStatus: HeyActivityStatus;
  activityLabel: string;
  activityHelp: string;
  /** Absent for a page HEY researched; `INDEXED` for a record it has only indexed. */
  researchLevel?: string;
  shipsLast30Days: number;
  lastShipAt?: string;
  lastShip?: { title: string; publishedAt: string; sourceUrl?: string };
  deployedAt?: string;
  /** Whether the project itself names this contract (2026-09-25). On `MISMATCH` its own site names a different one. */
  tokenVerification: { status: 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH'; reason?: string };
  badgeUrl: string;
};

/** `GET /api/token/{chainId}/{address}`: `status: 'unknown'` is an answer, not an error. */
export type HeyTokenLookup = {
  chainId: number;
  contractAddress: string;
  status: 'published' | 'unknown';
  project?: HeyTokenLookupProject;
  /** Where a reader can ask the chain directly about an address HEY has no page for. */
  scanUrl: string;
  disclaimer: string;
};

/** `GET /api/v1/scan?chain=&token=`: the partner card. `found: false` means print nothing rather than guess. */
export type HeyScanCard =
  | {
      found: false;
      chainId: number;
      contractAddress?: string;
      /** `chain` when the caller asked about a chain HEY does not index. */
      reason?: 'chain';
      message?: string;
      scan_url?: string;
      disclaimer: string;
    }
  | {
      found: true;
      chainId: number;
      contractAddress: string;
      status: Lowercase<HeyActivityStatus>;
      status_label: string;
      status_help: string;
      verified_builder: boolean;
      /** Whether the project itself names this contract (2026-09-25). On `MISMATCH`, do not print the activity as this token's. */
      token_verification: 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH';
      activity: {
        /** Absent when the project has no repository HEY reads — never a zero that reads as "nobody committed". */
        commits_30d?: number;
        /** Present, true, when a commits page was cut inside the window: `commits_30d` is a floor. */
        commits_30d_partial?: true;
        releases_30d: number;
        ships_30d: number;
        last_ship?: string;
        last_ship_title?: string;
      };
      project: { slug: string; name: string; symbol?: string };
      project_url: string;
      logo_url?: string;
      badge_url: string;
      cta: { label: string; url: string };
      disclaimer: string;
    };

/* ----------------------------------------------------------- intelligence */

/**
 * Derived builder intelligence (2026-09-24, rules `intel-v2` since 2026-09-25): read from the
 * same meaningful events as the activity status, never from a price. Every
 * figure is measured or explicitly not — a `state` that says why, and null.
 * Units: counts of meaningful events, days, weeks, hours, USD.
 */
export type HeyDevelopmentIntelligence = {
  rulesVersion: string;
  computedAt: string;
  /** When HEY began watching the project: the floor under every window. */
  observedSince: string;
  /** Meaningful events in the last 30 days against the 30 before; `previous` is null while HEY has watched for under 60 days. */
  velocity: {
    windowDays: number;
    current: number;
    previous: number | null;
    changePct: number | null;
    state: 'ACCELERATING' | 'STABLE' | 'SLOWING' | 'NEW' | 'NO_RECENT_ACTIVITY';
  };
  /** Days between release days over the last 365; needs three release days. */
  cadence:
    | { state: 'INSUFFICIENT_RELEASES'; releases: number; lookbackDays: number; daysSinceLastRelease: number | null }
    | {
        state: 'MEASURED';
        releases: number;
        lookbackDays: number;
        medianIntervalDays: number;
        currentIntervalDays: number | null;
        previousIntervalDays: number | null;
        direction: 'FASTER' | 'STEADY' | 'SLOWER' | null;
        daysSinceLastRelease: number;
      };
  consistency: {
    activeWeeks: number | null;
    windowWeeks: number;
    currentStreakWeeks: number;
    longestStreakWeeks: number;
    daysSinceMeaningfulShip: number | null;
    longestSilenceDays: number | null;
    resumptions: number;
  };
  /** Hours from publication to HEY recording it, over events published while HEY was watching. */
  discoveryLag:
    | { state: 'INSUFFICIENT_SAMPLES'; samples: number; windowDays: number }
    | { state: 'MEASURED'; samples: number; windowDays: number; medianHours: number; maxHours: number };
  /** Market context only, never an input to the figures above; null without a live market reading. */
  marketAttention: 'VERY_LOW' | 'LOW' | 'TYPICAL' | 'ELEVATED' | 'HIGH' | null;
  /** Now against thirty days ago; a side with no reading is null. */
  changes: {
    windowDays: number;
    buildMomentum: { current: number | null; previous: number | null; sameRules: boolean };
    liquidityUsd: { current: number | null; previous: number | null };
    /** Market attention band then and now; the daily series began 2026-09-24, so `previous` is null until it reaches back far enough. */
    marketAttention: { current: 'VERY_LOW' | 'LOW' | 'TYPICAL' | 'ELEVATED' | 'HIGH' | null; previous: 'VERY_LOW' | 'LOW' | 'TYPICAL' | 'ELEVATED' | 'HIGH' | null };
    /** Median days between release days, now and as HEY knew it at the start of the window. */
    cadenceDays: { current: number | null; previous: number | null };
  };
};

/** `GET /api/projects/{slug}/intelligence`: the card, its signals, its Radar standing and the market summary in one answer. */
export type HeyProjectIntelligence = {
  project: HeyProject;
  signals: HeySignal[];
  /** Absent until the project has been scored. */
  /** `onCurrentBoard` false: `rank` is the last standing, not today's (2026-09-25). `rank7d`: a week earlier, recounted among today's board. */
  builderRadar?: HeyBuilderRadarDay & { onCurrentBoard: boolean; rank7d?: number; history: HeyBuilderRadarDay[] };
  /** Absent for a project without a token. */
  market?: HeyIntelligenceMarket;
  /** Absent when HEY could not read the project's record. */
  development?: HeyDevelopmentIntelligence;
  urls: { page: string; detail: string; market?: string };
  disclaimer: string;
};

/* ----------------------------------------------------------------- queries */

/** The activity surfaces the site itself offers, as `tab`. */
export type HeyProjectSurface =
  | 'building-with-token'
  | 'still-building'
  | 'under-the-radar'
  | 'shipping-now'
  | 'most-active'
  | 'new-builders'
  | 'back-from-dormancy'
  | 'utility'
  | 'memes';

export type HeyProjectKind = 'UTILITY' | 'MEME' | 'HYBRID' | 'INFRASTRUCTURE' | 'RWA' | 'APPLICATION' | 'OTHER';

/** Facts a row must carry (`has`); all of them must hold. */
export type HeyCardFact = 'token' | 'x' | 'marketCap' | 'launchpad' | 'liveMarket' | 'verifiedToken' | 'trading' | 'github';

export type HeyLaunchStage = 'curve' | 'graduated' | 'dex';

/** `GET /api/projects`: unknown values are dropped by the API, and the echoed `query` shows what was understood. */
export type HeyProjectsQuery = {
  /** Free text — name, ticker or contract prefix; under two characters is no query. */
  q?: string;
  tab?: HeyProjectSurface;
  kind?: HeyProjectKind;
  status?: HeyActivityStatus;
  /** A narrative slug, e.g. `ai-agents`. */
  narrative?: string;
  /** A launchpad key, e.g. `pons`, `virtuals`, `hoodfun`, `clanker`, `pairfund`. */
  launchpad?: string;
  has?: HeyCardFact[];
  stage?: HeyLaunchStage;
  /** Dollar figures on the card's own reading; unknown is excluded, never read as zero. */
  minLiquidity?: number;
  maxMarketCap?: number;
  minMarketCap?: number;
  /** Default `activity` — most recently shipped first. A market order is context the caller asked for. */
  sort?: 'activity' | 'marketCap' | 'newest' | 'liquidity' | 'volume24h';
  /** 1–48; default 24. */
  limit?: number;
  offset?: number;
};

/** `GET /api/ships`: a record of ships, not of projects. */
export type HeyShipsQuery = {
  /** Restrict to one project, by slug. */
  project?: string;
  /** ISO 8601 instant. Only ships at or after it — the window you are reporting on. */
  since?: string;
  /** ISO 8601 instant. Only ships HEY observed at or after it — the watermark to mirror along. */
  detectedSince?: string;
  /** One event type, e.g. `GITHUB_RELEASE`, `PRODUCT_LAUNCH`. */
  type?: string;
  /** The shipping project's name, ticker or contract prefix. */
  q?: string;
  has?: HeyCardFact[];
  /** Default `latest`; `detected` is the order to page along when mirroring. */
  sort?: 'latest' | 'marketCap' | 'activity' | 'detected';
  /** 1–48; default 24. */
  limit?: number;
  offset?: number;
};
