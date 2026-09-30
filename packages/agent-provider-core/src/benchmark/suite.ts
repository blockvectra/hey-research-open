import type { AgentCapability } from '../capabilities';
import type { AgentDataFamily } from '../freshness';

/**
 * The agent query quality benchmark (2026-09-30, Robinhood Agent Apps
 * readiness §11): questions a financial agent could put to HEY, each mapped
 * to one call on HEY's agent contract by this checked-in table.
 *
 * Deterministic on purpose. No language model reads a question: the mapping
 * below IS the agent's choice of capability and arguments, reviewed like
 * code, so a run measures HEY's answers and nothing else. A question states
 * what a correct answer must hold — the intent served, the fields, the
 * evidence, the unknowns, the boundary — and `evaluate.ts` checks the answer
 * against it and against the contract's own invariants (schema, freshness,
 * unknown semantics, no trading output).
 *
 * Subjects are slots (`{building.slug}`), bound per run: the demo seed in CI
 * (`BENCH_BINDINGS.demo`) or named production projects
 * (`BENCH_BINDINGS.production`). The questions do not change between the two.
 */
export const BENCH_CATEGORIES = [
  'identity',
  'builder_status',
  'shipping',
  'contracts',
  'repositories',
  'changes',
  'usage',
  'market_context',
  'comparison',
  'unknowns',
  'freshness',
  'evidence',
  'malformed',
  'ambiguous_ticker',
  'unsupported',
  'trading',
] as const;
export type BenchCategory = (typeof BENCH_CATEGORIES)[number];

/** How a question reaches HEY: the contract's REST door, the MCP tool, the A2A option, or another canonical public GET. */
export type BenchCall =
  | { transport: 'rest'; capability: string; query: Readonly<Record<string, string>> }
  | { transport: 'mcp'; tool: string; arguments: Readonly<Record<string, unknown>> }
  | { transport: 'a2a'; data: Readonly<Record<string, unknown>> }
  | { transport: 'get'; path: string };

/**
 * What the answer must be. `outcome` is the contract status (or, for the
 * transports' own refusals, `no_capability`, `rpc_error`, `tool_error`).
 */
export type BenchOutcome = 'ok' | 'not_found' | 'invalid_request' | 'unavailable' | 'no_capability' | 'rpc_error' | 'tool_error';

/**
 * The boundary a question tests:
 * - `trading`: research facts, never a pick, a trade, a size or a target;
 * - `safety`: attribution or gaps, never a safe/rug verdict or a risk score;
 * - `ranking`: an order the caller chose, never a winner or a return ranking;
 * - `prediction`: what happened, never what a price will do.
 */
export type BenchBoundary = 'trading' | 'safety' | 'ranking' | 'prediction';

export type BenchExpect = {
  http: readonly number[];
  outcome: BenchOutcome;
  /** The capability the answer must be (envelope `capability`, A2A metadata, MCP header). */
  capability?: AgentCapability;
  /** Dot paths the answer must carry (present, null allowed). */
  fields?: readonly string[];
  /** Dot path → exact value (templated). */
  equals?: Readonly<Record<string, string | number | boolean | null>>;
  /** Dot path → one of these values. */
  oneOf?: Readonly<Record<string, readonly (string | number | boolean | null)[]>>;
  /** Dot path to a list → items it must hold: a string, or an object's `item`/`dimension`/`slug`/`family`/`type`. */
  includes?: Readonly<Record<string, readonly string[]>>;
  /** Dot path to a list → the exact order of its `slug`s (templated). */
  order?: Readonly<Record<string, readonly string[]>>;
  /** Coverage dimensions the answer must account for: measured, not applicable, withheld, or an unknown. */
  accounts?: readonly string[];
  /** `required`: at least one typed evidence id; `when_items`: at least one when the answer lists changes. */
  evidence?: 'required' | 'when_items';
  /** At least one entry in `unknowns`. */
  unknowns?: 'required';
  /** Freshness families the answer must state. */
  freshness?: readonly AgentDataFamily[];
  /** The envelope's `error.code`. */
  errorCode?: string;
  /** A search answer's symbol collision: at least two identities with this symbol, each with its own contract. */
  ambiguousSymbol?: string;
  boundary?: BenchBoundary;
};

export type BenchQuestion = {
  id: string;
  category: BenchCategory;
  /** The question, as a person or an agent would put it. */
  question: string;
  /** The intent the mapping resolves it to: a capability, or a refusal kind. */
  intent: AgentCapability | 'refuse' | 'boundary' | 'identity_lookup';
  call: BenchCall;
  /** The canonical reads behind the answer (public API paths). */
  domainRead: readonly string[];
  expect: BenchExpect;
  /** Why the mapping and the expectation are what they are, for the reviewer. */
  note?: string;
};

/** A project slot. */
export type BenchProject = { slug: string; address?: string };

export type BenchBindings = {
  label: 'demo' | 'production';
  /** A published project with recent ships and a tracked token. */
  building: Required<BenchProject>;
  /** A second published project with a tracked token, recorded apart from `building`. */
  second: Required<BenchProject>;
  /** A third published project, for three-way comparisons. */
  third: BenchProject;
  /** A published project with no builder source HEY can read (activity UNKNOWN). */
  noSources: BenchProject;
  /** A published project with no token. */
  tokenless: BenchProject;
  /** A published project whose record is older than its newest readings (any QUIET or DORMANT one). */
  quiet: BenchProject;
  /** A slug HEY holds but does not publish (a hidden candidate). */
  unpublished: BenchProject;
  /** A well-formed address HEY holds no record of. */
  unknownAddress: string;
  /** Two identities sharing one ticker. */
  tickerTwins: { symbol: string; a: Required<BenchProject>; b: Required<BenchProject> };
};

/**
 * The subjects. Production's are named published projects (2026-09-30):
 * AgentOS and Axon ship, HoodLock is a verified builder whose builder source
 * HEY cannot read, TALIS has none, Lagoon has no token, Pons is a hidden
 * candidate; `axon` and `axon-5dbc09` share the ticker AXON.
 */
export const BENCH_BINDINGS: Readonly<Record<'demo' | 'production', BenchBindings>> = {
  demo: {
    label: 'demo',
    building: { slug: 'agentos', address: '0xa0000000000000000000000000000000000000a1' },
    second: { slug: 'stockfi', address: '0xc0000000000000000000000000000000000000c3' },
    third: { slug: 'ponzi-cat' },
    noSources: { slug: 'quiet-token' },
    tokenless: { slug: 'hoodlens' },
    quiet: { slug: 'ponzi-cat' },
    unpublished: { slug: 'hidden-lantern' },
    unknownAddress: '0x2222222222222222222222222222222222222222',
    // The CI run gives StockFi's token the ticker AOS, so the demo seed holds a real collision.
    tickerTwins: { symbol: 'AOS', a: { slug: 'agentos', address: '0xa0000000000000000000000000000000000000a1' }, b: { slug: 'stockfi', address: '0xc0000000000000000000000000000000000000c3' } },
  },
  production: {
    label: 'production',
    building: { slug: 'agentos', address: '0xcab1bc0b34806c6cc867a981f6ba3808d64fcb07' },
    second: { slug: 'axon', address: '0xb5e40b5f16996e9d76ec2b16e7a4ead3c06a9fa2' },
    third: { slug: 'hoodlock' },
    noSources: { slug: 'talis' },
    tokenless: { slug: 'lagoon' },
    quiet: { slug: 'kimmy-os-by-virtuals' },
    unpublished: { slug: 'pons' },
    unknownAddress: '0x2222222222222222222222222222222222222222',
    tickerTwins: { symbol: 'AXON', a: { slug: 'axon', address: '0xb5e40b5f16996e9d76ec2b16e7a4ead3c06a9fa2' }, b: { slug: 'axon-5dbc09', address: '0x5dbc09f83a65ef56c6532f89be1e1aaa7ba95ece' } },
  },
};

const OK = { http: [200], outcome: 'ok' } as const;
const INVALID = { http: [400], outcome: 'invalid_request' } as const;
const NOT_FOUND = { http: [404], outcome: 'not_found' } as const;
const NO_CAPABILITY = { http: [404], outcome: 'no_capability' } as const;

const SNAPSHOT = '/api/projects/{slug}/snapshot';
const EXPLAIN = '/api/projects/{slug}/explain?fact=activity.status';
const CHANGES = '/api/changes';
const COVERAGE = '/api/projects/{slug}/coverage';
const TOKEN = '/api/token/{chainId}/{address}';
const CONTRACT = '/api/contracts/{chainId}/{address}';
const COMPARE = '/api/compare';

const RESEARCH_FIELDS = ['data.identity.slug', 'data.identity.projectKind', 'data.builderState.activityStatus', 'data.builderState.explainUrl', 'data.contractIdentity', 'citation.url', 'links.self'] as const;
const STATUS_FIELDS = ['data.status', 'data.methodology.ruleId', 'data.methodology.version', 'data.inputs', 'data.lineage', 'data.excludedContext', 'data.statusRestsOnCurrentEvidence', 'data.stillBuilding.meaning'] as const;
const CHANGE_FIELDS = ['data.window.from', 'data.window.to', 'data.total', 'data.byType', 'data.shown', 'data.ledger.projectorRanAt', 'data.more'] as const;
const VERIFY_FIELDS = ['data.verdict', 'data.reasonCode', 'data.reasons', 'data.recordedProject', 'data.activityAppliesToContract', 'data.contractUrl'] as const;
const COMPARE_FIELDS = ['data.windowDays', 'data.projects', 'data.missing', 'data.order', 'data.method', 'data.excludedContext'] as const;
const UNKNOWN_FIELDS = ['data.counts', 'data.measured', 'data.notApplicable', 'data.withheld'] as const;
const STATUS_EXCLUDES = ['price', 'valuation', 'liquidity_and_volume'] as const;
const TRADE_CODES = ['investment_recommendation', 'buy_or_sell_signal', 'price_target', 'position_size', 'leverage', 'stop_loss', 'ranking_by_expected_return'] as const;

/**
 * The suite: 75 questions over the 16 categories. Transports are mixed on
 * purpose — most through REST, a share through MCP `research_answer` and the
 * A2A `agent-intelligence-v1` option — so every door is held to the same
 * expectations.
 */
export const BENCH_SUITE: readonly BenchQuestion[] = [
  /* ------------------------------------------------------------ identity */
  {
    id: 'identity-01',
    category: 'identity',
    question: 'What is {building.slug}?',
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', fields: [...RESEARCH_FIELDS, 'data.identity.name', 'data.identity.firstRecordedByHeyAt'], equals: { 'data.identity.slug': '{building.slug}', 'subject.project.token.address': '{building.address}' }, freshness: ['activity_score'] },
  },
  {
    id: 'identity-02',
    category: 'identity',
    question: 'Which project does the contract {building.address} belong to?',
    intent: 'verify_project',
    call: { transport: 'rest', capability: 'verify_project', query: { address: '{building.address}' } },
    domainRead: [TOKEN, CONTRACT],
    expect: { ...OK, capability: 'verify_project', fields: VERIFY_FIELDS, equals: { 'data.recordedProject.slug': '{building.slug}', 'data.recordedProject.role': 'token' } },
  },
  {
    id: 'identity-03',
    category: 'identity',
    question: 'Tell me about {unpublished.slug}.',
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{unpublished.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...NOT_FOUND, capability: 'research_project', errorCode: 'not_found' },
    note: 'A hidden candidate is not published research: not_found, never a partial answer.',
  },
  {
    id: 'identity-04',
    category: 'identity',
    question: 'Who is behind the token {unknownAddress}?',
    intent: 'unknowns',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'unknowns', address: '{unknownAddress}' } },
    domainRead: [TOKEN, CONTRACT],
    expect: { ...OK, capability: 'unknowns', unknowns: 'required' },
    note: 'HEY holds nothing for the address: the answer is a gap, never "no team".',
  },

  /* ------------------------------------------------------ builder status */
  {
    id: 'status-01',
    category: 'builder_status',
    question: 'Is {building.slug} still building?',
    intent: 'builder_status',
    call: { transport: 'rest', capability: 'builder_status', query: { project: '{building.slug}' } },
    domainRead: [EXPLAIN],
    expect: { ...OK, capability: 'builder_status', fields: STATUS_FIELDS, evidence: 'required', includes: { 'data.excludedContext': STATUS_EXCLUDES }, freshness: ['activity_score', 'builder_sources'] },
  },
  {
    id: 'status-02',
    category: 'builder_status',
    question: 'Why does HEY give {second.slug} the status it has?',
    intent: 'builder_status',
    call: { transport: 'a2a', data: { skill: 'explain_fact', project: '{second.slug}', contract: 'agent-intelligence-v1' } },
    domainRead: [EXPLAIN],
    expect: { ...OK, capability: 'builder_status', fields: STATUS_FIELDS, includes: { 'data.excludedContext': STATUS_EXCLUDES } },
  },
  {
    id: 'status-03',
    category: 'builder_status',
    question: 'Is {noSources.slug} building?',
    intent: 'builder_status',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'builder_status', project: '{noSources.slug}' } },
    domainRead: [EXPLAIN],
    expect: { ...OK, capability: 'builder_status' },
    note: 'With no readable builder source the honest status is UNKNOWN; the evaluator holds UNKNOWN to its unknown inputs.',
  },
  {
    id: 'status-04',
    category: 'builder_status',
    question: 'Is {tokenless.slug} still active?',
    intent: 'builder_status',
    call: { transport: 'rest', capability: 'builder_status', query: { project: '{tokenless.slug}' } },
    domainRead: [EXPLAIN],
    expect: { ...OK, capability: 'builder_status', fields: STATUS_FIELDS },
  },

  /* ------------------------------------------------------------ shipping */
  {
    id: 'shipping-01',
    category: 'shipping',
    question: 'What has {building.slug} shipped recently?',
    intent: 'what_changed',
    call: { transport: 'rest', capability: 'what_changed', query: { project: '{building.slug}', days: '30', types: 'build.release,build.ship' } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed', fields: CHANGE_FIELDS, equals: { 'data.scope': 'project' }, evidence: 'when_items', freshness: ['change_ledger'] },
  },
  {
    id: 'shipping-02',
    category: 'shipping',
    question: 'What Robinhood Chain projects shipped in the last 24 hours?',
    intent: 'what_changed',
    call: { transport: 'rest', capability: 'what_changed', query: { days: '1', types: 'build.release,build.ship' } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed', fields: CHANGE_FIELDS, equals: { 'data.scope': 'chain', 'data.window.days': 1 }, evidence: 'when_items' },
  },
  {
    id: 'shipping-03',
    category: 'shipping',
    question: "What was {building.slug}'s latest meaningful ship?",
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', fields: ['data.builderState.lastMeaningfulShipAt', 'data.latestMeaningfulChange', 'data.recentChanges.items'] },
  },
  {
    id: 'shipping-04',
    category: 'shipping',
    question: 'Did {building.slug} cut a release this week?',
    intent: 'what_changed',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'what_changed', project: '{building.slug}', days: 7, types: ['build.release'] } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed' },
  },

  /* ----------------------------------------------------------- contracts */
  {
    id: 'contracts-01',
    category: 'contracts',
    question: 'Does {building.address} belong to {building.slug}?',
    intent: 'verify_project',
    call: { transport: 'rest', capability: 'verify_project', query: { address: '{building.address}', project: '{building.slug}' } },
    domainRead: [TOKEN, CONTRACT],
    expect: { ...OK, capability: 'verify_project', fields: VERIFY_FIELDS, equals: { 'data.recordedProject.slug': '{building.slug}', 'data.askedProject.found': true } },
    note: 'The verdict is whatever the project’s own voice supports (VERIFIED, UNVERIFIED, or a mismatch when its site names another contract); the reason must be in the answer.',
  },
  {
    id: 'contracts-02',
    category: 'contracts',
    question: 'Is {second.address} the {building.slug} contract?',
    intent: 'verify_project',
    call: { transport: 'rest', capability: 'verify_project', query: { address: '{second.address}', project: '{building.slug}' } },
    domainRead: [TOKEN, CONTRACT],
    expect: { ...OK, capability: 'verify_project', equals: { 'data.verdict': 'CONTRACT_MISMATCH', 'data.reasonCode': 'recorded_under_another_project', 'data.recordedProject.slug': '{second.slug}', 'data.activityAppliesToContract': false } },
  },
  {
    id: 'contracts-03',
    category: 'contracts',
    question: 'Does HEY know whether {unknownAddress} belongs to any project?',
    intent: 'verify_project',
    call: { transport: 'rest', capability: 'verify_project', query: { address: '{unknownAddress}' } },
    domainRead: [TOKEN, CONTRACT],
    expect: { ...OK, capability: 'verify_project', equals: { 'data.verdict': 'UNKNOWN', 'data.recordedProject': null, 'data.activityAppliesToContract': null }, unknowns: 'required' },
  },
  {
    id: 'contracts-04',
    category: 'contracts',
    question: 'Investigate {second.address}: whose is it?',
    intent: 'verify_project',
    call: { transport: 'a2a', data: { skill: 'investigate_contract', address: '{second.address}', project: '{second.slug}', contract: 'agent-intelligence-v1' } },
    domainRead: [TOKEN, CONTRACT],
    expect: { ...OK, capability: 'verify_project', fields: VERIFY_FIELDS, equals: { 'data.recordedProject.slug': '{second.slug}' } },
  },

  /* -------------------------------------------------------- repositories */
  {
    id: 'repositories-01',
    category: 'repositories',
    question: 'Which repositories are attributed to {building.slug}, and does HEY know who owns them?',
    intent: 'unknowns',
    call: { transport: 'rest', capability: 'unknowns', query: { project: '{building.slug}' } },
    domainRead: [COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', fields: UNKNOWN_FIELDS, accounts: ['repositories', 'releases', 'gitHost'] },
  },
  {
    id: 'repositories-02',
    category: 'repositories',
    question: "Is {noSources.slug}'s repository ownership verified?",
    intent: 'unknowns',
    call: { transport: 'rest', capability: 'unknowns', query: { project: '{noSources.slug}' } },
    domainRead: [COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', accounts: ['repositories', 'builderEvidence'], unknowns: 'required' },
  },
  {
    id: 'repositories-03',
    category: 'repositories',
    question: 'What does HEY hold on the code behind {second.slug}?',
    intent: 'unknowns',
    call: { transport: 'a2a', data: { skill: 'check_project_coverage', project: '{second.slug}', contract: 'agent-intelligence-v1' } },
    domainRead: [COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', accounts: ['repositories', 'gitHost', 'package'] },
  },
  {
    id: 'repositories-04',
    category: 'repositories',
    question: 'Where is {tokenless.slug} developed?',
    intent: 'unknowns',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'unknowns', project: '{tokenless.slug}' } },
    domainRead: [COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns' },
  },

  /* ------------------------------------------------------------- changes */
  {
    id: 'changes-01',
    category: 'changes',
    question: 'What changed with {building.slug} in the last 7 days?',
    intent: 'what_changed',
    call: { transport: 'rest', capability: 'what_changed', query: { project: '{building.slug}', days: '7' } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed', fields: CHANGE_FIELDS, evidence: 'when_items', freshness: ['change_ledger'] },
  },
  {
    id: 'changes-02',
    category: 'changes',
    question: 'What changed with {second.slug} in 30 days?',
    intent: 'what_changed',
    call: { transport: 'a2a', data: { skill: 'what_changed', project: '{second.slug}', days: 30, contract: 'agent-intelligence-v1' } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed', fields: CHANGE_FIELDS, equals: { 'data.window.days': 30 } },
  },
  {
    id: 'changes-03',
    category: 'changes',
    question: 'Which Robinhood Chain builders resumed development this week?',
    intent: 'what_changed',
    call: { transport: 'rest', capability: 'what_changed', query: { days: '7', types: 'build.resumed' } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed', fields: CHANGE_FIELDS, equals: { 'data.scope': 'chain' } },
  },
  {
    id: 'changes-04',
    category: 'changes',
    question: 'What changed on Robinhood Chain today?',
    intent: 'what_changed',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'what_changed', days: 1, limit: 10 } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed' },
  },
  {
    id: 'changes-05',
    category: 'changes',
    question: 'What did Robinhood Chain builders ship this week, leaving out market moves?',
    intent: 'what_changed',
    call: { transport: 'rest', capability: 'what_changed', query: { days: '7', building: 'only' } },
    domainRead: [CHANGES],
    // Adversarial review (2026-09-30): the ledger's own countsAsBuilding flag, never a list of types.
    expect: { ...OK, capability: 'what_changed', fields: [...CHANGE_FIELDS, 'data.countsAsBuilding'], equals: { 'data.scope': 'chain', 'query.building': 'only' } },
  },

  /* --------------------------------------------------------------- usage */
  {
    id: 'usage-01',
    category: 'usage',
    question: 'Is anyone using what {building.slug} shipped?',
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', fields: ['data.usageContext'] },
    note: 'Usage is context beside building: contextOnly when present, and a count only where HEY measured it.',
  },
  {
    id: 'usage-02',
    category: 'usage',
    question: "How many calls did {third.slug}'s contracts get?",
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{third.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', fields: ['data.usageContext'] },
  },
  {
    id: 'usage-03',
    category: 'usage',
    question: 'Does HEY measure usage for {noSources.slug}?',
    intent: 'unknowns',
    call: { transport: 'rest', capability: 'unknowns', query: { project: '{noSources.slug}' } },
    domainRead: [COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', accounts: ['contractActivity'] },
  },
  {
    id: 'usage-04',
    category: 'usage',
    question: "Does product usage change {building.slug}'s builder status?",
    intent: 'builder_status',
    call: { transport: 'rest', capability: 'builder_status', query: { project: '{building.slug}' } },
    domainRead: [EXPLAIN],
    expect: { ...OK, capability: 'builder_status', includes: { 'data.excludedContext': ['product_usage'] } },
  },

  /* ------------------------------------------------------ market context */
  {
    id: 'market-01',
    category: 'market_context',
    question: "What is {building.slug}'s market cap?",
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', fields: ['data.marketContext.contextOnly', 'data.marketContext.valuation', 'data.marketContext.tokenMarketStatus'], equals: { 'data.marketContext.contextOnly': true } },
  },
  {
    id: 'market-02',
    category: 'market_context',
    question: "Does the token price affect HEY's builder status for {building.slug}?",
    intent: 'builder_status',
    call: { transport: 'a2a', data: { skill: 'explain_fact', project: '{building.slug}', fact: 'activity.status', contract: 'agent-intelligence-v1' } },
    domainRead: [EXPLAIN],
    expect: { ...OK, capability: 'builder_status', includes: { 'data.excludedContext': STATUS_EXCLUDES } },
  },
  {
    id: 'market-03',
    category: 'market_context',
    question: 'Compare the market caps of {building.slug} and {second.slug}.',
    intent: 'compare_builders',
    call: { transport: 'rest', capability: 'compare_builders', query: { projects: '{building.slug},{second.slug}' } },
    domainRead: [COMPARE],
    expect: { ...OK, capability: 'compare_builders', includes: { 'data.excludedContext': ['valuation', 'liquidity_and_volume'] } },
    note: 'The builder comparison states that it leaves valuation out; market figures stay on the research answer as context.',
  },
  {
    id: 'market-04',
    category: 'market_context',
    question: 'What is the liquidity of {tokenless.slug}?',
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{tokenless.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', equals: { 'data.contractIdentity.token': null } },
  },

  /* ---------------------------------------------------------- comparison */
  {
    id: 'compare-01',
    category: 'comparison',
    question: "Compare {building.slug}'s and {second.slug}'s building activity.",
    intent: 'compare_builders',
    call: { transport: 'rest', capability: 'compare_builders', query: { projects: '{building.slug},{second.slug}' } },
    domainRead: [COMPARE, SNAPSHOT],
    expect: { ...OK, capability: 'compare_builders', fields: COMPARE_FIELDS, order: { 'data.projects': ['{building.slug}', '{second.slug}'] }, equals: { 'data.order': 'as_requested', 'data.windowDays': 30 } },
  },
  {
    id: 'compare-02',
    category: 'comparison',
    question: 'Compare {building.slug}, {second.slug} and {third.slug} over 30 days.',
    intent: 'compare_builders',
    call: { transport: 'a2a', data: { skill: 'compare_projects', projects: ['{building.slug}', '{second.slug}', '{third.slug}'], contract: 'agent-intelligence-v1' } },
    domainRead: [COMPARE, SNAPSHOT],
    expect: { ...OK, capability: 'compare_builders', order: { 'data.projects': ['{building.slug}', '{second.slug}', '{third.slug}'] } },
  },
  {
    id: 'compare-03',
    category: 'comparison',
    question: 'Compare {building.slug} with {unpublished.slug}.',
    intent: 'compare_builders',
    call: { transport: 'rest', capability: 'compare_builders', query: { projects: '{building.slug},{unpublished.slug}' } },
    domainRead: [COMPARE],
    // Adversarial review (2026-09-30): one of two found was `ok`, so an agent had to read `missing` to learn nothing was compared.
    expect: { ...NOT_FOUND, capability: 'compare_builders', errorCode: 'too_few_projects_found', includes: { 'data.missing': ['{unpublished.slug}'] }, order: { 'data.projects': ['{building.slug}'] }, equals: { 'data.completeness': 'not_compared' } },
    note: 'A project HEY does not publish is named as missing, never silently dropped or guessed; with fewer than two found, no comparison is made and the refusal says so.',
  },
  {
    id: 'compare-04',
    category: 'comparison',
    question: 'Put {second.slug} next to {building.slug}.',
    intent: 'compare_builders',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'compare_builders', projects: ['{second.slug}', '{building.slug}'] } },
    domainRead: [COMPARE, SNAPSHOT],
    expect: { ...OK, capability: 'compare_builders' },
  },

  /* ------------------------------------------------------------ unknowns */
  {
    id: 'unknowns-01',
    category: 'unknowns',
    question: 'What does HEY not know about {building.slug}?',
    intent: 'unknowns',
    call: { transport: 'rest', capability: 'unknowns', query: { project: '{building.slug}' } },
    domainRead: [COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', fields: UNKNOWN_FIELDS },
  },
  {
    id: 'unknowns-02',
    category: 'unknowns',
    question: 'What does HEY not know about {noSources.slug}?',
    intent: 'unknowns',
    call: { transport: 'rest', capability: 'unknowns', query: { project: '{noSources.slug}' } },
    domainRead: [COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', fields: UNKNOWN_FIELDS, unknowns: 'required' },
  },
  {
    id: 'unknowns-03',
    category: 'unknowns',
    question: 'What does HEY not know about the token {second.address}?',
    intent: 'unknowns',
    call: { transport: 'rest', capability: 'unknowns', query: { address: '{second.address}' } },
    domainRead: [TOKEN, COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', equals: { 'subject.project.slug': '{second.slug}' } },
  },
  {
    id: 'unknowns-04',
    category: 'unknowns',
    question: 'Before I rely on HEY for {third.slug}, what is missing?',
    intent: 'unknowns',
    call: { transport: 'a2a', data: { skill: 'check_project_coverage', project: '{third.slug}', contract: 'agent-intelligence-v1' } },
    domainRead: [COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', fields: UNKNOWN_FIELDS },
  },

  /* ----------------------------------------------------------- freshness */
  {
    id: 'freshness-01',
    category: 'freshness',
    question: "How current is HEY's view of {building.slug}?",
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', freshness: ['activity_score', 'builder_sources'] },
  },
  {
    id: 'freshness-02',
    category: 'freshness',
    question: "When did HEY's change ledger last run?",
    intent: 'what_changed',
    call: { transport: 'rest', capability: 'what_changed', query: { days: '1', limit: '1' } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed', fields: ['data.ledger.projectorRanAt', 'data.ledger.newestRecordedAt', 'data.ledger.collectionStart'], freshness: ['change_ledger'] },
  },
  {
    id: 'freshness-03',
    category: 'freshness',
    question: "Is HEY's data on {quiet.slug} stale?",
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{quiet.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', freshness: ['activity_score'] },
  },
  {
    id: 'freshness-04',
    category: 'freshness',
    question: "When will HEY next refresh {building.slug}'s builder sources?",
    intent: 'builder_status',
    call: { transport: 'rest', capability: 'builder_status', query: { project: '{building.slug}' } },
    domainRead: [EXPLAIN],
    expect: { ...OK, capability: 'builder_status', freshness: ['builder_sources', 'activity_score'] },
  },

  /* ------------------------------------------------------------ evidence */
  {
    id: 'evidence-01',
    category: 'evidence',
    question: "What evidence supports {building.slug}'s builder status?",
    intent: 'builder_status',
    call: { transport: 'rest', capability: 'builder_status', query: { project: '{building.slug}' } },
    domainRead: [EXPLAIN, '/api/evidence/{id}'],
    expect: { ...OK, capability: 'builder_status', fields: ['data.supportingEvidence'], evidence: 'required' },
  },
  {
    id: 'evidence-02',
    category: 'evidence',
    question: "Show me the evidence for {building.slug}'s releases this month.",
    intent: 'what_changed',
    call: { transport: 'rest', capability: 'what_changed', query: { project: '{building.slug}', days: '30', types: 'build.release' } },
    domainRead: [CHANGES, '/api/evidence/{id}'],
    expect: { ...OK, capability: 'what_changed', evidence: 'when_items' },
  },
  {
    id: 'evidence-03',
    category: 'evidence',
    question: "What backs HEY's research on {second.slug}?",
    intent: 'research_project',
    call: { transport: 'a2a', data: { skill: 'research_project', project: '{second.slug}', contract: 'agent-intelligence-v1' } },
    domainRead: [SNAPSHOT, '/api/evidence/{id}'],
    expect: { ...OK, capability: 'research_project', fields: ['claims', 'evidence', 'methodology.rules'] },
  },
  {
    id: 'evidence-04',
    category: 'evidence',
    question: "How do I cite HEY's answer on {building.slug} in a research receipt?",
    intent: 'research_project',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', fields: ['citation.kind', 'citation.url', 'citation.asOf', 'citation.scoringVersion'], equals: { 'citation.kind': 'hey_agent_answer', 'citation.project': '{building.slug}' } },
  },

  /* ----------------------------------------------------------- malformed */
  {
    id: 'malformed-01',
    category: 'malformed',
    question: 'What changed in the last 0 days?',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'what_changed', query: { days: '0' } },
    domainRead: [],
    expect: { ...INVALID, capability: 'what_changed', errorCode: 'invalid_request' },
  },
  {
    id: 'malformed-02',
    category: 'malformed',
    question: 'Whose contract is 0x123?',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'verify_project', query: { address: '0x123' } },
    domainRead: [],
    expect: { ...INVALID, capability: 'verify_project', errorCode: 'invalid_request' },
  },
  {
    id: 'malformed-03',
    category: 'malformed',
    question: 'Compare {building.slug}.',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'compare_builders', query: { projects: '{building.slug}' } },
    domainRead: [],
    expect: { ...INVALID, capability: 'compare_builders', errorCode: 'invalid_request' },
  },
  {
    id: 'malformed-04',
    category: 'malformed',
    question: 'Research {building.slug} with a parameter the capability does not take.',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}', include: 'everything' } },
    domainRead: [],
    expect: { ...INVALID, capability: 'research_project', errorCode: 'invalid_request' },
    note: 'An unknown parameter is refused, never dropped in silence.',
  },
  {
    id: 'malformed-05',
    category: 'malformed',
    question: 'What does HEY not know about {building.slug} and {second.address} at once?',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'unknowns', query: { project: '{building.slug}', address: '{second.address}' } },
    domainRead: [],
    expect: { ...INVALID, capability: 'unknowns', errorCode: 'invalid_request' },
  },
  {
    id: 'malformed-06',
    category: 'malformed',
    question: 'Explain the Build Momentum of {building.slug} with the agent contract.',
    intent: 'refuse',
    call: { transport: 'a2a', data: { skill: 'explain_fact', project: '{building.slug}', fact: 'build.momentum', contract: 'agent-intelligence-v1' } },
    domainRead: [],
    expect: { http: [200], outcome: 'rpc_error' },
    note: 'With the contract, explain_fact answers builder_status only; another fact is a JSON-RPC invalid-params error.',
  },
  {
    id: 'malformed-07',
    category: 'malformed',
    question: 'Research a project without naming it.',
    intent: 'refuse',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'research_project' } },
    domainRead: [],
    expect: { http: [200], outcome: 'tool_error' },
  },
  {
    id: 'malformed-08',
    category: 'malformed',
    question: 'What changed with "{building.slug}; drop table projects"?',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'what_changed', query: { project: '{building.slug}; drop table projects' } },
    domainRead: [],
    expect: { ...INVALID, capability: 'what_changed', errorCode: 'invalid_request' },
  },

  /* ---------------------------------------------------- ambiguous tickers */
  {
    id: 'ticker-01',
    category: 'ambiguous_ticker',
    question: 'What is {tickerTwins.symbol}?',
    intent: 'identity_lookup',
    call: { transport: 'get', path: '/api/search/suggest?q={tickerTwins.symbol}' },
    domainRead: ['/api/search/suggest'],
    expect: { ...OK, ambiguousSymbol: '{tickerTwins.symbol}' },
    note: 'A ticker is not an identity (chain + address is): the lookup lists every holder of the ticker, each with its own contract.',
  },
  {
    id: 'ticker-02',
    category: 'ambiguous_ticker',
    question: 'Research ${tickerTwins.symbol}.',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'research_project', query: { project: '${tickerTwins.symbol}' } },
    domainRead: [],
    expect: { ...INVALID, capability: 'research_project', errorCode: 'invalid_request' },
    note: 'The contract takes a slug or an address, never a ticker.',
  },
  {
    id: 'ticker-03',
    category: 'ambiguous_ticker',
    question: 'What does HEY not know about the {tickerTwins.symbol} at {tickerTwins.b.address}?',
    intent: 'unknowns',
    call: { transport: 'rest', capability: 'unknowns', query: { address: '{tickerTwins.b.address}' } },
    domainRead: [TOKEN, COVERAGE],
    expect: { ...OK, capability: 'unknowns', equals: { 'subject.project.slug': '{tickerTwins.b.slug}' } },
  },
  {
    id: 'ticker-04',
    category: 'ambiguous_ticker',
    question: 'Is {tickerTwins.b.address} the {tickerTwins.a.slug} token?',
    intent: 'verify_project',
    call: { transport: 'rest', capability: 'verify_project', query: { address: '{tickerTwins.b.address}', project: '{tickerTwins.a.slug}' } },
    domainRead: [TOKEN, CONTRACT],
    expect: { ...OK, capability: 'verify_project', equals: { 'data.verdict': 'CONTRACT_MISMATCH', 'data.recordedProject.slug': '{tickerTwins.b.slug}' } },
  },

  /* ---------------------------------------------------------- unsupported */
  {
    id: 'unsupported-01',
    category: 'unsupported',
    question: "Predict {building.slug}'s price next week.",
    intent: 'refuse',
    call: { transport: 'rest', capability: 'price_prediction', query: { project: '{building.slug}' } },
    domainRead: [],
    expect: { ...NO_CAPABILITY, boundary: 'prediction' },
  },
  {
    id: 'unsupported-02',
    category: 'unsupported',
    question: "Show me the PnL of the wallets holding {building.slug}'s token.",
    intent: 'refuse',
    call: { transport: 'rest', capability: 'wallet_pnl', query: { address: '{building.address}' } },
    domainRead: [],
    expect: { ...NO_CAPABILITY },
  },
  {
    id: 'unsupported-03',
    category: 'unsupported',
    question: 'Research {building.slug} on Ethereum mainnet.',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}', chainId: '1' } },
    domainRead: [],
    expect: { ...INVALID, capability: 'research_project', errorCode: 'unsupported_chain' },
  },
  {
    id: 'unsupported-04',
    category: 'unsupported',
    question: 'What is smart money buying on Robinhood Chain?',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'smart_money', query: {} },
    domainRead: [],
    expect: { ...NO_CAPABILITY, boundary: 'trading' },
  },

  /* ------------------------------------------------------------- trading */
  {
    id: 'trading-01',
    category: 'trading',
    question: 'Which token should I buy?',
    intent: 'boundary',
    call: { transport: 'rest', capability: 'what_changed', query: { days: '7', types: 'build.release,build.ship', limit: '10' } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed', boundary: 'trading', includes: { 'boundaries.notProvided': TRADE_CODES } },
    note: 'Mapped to the research HEY does hold — what shipped this week — with the boundary: no pick.',
  },
  {
    id: 'trading-02',
    category: 'trading',
    question: 'Which RH project will pump?',
    intent: 'boundary',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'what_changed', days: 7, types: ['build.release', 'build.ship'], limit: 10 } },
    domainRead: [CHANGES],
    expect: { ...OK, capability: 'what_changed', boundary: 'prediction' },
  },
  {
    id: 'trading-03',
    category: 'trading',
    question: 'Is this safe? {building.address}',
    intent: 'boundary',
    call: { transport: 'rest', capability: 'verify_project', query: { address: '{building.address}' } },
    domainRead: [TOKEN, CONTRACT],
    expect: { ...OK, capability: 'verify_project', boundary: 'safety', includes: { 'boundaries.notProvided': ['safety_verdict', 'risk_score'] } },
    note: 'Attribution is what HEY can say about a contract; never a safety verdict.',
  },
  {
    id: 'trading-04',
    category: 'trading',
    question: 'Is this a rug? {second.address}',
    intent: 'boundary',
    call: { transport: 'rest', capability: 'unknowns', query: { address: '{second.address}' } },
    domainRead: [TOKEN, COVERAGE, SNAPSHOT],
    expect: { ...OK, capability: 'unknowns', boundary: 'safety', includes: { 'boundaries.notProvided': ['safety_verdict', 'risk_score'] } },
  },
  {
    id: 'trading-05',
    category: 'trading',
    question: 'Which builder is the best investment?',
    intent: 'boundary',
    call: { transport: 'rest', capability: 'compare_builders', query: { projects: '{building.slug},{second.slug},{third.slug}' } },
    domainRead: [COMPARE, SNAPSHOT],
    expect: { ...OK, capability: 'compare_builders', boundary: 'ranking', equals: { 'data.order': 'as_requested' }, order: { 'data.projects': ['{building.slug}', '{second.slug}', '{third.slug}'] }, includes: { 'boundaries.notProvided': ['investment_recommendation', 'ranking_by_expected_return'] } },
  },
  {
    id: 'trading-06',
    category: 'trading',
    question: 'Should I sell {building.slug} now?',
    intent: 'boundary',
    call: { transport: 'a2a', data: { skill: 'explain_fact', project: '{building.slug}', contract: 'agent-intelligence-v1' } },
    domainRead: [EXPLAIN],
    expect: { ...OK, capability: 'builder_status', boundary: 'trading' },
  },
  {
    id: 'trading-07',
    category: 'trading',
    question: 'What price target and stop loss should I set for {building.slug}?',
    intent: 'boundary',
    call: { transport: 'rest', capability: 'research_project', query: { project: '{building.slug}' } },
    domainRead: [SNAPSHOT],
    expect: { ...OK, capability: 'research_project', boundary: 'trading', includes: { 'boundaries.notProvided': ['price_target', 'stop_loss', 'position_size', 'leverage'] } },
  },
  {
    id: 'trading-08',
    category: 'trading',
    question: 'Give me the best token to buy right now.',
    intent: 'refuse',
    call: { transport: 'rest', capability: 'best_token', query: {} },
    domainRead: [],
    expect: { ...NO_CAPABILITY, boundary: 'trading' },
    note: 'No capability is named for a trade: best_token, top_trade, buy_candidate and alpha do not exist.',
  },
  {
    id: 'trading-09',
    category: 'trading',
    question: 'Rank these projects by how much they will go up: {building.slug}, {second.slug}.',
    intent: 'boundary',
    call: { transport: 'mcp', tool: 'research_answer', arguments: { capability: 'compare_builders', projects: ['{building.slug}', '{second.slug}'] } },
    domainRead: [COMPARE, SNAPSHOT],
    expect: { ...OK, capability: 'compare_builders', boundary: 'ranking' },
  },
  {
    id: 'trading-10',
    category: 'trading',
    question: 'Call the MCP tool best_token.',
    intent: 'refuse',
    call: { transport: 'mcp', tool: 'best_token', arguments: {} },
    domainRead: [],
    expect: { http: [200], outcome: 'tool_error', boundary: 'trading' },
  },
];
