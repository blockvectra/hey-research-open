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
  /** `PROJECT_OWNS_TOKEN`, `PROJECT_USES_CONTRACT`, `CONTRACT_PROXY_TO`, `PROJECT_HAS_REPO`, `REPO_PUBLISHES_PACKAGE`, `PROJECT_PUBLISHES_PACKAGE`, `PACKAGE_LINKS_REPOSITORY`, `PROJECT_HAS_DOMAIN`, `PROJECT_HAS_DOCS`, `PROJECT_LISTED_BY`, `SOURCE_CORROBORATES_IDENTITY`, `PROJECT_RELATED_PROJECT`, `PROJECT_AUDIT_REPORT_LINKED`, `PROJECT_HAS_BUG_BOUNTY`. There is no partnership edge. An audit edge is evidence that an audit took place, labelled by where the report is published (the auditor's site `observed`, the project's link `claimed`, a DefiLlama listing `context_only`) — never a verdict. */
  type: string;
  filter: HeyRelationshipFilter;
  from: string;
  to: string;
  label: string;
  state: HeyRelationshipState;
  /** Typed evidence ids (`source:`, `impl:`, `ship:`, `security:`) with their `/api/evidence/{id}` URLs. */
  evidence: { id: string; url: string }[];
  links: { label: string; url: string }[];
  observedAt: string | null;
};

export type HeyProjectRelationships = {
  project: { slug: string; name: string; url: string };
  nodes: HeyRelationshipNode[];
  edges: HeyRelationshipEdge[];
  /** Records each family was built from: `shown` of `total`. */
  counts: { family: 'contracts' | 'sources' | 'packages' | 'corroborations' | 'related'; shown: number; total: number }[];
  truncated: boolean;
  /** Families HEY names but does not hold, with why: contract-to-contract interaction always; `PROJECT_AUDIT_REPORT_LINKED` / `PROJECT_HAS_BUG_BOUNTY` when none was found on the indexes HEY read, or they were not read — never "no audit". Never implied. */
  notHeld: { type: string; filter: HeyRelationshipFilter; reason: string }[];
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
