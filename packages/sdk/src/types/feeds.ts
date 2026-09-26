/**
 * The shapes the public API returns (2026-09-19): the chain, signals, the
 * weekly rollup, contract changes, the command centre and one project's
 * timeline. The rules every shape follows are stated in `projects.ts`: each is
 * held equal to its serialiser by `public-api-contract.*.test.ts`, and absent
 * means HEY does not know.
 */

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

/* --------------------------------------------------------------- this week */

export type HeyThisWeekProject = {
  slug: string;
  name: string;
  symbol?: string;
  activityStatus: string;
  /** Market context only, and only when HEY has a fresh reading of a live market. `valuationKind` says which measure it is (2026-09-25). */
  marketCapUsd?: number;
  /** `fdv` where the fully diluted valuation stands in for a market cap; the site prints it as "Valuation". */
  valuationKind?: 'marketCap' | 'fdv';
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

/* ----------------------------------------------------------------- queries */

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

/* ------------------------------------------------------- contract changes */

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
    /** `fdv` when both closes are price × total supply: a fully diluted valuation, not a market cap (2026-09-25). */
    valuationKind?: 'marketCap' | 'fdv';
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
  /** `marketCapKind` is `fdv` when the valuation is price × total supply (2026-09-25); no valuation for a market HEY records as gone. */
  marketAround?: {
    before?: { day: string; marketCapUsd?: number; marketCapKind?: 'marketCap' | 'fdv'; priceUsd?: number };
    after?: { day: string; marketCapUsd?: number; marketCapKind?: 'marketCap' | 'fdv'; priceUsd?: number };
  };
};

export type HeyTimeline = { project: { slug: string; name: string; url: string }; lens: string; items: HeyTimelineEntry[]; disclaimer: string };
