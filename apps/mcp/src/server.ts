import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  HeyApiError,
  type HeyBountyPage,
  type HeyBuildersPage,
  type HeyChain,
  type HeyClient,
  type HeyPage,
  type HeyProject,
  type HeyProjectDetail,
  type HeyProjectIntelligence,
  type HeyAskAnswer,
  type HeyAccelerating,
  type HeyProjectSurface,
  type HeyComebacks,
  type HeyMarketIntegrity,
  type HeyMarketMoves,
  type HeyCompare,
  type HeySilentBuilders,
  type HeyTimeline,
  type HeyUnlocks,
  type HeyContractChanges,
  type HeyShip,
  type HeySignalPage,
  type HeyThisWeek,
  type HeyTokenLookup,
  type HeyTokenMarket,
  type HeyWeeklyReport,
} from '@hey-research/sdk';

import {
  renderBounties,
  renderBuilders,
  renderChain,
  renderProject,
  renderProjectIntelligence,
  renderAskAnswer,
  renderAccelerating,
  renderComebacks,
  renderMarketIntegrity,
  renderMarketMoves,
  renderCompare,
  renderSilentBuilders,
  renderTimeline,
  renderUnlocks,
  renderContractChanges,
  renderProjects,
  renderShips,
  renderSignals,
  renderThisWeek,
  renderTokenLookup,
  renderTokenMarket,
  renderWeeklyReport,
} from './render';
import { MCP_VERSION } from './version';

/**
 * HEY Research as MCP tools (2026-09-05).
 *
 * The question HEY exists to answer — *which projects on Robinhood Chain are
 * still building, what have they shipped, and which of them is nobody looking
 * at?* — is exactly the kind of question someone asks an assistant. These
 * tools let it be answered from HEY's own record instead of from guesswork.
 *
 * Every tool reads the public API, so this server needs no credentials and
 * holds no database. Twelve tools, matching the questions the pages answer;
 * there is deliberately no tool that ranks by price, values a token, or
 * recommends anything, because HEY does not do those things.
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

const KINDS = ['UTILITY', 'MEME', 'HYBRID', 'INFRASTRUCTURE', 'RWA', 'APPLICATION', 'OTHER'] as const;
const STATUSES = ['SHIPPING', 'ACTIVE', 'QUIET', 'DORMANT', 'RESUMED', 'UNKNOWN'] as const;
const FACTS = ['token', 'x', 'marketCap', 'launchpad', 'liveMarket', 'verifiedToken', 'trading', 'github'] as const;
const STAGES = ['curve', 'graduated', 'dex'] as const;

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });

/**
 * A failure a model can act on: what went wrong and whether retrying helps,
 * rather than a stack trace it will paraphrase into a wrong answer.
 *
 * The SDK's sentences are for any caller (2026-09-19); the two things only
 * this server knows are added here — that the key came from `HEY_API_KEY`,
 * and how long a rate limit asked it to wait.
 */
const failureText = (error: unknown): string => {
  if (!(error instanceof HeyApiError)) return `Could not read HEY: ${error instanceof Error ? error.message : String(error)}`;
  if (error.code === 'unauthorized') return `${error.message} Check HEY_API_KEY against your HEY account page.`;
  if (error.retryAfterSeconds !== undefined && !/try again in/i.test(error.message)) {
    return `${error.message} Try again in ${error.retryAfterSeconds} seconds.`;
  }
  return error.message;
};

const failure = (error: unknown) => ({
  content: [{ type: 'text' as const, text: failureText(error) }],
  isError: true,
});

/**
 * What the server offers beyond the default set (2026-09-25).
 *
 * `marketIntegrity` mirrors the site's own gate: `/api/projects/{slug}/market-integrity`
 * answers 404 until `HEY_MARKET_INTEGRITY` reaches `public`, so a tool that
 * calls it is not offered until the operator says the same. Offering it
 * earlier handed an assistant a tool whose every call failed.
 */
export type HeyMcpOptions = { marketIntegrity?: boolean };

/** The site's exposure flag, read the same way: only `public` publishes Market Integrity. Fail closed. */
export const marketIntegrityFromEnv = (value: string | undefined): boolean => value?.trim().toLowerCase() === 'public';

export function createHeyMcpServer(client: HeyClient, now?: () => Date, options: HeyMcpOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'hey-research', version: MCP_VERSION },
    {
      instructions: [
        'HEY Research Lab is the builder-discovery layer for Robinhood Chain (chain id 4663).',
        'It answers: which projects are still building, what they shipped, and which of them are getting little attention.',
        '',
        'Every fact these tools return is backed by a public source HEY recorded, and each carries how it is backed.',
        'Absent means HEY does not know: a missing market cap is not zero, and a project with no measures has not been measured.',
        '',
        NOT_ADVICE,
      ].join('\n'),
    },
  );

  const at = () => now?.();

  server.tool(
    'search_projects',
    [
      'Find projects on Robinhood Chain by name, ticker, or contract address.',
      'Use this when the user names a specific project or token, or pastes a contract.',
      'Returns identity, what HEY claims about activity, and a link to the full record.',
    ].join(' '),
    {
      query: z.string().min(2).describe('A project name, ticker, or contract address (or the start of one).'),
      limit: z.number().int().min(1).max(48).optional().describe('How many results, up to 48. Default 10.'),
    },
    async ({ query, limit }) => {
      try {
        const page = await client.get<HeyPage<HeyProject>>('/api/projects', {
          q: query,
          limit: limit ?? 10,
        });
        return text(renderProjects(page, at()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'list_projects',
    [
      'Browse the Robinhood Chain catalogue by activity, kind, narrative or launchpad.',
      'Use this for open questions — "what is still being built", "what launched on Pons",',
      '"which infrastructure projects are active". The `surface` argument is the strongest filter:',
      'still-building is projects that kept shipping through a tracked market drawdown,',
      'under-the-radar is projects with a positive Discovery Gap: verified activity with a market-attention percentile below its build percentile.',
      'Not a ranking by price: ordering by market cap is context the caller asked for.',
    ].join(' '),
    {
      surface: z.enum(SURFACES).optional().describe('One of HEY\'s own discovery surfaces.'),
      kind: z.enum(KINDS).optional().describe('Project type.'),
      status: z.enum(STATUSES).optional().describe('Activity status.'),
      narrative: z.string().optional().describe('A narrative slug, e.g. "ai-agents".'),
      launchpad: z
        .string()
        .optional()
        .describe('Launchpad key, e.g. "pons", "virtuals", "hoodfun", "clanker", "pairfund".'),
      has: z
        .array(z.enum(FACTS))
        .optional()
        .describe('Facts every result must carry: token contract, official X, market reading, launch record, a market that is not gone (liveMarket), a token the project itself verified, a token that traded in the last day (trading).'),
      stage: z.enum(STAGES).optional().describe('Launch stage of the token: still on its bonding curve, graduated, or trading in a DEX pool.'),
      minLiquidity: z.number().positive().optional().describe('Only tokens whose card reading shows at least this much liquidity, in USD. Unknown liquidity is excluded, never treated as zero.'),
      maxMarketCap: z.number().positive().optional().describe('Only tokens whose card reading shows a market cap at or under this, in USD.'),
      minMarketCap: z.number().positive().optional().describe('Only tokens whose card reading shows a market cap at or above this, in USD.'),
      sort: z
        .enum(['activity', 'marketCap', 'liquidity', 'volume24h', 'newest'])
        .optional()
        .describe('Order. Default is activity — most recently shipped first. A market order is context the caller asked for; rows without that figure follow in activity order.'),
      limit: z.number().int().min(1).max(48).optional().describe('How many, up to 48. Default 24.'),
      offset: z.number().int().min(0).optional().describe('Skip this many; use the offset a previous call returned.'),
    },
    async ({ surface, kind, status, narrative, launchpad, has, stage, minLiquidity, maxMarketCap, minMarketCap, sort, limit, offset }) => {
      try {
        const page = await client.get<HeyPage<HeyProject>>('/api/projects', {
          tab: surface,
          kind,
          status,
          narrative,
          launchpad,
          has: has?.join(','),
          stage,
          minLiquidity,
          maxMarketCap,
          minMarketCap,
          sort,
          limit: limit ?? 24,
          offset,
        });
        return text(renderProjects(page, at()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'lookup_token',
    [
      'One project by its contract address — use this whenever the user pastes a contract, rather than searching for the address as text.',
      "It answers HEY's one question about that address: is anyone building it. Returns the activity status in HEY's own words,",
      'ships in the last thirty days counted the way the project page counts them, the last ship with the source it was read from, and a link back.',
      'An address HEY publishes no page for answers status "unknown" with a scan link for the user to follow; that is an answer, not an error.',
      'No risk reading of any kind: HEY gives no score, no grade and no verdict about what a token might do.',
    ].join(' '),
    {
      // `0X` as well as `0x` (round-7 audit 2026-09-18): the API accepts both, and a pasted address arrives however the explorer printed it.
      address: z.string().regex(/^0[xX][a-fA-F0-9]{40}$/).describe('The contract address, 0x followed by 40 hex characters.'),
      chainId: z.number().int().optional().describe('Chain id; HEY indexes Robinhood Chain, 4663, which is the default.'),
    },
    async ({ address, chainId }) => {
      try {
        const lookup = await client.get<HeyTokenLookup>(
          `/api/token/${chainId ?? 4663}/${encodeURIComponent(address)}`,
        );
        return text(renderTokenLookup(lookup, at() ?? new Date()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'get_project',
    [
      'Everything HEY holds on one project: description, activity, token identity, launch origin,',
      'every registered source with how it was established, market context with its provider,',
      'and HEY\'s own activity measures when it has run them.',
      'Use this after search_projects or list_projects to answer questions about one project.',
    ].join(' '),
    {
      slug: z.string().min(1).describe('The project slug, as returned by the other tools (e.g. "agentos").'),
    },
    async ({ slug }) => {
      try {
        const project = await client.get<HeyProjectDetail>(
          `/api/projects/${encodeURIComponent(slug)}`,
        );
        return text(renderProject(project, at()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'project_intelligence',
    [
      'How one Robinhood Chain project builds over time, from HEY\'s own records: build velocity (last 30 days against the 30 before),',
      'release cadence, consistency and streaks, how fast HEY recorded its ships, market attention as context, and what changed in 30 days.',
      'Each line says whether it is a FACT, a DERIVED figure or UNKNOWN. Use it for "is X accelerating", "how often does X ship", "what changed on X".',
    ].join(' '),
    {
      slug: z.string().min(1).describe('The project slug, as returned by the other tools (e.g. "agentos").'),
    },
    async ({ slug }) => {
      try {
        const intel = await client.get<HeyProjectIntelligence>(`/api/projects/${encodeURIComponent(slug)}/intelligence`);
        return text(renderProjectIntelligence(intel));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'ask_hey',
    [
      'Ask a free-text question about one Robinhood Chain project (English or Malay). HEY matches it to the parts of its record it is about —',
      'what changed, releases, contract changes, token evidence, Build Momentum, period comparison, what HEY does not know — and answers',
      'only from that record, every line tagged FACT, DERIVED or UNKNOWN with its source. It records building only and offers no view on price.',
    ].join(' '),
    {
      slug: z.string().min(1).describe('The project slug (e.g. "agentos").'),
      question: z.string().min(3).max(280).describe('The question, in the reader\'s own words.'),
    },
    async ({ slug, question }) => {
      try {
        const answer = await client.get<HeyAskAnswer>(`/api/projects/${encodeURIComponent(slug)}/ask`, { q: question });
        return text(renderAskAnswer(answer));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'contract_changes',
    [
      'Evidence-backed contract changes on Robinhood Chain projects: proxy upgrades, follow-up deployments by a project\'s deployer,',
      'contracts that became verified, and interface changes (functions or events added or removed) HEY saw on the explorer. Newest first.',
    ].join(' '),
    { days: z.number().int().min(1).max(90).optional().describe('Days to read; default 30.') },
    async ({ days }) => {
      try {
        const page = await client.get<HeyContractChanges>('/api/chain/contract-changes', { days });
        return text(renderContractChanges(page));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'shipping_in_silence',
    'Robinhood Chain projects that are Under the Radar (verified recent shipping, a positive Discovery Gap) and below the 40th market-attention percentile. Newest ship first; never ordered by price, and not a recommendation.',
    {},
    async () => {
      try {
        return text(renderSilentBuilders(await client.get<HeySilentBuilders>('/api/chain/silence')));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'accelerating_builders',
    'Robinhood Chain builders whose meaningful shipping is accelerating: the last 30 days against the 30 before, by the same velocity rule each project page shows. Most events first; a research list, not a recommendation.',
    {},
    async () => {
      try {
        return text(renderAccelerating(await client.get<HeyAccelerating>('/api/chain/accelerating')));
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (options.marketIntegrity) {
    server.tool(
      'market_integrity',
      "For one Robinhood Chain project: what happened to its tracked token market — liquidity against the level it held, trading, a pool migration — beside its builder activity, and where the two disagree. It describes the token market, never whether development stopped, and never calls a project a rug or safe.",
      { slug: z.string().min(1).describe('The project slug.') },
      async ({ slug }) => {
        try {
          return text(renderMarketIntegrity(await client.get<HeyMarketIntegrity>(`/api/projects/${encodeURIComponent(slug)}/market-integrity`)));
        } catch (error) {
          return failure(error);
        }
      },
    );
  }

  server.tool(
    'events_before_market_change',
    'For one Robinhood Chain project: each day-on-day move in HEY\'s recorded market-cap close, with the corroborated building events published in the week up to it. A sequence, never a cause — HEY does not say an event moved a market.',
    {
      slug: z.string().min(1).describe('The project slug.'),
      days: z.number().int().min(7).max(365).optional().describe('How far back to look; default 90.'),
      min_change_pct: z.number().int().min(5).max(500).optional().describe('Smallest day-on-day move, in percent either way; default 25.'),
    },
    async ({ slug, days, min_change_pct }) => {
      try {
        return text(renderMarketMoves(await client.get<HeyMarketMoves>(`/api/projects/${encodeURIComponent(slug)}/market-moves`, { days, min: min_change_pct })));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'builder_comebacks',
    'Robinhood Chain projects shipping again after 60 or more days without observed activity (activity status RESUMED).',
    {},
    async () => {
      try {
        return text(renderComebacks(await client.get<HeyComebacks>('/api/chain/comebacks')));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'upcoming_unlocks',
    'Scheduled HoodLock unlocks on Robinhood Chain from the locker\'s own records: locks still holding that reach their unlock time in the window, with proof links.',
    { days: z.number().int().min(1).max(365).optional().describe('Days ahead; default 30.') },
    async ({ days }) => {
      try {
        return text(renderUnlocks(await client.get<HeyUnlocks>('/api/chain/unlocks', { days })));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'project_timeline',
    'One project\'s research timeline: builds, releases, code, contract deploys, upgrades and interface changes, token verification, locks and scheduled unlocks — each with how precisely HEY knows its time. Lenses: everything, build, code, onchain, market, locks.',
    {
      slug: z.string().min(1).describe('The project slug.'),
      lens: z.enum(['everything', 'build', 'code', 'onchain', 'market', 'locks']).optional(),
    },
    async ({ slug, lens }) => {
      try {
        return text(renderTimeline(await client.get<HeyTimeline>(`/api/projects/${encodeURIComponent(slug)}/timeline`, { lens })));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'compare_projects',
    'Two to four Robinhood Chain projects side by side: activity status, last ship, Build Momentum, velocity, cadence, verification and market context — each line FACT, DERIVED or UNKNOWN. No winner and no recommendation.',
    { slugs: z.array(z.string().min(1)).min(2).max(4).describe('Two to four project slugs.') },
    async ({ slugs }) => {
      try {
        return text(renderCompare(await client.get<HeyCompare>('/api/compare', { slugs: slugs.join(',') })));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'get_token_market',
    [
      'One token\'s market in depth, from HEY\'s own daily index: price, liquidity and volume by day, trades by day split by direction (decoded from the chain),',
      'the token\'s lifecycle (launch recorded, pool created, launch stage, first and last indexed trade, highest liquidity), what HEY checked on the contract',
      '(proxy, deployer, whether the project names the contract, liquidity against its high), who deployed the contract and when, its pools and how much can be sold before the price moves 1%,',
      'a summary of how concentrated the supply is (shares only, no addresses), contract events by day and value locked.',
      'Use this after get_project when asked whether a token still trades, how its liquidity has moved, or what HEY checked. Counts, never accounts; context, never a recommendation.',
    ].join(' '),
    {
      slug: z.string().min(1).describe('The project slug (e.g. "agentos").'),
      days: z.number().int().min(1).max(400).optional().describe('Days of history to read; default 30.'),
    },
    async ({ slug, days }) => {
      try {
        const market = await client.get<HeyTokenMarket>(`/api/projects/${encodeURIComponent(slug)}/market`, { days });
        return text(renderTokenMarket(market, at() ?? new Date()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'chain_activity',
    [
      'Robinhood Chain day by day: decoded DEX trades, USD volume against the known quote assets, tokens and pools that traded, transactions,',
      'and what HEY saw on the chain — launches recorded, projects published, verified ships. Use this for "how active is the chain" questions. Aggregates only.',
    ].join(' '),
    { days: z.number().int().min(1).max(400).optional().describe('Days to read; default 14.') },
    async ({ days }) => {
      try {
        const chain = await client.get<HeyChain>('/api/chain', { days });
        return text(renderChain(chain));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'list_signals',
    [
      'HEY Signal: measured changes on Robinhood Chain — development spikes and slowdowns, releases, contracts deployed or upgraded, liquidity moving, launches graduating,',
      'pages published and verified — each with its figures before and after, source and confidence. Use this for "what changed", "what happened this week", "any news on X".',
      'Filter by group (development, contract, market, launch, research), kind, or a project slug. Counts only, never accounts; context, never a recommendation.',
    ].join(' '),
    {
      group: z.enum(['development', 'contract', 'market', 'launch', 'research']).optional(),
      kind: z.string().optional().describe('One signal kind, e.g. development_spike, liquidity_drop, release_published.'),
      slug: z.string().optional().describe("A project slug, to read one project's signals."),
      days: z.number().int().min(1).max(365).optional().describe('Window in days; default 30.'),
      order: z.enum(['newest', 'importance']).optional(),
      include: z
        .enum(['published'])
        .optional()
        .describe('Add project_published signals — how to ask "what launched". They are left out of the unfiltered feed by default.'),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional().describe('Skip this many; the answer says the total, so a second call can reach the rest.'),
    },
    async ({ group, kind, slug, days, order, include, limit, offset }) => {
      try {
        const page = await client.get<HeySignalPage>('/api/signals', { group, kind, slug, days, order, include, limit: limit ?? 30, offset });
        return text(renderSignals(page, at() ?? new Date()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'list_builders',
    [
      'The Builder Radar: who is actually building on Robinhood Chain, ranked by verified development, on-chain use of their own contracts and research standing —',
      "never by price — with each project's rank seven and thirty days ago. Use this for \"top builders\", \"most improved\", \"who is building on Pons\".",
      'Filters: all, pons, virtuals, other-launch, no-token, new, established, most-improved, development, onchain, resumed.',
    ].join(' '),
    {
      filter: z
        .enum(['all', 'pons', 'virtuals', 'other-launch', 'no-token', 'new', 'established', 'most-improved', 'development', 'onchain', 'resumed'])
        .optional()
        .describe('One of HEY\'s own Radar views. An unrecognised value is ignored, so it is an enum here rather than free text.'),
      q: z.string().optional().describe('Find a builder by name or symbol.'),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional().describe('Skip this many; the answer says how many are ranked, so a second call can reach the rest.'),
    },
    async ({ filter, q, limit, offset }) => {
      try {
        const page = await client.get<HeyBuildersPage>('/api/builders', { filter, q, limit: limit ?? 25, offset });
        return text(renderBuilders(page, at() ?? new Date()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'weekly_report',
    ["The archived weekly Robinhood Chain report: ships, new builders, movers, top builders, chain totals and the week's signals. Pass an ISO week like 2026-W37, or nothing for the latest."].join(' '),
    { week: z.string().regex(/^\d{4}-W\d{2}$/).optional() },
    async ({ week }) => {
      try {
        let key = week;
        if (!key) {
          const index = await client.get<{ items: { week: string }[] }>('/api/reports/weekly');
          key = index.items[0]?.week;
          if (!key) return text('No weekly report has been archived yet.');
        }
        const report = await client.get<HeyWeeklyReport>(`/api/reports/weekly/${encodeURIComponent(key)}`);
        return text(renderWeeklyReport(report));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'list_bounties',
    [
      'Research bounties HEY pays in HEY for evidence work — mapping a project\'s owned sources, tracing a migration, documenting a release.',
      'Use this when asked what bounties are open, what they pay, or whether one is already claimed.',
      'Reading is open to everyone. Claiming is NOT something this tool or the API can do: a person signs in with a wallet on the site,',
      'claims on the bounty page (holders of a HEY tier first, then anyone), submits public evidence, and a HEY moderator reviews it.',
    ].join(' '),
    {
      status: z.enum(['open', 'awarded', 'all']).optional().describe('Default: open and awarded.'),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ status, limit }) => {
      try {
        const page = await client.get<HeyBountyPage>('/api/bounties', { status, limit: limit ?? 50 });
        return text(renderBounties(page, at()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'list_ships',
    [
      'What projects actually shipped — releases, launches, features — each with the public source',
      'HEY recorded it from and how the claim is backed.',
      'Use this for "what happened recently", "what has X shipped", or to check whether a project is alive.',
      'A project that shipped three times appears three times: this is a record of ships, not of projects.',
    ].join(' '),
    {
      project: z.string().optional().describe('Restrict to one project, by slug.'),
      since: z
        .string()
        .optional()
        .describe('ISO 8601 instant. Only ships at or after it — state the window you are reporting on.'),
      type: z
        .string()
        .optional()
        .describe('One event type, e.g. GITHUB_RELEASE, PRODUCT_LAUNCH, FEATURE_RELEASE.'),
      query: z.string().optional().describe('Free text matching the shipping project.'),
      has: z
        .array(z.enum(FACTS))
        .optional()
        .describe('Facts the shipping project must carry, all of them — e.g. ["github"] for projects HEY reads code from.'),
      sort: z
        .enum(['latest', 'marketCap', 'activity', 'detected'])
        .optional()
        .describe('Order. Default latest (when the project shipped). `detected` is when HEY observed it, which is the order to page along when mirroring. Ordering by market cap is context the caller asked for, never a ranking HEY makes.'),
      detectedSince: z
        .string()
        .optional()
        .describe('ISO 8601 instant. Only ships HEY observed at or after it — use this, not `since`, to keep a copy up to date.'),
      limit: z.number().int().min(1).max(48).optional().describe('How many, up to 48. Default 24.'),
      offset: z.number().int().min(0).optional(),
    },
    async ({ project, since, type, query, has, sort, detectedSince, limit, offset }) => {
      try {
        const page = await client.get<HeyPage<HeyShip>>('/api/ships', {
          project,
          since,
          detectedSince,
          type,
          q: query,
          has: has && has.length > 0 ? has.join(',') : undefined,
          sort,
          limit: limit ?? 24,
          offset,
        });
        return text(renderShips(page, at()));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.tool(
    'this_week',
    [
      'HEY\'s weekly rollup: what shipped, which builders are new, who came back to shipping,',
      'and what is still building — each with the window it was counted over.',
      'Use this for "what happened this week on Robinhood Chain".',
    ].join(' '),
    {},
    async () => {
      try {
        const week = await client.get<HeyThisWeek>('/api/this-week');
        /*
         * Rendered, not passed through (2026-09-17). It was the one tool that
         * returned raw JSON, which let two rules past it: "Still Building"
         * reached the model with none of its meaning, and the rollup's market
         * caps — the only figures in the API that travel without a provider —
         * arrived bare beside an instruction saying every figure names one.
         */
        return text(renderThisWeek(week));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
