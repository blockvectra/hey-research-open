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
  deployer?: { address: string; sharedAcrossTrackedProjects: boolean; otherProjectsCount: number };
  factory?: string;
  verifiedSource: { state: HeyMeasureState; verified?: boolean; compiler?: string; contractName?: string; readFrom?: string; checkedAt?: string };
  proxy: {
    state: HeyMeasureState;
    status?: 'PROXY' | 'NOT_PROXY' | 'ERROR';
    kind?: 'EIP1967' | 'BEACON' | 'EXPLORER_REPORTED' | 'NONE_DETECTED';
    implementation?: string;
    beacon?: string;
    checkedAt?: string;
    changedAt?: string;
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
  activity: { state: HeyMeasureState; daysMeasured: number; calls7d: number | null; events7d: number | null; newestDay?: string };
  freshness: { proxyCheckedAt?: string; sourceCheckedAt?: string; activityObservedAt?: string };
  evidence: string[];
  url: string;
  disclaimer: string;
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
    | { state: 'MEASURED'; clock: 'recorded'; total: number; byType: Record<string, number>; truncated: boolean; collectedFrom?: string; partial?: boolean; url: string }
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

export type HeyPoolStructure = { livePoolCount?: number; dominantPoolShare?: number; poolFirstSeenDay?: string; structureCollectedFrom?: string };

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
