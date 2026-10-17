/**
 * Uniswap v4 hooks on Robinhood Chain (2026-10-11 in the SDK): `GET
 * /api/v4-hooks`, the hooks HEY ties to a published project, and `GET
 * /api/v4-hooks/{address}`, one hook as an answer. Held equal to the
 * serialisers by `apps/web/src/lib/public-api-contract.v4-hooks.test.ts`.
 *
 * Context only: nothing here is building evidence by itself, a ranking or a
 * safety verdict. A project is named only while HEY lists the hook under it;
 * no creator account is ever named. Unknown is absent or null with a reason,
 * never zero.
 */

/** The fourteen callbacks a hook address can declare (`Hooks.Permissions` in Uniswap v4-core). */
export type HeyV4HookPermission =
  | 'beforeInitialize'
  | 'afterInitialize'
  | 'beforeAddLiquidity'
  | 'afterAddLiquidity'
  | 'beforeRemoveLiquidity'
  | 'afterRemoveLiquidity'
  | 'beforeSwap'
  | 'afterSwap'
  | 'beforeDonate'
  | 'afterDonate'
  | 'beforeSwapReturnDelta'
  | 'afterSwapReturnDelta'
  | 'afterAddLiquidityReturnDelta'
  | 'afterRemoveLiquidityReturnDelta';

/** What a listed hook's tie rests on: chain evidence, the project's own listing, a project-linked creator, the project's factory, or HEY's review (never chain proof). */
export type HeyV4HookBasis = 'chain' | 'project' | 'linked' | 'factory' | 'review';

export type HeyV4HookMarketContext =
  | { shown: true; valuationUsd: number; kind: 'marketCap' | 'fdv'; label: string; source?: string; observedAt?: string }
  | { shown: false; state: string; label: string; reason: string };

export type HeyV4HookProject = { slug: string; name: string; url: string; activityStatus?: string; activityLabel?: string; marketContext?: HeyV4HookMarketContext };

/** Uniswap's public hooklist entry: a third-party listing, context only — never a tie. */
export type HeyV4HookListing = {
  words: string;
  name: string;
  url: string;
  commit: string;
  readAt: string;
  authority: 'context';
  verifiedSource: boolean;
  listedPermissions: string[];
  properties: Record<string, boolean | string>;
  /** Where the listed flags and the address's own disagree; absent when they agree. */
  disagreement?: { listedOnly: HeyV4HookPermission[]; addressOnly: HeyV4HookPermission[]; words: string };
};

export type HeyV4Hook = {
  id: string;
  chainId: number;
  address: string;
  explorer: string;
  receipt: string;
  attribution: 'PROJECT_DEPLOYER' | 'PROJECT_DECLARED' | 'PROJECT_LINKED_CREATOR' | 'PROJECT_REVIEWED';
  basis: Exclude<HeyV4HookBasis, 'factory'>;
  basisLabel: string;
  reviewedAt?: string;
  tie: string;
  tieDetail?: string;
  deploymentEvidenceId?: string;
  deployedAt?: string;
  deployedBlock?: number;
  firstPoolInit: { block: number; at?: string };
  poolsOnTrackedTokens: number;
  permissions: string[];
  capabilities: string;
  listing?: HeyV4HookListing;
  project: HeyV4HookProject;
};

/** A factory HEY ties to the project and the hook instances it made: counted, a few examples, never a ship. */
export type HeyV4HookFactory = {
  address: string;
  explorer: string;
  attribution: 'PROJECT_FACTORY';
  basis: 'factory';
  basisLabel: string;
  tieBasis: 'followup' | 'declared' | 'linked';
  tie: string;
  deploymentEvidenceId?: string;
  instanceCount: number;
  newestInstanceAt?: string;
  examples: { id: string; address: string; explorer: string; receipt: string; deployedAt?: string }[];
};

export type HeyV4HookProjectGroup = {
  project: HeyV4HookProject;
  summary: string;
  hookCount: number;
  deployedCount: number;
  declaredCount: number;
  newestDeployedAt?: string;
  tie?: string;
  tieDetail?: string;
  hookIds: string[];
  reviewedCount: number;
  linkedCount: number;
  factoryInstanceCount: number;
  factories: HeyV4HookFactory[];
};

export type HeyV4HooklistCoverage = {
  read: boolean;
  sentence: string;
  listed?: number;
  seenByHey?: number;
  notSeenByHey?: number;
  commit?: string;
  url?: string;
  readAt?: string;
  checkedAt?: string;
};

/** `GET /api/v4-hooks`: listed hooks only, newest deployment first, shown of total; every other hook is one aggregate count. */
export type HeyV4Hooks = {
  answer: string;
  /** When the list was read: HEY's hourly copy, or a live read when none exists yet (additive, 2026-10-11). */
  asOf?: string;
  readFrom?: 'hourly_copy' | 'live';
  stale?: boolean;
  items: HeyV4Hook[];
  shown: number;
  total: number;
  truncated: boolean;
  more: string;
  order: string;
  filter: { valuationUnderUsd: number | null; excludedNoFigure: number; excludedNoFigureProjects: number };
  projects: HeyV4HookProjectGroup[];
  /** Which projects `projects` holds (additive, 2026-10-12): `all` (the default) or `shown`, the shown rows' projects only. */
  projectsScope: 'all' | 'shown';
  /** Project groups in `projects`, of `projectsTotal` matching the filter (additive, 2026-10-12). */
  projectsShown: number;
  projectsTotal: number;
  aggregate: {
    sentence: string;
    seen: number;
    listed: number;
    listedProjects: number;
    byBasis: Record<HeyV4HookBasis, { hooks: number; projects: number }>;
    launchProtocol: number;
    notTied: number;
    withheld: number;
    notRead: number;
    checked: number;
    checkedAt?: string;
    lastDecodedAt?: string;
  };
  hooklist: HeyV4HooklistCoverage;
  definitions: { pools: string; marketContext: string; projects: string; hooklist: string; basis: string; factories: string };
  trademark: string;
  disclaimer: string;
};

export type HeyV4HooksQuery = {
  /** Rows, 1–100; default 100. */
  limit?: number;
  /** A reader's market-context filter in USD; a project HEY prints no figure for is left out and counted. Never an order. */
  under?: number;
  /** `shown`: only the shown rows' projects in `projects` (2026-10-12); default every project matching the filter. */
  projects?: 'all' | 'shown';
};

/** One thing HEY does not know about a hook: always null, with why. */
export type HeyV4HookUnknown = { key: string; label: string; value: null; reason: string; words: string };

/** `GET /api/v4-hooks/{address}`: one hook HEY holds, as its page reads it. */
export type HeyV4HookDetail = {
  id: string;
  chainId: number;
  address: string;
  explorer: string;
  receipt: string;
  page: string;
  answer: string;
  listed: boolean;
  project: (HeyV4HookProject & { latestShip: { id: string; title: string; eventType: string; publishedAt: string } | null; latestShipReason: string | null }) | null;
  /** 2026-10-18: the one published project whose own official contract listing names a hook HEY does not list; null otherwise. Who lists it, never a tie. */
  declaredBy: { slug: string; name: string; url: string } | null;
  tie: {
    basis: HeyV4HookBasis;
    basisLabel: string;
    tie: string;
    tieDetail: string | null;
    deploymentEvidenceId: string | null;
    reviewedAt: string | null;
    factory: { address: string; explorer: string; tieBasis: 'followup' | 'declared' | 'linked'; tie: string; deploymentEvidenceId: string | null } | null;
  } | null;
  creation: { state: 'TIED' | 'WITHHELD' | 'LAUNCH_INSTANCE' | 'NOT_TIED' | 'NOT_READ'; words: string; checked: boolean; checkedAt: string | null; deployedAt: string | null; deployedBlock: number | null };
  permissions: string[];
  capabilities: string;
  source: {
    verifiedSource: { state: string; verified: boolean | null; contractName: string | null; checkedAt: string | null; words: string };
    proxy: { state: string; status: 'PROXY' | 'NOT_PROXY' | 'ERROR' | null; kind: string | null; clonedFrom: string | null; checkedAt: string | null; words: string };
  };
  hooklist: { state: 'LISTED' | 'NOT_LISTED' | 'NOT_READ'; words: string; readAt: string | null; listing: HeyV4HookListing | null };
  pools: {
    onTrackedTokens: number;
    firstInitBlock: number | null;
    lastInitBlock: number | null;
    weekly: {
      basis: 'observed';
      collectedFrom: string | null;
      weeks: { isoWeek: string; start: string; pools: number | null; reason: 'before_collection' | null; complete: boolean; includesBackfill: boolean }[];
    };
  };
  when: { firstPoolInitBlock: number; firstPoolInitAt: string | null; lastPoolInitBlock: number; firstRecordedAt: string; lastRecordedAt: string };
  relatedShip: { deployment: { id: string; kind: 'hook_deployment' | 'factory_deployment'; countsAsBuilding: boolean } | null; deploymentReason: string | null };
  unknowns: HeyV4HookUnknown[];
  definitions: { pools: string; weekly: string; basis: string; hooklist: string; marketContext: string };
  trademark: string;
  disclaimer: string;
};
