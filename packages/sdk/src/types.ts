/**
 * The shapes the public API returns (2026-09-19).
 *
 * Each `Hey*` type here is a copy of the serialiser type in `apps/web` that
 * produces the route body — `ApiProject`, `ApiShip`, `ApiSignalsPage` and so
 * on — and `apps/web/src/lib/public-api-contract.test.ts` asserts the two are
 * identical in both directions at typecheck time. A field the API starts
 * sending and this file does not name fails the gate; so does a field named
 * here that the API does not send. The SDK cannot import from the web app
 * (it is published on its own), which is why the shapes are spelled twice
 * and held together by a test rather than by an import.
 *
 * The one rule every shape follows: **absent means HEY does not know.** A
 * missing market cap is not zero, a project with no `score` has not been
 * measured, and no field is `null` unless the API itself sends `null`
 * (`HeyStatus` does, because "never captured" is a fact about the platform).
 */

/* ------------------------------------------------------------------ enums */

/** What HEY claims about a project's activity. */
export type HeyActivityStatus = 'SHIPPING' | 'ACTIVE' | 'QUIET' | 'DORMANT' | 'RESUMED' | 'UNKNOWN';

/* ---------------------------------------------------------------- projects */

/** Canonical token identity: `(chainId, contractAddress)`, never a ticker alone. */
export type HeyToken = { chainId: number; contractAddress: string };

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
  tokenLock?: { supplyPct?: number; until?: string; pairLocked: boolean };
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
  marketCap?: { usd: number; source: string; observedAt?: string };
  /** The same reading's liquidity and 24 h volume. Absent means that source reports no such figure — never zero. */
  liquidity?: { usd: number; source?: string; observedAt?: string };
  volume24h?: { usd: number; source?: string; observedAt?: string };
  /** Where the launch stands: on its curve, graduated, or trading in a DEX pool. */
  launchStage?: 'CURVE' | 'GRADUATED' | 'DEX';
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
  /** Whether the project itself ties the tracked contract to the project. */
  tokenVerification?: { status: 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH'; reason?: string; verifiedAt?: string };
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
  verification: string;
  current?: {
    priceUsd?: number;
    marketCapUsd?: number;
    liquidityUsd?: number;
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
    marketCapCloseUsd?: number;
    source?: string;
    trades?: number;
    buys?: number;
    sells?: number;
    buyVolumeUsd?: number;
    sellVolumeUsd?: number;
    tradeCloseUsd?: number;
    transfers?: number;
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
  onchainDays: { day: string; events: number; truncated: boolean }[];
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

/* ------------------------------------------------------------------- chain */

export type HeyChainDay = {
  day: string;
  dexTrades?: number;
  dexVolumeUsd?: number;
  tokensTraded?: number;
  poolsTraded?: number;
  transactions?: number;
  transfers?: number;
  launches?: number;
  projectsPublished?: number;
  ships?: number;
  buildersShipping?: number;
  chainObservedAt?: string;
};

/** `GET /api/chain`: Robinhood Chain day by day, aggregates only. */
export type HeyChain = { chainId: number; days: HeyChainDay[]; today?: string; lastFullDay?: string; volumeNote: string; disclaimer: string };

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

/* ----------------------------------------------------------------- signals */

/** `GET /api/signals`: a measured change about a published project. Counts only, never accounts; never a verdict. */
export type HeySignal = {
  id: string;
  kind: string;
  group: string;
  label: string;
  meaning: string;
  severity: string;
  confidence: number;
  importance: number;
  observedAt: string;
  title: string;
  summary: string;
  before?: number;
  after?: number;
  changePct?: number;
  unit?: string;
  evidence: { label: string; url?: string; value?: string }[];
  source: string;
  project: { slug: string; name: string; symbol?: string; activityStatus: string; url: string };
  url: string;
};

export type HeySignalPage = {
  query: Record<string, string | number>;
  total: number;
  items: HeySignal[];
  disclaimer: string;
};

export type HeySignalDetail = HeySignal & { disclaimer: string };

/* ---------------------------------------------------------------- builders */

/** `GET /api/builders`: one row of the Builder Radar. Ranked by verified building, never by price. */
export type HeyBuilder = {
  rank: number;
  rank7d?: number;
  rank30d?: number;
  slug: string;
  name: string;
  symbol?: string;
  /** The artwork the project chose; absent where HEY does not know it. */
  logoUrl?: string;
  activityStatus: string;
  catalogStatus: string;
  launchpad?: string;
  firstSeenAt: string;
  lastShippedAt?: string;
  scores: { overall: number; development: number; onchain: number; research: number };
  liquidityHealth?: number;
  inputs: Record<string, unknown>;
  url: string;
};

export type HeyBuildersPage = {
  day: string;
  ranked: number;
  total: number;
  /** Echoed so a dropped filter can be seen rather than inferred. */
  query: Record<string, unknown>;
  method: string;
  items: HeyBuilder[];
  disclaimer: string;
};

/** One day of a project's Builder Radar standing. */
export type HeyBuilderRadarDay = { day: string; rank: number; overall: number; development: number; onchain: number; research: number };

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
  builderRadar?: HeyBuilderRadarDay & { history: HeyBuilderRadarDay[] };
  /** Absent for a project without a token. */
  market?: HeyIntelligenceMarket;
  /** Absent when HEY could not read the project's record. */
  development?: HeyDevelopmentIntelligence;
  urls: { page: string; detail: string; market?: string };
  disclaimer: string;
};

/* ----------------------------------------------------------------- reports */

/** `GET /api/reports/weekly`: the archive index; `url` is the JSON report, `page` the one people read. */
export type HeyWeeklyIndex = {
  items: {
    week: string;
    window: { start: string; end: string };
    final: boolean;
    headline: string;
    generatedAt: string;
    url: string;
    page: string;
  }[];
  disclaimer: string;
};

/** `GET /api/reports/weekly/{week}`: one archived week, kept as it was published. */
export type HeyWeeklyReport = {
  week: string;
  window: { start: string; end: string };
  final: boolean;
  generatedAt: string;
  headline: string;
  overview: { published: number; verifiedBuilders: number; ships: number; projectsShipping: number; newBuilders: number; backToShipping: number; stillBuilding: number; underTheRadar: number };
  chain: { days: number; dexTrades?: number; dexVolumeUsd?: number; tokensTraded?: number; launches?: number; projectsPublished?: number };
  shipped: { slug: string; name: string; ships: number; latest: string; latestAt: string }[];
  newBuilders: { slug: string; name: string; verifiedAt: string }[];
  backToShipping: { slug: string; name: string; from: string; to: string }[];
  stillBuilding: { slug: string; name: string }[];
  underTheRadar: { slug: string; name: string }[];
  topBuilders: { slug: string; name: string; rank: number; overall: number; development: number; onchain: number; research: number }[];
  movers: { slug: string; name: string; rank: number; rank7d: number; gained: number }[];
  signals: { id: string; kind: string; label: string; title: string; slug: string; name: string; observedAt: string; importance: number }[];
  signalCounts: { kind: string; group: string; count: number }[];
  /** The report rule this payload was built under; absent on reports older than v2. */
  version?: number;
  url: string;
  disclaimer: string;
};

/* ---------------------------------------------------------------- bounties */

/** A research bounty as `/api/bounties` lists it. Read-only: claiming is a wallet sign-in on the site. */
export type HeyBounty = {
  id: string;
  url: string;
  title: string;
  description: string;
  kind: string;
  scope: string;
  /** What a submission must show. */
  evidence: string;
  status: string;
  taskStatus: string;
  project?: { slug: string; name: string; url: string };
  reward: {
    /** Whole HEY, as text (base units divided by 1e18, rounded down). */
    hey: string;
    heyBaseUnits: string;
    tier?: string;
    targetUsd?: string;
    /** The HEY price the amount was quoted at, and where; the amount is fixed from then. */
    quote?: { priceUsd: string; at: string; source: string };
  };
  claim: {
    /** Only wallets on a HEY tier may claim before this instant; after it, anyone with a wallet sign-in. */
    holdersOnlyUntil?: string;
    openToAll: boolean;
    /** True once a Scout holds the task (claimed or submitted, awaiting review). */
    claimed: boolean;
    claimedBy?: string;
    expiresAt?: string;
  };
  createdAt: string;
  awardedAt?: string;
};

/** The claim rules, in words, so an assistant describes a bounty the way the page does. */
export type HeyBountyRules = { read: string; claim: string; review: string; reward: string };

/** `GET /api/bounties`: `open: false` when the research economy is closed, and then the list is empty by type. */
export type HeyBountyPage =
  | { open: false; items: []; rules: HeyBountyRules; disclaimer: string }
  | {
      open: true;
      query: { status: string; limit: number };
      summary: { openBounties: number; committedHey: string; paidHey: string };
      items: HeyBounty[];
      rules: HeyBountyRules;
      disclaimer: string;
    };

/** `GET /api/bounties/{id}`: one bounty, the same shape as a list row. */
export type HeyBountyDetail = { item: HeyBounty; rules: HeyBountyRules; disclaimer: string };

/* --------------------------------------------------------------- this week */

export type HeyThisWeekProject = {
  slug: string;
  name: string;
  symbol?: string;
  activityStatus: string;
  /** Market context only, and only when HEY has a fresh reading. */
  marketCapUsd?: number;
  url: string;
};

export type HeyThisWeekShip = {
  title: string;
  eventType: string;
  publishedAt: string;
  /** How the claim is backed — self-reported and verified never look alike. */
  verification: string;
  sourceUrl?: string;
};

/** `GET /api/this-week`: the weekly rollup, each figure with the window it was counted over. */
export type HeyThisWeek = {
  window: { since: string; until: string; days: number; label: string };
  summary: string;
  shipped: {
    ships: number;
    projects: number;
    items: { project: HeyThisWeekProject; ships: number; latest: HeyThisWeekShip }[];
  };
  newBuilders: { total: number; items: { project: HeyThisWeekProject; verifiedAt: string }[] };
  backToShipping: {
    total: number;
    comparable: number;
    items: { project: HeyThisWeekProject; from: string; to: string; changedAt: string }[];
  };
  stillBuilding: { total: number; items: HeyThisWeekProject[] };
  underTheRadar: { total: number; items: HeyThisWeekProject[] };
  /** Where each section continues, so a reader of the JSON can follow it. */
  links: { page: string; ships: string; radar: string; methodology: string };
  /** One sentence that travels with the numbers wherever they are pasted. */
  disclaimer: string;
};

/* ------------------------------------------------------------------ status */

export type HeyStatusLevel = 'ok' | 'waiting' | 'warn' | 'critical' | 'unknown';

export type HeyStatusSource = {
  id: string;
  label: string;
  /** `factories` rolls the per-factory rows into one line. */
  group: 'launchpads' | 'listings' | 'market' | 'factories';
  /** `retired`: HEY stopped reading the source on purpose. */
  state: 'fresh' | 'stale' | 'never' | 'retired';
  lastSuccessAt: string | null;
  lastAttemptAt?: string | null;
  /** A provider's status word — never a URL or a key. */
  reason?: string;
  /** Factories only: how many rows the line stands for. */
  count?: number;
};

export type HeyStatusSlo = {
  id: string;
  label: string;
  level: HeyStatusLevel;
  detail: string;
  waitingUntil?: string;
};

/**
 * `GET /api/status`: the public status page as JSON. This is the one shape
 * that sends `null`, because "never captured" is a fact about the platform
 * and not a gap in HEY's knowledge of a project.
 */
export type HeyStatus = {
  generatedAt: string;
  /** When the platform last summarised itself; null when it never has. */
  capturedAt: string | null;
  verdict: HeyStatusLevel;
  headline: string;
  build: string | null;
  worker: { heartbeatAgeSeconds: number | null; fresh: boolean };
  catalog: { published: number; verifiedBuilders: number; indexed: number };
  jobs: { pending: number; failed24h: number | null };
  /** Published tokens with a reading under a day, of those with a known pair. */
  market: { fresh: number; cohort: number } | null;
  integrity: { verdict: 'ok' | 'warn' | 'fail' | 'unknown'; ranAt: string | null };
  /** Keyed API calls this month, across every account; calls without a key are not counted. */
  api: { month: string; requests: number; accounts: number; previousMonth: { month: string; requests: number; accounts: number } } | null;
  sources: HeyStatusSource[];
  slos: HeyStatusSlo[];
  healedLastHour: number;
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

export type HeySignalGroup = 'development' | 'contract' | 'market' | 'launch' | 'research';

/** `GET /api/signals`: the unfiltered feed leaves out `project_published`; pass `include: 'published'` to see them. */
export type HeySignalsQuery = {
  group?: HeySignalGroup;
  /** One signal kind, e.g. `development_spike`, `liquidity_drop`, `release_published`. */
  kind?: string;
  slug?: string;
  /** Window in days, 1–365; default 30. */
  days?: number;
  order?: 'newest' | 'importance';
  include?: 'published';
  /** 1–100; default 30. */
  limit?: number;
  offset?: number;
};

export type HeyBuilderFilter =
  | 'all'
  | 'pons'
  | 'virtuals'
  | 'other-launch'
  | 'no-token'
  | 'new'
  | 'established'
  | 'most-improved'
  | 'development'
  | 'onchain'
  | 'resumed';

/** `GET /api/builders`. */
export type HeyBuildersQuery = {
  filter?: HeyBuilderFilter;
  /** Find a builder by name or symbol. */
  q?: string;
  /** 1–200; default 25. */
  limit?: number;
  offset?: number;
};

/** `GET /api/bounties`: default is open and awarded. */
export type HeyBountiesQuery = {
  status?: 'open' | 'awarded' | 'all';
  /** 1–50; default 50. */
  limit?: number;
};

/* ------------------------------------------------------ ask and contracts */

/** `GET /api/projects/{slug}/ask?q=` and `GET /api/chain/contract-changes` (2026-09-24). */
export type HeyAskLine = { tag: 'FACT' | 'DERIVED' | 'UNKNOWN'; text: string; source?: string };
export type HeyAskAnswer = {
  project: { slug: string; name: string; url: string };
  question: string;
  /** Present when the question asked for something HEY does not give (a price call, a buy or sell). */
  notice?: HeyAskLine;
  /** True when HEY could not tell what the question is about and answered with what changed and what it does not know. */
  fallback: boolean;
  sections: { question: string; lines: HeyAskLine[] }[];
  disclaimer: string;
};

export type HeyContractChange =
  | {
      kind: 'CONTRACT_UPGRADE' | 'CONTRACT_DEPLOY_FOLLOWUP';
      project: { slug: string; name: string };
      count: number;
      latest: { title: string; publishedAt: string; source?: string };
    }
  | {
      kind: 'VERIFIED' | 'UNVERIFIED' | 'INTERFACE_CHANGED';
      project: { slug: string; name: string };
      address: string;
      functionsAdded: string[];
      functionsRemoved: string[];
      eventsAdded: string[];
      eventsRemoved: string[];
      detectedAt: string;
      source: string;
    };
export type HeyContractChanges = { days: number; items: HeyContractChange[]; disclaimer: string };


/* ------------------------------------------------------- command centre */

/** The Terminal command centre over the API (2026-09-24). */
export type HeyCentreProject = { slug: string; name: string; symbol?: string; activityStatus: string; lastShipAt?: string; url: string };

export type HeySilentBuilders = {
  items: (HeyCentreProject & { meaningfulShips30d: number; marketAttention?: 'VERY_LOW' | 'LOW' | 'TYPICAL' | 'ELEVATED' | 'HIGH' })[];
  method: string;
  disclaimer: string;
};

export type HeyAccelerating = {
  items: (HeyCentreProject & { velocity: { windowDays: number; current: number; previous: number | null; changePct: number | null } })[];
  method: string;
  disclaimer: string;
};

/**
 * Market Integrity (2026-09-25): what happened to a project's tracked token
 * market, beside its builder activity, and where the two disagree. Published
 * only once HEY's exposure flag reaches the public API; until then the route
 * answers 404. `exitPattern` appears only where HEY names one.
 */
export type HeyMarketIntegrity = {
  slug: string;
  url: string;
  builderActivity: { status: string | null; lastMeaningfulShipAt: string | null };
  note: string;
  marketIntegrity: {
    rulesVersion: string;
    evaluatedAt: string;
    state: string;
    marketActive: boolean;
    established: boolean;
    collapse: 'NONE' | 'DECLINE' | 'COLLAPSE' | 'SEVERE';
    liquidityPeakUsd: number | null;
    liquidityPeakDay: string | null;
    liquidityNowUsd: number | null;
    liquidityNowDay: string | null;
    liquidityChangePct: number | null;
    deteriorationStartDay: string | null;
    collapseDay: string | null;
    lastTradeDay: string | null;
    migrationDetected: boolean;
    migration: { kind: string; confidence: string; windowStart: string; windowEnd: string } | null;
    lockState: string;
    sourcesDisagree: boolean;
    exitPattern?: { level: string; reasons: string[] };
  } | null;
  conflicts: { type: string; text: string }[];
  events: { kind: string; label: string; at: string; precision: 'exact' | 'day' | 'window'; until: string | null; detectedAt: string; confidence: string }[];
};

export type HeyMarketMoves = {
  project: { slug: string; name: string; url: string };
  threshold: { minChangePct: number; lookbackDays: number; windowDays: number };
  daysRead: number;
  items: {
    day: string;
    previousDay: string;
    changePct: number;
    marketCapUsd: number;
    previousMarketCapUsd: number;
    eventsBefore: { title: string; eventType: string; publishedAt: string; verification: string; source?: string }[];
  }[];
  method: string;
  disclaimer: string;
};

export type HeyComebacks = { items: HeyCentreProject[]; method: string; disclaimer: string };

export type HeyUnlocks = {
  days: number;
  items: {
    project: HeyCentreProject;
    lockId: number;
    unlockAt: string;
    assetKind: 'TOKEN' | 'LP';
    lockedTokens?: number;
    shareOfSupplyPct?: number;
    proof: string;
    precision: 'SCHEDULED';
  }[];
  disclaimer: string;
};

export type HeyBuildMarket = { items: (HeyCentreProject & { buildMomentum: number; marketAttentionPercentile: number })[]; method: string; disclaimer: string };

export type HeyTimelineEntry = {
  id: string;
  kind: string;
  at: string;
  precision: 'EXACT' | 'DATE' | 'WEEK' | 'OBSERVED' | 'SCHEDULED';
  title: string;
  summary?: string;
  recordedAt?: string;
  discoveryLagHours?: number;
  eventType?: string;
  verification?: string;
  countsAsBuilding: boolean;
  source?: string;
  marketAround?: { before?: { day: string; marketCapUsd?: number; priceUsd?: number }; after?: { day: string; marketCapUsd?: number; priceUsd?: number } };
};

export type HeyTimeline = { project: { slug: string; name: string; url: string }; lens: string; items: HeyTimelineEntry[]; disclaimer: string };

export type HeyCompare = {
  projects: {
    slug: string;
    name: string;
    url: string;
    activityStatus: string;
    lastMeaningfulShipAt?: string;
    buildMomentum?: number;
    verifiedBuilder: boolean;
    sources: { verified: number; total: number };
    tokenMarketStatus?: string;
    marketCapUsd?: number;
    liquidityUsd?: number;
    velocity?: { state: string; current: number; previous: number | null };
    cadence?: { state: string; medianIntervalDays?: number };
    consistency?: { activeWeeks: number | null; windowWeeks: number };
    marketAttention?: string;
  }[];
  missing: string[];
  method: string;
  disclaimer: string;
};
