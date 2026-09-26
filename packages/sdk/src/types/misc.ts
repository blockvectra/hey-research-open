/**
 * The shapes the public API returns (2026-09-19): the Builder Radar, weekly
 * reports, bounties, platform status, answers and comparisons. The rules
 * every shape follows are stated in `projects.ts`: each is held equal to its
 * serialiser by `public-api-contract.*.test.ts`, and absent means HEY does not
 * know.
 */

import type { HeyActivityStatus, HeyLiquidityKind } from './projects';

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

/* ------------------------------------------------------------------ status */

export type HeyStatusLevel = 'ok' | 'waiting' | 'warn' | 'critical' | 'unknown';

export type HeyStatusSource = {
  id: string;
  label: string;
  /** `factories` rolls the per-factory rows into one line. */
  group: 'launchpads' | 'listings' | 'market' | 'factories';
  /** `retired`: HEY stopped reading the source on purpose. */
  state: 'fresh' | 'degraded' | 'stale' | 'never' | 'retired';
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

/* -------------------------------------------------------------------- ask */

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

/* ---------------------------------------------------------------- compare */

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
    /** `fdv` when the figure is the fully diluted valuation standing in for a market cap. */
    valuationKind?: 'marketCap' | 'fdv';
    /** The liquidity the project page prints: the current reading's, else the token's last recorded depth (2026-09-25). */
    liquidityUsd?: number;
    /** `launch_inventory` when `liquidityUsd` is a launch pool's own supply (2026-09-25). */
    liquidityKind?: HeyLiquidityKind;
    /** `current` is null with state `NOT_MEASURED` when HEY has not measured the project's building (2026-09-26). */
    velocity?: { state: string; current: number | null; previous: number | null };
    cadence?: { state: string; medianIntervalDays?: number };
    consistency?: { activeWeeks: number | null; windowWeeks: number };
    marketAttention?: string;
  }[];
  missing: string[];
  /** Slugs in the request that were malformed or past the fourth, and so were not compared (2026-09-26). */
  ignoredSlugs: string[];
  method: string;
  disclaimer: string;
};

/* ------------------------------------------------------- partner: builder */

/**
 * `GET /api/v1/builder?chain=&token=` (2026-09-20; typed 2026-09-26): the
 * RHTools card, in the partner's snake_case. Explicit `null` is part of this
 * contract (unlike the rest of the API, where absent means unknown); a
 * contract HEY has not published answers 404, and another chain 400.
 */
export type HeyBuilderCard = {
  contract_address: string;
  chain_id: number;
  /** ISO 8601, or null when HEY holds no meaningful activity for the project yet. */
  last_activity_at: string | null;
  /** Four values, never `abandoned`: HEY cannot see that a team stopped. */
  status: 'active' | 'stale' | 'dormant' | 'unknown';
  hey_status: HeyActivityStatus;
  hey_status_label: string;
  hey_status_help: string;
  hey_project_name: string;
  token_verification: 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH';
  hey_project_url: string;
  /** Only a repository HEY counts as the project's own evidence. */
  repo_url: string | null;
  /** HEY never stores a commit, so this is always null; `last_code_activity` carries what HEY holds. */
  last_commit: null;
  last_code_activity: {
    summary: string;
    /** Human commits the newest weekly summary recorded; a floor when `commits_partial`. */
    commits: number | null;
    commits_partial: boolean;
    /** Commits in the thirty days before `as_of`, counted like the partner card's `commits_30d`; absent when unknown. */
    commits_30d?: number;
    commits_30d_partial?: true;
    window_start?: string;
    active_days: number | null;
    contributors: number | null;
    repo_url: string | null;
    observed_at: string;
  } | null;
  latest_release: { title: string; url: string | null; timestamp: string; version: string | null } | null;
  latest_deployment: { title: string; url: string | null; timestamp: string; environment: string } | null;
  /** `INDEXED`, `RESEARCHED` or `VERIFIED_BUILDER`; always sent (2026-09-26). */
  research_level: string;
  /** False means `unknown` is not a finding: HEY holds no source it can read building from (2026-09-26). */
  activity_measured: boolean;
  /** When the project was last scored; null when never. */
  as_of: string | null;
  disclaimer: string;
};

/* ------------------------------------------------------------ search */

/** One type-ahead row: a published project, or a launch record typed as one (never presented as a project). */
export type HeySearchSuggestion =
  | { type: 'project'; name: string; symbol?: string; contract?: string; target: string }
  | { type: 'launch'; name: string; symbol?: string; contract: string; launchedVia: string; target: string };

/** `GET /api/search/suggest?q=`: at most eight rows, HEY's own tables only. */
export type HeySearchSuggestions = { q: string; suggestions: HeySearchSuggestion[] };
