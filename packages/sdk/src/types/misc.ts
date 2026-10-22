/**
 * The shapes the public API returns (2026-09-19): the Builder Radar, weekly
 * reports, bounties, platform status, answers and comparisons. The rules
 * every shape follows are stated in `projects.ts`: each is held equal to its
 * serialiser by `public-api-contract.*.test.ts`, and absent means HEY does not
 * know.
 */

import type { HeyChangePrecision, HeyChangeType } from './changes';
import type { HeyChangeActivityState, HeyChangeReporter, HeyChangeStage } from './snapshot';
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
  /** `true` on `$HEY`, HEY's own token, researched by the same rules (2026-09-30, additive): the rank is the board's, unchanged. */
  heysOwnToken?: true;
  /** The artwork the project chose; absent where HEY does not know it. */
  logoUrl?: string;
  activityStatus: string;
  catalogStatus: string;
  launchpad?: string;
  firstSeenAt: string;
  lastShippedAt?: string;
  /** `scores.onchain` is the sub-score as ranked — 0 when nothing was measured, so `overall` adds up. */
  scores: { overall: number; development: number; onchain: number; research: number };
  /**
   * The on-chain figure to read (additive, 2026-09-28): the sub-score where HEY
   * measured use, null where it measured nothing — `onchainUseReason` says
   * whether there is no contract or no readable day. Never a 0 for "unknown".
   */
  onchainUse: number | null;
  onchainUseReason?: 'no_contract' | 'not_measured';
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

/**
 * The rule a report's "verified ships" were counted under (2026-10-02,
 * additive). `basis` is `stored` when the report wrote it down and
 * `generated_at` when it is placed by the report's generation time; compare
 * two weeks' ships only where `id` matches.
 */
export type HeyWeeklyShipRule = { id: string; counts: string; inForceFrom: string; basis: 'stored' | 'generated_at'; current: boolean };

/** `GET /api/reports/weekly`: the archive index; `url` is the JSON report, `page` the one people read. */
export type HeyWeeklyIndex = {
  items: {
    week: string;
    window: { start: string; end: string };
    final: boolean;
    headline: string;
    generatedAt: string;
    shipsRule: HeyWeeklyShipRule;
    url: string;
    page: string;
    /** The same stored payload as CSV, one row per fact (2026-10-14, additive). */
    csv: string;
  }[];
  disclaimer: string;
};

/** A project named in a report block: the name of a published page. */
export type HeyWeeklyNamed = { slug: string; name: string };

/**
 * A project HEY read as quiet or dormant inside the week (2026-10-14, report
 * v5, additive): "HEY read no meaningful activity for N weeks" — never
 * "abandoned". `weeksWithoutActivity` is null when HEY holds no dated ship
 * before the move.
 */
export type HeyWeeklyWentQuiet = HeyWeeklyNamed & { from: HeyActivityStatus; to: 'QUIET' | 'DORMANT'; changedAt: string; weeksWithoutActivity: number | null };

/**
 * One narrative's or launchpad's week (2026-10-14, report v5, additive):
 * counts, and the published names behind the smaller ones. Ordered by name,
 * never by a count, and never by volume or price.
 */
export type HeyWeeklyGroupBlock = {
  key: string;
  name: string;
  ships: number;
  projectsShipping: number;
  newBuilders: HeyWeeklyNamed[];
  backToShipping: HeyWeeklyNamed[];
  wentQuiet: HeyWeeklyNamed[];
};

/** `GET /api/reports/weekly/{week}`: one archived week, kept as it was published. */
export type HeyWeeklyReport = {
  week: string;
  window: { start: string; end: string };
  final: boolean;
  generatedAt: string;
  headline: string;
  overview: {
    published: number;
    /** Verified Builders on any chain (the catalogue's count), labelled as such on every surface. */
    verifiedBuilders: number;
    /** Verified Builders with Robinhood Chain evidence (2026-10-14, report v5, additive): the count a headline leads with. Absent on older reports. */
    verifiedBuildersChainEvidence?: number;
    ships: number;
    projectsShipping: number;
    newBuilders: number;
    backToShipping: number;
    stillBuilding: number;
    underTheRadar: number;
  };
  chain: { days: number; dexTrades?: number; dexVolumeUsd?: number; /** Days withheld as implausible (2026-10-09, additive); `dexVolumeUsd` is then absent. */ dexVolumeWithheldDays?: number; /** The busiest day's count of distinct tokens traded, never a weekly total. */ tokensTraded?: number; /** What `tokensTraded` is (2026-10-22, additive): `busiest_day`. */ tokensTradedBasis?: 'busiest_day'; /** The UTC day `tokensTraded` was read on (2026-10-22, additive; absent on older reports). */ tokensTradedDay?: string; launches?: number; projectsPublished?: number };
  shipped: { slug: string; name: string; ships: number; latest: string; latestAt: string }[];
  newBuilders: { slug: string; name: string; verifiedAt: string }[];
  backToShipping: { slug: string; name: string; from: string; to: string }[];
  stillBuilding: { slug: string; name: string }[];
  underTheRadar: { slug: string; name: string }[];
  topBuilders: { slug: string; name: string; rank: number; overall: number; development: number; onchain: number; research: number }[];
  movers: { slug: string; name: string; rank: number; rank7d: number; gained: number }[];
  /** The Builder Radar board `topBuilders` and `movers` were read from: its day and the rules it was ranked under (2026-10-16, additive; absent on older reports). */
  radarBoard?: { day: string; scoringVersion?: string };
  signals: { id: string; kind: string; label: string; title: string; slug: string; name: string; observedAt: string; importance: number }[];
  signalCounts: { kind: string; group: string; count: number }[];
  /** The report rule this payload was built under; absent on reports older than v2. */
  version?: number;
  /** The ship rule the report stored when it was written (2026-10-02); absent on older reports. */
  shipsRuleId?: string;
  /** The rule `overview.ships` was counted under (2026-10-02, additive). */
  shipsRule: HeyWeeklyShipRule;
  /** Present only when that rule is not today's: the same window recounted under today's rule from today's records — never the week as published. */
  shipsUnderCurrentRule?: { ruleId: string; ships: number; projectsShipping: number; countedAt: string };
  /** State of Robinhood Chain v4 hooks (2026-10-11, additive; report v4): counts only. Absent on reports written before it. */
  uniswapV4Hooks?: HeyWeeklyV4Hooks;
  /** Projects HEY read as quiet or dormant inside the week (2026-10-14, report v5, additive). Absent on older reports. */
  wentQuiet?: { total: number; items: HeyWeeklyWentQuiet[] };
  /** The week cut by primary narrative (2026-10-14, report v5, additive): by name, never a league table. Absent on older reports. */
  narratives?: HeyWeeklyGroupBlock[];
  /** Projects in the week's sections with no primary narrative, counted rather than dropped. */
  narrativesUnassigned?: number;
  /** The week cut by launchpad (2026-10-14, report v5, additive): by name, never by volume. Absent on older reports. */
  launchpads?: HeyWeeklyGroupBlock[];
  /** Projects in the week's sections HEY holds no launch record for. */
  launchpadsUnassigned?: number;
  url: string;
  /** The same stored payload as CSV, one row per fact (2026-10-14, additive). */
  csv: string;
  disclaimer: string;
};

/** One listed hook first decoded inside the report's week: a contract, its project and its `v4hook:` receipt. */
export type HeyWeeklyV4HookItem = {
  address: string;
  evidenceId: string;
  basis: 'chain' | 'project' | 'linked' | 'review';
  basisLabel: string;
  slug: string;
  name: string;
  firstDecodedAt: string;
  deployedAt: string | null;
};

/**
 * The weekly report's v4 hook block (2026-10-11). Every total is as of `asOf`
 * (the report's generation); "this week" counts are first decoded inside
 * `window`. Null — never 0 — is unknown: before HEY decodes any hook every
 * hook count is null and `notMeasured` says why. Launch protocols are counted,
 * never named. Contract context only: no account, no market figure, no ranking.
 */
export type HeyWeeklyV4Hooks = {
  chainId: number;
  asOf: string;
  window: { start: string; end: string };
  notMeasured?: { reason: 'no_hook_decoded'; detail: string };
  seen: { total: number | null; newThisWeek: number | null; lastDecodedAt: string | null; method: string };
  onTrackedTokens: { hooks: number | null; method: string };
  listed: {
    hooks: number | null;
    projects: number | null;
    byBasis: {
      chain: { hooks: number; projects: number };
      project: { hooks: number; projects: number };
      linked: { hooks: number; projects: number };
      factory: { hooks: number; projects: number };
      review: { hooks: number; projects: number };
    } | null;
    method: string;
  };
  newListed: { hooks: number | null; factoryInstances: number | null; shown: number; items: HeyWeeklyV4HookItem[]; method: string };
  creationRead: { read: number | null; notReadYet: number | null; unavailable: number | null; lastCheckedAt: string | null; method: string };
  factories: { seen: number | null; tiedToPublishedProjects: number | null; projects: number | null; method: string };
  hooklist: { read: boolean; entries: number | null; seenByHey: number | null; attributed: number | null; readAt: string | null; reason?: 'hooklist_not_read'; method: string };
  launchProtocols: {
    hooks: number | null;
    shareOfSeen: number | null;
    protocols: number | null;
    largestShareOfSeen: number | null;
    launchInfrastructure: number | null;
    method: string;
  };
  limits: string[];
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
  /** The build serving the answer (its `HEY_BUILD_SHA`, as `/api/health` reports it), since 2026-10-02; before, the summary's. */
  build: string | null;
  /** The build that wrote the summary `capturedAt` dates (additive, 2026-10-02); null without one. */
  summaryBuild: string | null;
  worker: { heartbeatAgeSeconds: number | null; fresh: boolean };
  /**
   * `verifiedBuilders` is the badge on every chain; `verifiedBuildersOnChain` its Robinhood Chain part and `asOf` when counted (2026-10-02, additive).
   * `indexed` is the hidden launch records (approved rows HEY has not published), as /status has always labelled it — not the
   * catalogue's "indexed" (every approved row). `hidden` carries the same figure under the catalogue's word and `hiddenAsOf`
   * dates it: the hourly summary's capture time, not `asOf` (both additive, 2026-10-03).
   */
  catalog: {
    published: number;
    verifiedBuilders: number;
    indexed: number;
    hidden?: number;
    hiddenAsOf?: string;
    verifiedBuildersOnChain?: number;
    /** The part of `published` that is a listed token with no builder evidence and no live market (2026-10-12, additive). */
    listedTokenOnly?: number;
    asOf?: string;
  };
  jobs: { pending: number; failed24h: number | null };
  /** Published tokens with a reading under a day, of those with a known pair. */
  market: { fresh: number; cohort: number } | null;
  /** `failing` (additive, 2026-10-03): the checks the newest audit failed, by id and plain words; a failing audit makes `verdict` critical. */
  integrity: { verdict: 'ok' | 'warn' | 'fail' | 'unknown'; ranAt: string | null; failing?: { check: string; label: string }[] };
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
    /** The valuation the project page prints — a market cap or an FDV; `valuationKind` (and `valuation.kind`) say which. Named so since 2026-09-24. */
    marketCapUsd?: number;
    /** `fdv` when the figure is the fully diluted valuation standing in for a market cap. */
    valuationKind?: 'marketCap' | 'fdv';
    /** The same figure with its kind and the words HEY prints it under, "Market cap" or "Fully diluted valuation" (additive, 2026-10-01). Absent exactly when `marketCapUsd` is. */
    valuation?: { usd: number; kind: 'marketCap' | 'fdv'; label: string };
    /** Why `marketCapUsd` is absent although HEY holds a reading (round 4, 2026-09-30): the list's `valuationWithheld` code. */
    valuationWithheld?: string;
    /** The liquidity the project page prints: the current reading's, else the token's last recorded depth (2026-09-25). */
    liquidityUsd?: number;
    /** `launch_inventory` when `liquidityUsd` is a launch pool's own supply (2026-09-25). */
    liquidityKind?: HeyLiquidityKind;
    /** `current` is null with state `NOT_MEASURED` when HEY has not measured the project's building (2026-09-26). */
    velocity?: { state: string; current: number | null; previous: number | null };
    cadence?: { state: string; medianIntervalDays?: number };
    /** The intelligence layer's twelve-week consistency: `activeWeeks` is null while HEY has watched the project for fewer than twelve weeks. Not the page's "CONSISTENCY"; that is `buildMomentumConsistency`. */
    consistency?: { activeWeeks: number | null; windowWeeks: number };
    marketAttention?: string;
    /** Why `marketAttention` is absent (additive, 2026-10-16): attention is measured only where the Discovery Gap measures the market. */
    marketAttentionWithheld?: string;
    /** The category every HEY card prints (additive, 2026-10-02): the primary narrative (null for none or the catch-all "Other"), then the kind; `label` is the card's words, e.g. "Infrastructure" or "Uncategorised". */
    category: { label: string; narrative: { slug: string; name: string } | null; projectKind: string };
    /** The Build Momentum component the project page prints as "CONSISTENCY" (additive, 2026-10-02): 0–100 rounded as printed, with the weeks it counts. Absent when Build Momentum is not measured. */
    buildMomentumConsistency?: { score: number; activeWeeks?: number; windowWeeks?: number };
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
  /** False exactly on `MISMATCH` (2026-09-27, additive): do not print the activity as this token's, or link from the token to the project. */
  activity_applies_to_token: boolean;
  hey_project_url: string;
  /** Only a repository HEY counts as the project's own evidence. */
  repo_url: string | null;
  /** HEY never stores a commit, so this is always null; `last_code_activity` carries what HEY holds. */
  last_commit: null;
  last_code_activity: {
    summary: string;
    /** Human commits of the newest code week, as its receipt counts them (`codeWeek.commits`; the week's, not its read window's, since 2026-10-18); a floor when `commits_partial`. */
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
  /* The Partner Card (2026-09-30, additive; heyresearch.xyz/developers/partners). */
  /** HEY's catalogue marks the project a verified builder (the scan card's `verified_builder`). */
  verified_builder: boolean;
  /** The newest ship HEY counts as building evidence now, with its typed evidence id; null when HEY holds none. */
  latest_meaningful_ship: HeyPartnerShip | null;
  /** Meaningful ships in thirty days by the rule behind the status; null — never 0 — when HEY did not measure building and holds none. */
  meaningful_ships_30d: number | null;
  /** The newest builder-story change in the change ledger (no market, usage, coverage or narrative events); null when none or unavailable — see `latest_change_state`. */
  latest_change: HeyPartnerChange | null;
  /** `unavailable` means the ledger has not run or could not be read: unknown, not none. */
  latest_change_state: 'recorded' | 'none_recorded' | 'unavailable';
  /** The newest standing HEY Signal about building, contracts, launch or research; null when none stands. */
  latest_signal: HeyPartnerSignal | null;
  /** This token's market state: context only, never a builder input. `INSUFFICIENT_DATA` is "not measured". */
  market_status: {
    status: string;
    observed_at: string | null;
    /** The classifier's reason for the status (2026-10-19, additive); null when HEY holds none. */
    reason: string | null;
    /** The status in HEY's canonical words, reason included ("Launch pool only", "Readings not confirmed"; 2026-10-19, additive). Print this one. */
    label: string;
  };
  badge_url: string;
  /** `hey_project_url` with HEY's attribution labels (`utm_medium=partner_api`); link this one. */
  project_link: string;
  /** The project's publicly listed Uniswap v4 hooks (2026-10-11, additive); null unless `uniswap_v4_hooks_state` is `listed`. */
  uniswap_v4_hooks: HeyPartnerV4Hooks | null;
  /** `none_listed` is a reading of HEY's listing (a hook whose creation HEY has not read is tied to no one yet); `not_read`: HEY has decoded no v4 hook on the chain — unknown, not none. */
  uniswap_v4_hooks_state: 'listed' | 'none_listed' | 'not_read';
  disclaimer: string;
};

/** A project's listed Uniswap v4 hooks on the partner card (2026-10-11). Contracts and counts only. */
export type HeyPartnerV4Hooks = {
  /** Every listed hook, factory instances included. */
  listed: number;
  basis_counts: { chain: number; project: number; linked: number; factory: number; review: number };
  /** At most ten hooks with a row of their own, newest deployment first; factory instances are counted, never listed. */
  items: { address: string; basis: 'chain' | 'project' | 'linked' | 'review'; basis_label: string; page_url: string; evidence_id: string }[];
  shown: number;
  total: number;
  list_url: string;
};

/** A ship on the partner card (2026-09-30). */
export type HeyPartnerShip = {
  title: string;
  url: string | null;
  timestamp: string;
  /** HEY's ship type (`RELEASE`, `CODE_ACTIVITY`, `CONTRACT_UPGRADE`, …). */
  kind: string;
  /** `ship:<uuid>`; resolve at `/api/evidence/{id}`. */
  evidence_id: string;
  /** The evidence receipt as a reader's page, with the card's attribution labels: link this one as "Evidence" (2026-10-05). */
  evidence_link: string;
};

/** One change-ledger event on the partner card (2026-09-30). */
export type HeyPartnerChange = {
  id: string;
  type: HeyChangeType;
  summary: string;
  /** Null when only HEY's own observation dates it (`precision: "OBSERVED"`). */
  occurred_at: string | null;
  precision: HeyChangePrecision;
  detected_at: string;
  evidence_id: string | null;
  url: string;
  /**
   * The change explained, compactly (2026-10-20, additive): the same object `explain?fact=build.change` answers with,
   * in this card's words. Null when HEY could not read it.
   */
  explanation: HeyPartnerChangeExplanation | null;
};

/** The partner card's change explanation (2026-10-20): stage, attribution, link and limits; `explain_url` holds the rest. */
export type HeyPartnerChangeExplanation = {
  version: string;
  headline: string;
  stage: HeyChangeStage;
  reported_by: HeyChangeReporter;
  corroboration: 'corroborated' | 'not_corroborated' | 'not_applicable';
  /** `established` only when the release text names the exact contract or implementation address; never by timing. */
  release_deployment: 'established' | 'not_established' | 'not_applicable' | 'not_read';
  activity: HeyChangeActivityState;
  /** Whether calls succeeded is never measured. */
  call_success: 'not_measured';
  time_basis: 'source_dated' | 'observed_by_hey';
  standing: 'standing' | 'withdrawn' | 'not_checked';
  /** What HEY does not know, as codes (`deployment_not_observed`, `success_not_measured`, …). */
  unknowns: string[];
  explain_url: string;
};

/** One HEY Signal on the partner card (2026-09-30). */
export type HeyPartnerSignal = {
  id: string;
  /** A HEY Signal kind (`release_published`, `development_spike`, …); never a market-group kind. */
  kind: string;
  label: string;
  headline: string;
  observed_at: string;
  /** `signal:<uuid>`. */
  evidence_id: string;
  url: string;
};

/* ------------------------------------------------------------ search */

/** One type-ahead row: a published project, or a launch record typed as one (never presented as a project). */
export type HeySearchSuggestion =
  /**
   * `emptyNamesake` (additive, 2026-10-01): a page with no token, ship or builder signal recorded that shares its name with a fuller suggestion; listed after the other projects.
   * `sameNameDifferentContract` (additive, 2026-10-03): another project suggestion shares this one's name or ticker on a different contract.
   * `status` (additive, 2026-10-10): the project card's status words ("Shipping · Verified Builder", "Not researched yet"); display only, the order is unchanged.
   */
  | { type: 'project'; name: string; symbol?: string; contract?: string; target: string; emptyNamesake?: true; sameNameDifferentContract?: true; status?: string }
  /**
   * `brandNotice` (additive, 2026-10-02): "Not affiliated with Robinhood" — the record's name or ticker borrows
   * a Robinhood stock token's ticker (`stock_ticker`) or Robinhood's brand (`robinhood_brand`,
   * `robinhood_affiliation`, …). `kind` is open: a new kind may be added. Presentation only.
   */
  | {
      type: 'launch';
      name: string;
      symbol?: string;
      contract: string;
      launchedVia: string;
      target: string;
      brandNotice?: { kind: string; title: string; detail: string; ticker?: string };
    }
  /**
   * An issuer's own token (additive, 2026-10-02): a Robinhood stock token from HEY's issuer-token registry —
   * never a project and never a launch record. `label` says so ("Robinhood stock token · issued by Robinhood");
   * `match` is how the query found it; `target` is its address permalink (`/scan/<address>`).
   */
  | { type: 'issuer'; name: string; symbol?: string; contract: string; label: string; match: 'address' | 'ticker' | 'name'; target: string };

/**
 * `GET /api/search/suggest?q=`: at most eight rows, HEY's own tables only.
 * `moreLaunchRecords` (additive, 2026-10-01): true when HEY may hold more
 * launch records matching `q` than the rows list; the search page lists them.
 * `moreProjects` (additive, 2026-10-16): true when more published projects
 * match `q` than the rows list.
 */
export type HeySearchSuggestions = { q: string; suggestions: HeySearchSuggestion[]; moreLaunchRecords?: boolean; moreProjects?: boolean };
