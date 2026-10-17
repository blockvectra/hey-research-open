/**
 * Contract intelligence, history, diff and bulk reads (2026-09-26), and the
 * error envelope every public route answers with. Each type is held equal to
 * its serialiser by `apps/web/src/lib/public-api-contract.contracts.test.ts`.
 */
import type { HeyScanCard, HeyTokenLookup } from './projects';
import type { HeyProjectSnapshot } from './snapshot';

/* ---------------------------------------------------------------- errors */

/**
 * Every public route's error body: `error` is a stable code to switch on,
 * `message` is for a person, `requestId` matches the `x-request-id` header,
 * `retryable` says whether the same request can succeed later unchanged.
 */
export type HeyApiErrorBody = {
  error: string;
  message: string;
  requestId?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
};

/* ------------------------------------------------------------- contracts */

/** Whether HEY measured a section: an unread proxy is never "not a proxy". */
export type HeyMeasureState = 'MEASURED' | 'NOT_READ' | 'ERROR' | 'NO_SOURCE';

/**
 * Calls per method over the last seven complete UTC days HEY read (2026-09-27).
 * Counts only: `top` ranks the most-called methods by bucket (the ERC-20
 * standard surface is one entry), and `names: 'WITHHELD'` says the function
 * names are not published here. `NOT_READ` carries no counts — unknown, never
 * zero — and `collectedFrom`/`collectedThrough` bound the days HEY holds.
 */
export type HeyContractMethods = {
  state: 'MEASURED' | 'NOT_READ';
  source: 'decoded_calls';
  collectedFrom?: string;
  collectedThrough?: string;
  window?: { from: string; to: string; days: number };
  calls?: number;
  buckets?: { erc20Standard: number; named: number; undecoded: number };
  /** Of `buckets.named`, calls the contract's own verified ABI names rather than the decoder (2026-09-27). */
  namedFromAbi?: number;
  /** Calls to the contract's creation code in the window — its deployment, not a method call: in no bucket and not in `calls`. */
  creationCalls?: number;
  /** Undecoded selectors a signature database offers a candidate for: a count of guesses, never a name. */
  undecodedWithCandidates?: number;
  /** The contract's own functions called in the window: named ones and undecoded selectors, never the ERC-20 surface. */
  distinctFunctions?: number;
  top?: { rank: number; bucket: 'erc20_standard' | 'named' | 'undecoded'; calls: number }[];
  names: 'WITHHELD';
};

/** Sourcify's stored answer for one address (2026-09-27). */
export type HeySourcifyEvidence = {
  state: 'MEASURED' | 'NOT_READ' | 'ERROR';
  status?: 'MATCH' | 'NOT_FOUND';
  match?: 'exact_match' | 'match';
  creationMatch?: 'exact_match' | 'match';
  runtimeMatch?: 'exact_match' | 'match';
  checkedAt?: string;
};

/** `GET /api/contracts/{chainId}/{address}`: one contract as a research entity. Counts, never function lists; no account but the token deployer. */
export type HeyContract = {
  chainId: number;
  address: string;
  name?: string;
  /** Null when no published project claims the contract, or when more than one shares the strongest link. */
  associatedProject: { slug: string; name: string; url: string } | null;
  role?: 'token' | 'declared' | 'followup';
  token?: { symbol?: string };
  watched: boolean;
  creation?: { tx?: string; at?: string; block?: number; precision: 'EXACT'; evidenceId?: string };
  /** `sharedAcrossTrackedProjects` is HEY's one shared-deployer rule (the same flag `/market` publishes); `otherProjectsCount` counts other published projects' tokens from this account. */
  deployer?: {
    address: string;
    sharedAcrossTrackedProjects: boolean;
    otherProjectsCount: number;
    /** 2026-10-18 (additive): whether the account created 100+ contracts in 90 days, with its evidence; `measured: false` is unknown, never "no". */
    serialLauncher: { measured: false } | { measured: true; value: boolean; creations: number | null; windowDays: number | null; observedAt: string | null };
  };
  factory?: string;
  verifiedSource: {
    state: HeyMeasureState;
    verified?: boolean;
    compiler?: string;
    contractName?: string;
    readFrom?: string;
    checkedAt?: string;
    /** How the explorer came to hold the source (2026-09-27). Absent until HEY has read the explorer's record: unknown, never "published". */
    method?: 'SOURCE_PUBLISHED' | 'BYTECODE_MATCH' | 'SOURCIFY' | 'VERIFIER_ALLIANCE';
    match?: 'FULL' | 'PARTIAL';
    verifiedAt?: string;
    /** Whose code it is: a launchpad template, a bytecode match to other source, source published for this address, or not yet known. Present only when some verifier holds source. */
    authorship?: { kind: 'TEMPLATE' | 'EXPLORER_MATCHED' | 'PROJECT_AUTHORED' | 'UNCONFIRMED'; reason: string };
    /** Sourcify's independent answer; `NOT_READ` is never "not verified". */
    sourcify: HeySourcifyEvidence;
  };
  proxy: {
    state: HeyMeasureState;
    status?: 'PROXY' | 'NOT_PROXY' | 'ERROR';
    kind?: 'EIP1967' | 'BEACON' | 'EXPLORER_REPORTED' | 'NONE_DETECTED';
    implementation?: string;
    beacon?: string;
    checkedAt?: string;
    changedAt?: string;
    /** An immutable minimal clone (EIP-1167) of this contract, as the explorer reports it (2026-09-27). */
    clonedFrom?: string;
    history: {
      id: string;
      implementation: string | null;
      previousImplementation: string | null;
      beacon: string | null;
      event: 'Upgraded' | 'BeaconUpgraded' | null;
      occurredAt: string | null;
      precision: 'EXACT' | 'OBSERVED';
      detectedAt: string;
      blockNumber: number | null;
      txHash: string | null;
      source: 'onchain_logs' | 'hey_reads';
    }[];
  };
  interface: {
    state: HeyMeasureState;
    functionCount?: number;
    eventCount?: number;
    baselineSince?: string;
    changes: { id: string; kind: 'VERIFIED' | 'UNVERIFIED' | 'INTERFACE_CHANGED'; functionsAdded: number; functionsRemoved: number; eventsAdded: number; eventsRemoved: number; detectedAt: string; source: string }[];
  };
  activity: { state: HeyMeasureState; daysMeasured: number; calls7d: number | null; events7d: number | null; newestDay?: string; methods: HeyContractMethods };
  freshness: { proxyCheckedAt?: string; sourceCheckedAt?: string; activityObservedAt?: string };
  /** Present when the address is a Uniswap v4 hook HEY stores (2026-10-11, additive); absent for any other contract. */
  uniswapV4Hook?: HeyContractV4Hook;
  evidence: string[];
  url: string;
  disclaimer: string;
};

/**
 * A Uniswap v4 hook HEY stores (2026-10-11). Context only:
 *  - `permissions`/`capabilities`: what the PoolManager will call, decoded from the address — never what the hook does or whether it is safe;
 *  - `attribution`: `LISTED` (on HEY's public hook list, `project` named), `TIED_NOT_LISTED` (tied by HEY's read to a project HEY does not list — no name), `LAUNCH_INSTANCE`, `NOT_TIED` (read, tied to no project), or `NOT_READ` (HEY has not read who created it yet — unknown, never "not tied");
 *  - a time HEY did not read is null with its `*Reason`, never a zero;
 *  - `poolsOnTrackedTokens`: pools on tokens HEY tracks, never every pool and never usage;
 *  - `hooklist`: Uniswap's hooklist "listed as", a third-party listing, never verification;
 *  - `evidenceId`: the `v4hook:` receipt, which stands only while `receiptStands`.
 * No creator or deployer account is ever named.
 */
export type HeyContractV4Hook = {
  hookAddress: string;
  permissions: string[];
  capabilities: string;
  permissionsBasis: string;
  attribution: 'LISTED' | 'TIED_NOT_LISTED' | 'LAUNCH_INSTANCE' | 'NOT_TIED' | 'NOT_READ';
  attributionWords: string;
  attributionDetail: string | null;
  project: { slug: string; name: string; url: string } | null;
  basis: 'chain' | 'project' | 'linked' | 'factory' | 'review' | null;
  basisLabel: string | null;
  creationState: 'read' | 'not_read' | 'unavailable';
  deployedAt: string | null;
  deployedBlock: number | null;
  deployedAtReason: 'creation_not_read' | 'creation_record_unavailable' | 'block_time_not_read' | null;
  firstPoolInitBlock: number;
  firstPoolInitAt: string | null;
  firstPoolInitAtReason: 'block_time_not_read' | null;
  poolsOnTrackedTokens: number;
  poolsOnTrackedTokensBasis: string;
  hooklist: { listedAs: string; verifiedSourceAsListed: boolean; listedPermissions: string[]; disagreement: string | null; url: string; readAt: string; label: string } | null;
  hooklistState: 'listed' | 'not_listed' | 'list_not_read';
  evidenceId: string;
  receiptStands: boolean;
  firstSeenAt: string;
  observedAt: string;
  checkedAt: string | null;
};

/** `GET /api/projects/{slug}/contracts`: the project's contracts, each as `/api/contracts` serves it. */
export type HeyProjectContracts = {
  project: { slug: string; name: string; url: string };
  chainId: number;
  items: (Omit<HeyContract, 'disclaimer'> & { role: 'token' | 'declared' | 'followup' })[];
  total: number;
  truncated: boolean;
  method: string;
  disclaimer: string;
};

/* --------------------------------------------------------------- history */

export type HeyHistoryBasis = 'knowledge' | 'observed' | 'reconstructed_from_chain';
export type HeyHistorySeriesName =
  | 'status'
  | 'momentum'
  | 'discoveryGap'
  | 'rank'
  | 'valuation'
  | 'price'
  | 'liquidity'
  | 'volume'
  | 'pools'
  | 'onchain'
  | 'tvl'
  | 'contractChanges'
  | 'locks';

export type HeyHistoryPoint = {
  day: string;
  value: number | string | null;
  basis: HeyHistoryBasis;
  reason?: string;
  scoringVersion?: string;
  kind?: 'marketCap' | 'fdv';
  source?: string;
  calls?: number | null;
  ids?: string[];
};

/** `GET /api/projects/{slug}/history`: points HEY persisted, each with its basis; a missing day is absent, never zero. */
export type HeyHistory = {
  project: { slug: string; name: string; url: string };
  from: string;
  to: string;
  series: {
    name: HeyHistorySeriesName;
    state: 'MEASURED' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
    collectedFrom: string | null;
    unit: string;
    points: HeyHistoryPoint[];
    reason?: string;
  }[];
  ignoredSeries: string[];
  method: string;
  disclaimer: string;
};

export type HeyHistoryQuery = { series?: HeyHistorySeriesName[]; from?: string; to?: string };

/* ------------------------------------------------------------------ diff */

export type HeyDiffEnd<T> = { value: T | null; day?: string; basis?: HeyHistoryBasis; reason?: string; scoringVersion?: string; kind?: 'marketCap' | 'fdv' };
export type HeyDiffPair<T> = { then: HeyDiffEnd<T>; now: HeyDiffEnd<T> };

/** `GET /api/projects/{slug}/diff?from=&to=`: then/now from persisted points, counts on named clocks, never a cause. */
export type HeyDiff = {
  project: { slug: string; name: string; url: string };
  from: string;
  to: string;
  build: {
    clock: 'published';
    /** Null, with `countsReason`, when HEY does not measure the project's building: a zero would not be a finding. */
    releasesAdded: number | null;
    meaningfulShips: number | null;
    countsReason?: string;
    status: HeyDiffPair<string>;
    momentum: HeyDiffPair<number>;
  };
  market: { state: 'MEASURED'; valuation: HeyDiffPair<number>; liquidity: HeyDiffPair<number> } | { state: 'NOT_APPLICABLE'; reason: string };
  /** A window that ends before the ledger began recording is UNAVAILABLE; one that starts before it is `partial`, counted from `collectedFrom`. */
  changes:
    | {
        state: 'MEASURED';
        clock: 'recorded';
        /** Distinct events, each once at its newest revision; a retracted one is not counted (2026-10-18: it counted revisions before). */
        total: number;
        /** The ledger revisions recorded in the window for those events (2026-10-18, additive). */
        revisions?: number;
        byType: Record<string, number>;
        truncated: boolean;
        collectedFrom?: string;
        partial?: boolean;
        url: string;
      }
    | { state: 'UNAVAILABLE'; reason: string };
  method: string;
  disclaimer: string;
};

/* ------------------------------------------------------------------ bulk */

export type HeyBulkError = { code: string; message: string };
export type HeyBulkItem<T> = { input: string; found: boolean; data?: T; error?: HeyBulkError };
export type HeyBulk<T> = { items: HeyBulkItem<T>[]; requested: number; found: number; disclaimer: string };

/** `GET /api/snapshots?slugs=` (keyed only, at most 10). */
export type HeySnapshotsBulk = HeyBulk<HeyProjectSnapshot>;
/** `GET /api/token/{chainId}?addresses=` (keyed only, at most 30). */
export type HeyTokenLookupBulk = HeyBulk<HeyTokenLookup>;

/** `GET /api/v1/scan?chain=4663&tokens=` (keyed only, at most 30), in the partner's snake_case. */
export type HeyScanBulkItem = ({ input: string } & HeyScanCard) | { input: string; found: false; error: HeyBulkError };
export type HeyScanBulk = { items: HeyScanBulkItem[]; requested: number; found_count: number; disclaimer: string };

/* ----------------------------------------- additions to the market answer */

export type HeyMarketContractExtras = {
  factory?: string;
  deployerOtherProjects?: number;
  proxy?: {
    status: 'PROXY' | 'NOT_PROXY' | 'ERROR';
    kind?: 'EIP1967' | 'BEACON' | 'EXPLORER_REPORTED' | 'NONE_DETECTED';
    implementation?: string;
    beacon?: string;
    checkedAt: string;
    changedAt?: string;
  };
};

export type HeyPoolStructure = {
  livePoolCount?: number;
  /** The largest pool's share of measured pool liquidity, as a percentage (0–100, one decimal) — not a 0–1 fraction. */
  dominantPoolShare?: number;
  poolFirstSeenDay?: string;
  structureCollectedFrom?: string;
};

export type HeyLifecycleExtras = {
  launchStageObservedAt?: string;
  deployedAt?: string;
  launchpadLaunchAt?: { at: string; source: string; basis: 'launchpad_claim' };
  tradeIndexFrom?: string;
  firstTradeCensored?: boolean;
  firstBuildingShip?: { publishedAt: string; detectedAt: string };
  firstVerifiedRelease?: { publishedAt: string; detectedAt: string };
  verifiedBuilderAt?: string;
  durations?: { deployToFirstTradeDays?: number; deployToFirstBuildingShipDays?: number; deployToFirstVerifiedReleaseDays?: number };
  /** A Pons V2 launch's sweep, graduation and permanent lock, read from the launch factory's events (2026-10-15). */
  launchLifecycle?: HeyLaunchLifecycle;
};

/**
 * The launch factory's own account of a graduation (2026-10-15). Amounts are
 * raw base-unit integers as strings (`tokenDecimals`; 18 for the quote side
 * when `quoteAsset` is `ETH`); null is "not read", never zero. `graduatedAt`
 * is the graduation log's block time. `evidenceId` (`ponsgrad:<chainId>:<token>`)
 * resolves at `/api/evidence/{id}`.
 */
export type HeyLaunchLifecycle = {
  evidenceId: string;
  factory: string;
  venue: string | null;
  sweptAt: string | null;
  graduatedAt: string | null;
  graduationTx: string | null;
  positionId: string | null;
  seededToken: string | null;
  seededQuote: string | null;
  quoteAsset: 'ETH' | null;
  permanentlyLocked: string | null;
  tokenDecimals: number | null;
  units: 'base_units';
  summary: string;
};

export type HeyOnchainDay = {
  day: string;
  /** Null on a day the decoding source counted calls but could not index events: unknown, never zero. */
  events: number | null;
  truncated: boolean;
  callers?: number;
  calls?: number;
  methods?: number;
  eventKinds?: number;
  source: string;
  window: 'utc_day' | 'rolling_24h';
};

export type HeyOnchainFreshness = { newestDay: string; observedAt: string; stale: boolean };

/** A listing's size before its page: `truncated` when the page shows fewer. */
export type HeyListingTotals = { total: number; truncated: boolean };
