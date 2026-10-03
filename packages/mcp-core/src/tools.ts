import type { HeyChangeType } from '@hey-research-lab/sdk';

/**
 * The tool set, as data (2026-09-26): fourteen tools, and one more only where
 * the site publishes Market Integrity. Fifteen since 2026-09-30: `research_answer`
 * carries the agent contract (`@hey/agent-provider-core`).
 *
 * One list read by everything that names the tools — the server's
 * registrations are checked against it, `/developers`, `llms.txt` and the
 * docs print it — so a page can no longer list eleven of twenty-two tools or
 * describe a tool by what it used to do (audit M2 G7).
 *
 * Usage before the rework was one call ever, and nothing was on npm, so the
 * twenty-two old names were replaced rather than aliased. What each new tool
 * absorbed is in `replaces`.
 *
 * Twelve listed since 2026-09-30 (round 4): `lookup_token`, `compare_projects`
 * and `get_project_coverage` were folded into `find_projects` and
 * `research_answer` to pay for typed output (`structuredContent` and
 * `outputSchema`) inside the list's byte budget. By then the tools were on
 * npm and in the MCP registry, so the three are aliased, not replaced: they
 * stay callable, unlisted, until `callableUntil` (`HEY_MCP_DEPRECATED_TOOLS`).
 */
/**
 * The profiles one registry serves (round 4, 2026-09-30, founder decision):
 * `full` at `/mcp` (unchanged), and `research` at `/mcp/research` —
 * builder intelligence first: no market-move, Under the Radar or other
 * market-attention tool, no valuation tool (`HEY_MCP_RESEARCH_PROFILE_SCOPE`
 * says what `research_answer` still carries). A tool names the profiles it is
 * offered on; a research-profile tool may take fewer arguments there
 * (`find_projects` without market filters, `get_changes` without market
 * events), never more.
 */
export const HEY_MCP_PROFILES = ['full', 'research'] as const;

/**
 * What the research profile is, in one sentence every surface prints (full
 * audit 2026-10-03). llms.txt, the agent card, the OpenAPI document and the
 * guides said "builder intelligence only" while `research_answer` there
 * returns the agent contract's `market.valuation` claim and `marketContext`
 * — deliberately: the contract's project answer carries its market context,
 * labelled context only (`contextOnly: true`), never a builder judgement.
 * The words now say that instead of promising less than the tool returns.
 */
export const HEY_MCP_RESEARCH_PROFILE_SCOPE =
  "builder intelligence first: no market-move, Under the Radar or valuation tool, and the ledger without market events; research_answer still carries the market context of HEY's agent contract (the valuation with its kind, source and reading date, and the market status), labelled context only and never a builder judgement";
export type HeyMcpProfile = (typeof HEY_MCP_PROFILES)[number];

/** Where each profile is served, relative to the site's origin. */
export const HEY_MCP_PROFILE_PATHS: Readonly<Record<HeyMcpProfile, string>> = { full: '/mcp', research: '/mcp/research' };

/**
 * What each profile's `tools/list` may cost a model, in bytes of JSON (round
 * 4), output schemas included. `full` keeps the old 22-tool list's 19,179
 * bytes: typed output was paid for by folding three overlapping tools and
 * dropping the SDK's `$schema` stamps, not by lifting the budget. `research`
 * is its own, smaller budget. `server.test.ts` holds both.
 */
export const HEY_MCP_TOOL_LIST_BUDGET: Readonly<Record<HeyMcpProfile, number>> = { full: 19_179, research: 11_000 };

export type HeyMcpToolInfo = {
  name: string;
  title: string;
  /** The profiles the tool is offered on (round 4). */
  profiles: readonly HeyMcpProfile[];
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
    routes: ['/api/projects', '/api/chain/silence', '/api/chain/accelerating', '/api/builders', '/api/token/{chainId}/{address}'],
    replaces: ['search_projects', 'list_projects', 'shipping_in_silence', 'builder_comebacks', 'accelerating_builders', 'list_builders', 'lookup_token'],
    profiles: ['full', 'research'],
  },
  {
    name: 'get_project_snapshot',
    title: 'Project snapshot',
    summary: 'The important state of one project in one read, opening on the Research Summary (one tagged line each for build, usage, market, contracts, fundamentals, security, the latest change and what HEY does not know), then identity, build, market with its withholding, on-chain, verification, locks, latest changes, freshness and coverage.',
    routes: ['/api/projects/{slug}/snapshot'],
    replaces: ['get_project', 'project_intelligence'],
    profiles: ['full'],
  },
  {
    name: 'get_changes',
    title: 'What changed',
    summary: 'The change ledger: what changed on the chain or on one project, one event per change, with its own time, its precision, when HEY knew and its evidence. Cursor sync.',
    routes: ['/api/changes'],
    replaces: ['list_ships', 'list_signals', 'contract_changes'],
    profiles: ['full', 'research'],
  },
  {
    name: 'get_project_timeline',
    title: 'Project timeline',
    summary: 'One project’s research timeline, every kind of evidence on one axis, paged with a cursor.',
    routes: ['/api/projects/{slug}/timeline'],
    replaces: ['project_timeline'],
    profiles: ['full', 'research'],
  },
  {
    name: 'explain_fact',
    title: 'Explain a fact',
    summary: 'Why HEY publishes a figure: the rule, the winning source, the inputs, the lineage and the evidence ids.',
    routes: ['/api/projects/{slug}/explain'],
    replaces: [],
    profiles: ['full', 'research'],
  },
  {
    name: 'get_evidence',
    title: 'Open evidence',
    summary: 'One published record by its typed id (ship:, signal:, abi:, impl:, lock:, source:, claim:, state:), as a receipt.',
    routes: ['/api/evidence/{id}'],
    replaces: [],
    profiles: ['full', 'research'],
  },
  {
    name: 'get_token_market',
    title: 'Token market',
    summary: 'One token’s market from HEY’s daily index: current reading with its kind, lifecycle, pools, supply concentration (shares only), contract checks; optionally the day-on-day moves with what shipped before each.',
    routes: ['/api/projects/{slug}/market', '/api/projects/{slug}/market-moves'],
    replaces: ['events_before_market_change'],
    profiles: ['full'],
  },
  {
    name: 'get_contract',
    title: 'Contract',
    summary: 'A contract as a research entity — creation, deployer, verified source, proxy and implementation history, interface counts and changes, activity — by address or for every contract of a project.',
    routes: ['/api/contracts/{chainId}/{address}', '/api/projects/{slug}/contracts'],
    replaces: [],
    profiles: ['full', 'research'],
  },
  {
    name: 'project_diff',
    title: 'Project diff',
    summary: 'What changed for one project between two dates, from persisted points on named clocks. Never a cause.',
    routes: ['/api/projects/{slug}/diff'],
    replaces: [],
    profiles: ['full'],
  },
  {
    name: 'ask_hey',
    title: 'Ask HEY',
    summary: 'A free-text question about one project, answered only from HEY’s record, every line tagged with its source.',
    routes: ['/api/projects/{slug}/ask'],
    replaces: [],
    profiles: ['full'],
  },
  {
    name: 'research_answer',
    title: 'Agent research answer',
    summary: 'One bounded answer in HEY’s agent contract (AgentIntelligenceResponse v1) for one of six questions: research a project, what changed, builder status with its evidence, whether a contract belongs to a project, a builder comparison, and what HEY does not know (every coverage dimension’s state).',
    routes: ['/api/agent/{capability}'],
    replaces: ['compare_projects', 'get_project_coverage'],
    profiles: ['full', 'research'],
  },
  {
    name: 'chain_overview',
    title: 'Chain overview',
    summary: 'Robinhood Chain as a whole: day-by-day activity, this week’s rollup, an archived weekly report, scheduled HoodLock unlocks, or Build Momentum beside market attention.',
    routes: ['/api/chain', '/api/this-week', '/api/reports/weekly/{week}', '/api/chain/unlocks', '/api/chain/build-market'],
    replaces: ['chain_activity', 'this_week', 'weekly_report', 'upcoming_unlocks'],
    profiles: ['full'],
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
    profiles: ['full'],
  },
] as const satisfies readonly HeyMcpToolInfo[];

/**
 * Tools folded into others on 2026-09-30 (round 4) to pay for typed output
 * inside the tool list's byte budget. Each overlapped a listed tool: the same
 * read, or a restatement the contract already carries. They are no longer
 * listed, and stay CALLABLE on `/mcp` and the stdio server, answering exactly
 * as before plus a deprecation line, until `callableUntil` — at least 90 days,
 * the partner overlap rule (machine-layer rule 10). An agent built against
 * them does not break in that time.
 */
export type HeyMcpDeprecatedTool = {
  name: string;
  title: string;
  /** How to ask the same thing of a listed tool. */
  replacedBy: string;
  callableUntil: string;
  routes: readonly string[];
};

export const HEY_MCP_DEPRECATED_TOOLS = [
  {
    name: 'lookup_token',
    title: 'Look up a contract address',
    replacedBy: 'find_projects with query set to the 0x address: the same read and the same answer.',
    callableUntil: '2026-12-31',
    routes: ['/api/token/{chainId}/{address}'],
  },
  {
    name: 'compare_projects',
    title: 'Compare projects',
    replacedBy: 'research_answer with capability compare_builders and projects (builder metrics, no winner); each project\'s market context is get_token_market.',
    callableUntil: '2026-12-31',
    routes: ['/api/compare'],
  },
  {
    name: 'get_project_coverage',
    title: 'What HEY knows',
    replacedBy: 'research_answer with capability unknowns and project: every coverage dimension\'s state (measured, not applicable, withheld, and each gap with its coverage state and what not to conclude).',
    callableUntil: '2026-12-31',
    routes: ['/api/projects/{slug}/coverage'],
  },
] as const satisfies readonly HeyMcpDeprecatedTool[];

export type HeyMcpToolName = (typeof HEY_MCP_TOOLS)[number]['name'] | (typeof HEY_MCP_GATED_TOOLS)[number]['name'] | (typeof HEY_MCP_DEPRECATED_TOOLS)[number]['name'];

/** The tools a profile lists, in catalogue order; `market_integrity` only where the site publishes it. */
export function mcpToolsFor(profile: HeyMcpProfile, options: { marketIntegrity?: boolean } = {}): readonly HeyMcpToolInfo[] {
  return [...HEY_MCP_TOOLS, ...(options.marketIntegrity ? HEY_MCP_GATED_TOOLS : [])].filter((tool) => (tool.profiles as readonly HeyMcpProfile[]).includes(profile));
}

/** Every name a server answers on some profile, listed or deprecated: what the request log may record as a tool. */
export const HEY_MCP_CALLABLE_TOOL_NAMES: readonly string[] = [...HEY_MCP_TOOLS, ...HEY_MCP_GATED_TOOLS, ...HEY_MCP_DEPRECATED_TOOLS].map((tool) => tool.name);

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
  'research.source_changed',
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
