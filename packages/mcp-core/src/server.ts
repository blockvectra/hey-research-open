import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  DEFAULT_BASE_URL,
  HeyApiError,
  type HeyBuilderFilter,
  type HeyClient,
  type HeyExplainFact,
  type HeyProjectSurface,
  type HeyProjectsQuery,
} from '@hey-research/sdk';

import {
  renderAccelerating,
  renderAskAnswer,
  renderBuilders,
  renderChain,
  renderChanges,
  renderCompare,
  renderMarketIntegrity,
  renderMarketMoves,
  renderProjects,
  renderSilentBuilders,
  renderThisWeek,
  renderTimeline,
  renderTokenLookup,
  renderTokenMarket,
  renderUnlocks,
  renderWeeklyReport,
} from './render';
import { renderBuildMarket, renderContract, renderCoverage, renderDiff, renderEvidence, renderExplainIndex, renderExplained, renderProjectContracts, renderSnapshot } from './render-machine';
import { HEY_MCP_GATED_TOOLS, HEY_MCP_TOOLS, PUBLIC_CHANGE_TYPES, type HeyMcpToolName } from './tools';
import { MCP_VERSION } from './version';

/**
 * HEY Research as MCP tools (2026-09-05; reworked 2026-09-26).
 *
 * The question HEY exists to answer — *which projects on Robinhood Chain are
 * still building, what have they shipped, and which of them is nobody looking
 * at?* — is exactly the kind of question someone asks an assistant. These
 * tools let it be answered from HEY's own record instead of from guesswork.
 *
 * Fourteen tools, one per real question, over the canonical API (snapshot,
 * changes, coverage, explain, evidence, contracts, diff); `market_integrity`
 * only where the site publishes it. Every tool reads the public API through
 * the SDK's typed methods, so the MCP can say nothing the API does not; there
 * is deliberately no tool that ranks by price, values a token, or recommends
 * anything. The server has no transport of its own: `apps/mcp` connects stdio
 * and the web app mounts it at `/mcp`.
 *
 * The descriptions matter as much as the code: they are what the model reads
 * when deciding whether a tool fits, and what stops it reaching for HEY to
 * answer a question HEY cannot answer.
 */
const NOT_ADVICE =
  'HEY records public building activity. It is not investment advice, it does not predict or rank by price, and it holds no wallet data and no cross-token address data. The one exception is get_token_market: it returns one token\'s supply-concentration summary and names only that token\'s contract deployer. No other tool here returns holder data.';

/** The activity surfaces the site itself offers; held to the SDK's list, which the contract test holds to the domain's. */
const SURFACES = [
  'building-with-token',
  'still-building',
  'under-the-radar',
  'shipping-now',
  'most-active',
  'new-builders',
  'back-from-dormancy',
  'utility',
  'memes',
] as const satisfies readonly HeyProjectSurface[];
// And every one of them: a surface the SDK knows and this list lacks fails the build.
const ALL_SURFACES: [Exclude<HeyProjectSurface, (typeof SURFACES)[number]>] extends [never] ? true : false = true;
void ALL_SURFACES;

/** Views that read their own route and take none of the catalogue's filters. */
const VIEWS = ['shipping-in-silence', 'accelerating', 'builder-radar'] as const;

/**
 * One definition per surface (2026-09-26, M2 G1/G2), in the domain's words.
 * `under-the-radar` is a positive Discovery Gap, not "little attention";
 * `back-from-dormancy` is narrower than every RESUMED project.
 */
const SURFACE_HELP = [
  'building-with-token: verified shipping, active or resumed, with a token whose market is live.',
  'still-building: verified activity continuing through a market drawdown HEY tracked.',
  'under-the-radar: a positive Discovery Gap — market-attention percentile below the build percentile; it does not bound attention itself.',
  'shipping-now: status SHIPPING. most-active: shipping, active or resumed, by Build Momentum.',
  'new-builders: recorded in the last 7 days.',
  'back-from-dormancy: status RESUMED, narrowed to verified builders native to the chain (status=RESUMED gives every resumed project).',
  'utility, memes: by kind.',
  'shipping-in-silence: under-the-radar AND below the 40th market-attention percentile.',
  'accelerating: more meaningful events in 30 days than in the 30 before.',
  'builder-radar: the Builder Radar, ranked by verified development, on-chain use and research, never price.',
  'shipping-in-silence and accelerating take no other argument (at most 100 rows); builder-radar takes query, radar, limit and offset.',
].join(' ');

const KINDS = ['UTILITY', 'MEME', 'HYBRID', 'INFRASTRUCTURE', 'RWA', 'APPLICATION', 'OTHER'] as const;
const STATUSES = ['SHIPPING', 'ACTIVE', 'QUIET', 'DORMANT', 'RESUMED', 'UNKNOWN'] as const;
const FACTS = ['token', 'x', 'marketCap', 'launchpad', 'liveMarket', 'verifiedToken', 'trading', 'github'] as const;
const STAGES = ['curve', 'graduated', 'dex'] as const;
const AGES = ['day', 'week', 'month', 'older'] as const;
const RADAR = ['all', 'pons', 'virtuals', 'other-launch', 'no-token', 'new', 'established', 'most-improved', 'development', 'onchain', 'resumed'] as const satisfies readonly HeyBuilderFilter[];
const EXPLAIN = ['market.valuation', 'market.status', 'activity.status', 'build.momentum', 'discovery_gap', 'still_building', 'research.level', 'token.verification', 'source.counted', 'market_integrity.state'] as const satisfies readonly HeyExplainFact[];
const ALL_EXPLAIN: [Exclude<HeyExplainFact, (typeof EXPLAIN)[number]>] extends [never] ? true : false = true;
void ALL_EXPLAIN;

const ADDRESS = /^0[xX][a-fA-F0-9]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Output cap per call (2026-09-26): 24 KB of text, cut on a line, with what was cut and where the whole is. */
export const MAX_OUTPUT_BYTES = 24 * 1024;

export function capOutput(text: string, canonicalUrl: string, maxBytes = MAX_OUTPUT_BYTES): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return { text, truncated: false };
  const lines = text.split('\n');
  const kept: string[] = [];
  let bytes = 0;
  const budget = maxBytes - 400;
  for (const line of lines) {
    const size = encoder.encode(line).length + 1;
    if (bytes + size > budget) break;
    kept.push(line);
    bytes += size;
  }
  const omitted = lines.length - kept.length;
  kept.push('', `[Output cut at ${Math.round(maxBytes / 1024)} KB: ${omitted} more line${omitted === 1 ? '' : 's'} not shown. Ask for fewer rows (limit, days) or read the whole answer at ${canonicalUrl}.]`);
  return { text: kept.join('\n'), truncated: true };
}

/**
 * A failure a model can act on: what went wrong and whether retrying helps,
 * rather than a stack trace it will paraphrase into a wrong answer. The two
 * things only this server knows are added: that the key came from
 * `HEY_API_KEY`, and how long a rate limit asked it to wait.
 */
const failureText = (error: unknown): string => {
  if (!(error instanceof HeyApiError)) return `Could not read HEY: ${error instanceof Error ? error.message : String(error)}`;
  if (error.code === 'unauthorized') return `${error.message} Check HEY_API_KEY against your HEY account page.`;
  if (error.retryAfterSeconds !== undefined && !/try again in/i.test(error.message)) {
    return `${error.message} Try again in ${error.retryAfterSeconds} seconds.`;
  }
  return error.message;
};

/** What happened to one tool call or resource read, for whoever mounted the server (the hosted route records it). */
export type HeyMcpCallEvent = { tool: string; ok: boolean; truncated: boolean; bytes: number; ms: number };

export type HeyMcpOptions = {
  /**
   * Offer `market_integrity` (2026-09-25). Mirrors the site's own gate: the
   * route answers 404 until `HEY_MARKET_INTEGRITY` reaches `public`, so a tool
   * that calls it is not offered until the operator says the same.
   */
  marketIntegrity?: boolean;
  /** Where the canonical API answers for a reader: the `resource_link` on every result. Defaults to the public site. */
  publicBaseUrl?: string;
  /** Told after every tool call and resource read. Never throws into the call. */
  onCall?: (event: HeyMcpCallEvent) => void;
};

/** The site's exposure flag, read the same way: only `public` publishes Market Integrity. Fail closed. */
export const marketIntegrityFromEnv = (value: string | undefined): boolean => value?.trim().toLowerCase() === 'public';

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

type Query = Record<string, string | number | boolean | readonly string[] | undefined>;

export function createHeyMcpServer(client: HeyClient, now?: () => Date, options: HeyMcpOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'hey-research', version: MCP_VERSION },
    {
      instructions: [
        'HEY Research Lab is the builder-discovery layer for Robinhood Chain (chain id 4663).',
        'It answers: which projects are still building, what they shipped, and which of them the market is not yet weighting as heavily as their building.',
        '',
        'Start with get_project_snapshot for one project, get_changes for "what changed", find_projects to find or browse, get_project_coverage for what HEY does not know.',
        'Lines are tagged FACT (recorded, with its source), DERIVED (a rule HEY applied) or UNKNOWN (not held). Absent means HEY does not know: a missing valuation is not zero, and a project with no measures has not been measured.',
        'Every listing says how many it showed of how many, and how to read on. Quote the evidence URLs; never state a cause HEY did not record.',
        '',
        NOT_ADVICE,
      ].join('\n'),
    },
  );

  const at = () => now?.() ?? new Date();
  const publicBase = (options.publicBaseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiUrl = (path: string, query: Query = {}): string => {
    const url = new URL(`${publicBase}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return url.toString();
  };
  const report = (event: HeyMcpCallEvent) => {
    try {
      options.onCall?.(event);
    } catch {
      // Counting a call is never the caller's problem.
    }
  };

  /**
   * Run one tool: read, render, cap, link the canonical answer, and report.
   * `canonical` is the API URL the text was rendered from, returned as a
   * `resource_link` so a client can fetch the JSON behind the prose.
   */
  const run = async (tool: HeyMcpToolName, canonical: string, render: () => Promise<string>): Promise<CallToolResult> => {
    const started = Date.now();
    try {
      const { text, truncated } = capOutput(await render(), canonical);
      report({ tool, ok: true, truncated, bytes: new TextEncoder().encode(text).length, ms: Date.now() - started });
      return {
        content: [
          { type: 'text', text },
          { type: 'resource_link', uri: canonical, name: `${tool} (API)`, mimeType: 'application/json', description: 'The public API answer this text was rendered from.' },
        ],
      };
    } catch (error) {
      const text = failureText(error);
      report({ tool, ok: false, truncated: false, bytes: text.length, ms: Date.now() - started });
      return { content: [{ type: 'text', text }], isError: true };
    }
  };

  const describe = (name: HeyMcpToolName, lines: string[]) => ({ title: [...HEY_MCP_TOOLS, ...HEY_MCP_GATED_TOOLS].find((tool) => tool.name === name)!.title, description: lines.join(' '), annotations: READ_ONLY });
  const slug = z.string().min(1).max(120).describe('A project slug, e.g. "agentos".');

  server.registerTool(
    'find_projects',
    {
      ...describe('find_projects', [
        'Find Robinhood Chain projects by name, ticker or contract, or browse one of HEY\'s surfaces. A full 0x address is answered as lookup_token would.',
        'Surfaces:',
        SURFACE_HELP,
        'Not a ranking by price: a market order is context the caller asked for, and rows without the figure follow in activity order.',
      ]),
      inputSchema: {
        query: z.string().min(2).max(120).optional().describe('Name, ticker or contract (or its start).'),
        surface: z.enum([...SURFACES, ...VIEWS]).optional(),
        radar: z.enum(RADAR).optional().describe('With surface=builder-radar: a Radar view.'),
        kind: z.enum(KINDS).optional(),
        status: z.enum(STATUSES).optional().describe('Activity status.'),
        narrative: z.string().max(80).optional().describe('Narrative slug, e.g. "ai-agents".'),
        launchpad: z.string().max(40).optional().describe('e.g. "pons", "virtuals".'),
        has: z.array(z.enum(FACTS)).optional().describe('Facts every row must carry.'),
        stage: z.enum(STAGES).optional().describe('Token launch stage.'),
        minLiquidity: z.number().positive().optional().describe('USD; unknown is excluded, never zero.'),
        maxMarketCap: z.number().positive().optional().describe('USD, on the card\'s valuation reading.'),
        minMarketCap: z.number().positive().optional(),
        minVolume: z.number().positive().optional().describe('24h volume, USD.'),
        age: z.enum(AGES).optional().describe('Since the first pool opened.'),
        deployed: z.enum(AGES).optional().describe('Since the contract was deployed.'),
        sort: z.enum(['activity', 'shipped', 'marketCap', 'newest', 'liquidity', 'volume24h']).optional().describe('Default activity (card completeness, then activity); shipped = most recently shipped first.'),
        limit: z.number().int().min(1).max(48).optional().describe('Default 24.'),
        offset: z.number().int().min(0).optional().describe('The offset a previous answer gave.'),
      },
    },
    async (args) => {
      if (args.query && ADDRESS.test(args.query.trim())) {
        const address = args.query.trim();
        return run('find_projects', apiUrl(`/api/token/4663/${address}`), async () => renderTokenLookup(await client.token.lookup(4663, address), at()));
      }
      /*
       * The three views read their own routes and take none of the catalogue's
       * filters. A filter the caller sent is named as not applied, never
       * dropped in silence (the same rule as the API's query echo).
       */
      const unused = (kept: readonly string[]) => {
        const sent = Object.entries(args).filter(([name, value]) => value !== undefined && name !== 'surface' && !kept.includes(name)).map(([name]) => name);
        return sent.length > 0 ? `Not applied to this view: ${sent.join(', ')}.\n` : '';
      };
      if (args.surface === 'shipping-in-silence') return run('find_projects', apiUrl('/api/chain/silence'), async () => `${unused([])}${renderSilentBuilders(await client.silence())}`);
      if (args.surface === 'accelerating') return run('find_projects', apiUrl('/api/chain/accelerating'), async () => `${unused([])}${renderAccelerating(await client.accelerating())}`);
      if (args.surface === 'builder-radar') {
        const query = { filter: args.radar, q: args.query, limit: args.limit ?? 25, offset: args.offset };
        return run('find_projects', apiUrl('/api/builders', query), async () => `${unused(['radar', 'query', 'limit', 'offset'])}${renderBuilders(await client.builders.list(query), at())}`);
      }
      const query: HeyProjectsQuery = {
        ...(args.query ? { q: args.query } : {}),
        ...(args.surface ? { tab: args.surface } : {}),
        ...(args.kind ? { kind: args.kind } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.narrative ? { narrative: args.narrative } : {}),
        ...(args.launchpad ? { launchpad: args.launchpad } : {}),
        ...(args.has ? { has: args.has } : {}),
        ...(args.stage ? { stage: args.stage } : {}),
        ...(args.minLiquidity !== undefined ? { minLiquidity: args.minLiquidity } : {}),
        ...(args.maxMarketCap !== undefined ? { maxMarketCap: args.maxMarketCap } : {}),
        ...(args.minMarketCap !== undefined ? { minMarketCap: args.minMarketCap } : {}),
        ...(args.minVolume !== undefined ? { minVolume: args.minVolume } : {}),
        ...(args.age ? { age: args.age } : {}),
        ...(args.deployed ? { deployed: args.deployed } : {}),
        ...(args.sort ? { sort: args.sort } : {}),
        limit: args.limit ?? 24,
        ...(args.offset !== undefined ? { offset: args.offset } : {}),
      };
      return run('find_projects', apiUrl('/api/projects', query), async () => {
        const page = await client.projects.list(query);
        return `${args.radar ? 'Note: radar applies only with surface=builder-radar and was not used.\n' : ''}${renderProjects(page, at())}`;
      });
    },
  );

  server.registerTool(
    'lookup_token',
    {
      ...describe('lookup_token', [
        'One project by its contract address — use this whenever the user pastes a contract.',
        "It answers HEY's one question about that address: is anyone building it. The activity status in HEY's words, ship records in 30 days, the last ship with its source, and whether the project names this contract.",
        'An address HEY publishes no page for answers "unknown" with a scan link: an answer, not an error. No risk reading, score or verdict.',
      ]),
      inputSchema: {
        address: z.string().regex(ADDRESS).describe('0x followed by 40 hex characters.'),
        chainId: z.number().int().optional().describe('Default 4663, Robinhood Chain.'),
      },
    },
    async ({ address, chainId }) => run('lookup_token', apiUrl(`/api/token/${chainId ?? 4663}/${address}`), async () => renderTokenLookup(await client.token.lookup(chainId ?? 4663, address), at())),
  );

  server.registerTool(
    'get_project_snapshot',
    {
      ...describe('get_project_snapshot', [
        'Everything important about one project in one read: identity and when HEY first recorded it, build status and Build Momentum, market context with its kind or why it is withheld,',
        'on-chain use, verification and sources, HoodLock locks, the latest changes, freshness and what HEY does not know. Use this first for "tell me about X".',
      ]),
      inputSchema: { slug },
    },
    async ({ slug }) => run('get_project_snapshot', apiUrl(`/api/projects/${encodeURIComponent(slug)}/snapshot`), async () => renderSnapshot(await client.projects.snapshot(slug), at())),
  );

  server.registerTool(
    'get_changes',
    {
      ...describe('get_changes', [
        'The canonical change ledger: what changed on Robinhood Chain or on one project — releases, ships, status moves, contract deployments, implementation and interface changes,',
        'verification, publication, sources, scheduled unlocks — one event per change, with its own time and precision, when HEY first knew, and its evidence.',
        'Use this for "what changed", "what happened since", "anything new on X". Browse newest first by default; to follow along pass after=c1.0 (or a kept cursor) and keep the cursor each answer gives.',
        'A retraction means HEY no longer makes that claim. Facts, never causes.',
      ]),
      inputSchema: {
        project: z.string().max(120).optional().describe('A project slug.'),
        contract: z.string().regex(/^\d{1,10}:0x[0-9a-fA-F]{40}$/).optional().describe('<chainId>:<address>.'),
        domain: z.array(z.enum(['build', 'contract', 'market', 'token', 'research', 'lock'])).optional(),
        type: z.array(z.enum(PUBLIC_CHANGE_TYPES)).optional(),
        since: z.string().max(40).optional().describe('ISO date: events whose own time is at or after it (events with no source time are left out).'),
        until: z.string().max(40).optional(),
        detectedSince: z.string().max(40).optional().describe('ISO instant: start a sync at the first event HEY recorded at or after it.'),
        after: z.string().max(64).optional().describe('Sync forward from this cursor (c1.0 is the start).'),
        before: z.string().max(64).optional().describe('Browse older than this cursor.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 30.'),
      },
    },
    async (args) => {
      const query = {
        ...(args.project ? { project: args.project } : {}),
        ...(args.contract ? { contract: args.contract } : {}),
        ...(args.domain ? { domain: args.domain } : {}),
        ...(args.type ? { type: args.type } : {}),
        ...(args.since ? { since: args.since } : {}),
        ...(args.until ? { until: args.until } : {}),
        ...(args.detectedSince ? { detectedSince: args.detectedSince } : {}),
        ...(args.after ? { after: args.after } : {}),
        ...(args.before ? { before: args.before } : {}),
        limit: args.limit ?? 30,
      };
      return run('get_changes', apiUrl('/api/changes', query), async () => renderChanges(await client.changes.list(query)));
    },
  );

  server.registerTool(
    'get_project_timeline',
    {
      ...describe('get_project_timeline', [
        "One project's research timeline: builds, releases, code, contract deploys, upgrades and interface changes, token verification, locks and scheduled unlocks,",
        'each with how precisely HEY knows its time. Lenses: everything, build, code, onchain, market, locks. Paged with the before cursor each answer gives.',
      ]),
      inputSchema: {
        slug,
        lens: z.enum(['everything', 'build', 'code', 'onchain', 'market', 'locks']).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 30.'),
        before: z.string().max(400).optional().describe('The cursor the previous answer gave.'),
      },
    },
    async ({ slug, lens, limit, before }) => {
      const size = limit ?? 30;
      const query = { lens, limit: size, before };
      return run('get_project_timeline', apiUrl(`/api/projects/${encodeURIComponent(slug)}/timeline`, query), async () => renderTimeline(await client.projects.timeline(slug, { ...(lens ? { lens } : {}), limit: size, ...(before ? { before } : {}) }), size));
    },
  );

  server.registerTool(
    'get_project_coverage',
    {
      ...describe('get_project_coverage', [
        'What HEY knows and does not about one project, per dimension — builder evidence, repositories, releases, current and historical market, contracts, distribution, locks, market integrity, timeline —',
        'as states (MEASURED, NO_SOURCE, NOT_ENOUGH_YET, STALE, SOURCE_UNAVAILABLE, NOT_APPLICABLE, NOT_RESEARCHED, ERROR, WITHHELD), never a score. Read it before concluding anything from an absence.',
      ]),
      inputSchema: { slug },
    },
    async ({ slug }) => run('get_project_coverage', apiUrl(`/api/projects/${encodeURIComponent(slug)}/coverage`), async () => renderCoverage(await client.projects.coverage(slug))),
  );

  server.registerTool(
    'explain_fact',
    {
      ...describe('explain_fact', [
        'Why HEY publishes a fact about one project: the value, whether it is FACT, DERIVED or UNKNOWN, the canonical rule and its version, the winning source and why, the inputs,',
        'the lineage from source to public value, and the evidence ids. Omit fact to list what can be explained. source.counted takes a source id.',
      ]),
      inputSchema: {
        slug,
        fact: z.enum(EXPLAIN).optional(),
        source: z.string().max(80).optional().describe('With fact=source.counted: the source id.'),
      },
    },
    async ({ slug, fact, source }) => {
      const canonical = apiUrl(`/api/projects/${encodeURIComponent(slug)}/explain`, { fact, source });
      if (!fact) return run('explain_fact', canonical, async () => renderExplainIndex(await client.projects.explain(slug)));
      return run('explain_fact', canonical, async () => renderExplained(await client.projects.explain(slug, fact, source ? { source } : {})));
    },
  );

  server.registerTool(
    'get_evidence',
    {
      ...describe('get_evidence', [
        'Open one published record by its typed id — ship:, signal:, abi:, impl:, lock:, source:, claim:, state: — as a receipt: what it claims, its source URL, when it happened',
        'at what precision, when HEY knew, how it is backed. Ids come from get_changes, get_project_timeline, explain_fact and the snapshot. A withdrawn record says so.',
      ]),
      inputSchema: { id: z.string().regex(/^[a-z_]+:[A-Za-z0-9:._-]{1,200}$/).describe('A typed evidence id, e.g. "ship:2ac87a66-…".') },
    },
    async ({ id }) => run('get_evidence', apiUrl(`/api/evidence/${encodeURIComponent(id)}`), async () => renderEvidence(await client.evidence.get(id))),
  );

  server.registerTool(
    'get_token_market',
    {
      ...describe('get_token_market', [
        "One token's market from HEY's own daily index: the current reading with its valuation kind and provider, price, liquidity, volume and trades by day, the lifecycle",
        '(deploy, the launchpad\'s claim, stage, first indexed trade), pools and depth, a supply-concentration summary (shares only, no addresses), contract checks and events by day.',
        'include=["moves"] adds each day-on-day valuation move with the building events published before it — a sequence, never a cause. Context, never a recommendation.',
      ]),
      inputSchema: {
        slug,
        days: z.number().int().min(1).max(400).optional().describe('Days of history; default 30.'),
        include: z.array(z.enum(['moves'])).optional(),
        min_change_pct: z.number().int().min(5).max(500).optional().describe('With moves: smallest move in percent; default 25.'),
      },
    },
    async ({ slug, days, include, min_change_pct }) =>
      run('get_token_market', apiUrl(`/api/projects/${encodeURIComponent(slug)}/market`, { days }), async () => {
        const market = renderTokenMarket(await client.projects.market(slug, days === undefined ? {} : { days }), at());
        if (!include?.includes('moves')) return market;
        const moves = await client.projects.marketMoves(slug, { ...(days === undefined ? {} : { days: Math.max(7, Math.min(365, days)) }), ...(min_change_pct === undefined ? {} : { min: min_change_pct }) });
        return `${market}\n\n${renderMarketMoves(moves)}`;
      }),
  );

  server.registerTool(
    'get_contract',
    {
      ...describe('get_contract', [
        'A contract as a research entity: creation, deployer (the only account ever named), factory, verified source and compiler, proxy kind and implementation history,',
        'interface size and changes (counts), and activity. Give chainId and address for one contract, or slug for every contract a project has. A proxy HEY did not read is "not read", never "not a proxy".',
      ]),
      inputSchema: {
        address: z.string().regex(ADDRESS).optional(),
        chainId: z.number().int().optional().describe('Default 4663.'),
        slug: slug.optional().describe('A project slug, for all of its contracts.'),
      },
    },
    async ({ address, chainId, slug }) => {
      if (address) return run('get_contract', apiUrl(`/api/contracts/${chainId ?? 4663}/${address.toLowerCase()}`), async () => renderContract(await client.contracts.get(chainId ?? 4663, address)));
      if (slug) return run('get_contract', apiUrl(`/api/projects/${encodeURIComponent(slug)}/contracts`), async () => renderProjectContracts(await client.projects.contracts(slug)));
      return { content: [{ type: 'text', text: 'Give an address (and chainId, default 4663), or a project slug.' }], isError: true };
    },
  );

  server.registerTool(
    'project_diff',
    {
      ...describe('project_diff', [
        'What changed for one project between two dates (YYYY-MM-DD, at most 400 days apart): releases and meaningful ships, status and Build Momentum then and now,',
        'valuation and liquidity then and now, and the changes recorded — each value from the nearest persisted point with its date and basis; none HEY did not persist. Never a cause.',
      ]),
      inputSchema: { slug, from: z.string().regex(DAY), to: z.string().regex(DAY) },
    },
    async ({ slug, from, to }) => run('project_diff', apiUrl(`/api/projects/${encodeURIComponent(slug)}/diff`, { from, to }), async () => renderDiff(await client.projects.diff(slug, { from, to }))),
  );

  server.registerTool(
    'compare_projects',
    {
      ...describe('compare_projects', ['Two to four Robinhood Chain projects side by side: activity status, last ship, Build Momentum, velocity, cadence, verification and market context — each line FACT, DERIVED or UNKNOWN. No winner and no recommendation.']),
      inputSchema: { slugs: z.array(z.string().min(1).max(120)).min(2).max(4).describe('Two to four slugs.') },
    },
    async ({ slugs }) => run('compare_projects', apiUrl('/api/compare', { slugs }), async () => renderCompare(await client.projects.compare(slugs))),
  );

  server.registerTool(
    'ask_hey',
    {
      ...describe('ask_hey', [
        'A free-text question about one project (English or Malay). HEY matches it to the parts of its record it is about and answers only from that record,',
        'every line tagged FACT, DERIVED or UNKNOWN with its source. It records building only and offers no view on price.',
      ]),
      inputSchema: { slug, question: z.string().min(3).max(280).describe('The question, in the reader\'s words.') },
    },
    async ({ slug, question }) => run('ask_hey', apiUrl(`/api/projects/${encodeURIComponent(slug)}/ask`, { q: question }), async () => renderAskAnswer(await client.projects.ask(slug, question))),
  );

  server.registerTool(
    'chain_overview',
    {
      ...describe('chain_overview', [
        'Robinhood Chain as a whole. view: days (default; trades, volume, tokens, transactions, launches, ships per day), this-week (the rollup), weekly-report (an archived ISO week, or the latest),',
        'unlocks (scheduled HoodLock unlocks with proof), build-market (Build Momentum beside market attention, a map). Aggregates only; nobody is named.',
      ]),
      inputSchema: {
        view: z.enum(['days', 'this-week', 'weekly-report', 'unlocks', 'build-market']).optional(),
        days: z.number().int().min(1).max(400).optional().describe('days: 1–400 (default 14); unlocks: 1–365 ahead (default 30).'),
        week: z.string().regex(/^\d{4}-W\d{2}$/).optional().describe('weekly-report: e.g. 2026-W37.'),
      },
    },
    async ({ view, days, week }) => {
      switch (view ?? 'days') {
        case 'this-week':
          return run('chain_overview', apiUrl('/api/this-week'), async () => renderThisWeek(await client.thisWeek()));
        case 'weekly-report':
          return run('chain_overview', apiUrl(week ? `/api/reports/weekly/${week}` : '/api/reports/weekly'), async () => {
            const key = week ?? (await client.reports.weekly.list()).items[0]?.week;
            if (!key) return 'No weekly report has been archived yet.';
            return renderWeeklyReport(await client.reports.weekly.get(key));
          });
        case 'unlocks': {
          const ahead = days === undefined ? undefined : Math.min(365, days);
          return run('chain_overview', apiUrl('/api/chain/unlocks', { days: ahead }), async () => renderUnlocks(await client.unlocks(ahead === undefined ? {} : { days: ahead })));
        }
        case 'build-market':
          return run('chain_overview', apiUrl('/api/chain/build-market'), async () => renderBuildMarket(await client.buildMarket()));
        default:
          return run('chain_overview', apiUrl('/api/chain', { days }), async () => renderChain(await client.chain(days === undefined ? {} : { days })));
      }
    },
  );

  if (options.marketIntegrity) {
    server.registerTool(
      'market_integrity',
      {
        ...describe('market_integrity', [
          "For one project: what happened to its tracked token market — liquidity against the level it held, trading, a pool migration — beside its builder activity, and where the two disagree.",
          'It describes the token market, never whether development stopped, and never calls a project a rug or safe.',
        ]),
        inputSchema: { slug },
      },
      async ({ slug }) => run('market_integrity', apiUrl(`/api/projects/${encodeURIComponent(slug)}/market-integrity`), async () => renderMarketIntegrity(await client.projects.marketIntegrity(slug))),
    );
  }

  registerResources(server, client, { at, apiUrl, report });
  registerPrompts(server);
  return server;
}

type ResourceContext = {
  at: () => Date;
  apiUrl: (path: string, query?: Query) => string;
  report: (event: HeyMcpCallEvent) => void;
};

/**
 * Stable objects as resources (2026-09-26, M2 R16): the same reads and the
 * same renderers as the tools, for clients that attach context rather than
 * call tools. They add to the tools and replace none: many clients read tools
 * only.
 */
function registerResources(server: McpServer, client: HeyClient, context: ResourceContext): void {
  const read = async (name: string, uri: URL, canonical: string, render: () => Promise<string>): Promise<ReadResourceResult> => {
    const started = Date.now();
    try {
      const { text, truncated } = capOutput(await render(), canonical);
      context.report({ tool: `resource:${name}`, ok: true, truncated, bytes: new TextEncoder().encode(text).length, ms: Date.now() - started });
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    } catch (error) {
      const text = failureText(error);
      context.report({ tool: `resource:${name}`, ok: false, truncated: false, bytes: text.length, ms: Date.now() - started });
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
    }
  };
  const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

  server.registerResource(
    'project',
    new ResourceTemplate('hey://project/{slug}', { list: undefined }),
    { title: 'Project snapshot', description: 'One project’s snapshot, as get_project_snapshot renders it.', mimeType: 'text/markdown' },
    async (uri, variables) => {
      const slug = one(variables.slug);
      return read('project', uri, context.apiUrl(`/api/projects/${encodeURIComponent(slug)}/snapshot`), async () => renderSnapshot(await client.projects.snapshot(slug), context.at()));
    },
  );
  server.registerResource(
    'project_timeline',
    new ResourceTemplate('hey://project/{slug}/timeline', { list: undefined }),
    { title: 'Project timeline', description: 'The newest page of one project’s timeline.', mimeType: 'text/markdown' },
    async (uri, variables) => {
      const slug = one(variables.slug);
      return read('project_timeline', uri, context.apiUrl(`/api/projects/${encodeURIComponent(slug)}/timeline`, { limit: 30 }), async () => renderTimeline(await client.projects.timeline(slug, { limit: 30 }), 30));
    },
  );
  server.registerResource(
    'project_coverage',
    new ResourceTemplate('hey://project/{slug}/coverage', { list: undefined }),
    { title: 'Project coverage', description: 'What HEY knows and does not about one project.', mimeType: 'text/markdown' },
    async (uri, variables) => {
      const slug = one(variables.slug);
      return read('project_coverage', uri, context.apiUrl(`/api/projects/${encodeURIComponent(slug)}/coverage`), async () => renderCoverage(await client.projects.coverage(slug)));
    },
  );
  server.registerResource(
    'contract',
    new ResourceTemplate('hey://contract/{chainId}/{address}', { list: undefined }),
    { title: 'Contract', description: 'One contract as a research entity.', mimeType: 'text/markdown' },
    async (uri, variables) => {
      const chainId = Number(one(variables.chainId));
      const address = one(variables.address);
      if (!Number.isInteger(chainId) || !ADDRESS.test(address)) return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Expected hey://contract/<chainId>/<0x address>.' }] };
      return read('contract', uri, context.apiUrl(`/api/contracts/${chainId}/${address.toLowerCase()}`), async () => renderContract(await client.contracts.get(chainId, address)));
    },
  );
  server.registerResource(
    'changes_latest',
    'hey://changes/latest',
    { title: 'Latest changes', description: 'The newest thirty events in HEY’s change ledger.', mimeType: 'text/markdown' },
    async (uri) => read('changes_latest', uri, context.apiUrl('/api/changes', { limit: 30 }), async () => renderChanges(await client.changes.list({ limit: 30 }))),
  );
}

/**
 * Four workflows as prompts (2026-09-26): each names the tools in the order
 * that answers the question and the rules the answer must keep. A prompt
 * fetches nothing; it is text the client offers its user.
 */
function registerPrompts(server: McpServer): void {
  const RULES = 'Keep each line\'s FACT / DERIVED / UNKNOWN tag, cite evidence URLs, say what HEY does not know, and never state a cause or a recommendation.';
  const message = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

  server.registerPrompt(
    'deep_research_project',
    { title: 'Deep research: one project', description: 'Snapshot, coverage, recent changes and evidence for one project.', argsSchema: { slug: z.string().min(1).max(120) } },
    ({ slug }) => message(`Research the Robinhood Chain project "${slug}" with HEY. Call get_project_snapshot, then get_project_coverage, then get_changes with project=${slug}; open the two most important evidence ids with get_evidence. ${RULES}`),
  );
  server.registerPrompt(
    'what_changed_since',
    { title: 'What changed since…', description: 'The change ledger since a date, for the chain or one project.', argsSchema: { since: z.string().max(40), project: z.string().max(120).optional() } },
    ({ since, project }) => message(`What changed on Robinhood Chain${project ? ` for "${project}"` : ''} since ${since}? Call get_changes with detectedSince=${since}${project ? ` and project=${project}` : ''}, following the cursor until hasMore is false; group the events by type. ${RULES}`),
  );
  server.registerPrompt(
    'explain_metric',
    { title: 'Explain a figure', description: 'Why HEY shows a figure for a project.', argsSchema: { slug: z.string().min(1).max(120), fact: z.string().max(40) } },
    ({ slug, fact }) => message(`Why does HEY show ${fact} for "${slug}"? Call explain_fact with slug=${slug} and fact=${fact}; report the value, its state, the rule and version, the winning source and the unknown inputs. ${RULES}`),
  );
  server.registerPrompt(
    'investigate_contract',
    { title: 'Investigate a contract', description: 'A contract, its project and its changes.', argsSchema: { address: z.string().regex(ADDRESS), chainId: z.string().regex(/^\d{1,10}$/).optional() } },
    ({ address, chainId }) => message(`Investigate contract ${address} on chain ${chainId ?? '4663'} with HEY. Call get_contract, then lookup_token, then get_changes with contract=${chainId ?? '4663'}:${address}. Name no account but the deployer, and say "on-chain interaction observed", never "partnership". ${RULES}`),
  );
}
