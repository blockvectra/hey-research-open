import { readFileSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HeyClient } from '@hey-research/sdk';
import { createHeyMcpServer, marketIntegrityFromEnv, type HeyMcpOptions } from './server';

/**
 * The tools as an assistant sees them (2026-09-05).
 *
 * Driven through a real MCP client over the in-memory transport, so what is
 * tested is the contract a client actually gets: the tool list, the argument
 * schemas, and the text that comes back — including when HEY is unreachable.
 *
 * The descriptions are part of that contract. They are what a model reads when
 * deciding whether HEY can answer a question, so a tool that quietly stopped
 * saying "not a ranking by price" would be a real regression.
 */
const NOW = new Date('2026-09-05T12:00:00Z');

const projectsPage = {
  query: { limit: 24, offset: 0, sort: 'activity' },
  total: 1,
  items: [
    {
      slug: 'agentos',
      name: 'AgentOS',
      symbol: 'AOS',
      projectKind: 'UTILITY',
      activityStatus: 'SHIPPING',
      researchLevel: 'VERIFIED_BUILDER',
      catalogStatus: 'VERIFIED_BUILDER',
      stillBuilding: true,
      url: 'https://heyresearch.xyz/project/agentos',
    },
  ],
  disclaimer: 'Public, source-backed activity HEY recorded. … not investment advice.',
};

async function connect(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>, options: HeyMcpOptions = {}) {
  const server = createHeyMcpServer(new HeyClient({ baseUrl: 'https://hey.test', fetchImpl }), () => NOW, options);
  const client = new Client({ name: 'test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const respond = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('the HEY MCP server', () => {
  let requested: string[];
  const fetchOk = (body: unknown) =>
    vi.fn(async (input: string) => {
      requested.push(input);
      return respond(body);
    });

  beforeEach(() => {
    requested = [];
  });

  it('offers exactly the questions HEY can answer, and nothing that ranks by price', async () => {
    const client = await connect(fetchOk(projectsPage));
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(['accelerating_builders', 'ask_hey', 'builder_comebacks', 'chain_activity', 'compare_projects', 'contract_changes', 'events_before_market_change', 'get_changes', 'get_project', 'get_token_market', 'list_bounties', 'list_builders', 'list_projects', 'list_ships', 'list_signals', 'lookup_token', 'project_intelligence', 'project_timeline', 'search_projects', 'shipping_in_silence', 'this_week', 'upcoming_unlocks', 'weekly_report']);

    expect(tools).toHaveLength(23);
    // No tool promises a valuation, a recommendation or a price ranking.
    const descriptions = tools.map((tool) => tool.description ?? '').join(' ').toLowerCase();
    for (const forbidden of ['buy', 'invest', 'undervalued', 'price target', 'predict']) {
      expect(descriptions).not.toContain(forbidden);
    }
    // And the one that could be misread says outright that it is not a ranking.
    const list = tools.find((tool) => tool.name === 'list_projects');
    expect(list?.description).toMatch(/not a ranking by price/i);
  });

  it('offers market_integrity only where the site publishes it, by the same flag', async () => {
    // The route answers 404 until HEY_MARKET_INTEGRITY is `public`; a tool whose every call 404s is not offered.
    const hidden = await connect(fetchOk(projectsPage));
    expect((await hidden.listTools()).tools.map((tool) => tool.name)).not.toContain('market_integrity');

    const shown = await connect(fetchOk(projectsPage), { marketIntegrity: true });
    const names = (await shown.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('market_integrity');
    expect(names).toHaveLength(24);

    expect(marketIntegrityFromEnv(undefined)).toBe(false);
    expect(marketIntegrityFromEnv('internal')).toBe(false);
    expect(marketIntegrityFromEnv('terminal')).toBe(false);
    expect(marketIntegrityFromEnv('public')).toBe(true);
    expect(marketIntegrityFromEnv(' PUBLIC ')).toBe(true);
  });

  it('tells the model, up front, what HEY does not hold', async () => {
    const client = await connect(fetchOk(projectsPage));
    const instructions = client.getInstructions() ?? '';

    expect(instructions).toMatch(/not investment advice/i);
    expect(instructions).toMatch(/holds no wallet data and no cross-token address data/i);
    /*
     * The claim narrowed on 2026-09-17 because the broad one had become
     * false: since the founder's 2026-09-14 amendment HEY does keep a daily
     * snapshot of a single token's largest balances, for the distribution map
     * on that token's market page. It narrowed again on 2026-09-26, because
     * "no tool returns holder data of any kind" was false too: get_token_market
     * prints that token's concentration summary and names its deployer. The
     * sentence now says exactly that, and that nothing else does.
     */
    expect(instructions).toMatch(/get_token_market: it returns one token's supply-concentration summary and names only that token's contract deployer/i);
    expect(instructions).toMatch(/No other tool here returns holder data/i);
    // Absence is a real answer, and the model is told so before it asks anything.
    expect(instructions).toMatch(/Absent means HEY does not know/i);
  });

  it('get_changes reads the change ledger with the caller’s filters and cursor (2026-09-26)', async () => {
    const page = { query: { mode: 'sync', limit: 30 }, items: [], nextCursor: 'KEEP', hasMore: false, ledger: { collectionStart: null, transitionsFrom: null, newestRecordedAt: null, projectorRanAt: null }, disclaimer: 'd' };
    const client = await connect(fetchOk(page));
    const result = await client.callTool({ name: 'get_changes', arguments: { project: 'arrow', type: ['build.release', 'build.dormant'], after: 'c1.0' } });
    const url = new URL(requested[0]!);
    expect(url.pathname).toBe('/api/changes');
    expect(Object.fromEntries(url.searchParams)).toEqual({ project: 'arrow', type: 'build.release,build.dormant', after: 'c1.0', limit: '30' });
    expect((result.content as { text: string }[])[0]!.text).toContain('Cursor: KEEP.');
  });

  it('search_projects asks HEY for a text query and renders the answer', async () => {
    const client = await connect(fetchOk(projectsPage));
    const result = await client.callTool({ name: 'search_projects', arguments: { query: 'agent' } });

    expect(new URL(requested[0]!).searchParams.get('q')).toBe('agent');
    const body = (result.content as { text: string }[])[0]!.text;
    expect(body).toContain('AgentOS ($AOS)');
    // The badge never arrives without what it means.
    expect(body).toContain('not a prediction and not a buy signal');
  });

  it('list_projects passes the surface, the facts and the order through', async () => {
    const client = await connect(fetchOk(projectsPage));
    await client.callTool({
      name: 'list_projects',
      arguments: { surface: 'still-building', has: ['token', 'x'], sort: 'marketCap', limit: 5 },
    });

    const params = new URL(requested[0]!).searchParams;
    expect(params.get('tab')).toBe('still-building');
    expect(params.get('has')).toBe('token,x');
    expect(params.get('sort')).toBe('marketCap');
    expect(params.get('limit')).toBe('5');
  });

  it('get_project escapes the slug rather than pasting it into the path', async () => {
    const client = await connect(
      fetchOk({
        ...projectsPage.items[0],
        firstSeenAt: '2026-06-01T00:00:00.000Z',
        isClaimed: false,
        submitted: false,
        narratives: [],
        sources: [],
        disclaimer: 'not investment advice',
      }),
    );
    await client.callTool({ name: 'get_project', arguments: { slug: 'a b/../c' } });

    expect(requested[0]).toBe('https://hey.test/api/projects/a%20b%2F..%2Fc');
  });

  it('reports an unreachable HEY as an error the model can act on', async () => {
    const client = await connect(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await client.callTool({ name: 'search_projects', arguments: { query: 'agent' } });

    expect(result.isError).toBe(true);
    const body = (result.content as { text: string }[])[0]!.text;
    expect(body).toContain('Could not reach HEY at https://hey.test');
    // It must not look like an answer: no project, no empty list to summarise.
    expect(body).not.toContain('Showing');
  });

  it('answers this_week from the payload the API actually returns (2026-09-17)', async () => {
    const week = JSON.parse(readFileSync(new URL('./fixtures/this-week.json', import.meta.url), 'utf8')) as unknown;
    const client = await connect(fetchOk(week));
    const result = await client.callTool({ name: 'this_week', arguments: {} });

    expect(result.isError).toBeFalsy();
    const text = (result.content as { text: string }[])[0]!.text;
    expect(text).toContain('Ships: 2,540 from 597 projects.');
    expect(text).toContain('Still Building');
    expect(requested).toEqual(['https://hey.test/api/this-week']);
  });

  it('lookup_token takes an address written 0X as well as 0x (round-7 audit 2026-09-18)', async () => {
    // The API accepts both; the schema refused the upper-case prefix an explorer sometimes prints.
    const lookup = { chainId: 4663, contractAddress: '0x' + 'a'.repeat(40), status: 'unknown', scanUrl: 'https://hey.test/scan', disclaimer: 'not investment advice' };
    const client = await connect(fetchOk(lookup));
    const result = await client.callTool({ name: 'lookup_token', arguments: { address: '0X' + 'A'.repeat(40) } });

    expect(result.isError).toBeFalsy();
    expect(requested[0]).toBe(`https://hey.test/api/token/4663/0X${'A'.repeat(40)}`);

    const refused = await client.callTool({ name: 'lookup_token', arguments: { address: '0x' + 'g'.repeat(40) } });
    expect(refused.isError).toBe(true);
  });

  it('reports a rate limit as temporary rather than as "no results"', async () => {
    const client = await connect(async () => respond({}, 429));
    const result = await client.callTool({ name: 'list_ships', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(/try again in a minute/i);
  });

  it('adds what only this server knows: the key came from HEY_API_KEY, and how long a limiter asked it to wait (2026-09-19)', async () => {
    const withHeaders = (body: unknown, status: number, headers: Record<string, string>): Response =>
      ({ ok: false, status, headers: new Headers(headers), json: async () => body }) as Response;

    const refused = await connect(async () => withHeaders({ error: 'unauthorized' }, 401, {}));
    const refusedText = ((await refused.callTool({ name: 'this_week', arguments: {} })).content as { text: string }[])[0]!.text;
    expect(refusedText).toContain('HEY_API_KEY');

    const spent = await connect(async () => withHeaders({ error: 'quota', message: 'Monthly allowance used. It resets on 2026-11-01.' }, 429, { 'retry-after': '3600' }));
    const spentText = ((await spent.callTool({ name: 'this_week', arguments: {} })).content as { text: string }[])[0]!.text;
    expect(spentText).toContain('resets on 2026-11-01');
    expect(spentText).toContain('Try again in 3600 seconds.');
  });

  it('refuses a query shorter than HEY will match, before making a request', async () => {
    const client = await connect(fetchOk(projectsPage));
    const result = await client.callTool({ name: 'search_projects', arguments: { query: 'a' } });

    expect(result.isError).toBe(true);
    expect(requested).toHaveLength(0);
  });
});
