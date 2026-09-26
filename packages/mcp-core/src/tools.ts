import type { HeyChangeType } from '@hey-research/sdk';

/**
 * The tool set, as data (2026-09-26): fourteen tools, and one more only where
 * the site publishes Market Integrity.
 *
 * One list read by everything that names the tools — the server's
 * registrations are checked against it, `/developers`, `llms.txt` and the
 * docs print it — so a page can no longer list eleven of twenty-two tools or
 * describe a tool by what it used to do (audit M2 G7).
 *
 * Usage before the rework was one call ever, and nothing was on npm, so the
 * twenty-two old names were replaced rather than aliased. What each new tool
 * absorbed is in `replaces`.
 */
export type HeyMcpToolInfo = {
  name: string;
  title: string;
  /** One line for a reader: what question it answers. */
  summary: string;
  /** The public API routes it reads, so a reader can check the answer at the source. */
  routes: readonly string[];
  /** The tools this one absorbed on 2026-09-26. */
  replaces: readonly string[];
};

export const HEY_MCP_TOOLS = [
  {
    name: 'find_projects',
    title: 'Find projects',
    summary: 'Find projects by name, ticker or contract, or browse one of HEY’s surfaces (still building, under the radar, back from dormancy, shipping in silence, accelerating, the Builder Radar) with the catalogue’s filters.',
    routes: ['/api/projects', '/api/chain/silence', '/api/chain/accelerating', '/api/builders'],
    replaces: ['search_projects', 'list_projects', 'shipping_in_silence', 'builder_comebacks', 'accelerating_builders', 'list_builders'],
  },
  {
    name: 'lookup_token',
    title: 'Look up a contract address',
    summary: 'One project by its token contract: is anyone building it, its ships in 30 days and the last one with its source.',
    routes: ['/api/token/{chainId}/{address}'],
    replaces: [],
  },
  {
    name: 'get_project_snapshot',
    title: 'Project snapshot',
    summary: 'The important state of one project in one read: identity, build, market with its withholding, on-chain, verification, locks, latest changes, freshness and what HEY does not know.',
    routes: ['/api/projects/{slug}/snapshot'],
    replaces: ['get_project', 'project_intelligence'],
  },
  {
    name: 'get_changes',
    title: 'What changed',
    summary: 'The change ledger: what changed on the chain or on one project, one event per change, with its own time, its precision, when HEY knew and its evidence. Cursor sync.',
    routes: ['/api/changes'],
    replaces: ['list_ships', 'list_signals', 'contract_changes'],
  },
  {
    name: 'get_project_timeline',
    title: 'Project timeline',
    summary: 'One project’s research timeline, every kind of evidence on one axis, paged with a cursor.',
    routes: ['/api/projects/{slug}/timeline'],
    replaces: ['project_timeline'],
  },
  {
    name: 'get_project_coverage',
    title: 'What HEY knows',
    summary: 'Per dimension, whether HEY measured it, has no source, is stale or withholds it: what an agent must not conclude. States, never a score.',
    routes: ['/api/projects/{slug}/coverage'],
    replaces: [],
  },
  {
    name: 'explain_fact',
    title: 'Explain a fact',
    summary: 'Why HEY publishes a figure: the rule, the winning source, the inputs, the lineage and the evidence ids.',
    routes: ['/api/projects/{slug}/explain'],
    replaces: [],
  },
  {
    name: 'get_evidence',
    title: 'Open evidence',
    summary: 'One published record by its typed id (ship:, signal:, abi:, impl:, lock:, source:, claim:, state:), as a receipt.',
    routes: ['/api/evidence/{id}'],
    replaces: [],
  },
  {
    name: 'get_token_market',
    title: 'Token market',
    summary: 'One token’s market from HEY’s daily index: current reading with its kind, lifecycle, pools, supply concentration (shares only), contract checks; optionally the day-on-day moves with what shipped before each.',
    routes: ['/api/projects/{slug}/market', '/api/projects/{slug}/market-moves'],
    replaces: ['events_before_market_change'],
  },
  {
    name: 'get_contract',
    title: 'Contract',
    summary: 'A contract as a research entity — creation, deployer, verified source, proxy and implementation history, interface counts and changes, activity — by address or for every contract of a project.',
    routes: ['/api/contracts/{chainId}/{address}', '/api/projects/{slug}/contracts'],
    replaces: [],
  },
  {
    name: 'project_diff',
    title: 'Project diff',
    summary: 'What changed for one project between two dates, from persisted points on named clocks. Never a cause.',
    routes: ['/api/projects/{slug}/diff'],
    replaces: [],
  },
  {
    name: 'compare_projects',
    title: 'Compare projects',
    summary: 'Two to four projects side by side, each line tagged. No winner.',
    routes: ['/api/compare'],
    replaces: [],
  },
  {
    name: 'ask_hey',
    title: 'Ask HEY',
    summary: 'A free-text question about one project, answered only from HEY’s record, every line tagged with its source.',
    routes: ['/api/projects/{slug}/ask'],
    replaces: [],
  },
  {
    name: 'chain_overview',
    title: 'Chain overview',
    summary: 'Robinhood Chain as a whole: day-by-day activity, this week’s rollup, an archived weekly report, scheduled HoodLock unlocks, or Build Momentum beside market attention.',
    routes: ['/api/chain', '/api/this-week', '/api/reports/weekly/{week}', '/api/chain/unlocks', '/api/chain/build-market'],
    replaces: ['chain_activity', 'this_week', 'weekly_report', 'upcoming_unlocks'],
  },
] as const satisfies readonly HeyMcpToolInfo[];

/** Offered only where the site publishes Market Integrity (`HEY_MARKET_INTEGRITY=public`). */
export const HEY_MCP_GATED_TOOLS = [
  {
    name: 'market_integrity',
    title: 'Market integrity',
    summary: 'What happened to a project’s tracked token market beside its builder activity, and where the two disagree. Offered only while HEY publishes it.',
    routes: ['/api/projects/{slug}/market-integrity'],
    replaces: [],
  },
] as const satisfies readonly HeyMcpToolInfo[];

export type HeyMcpToolName = (typeof HEY_MCP_TOOLS)[number]['name'] | (typeof HEY_MCP_GATED_TOOLS)[number]['name'];

/** Dropped on 2026-09-26 and not replaced: bounties are not research, and stay in the SDK and API. */
export const HEY_MCP_DROPPED_TOOLS = ['list_bounties'] as const;

/**
 * `find_projects` argument → `/api/projects` parameter (2026-09-26). The web
 * app's contract test holds the right-hand side to the parameters the API's
 * parser reads (`PROJECT_QUERY_PARAMS`), in both directions: every parameter
 * the API takes is offered, and nothing is offered that the API would drop.
 */
export const FIND_PROJECTS_API_PARAMS = {
  query: 'q',
  surface: 'tab',
  kind: 'kind',
  status: 'status',
  narrative: 'narrative',
  launchpad: 'launchpad',
  has: 'has',
  stage: 'stage',
  minLiquidity: 'minLiquidity',
  maxMarketCap: 'maxMarketCap',
  minMarketCap: 'minMarketCap',
  minVolume: 'minVolume',
  age: 'age',
  deployed: 'deployed',
  sort: 'sort',
  limit: 'limit',
  offset: 'offset',
} as const;

/**
 * The event types `get_changes` offers: every type the API accepts except
 * `market_integrity.event`, which the ledger holds as Terminal-only while the
 * founder's gate is closed and the public API therefore never returns. Where
 * HEY publishes Market Integrity (`HEY_MARKET_INTEGRITY=public`, the same flag
 * that offers the `market_integrity` tool) the server adds it (2026-09-27).
 * Held to the API's own list by the web app's test, so a model can only ask
 * for a type that exists.
 */
export const PUBLIC_CHANGE_TYPES = [
  'build.release',
  'build.code_activity',
  'build.ship',
  'build.status_changed',
  'build.dormant',
  'build.resumed',
  'build.accelerating',
  'build.slowing',
  'contract.deployed',
  'contract.followup_deployed',
  'contract.implementation_changed',
  'contract.source_verified',
  'contract.source_unverified',
  'contract.interface_changed',
  'contract.usage_changed',
  'contract.method_first_observed',
  'contract.method_resumed',
  'market.status_changed',
  'market.liquidity_moved',
  'market.volume_spike',
  'market.distribution_changed',
  'token.launch_stage_changed',
  'token.verification_changed',
  'research.published',
  'research.builder_verified',
  'research.owner_verified',
  'research.source_added',
  'research.source_unavailable',
  'research.source_restored',
  'research.narrative_assigned',
  'lock.unlock_due',
  'lock.observed',
  'lock.withdrawn',
] as const satisfies readonly HeyChangeType[];

/** `get_changes` argument → `/api/changes` parameter; the same names, held by the same test. */
export const GET_CHANGES_API_PARAMS = {
  project: 'project',
  contract: 'contract',
  domain: 'domain',
  type: 'type',
  since: 'since',
  until: 'until',
  detectedSince: 'detectedSince',
  after: 'after',
  before: 'before',
  limit: 'limit',
} as const;
