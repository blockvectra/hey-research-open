/**
 * Relationships, peer context and research boards (2026-09-28). Held to the
 * API's shapes by `apps/web/src/lib/public-api-contract.*.test.ts`.
 */

/* ---------------------------------------------------------- relationships */

export type HeyRelationshipFilter = 'identity' | 'code' | 'contracts' | 'protocol' | 'integrations' | 'security';

/** How firmly an edge holds: HEY or the owner confirmed it, the project published it, someone declared it, kept as context, or read from the chain, a registry or a third party's own host (an auditor's report, a bounty platform's program page). */
export type HeyRelationshipState = 'verified' | 'official' | 'claimed' | 'context_only' | 'observed';

export type HeyRelationshipNode = {
  /** Graph-local key (`contract:4663:0x…`, `repo:github.com/o/r`), not an evidence id. */
  id: string;
  /** Never an account: no deployer, holder, caller or wallet is a node. `AUDITOR` is the firm as the security context names it; `AUDIT_REPORT` is a document whose auditor is not named. */
  kind: 'PROJECT' | 'TOKEN' | 'CONTRACT' | 'IMPLEMENTATION' | 'REPOSITORY' | 'PACKAGE' | 'DOMAIN' | 'DOCS' | 'LAUNCHPAD' | 'PROTOCOL_REGISTRY' | 'SOURCE' | 'AUDITOR' | 'AUDIT_REPORT' | 'BUG_BOUNTY_PROGRAM';
  label: string;
  url?: string;
};

export type HeyRelationshipEdge = {
  /** `PROJECT_OWNS_TOKEN`, `PROJECT_USES_CONTRACT`, `CONTRACT_PROXY_TO`, `PROJECT_HAS_REPO`, `REPO_PUBLISHES_PACKAGE`, `PROJECT_PUBLISHES_PACKAGE`, `PACKAGE_LINKS_REPOSITORY`, `PROJECT_HAS_DOMAIN`, `PROJECT_HAS_DOCS`, `PROJECT_LISTED_BY`, `SOURCE_CORROBORATES_IDENTITY`, `PROJECT_RELATED_PROJECT`, `PROJECT_AUDIT_REPORT_LINKED`, `PROJECT_HAS_BUG_BOUNTY`, and since 2026-10-17 `PROJECT_CODE_NAMES_TOKEN` (the `from` project's official repository names the `to` project's token in code) and `PROJECT_POOLS_ON_HOOK` (a v4 pool of the `from` project's token runs on a hook HEY lists under the `to` project). There is no partnership edge, and neither built-on edge is an on-chain interaction. An audit edge is evidence that an audit took place, labelled by where the report is published (the auditor's site `observed`, the project's link `claimed`, a DefiLlama listing `context_only`) — never a verdict. */
  type: string;
  filter: HeyRelationshipFilter;
  from: string;
  to: string;
  label: string;
  state: HeyRelationshipState;
  /** Typed evidence ids (`source:`, `impl:`, `ship:`, `security:`, `v4pool:`, `v4hook:`) with their `/api/evidence/{id}` URLs. */
  evidence: { id: string; url: string }[];
  links: { label: string; url: string }[];
  observedAt: string | null;
};

export type HeyProjectRelationships = {
  project: { slug: string; name: string; url: string };
  nodes: HeyRelationshipNode[];
  edges: HeyRelationshipEdge[];
  /** Records each family was built from: `shown` of `total`. `buildsOn` / `builtOnBy` (2026-10-17) count built-on links, one per other project and kind. */
  counts: { family: 'contracts' | 'sources' | 'packages' | 'corroborations' | 'related' | 'buildsOn' | 'builtOnBy'; shown: number; total: number }[];
  truncated: boolean;
  /** Families HEY names but does not hold, with why: contract-to-contract interaction always; `PROJECT_AUDIT_REPORT_LINKED` / `PROJECT_HAS_BUG_BOUNTY` when none was found on the indexes HEY read, or they were not read — never "no audit". Never implied. */
  notHeld: { type: string; filter: HeyRelationshipFilter; reason: string }[];
  computedAt: string;
  methodology: string;
};

/* -------------------------------------------------------------- built on */

export type HeyBuiltOnProject = { slug: string; name: string; url: string };

/** One piece of evidence behind a link: a file of the builder's official repository, or a v4 pool. */
export type HeyBuiltOnEvidence =
  | {
      kind: 'code';
      /** One word: `Source`, `Config` or `Deployment`. */
      word: string;
      pathKind: 'SOURCE' | 'CONFIG' | 'DEPLOYMENT_RECORD';
      repository: string;
      path: string;
      /** The file on GitHub. */
      url: string;
      /** The builder's official repository (`source:`), resolvable on `/api/evidence/{id}`. */
      evidence: { id: string; url: string };
      observedAt: string | null;
    }
  | {
      kind: 'hook';
      word: string;
      poolId: string;
      hookAddress: string;
      /** The receipt page. */
      url: string;
      /** `v4pool:` (or `v4hook:` for a hook a linked address created), resolvable on `/api/evidence/{id}`. */
      evidence: { id: string; url: string };
      observedAt: string | null;
    };

/** One link: named in code, or runs on a hook. Never a partnership, never an on-chain interaction. */
export type HeyBuiltOnEdge = {
  direction: 'builds_on' | 'built_on_by';
  kind: 'code' | 'hook';
  /** The builder side: its code names the token, or its pools run on the hook. */
  from: HeyBuiltOnProject;
  /** The token's or the hook's project. */
  to: HeyBuiltOnProject;
  /** The project that is not the one asked about. */
  project: HeyBuiltOnProject;
  /** `Its code names X’s token` or `Its pools run on Y’s hook`; its subject is `from`. */
  sentence: string;
  /** Files or pools behind the link, all of them; `evidence` shows a few. */
  evidenceTotal: number;
  evidence: HeyBuiltOnEvidence[];
  observedAt: string | null;
};

/** Totals are true; `edges` is ordered by name, never by a count, and bounded. */
export type HeyBuiltOnSide = { total: number; projects: number; byKind: { code: number; hook: number }; edges: HeyBuiltOnEdge[]; truncated: boolean };

/** `GET /api/projects/{slug}/built-on` (2026-10-17): which builders a project builds on, and which build on it. */
export type HeyProjectBuiltOn = {
  project: HeyBuiltOnProject;
  buildsOn: HeyBuiltOnSide;
  builtOnBy: HeyBuiltOnSide;
  definition: string;
  computedAt: string;
  methodology: string;
};

/* ------------------------------------------------------------ peer context */

export type HeyPeerDimension = {
  /** `build_momentum`, `meaningful_events_30d`, `release_cadence_days`, `active_contracts_7d`, `contract_calls_7d`, `protocol_tvl_usd`, `protocol_fees_24h_usd`, `protocol_revenue_24h_usd`. */
  metric: string;
  label: string;
  unit: 'score' | 'count' | 'days' | 'usd';
  windowDays: number | null;
  definition: string;
  state: 'MEASURED' | 'NOT_MEASURED';
  reason: string;
  value: number | null;
  /** Measured members of the cohort for this metric. */
  cohortSize: number;
  median: number | null;
  range: { p10: number; p90: number } | null;
  statsReason: 'not_enough_comparable_projects' | null;
  percentile: number | null;
  percentileReason: 'not_measured' | 'cohort_below_percentile_minimum' | null;
  /** A position against the median, never a judgement. */
  comparison: 'above_median' | 'at_median' | 'below_median' | null;
  line: string;
};

/** Each dimension stands alone; there is no overall figure. */
export type HeyPeerContext = {
  rulesVersion: string;
  state: 'COMPUTED' | 'NO_COHORT' | 'NOT_COMPUTED';
  reason: string | null;
  computedAt: string | null;
  /** How old the run is (2026-09-28): `STALE` when the daily run has not replaced it in `staleAfterHours`. Null when nothing was computed. */
  freshness: { state: 'CURRENT' | 'STALE'; asOf: string; staleAfterHours: number } | null;
  cohort: { key: string; label: string; narrative: { slug: string; name: string }; family: 'meme' | 'product' } | null;
  minimums: { median: number; percentile: number };
  dimensions: HeyPeerDimension[];
  methodology: string;
};

/* ------------------------------------------------------------------ boards */

export type HeyBoardPanel = 'latest_changes' | 'build_momentum' | 'usage' | 'protocol_economics' | 'upcoming_unlocks' | 'contract_changes';

/** `/api/boards/{id}` (key or session, owner only): a private arrangement of published projects and fixed panels over HEY's canonical reads. */
export type HeyBoard = {
  id: string;
  name: string;
  /** Plain text; never HTML. */
  note: string | null;
  projects: { slug: string; name: string }[];
  unpublishedProjects: number;
  panels: HeyBoardPanel[];
  windowDays: 7 | 30 | 90;
  visibility: 'private' | 'link';
  sharedAt: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type HeyBoardSummary = {
  id: string;
  name: string;
  projectCount: number;
  panels: HeyBoardPanel[];
  windowDays: 7 | 30 | 90;
  visibility: 'private' | 'link';
  updatedAt: string;
  url: string;
};

export type HeyBoardList = {
  items: HeyBoardSummary[];
  limits: { boards: number; projectsPerBoard: number; nameLength: number; noteLength: number };
  panels: HeyBoardPanel[];
  windows: (7 | 30 | 90)[];
};
