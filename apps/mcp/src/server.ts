import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  HeyApiError,
  type HeyClient,
  type HeyPage,
  type HeyProject,
  type HeyProjectDetail,
  type HeyShip,
  type HeyBountyPage,
} from './client';
import { renderProject, renderProjects, renderShips, renderBounties } from './render';

/**
 * HEY Research as MCP tools (2026-09-05).
 *
 * The question HEY exists to answer — *which projects on Robinhood Chain are
 * still building, what have they shipped, and which of them is nobody looking
 * at?* — is exactly the kind of question someone asks an assistant. These
 * tools let it be answered from HEY's own record instead of from guesswork.
 *
 * Every tool reads the public API, so this server needs no credentials and
 * holds no database. Five tools, matching the five questions the pages answer;
 * there is deliberately no tool that ranks by price, values a token, or
 * recommends anything, because HEY does not do those things.
 *
 * The descriptions matter as much as the code: they are what the model reads
 * when deciding whether a tool fits, and what stops it reaching for HEY to
 * answer a question HEY cannot answer.
 */
const NOT_ADVICE =
  'HEY records public building activity. It is not investment advice, it does not predict or rank by price, and it holds no wallet, holder or trading data.';

/** The activity surfaces the site itself offers. */
const SURFACES = [
  'still-building',
  'under-the-radar',
  'shipping-now',
  'most-active',
  'new-builders',
  'back-from-dormancy',
  'utility',
  'memes',
] as const;

const KINDS = ['UTILITY', 'MEME', 'HYBRID', 'INFRASTRUCTURE', 'RWA', 'APPLICATION', 'OTHER'] as const;
const STATUSES = ['SHIPPING', 'ACTIVE', 'QUIET', 'DORMANT', 'RESUMED', 'UNKNOWN'] as const;
const FACTS = ['token', 'x', 'marketCap', 'launchpad', 'liveMarket', 'verifiedToken', 'trading', 'github'] as const;
const STAGES = ['curve', 'graduated', 'dex'] as const;

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });

/**
 * A failure a model can act on: what went wrong and whether retrying helps,
 * rather than a stack trace it will paraphrase into a wrong answer.
 */
const failure = (error: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text:
        error instanceof HeyApiError
          ? error.message
          : `Could not read HEY: ${error instanceof Error ? error.message : String(error)}`,
    },
  ],
  isError: true,
});

export function createHeyMcpServer(client: HeyClient, now?: () => Date): McpServer {
  const server = new McpServer(
    { name: 'hey-research', version: '0.1.0' },
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
      'under-the-radar is projects with real activity and little market attention.',
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
      limit: z.number().int().min(1).max(48).optional().describe('How many, up to 48. Default 24.'),
      offset: z.number().int().min(0).optional(),
    },
    async ({ project, since, type, query, limit, offset }) => {
      try {
        const page = await client.get<HeyPage<HeyShip>>('/api/ships', {
          project,
          since,
          type,
          q: query,
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
        const week = await client.get<Record<string, unknown>>('/api/this-week');
        // The rollup is already written to be pasted somewhere else, so it is
        // passed through rather than re-worded into a second summary that
        // could drift from the one on the page.
        return text(JSON.stringify(week, null, 2));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
