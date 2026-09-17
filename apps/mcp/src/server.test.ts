import { readFileSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HeyClient } from './client';
import { createHeyMcpServer } from './server';

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

async function connect(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>) {
  const server = createHeyMcpServer(new HeyClient({ baseUrl: 'https://hey.test', fetchImpl }), () => NOW);
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

    expect(tools.map((tool) => tool.name).sort()).toEqual(['chain_activity', 'get_project', 'get_token_market', 'list_bounties', 'list_builders', 'list_projects', 'list_ships', 'list_signals', 'lookup_token', 'search_projects', 'this_week', 'weekly_report']);

    // No tool promises a valuation, a recommendation or a price ranking.
    const descriptions = tools.map((tool) => tool.description ?? '').join(' ').toLowerCase();
    for (const forbidden of ['buy', 'invest', 'undervalued', 'price target', 'predict']) {
      expect(descriptions).not.toContain(forbidden);
    }
    // And the one that could be misread says outright that it is not a ranking.
    const list = tools.find((tool) => tool.name === 'list_projects');
    expect(list?.description).toMatch(/not a ranking by price/i);
  });

  it('tells the model, up front, what HEY does not hold', async () => {
    const client = await connect(fetchOk(projectsPage));
    const instructions = client.getInstructions() ?? '';

    expect(instructions).toMatch(/not investment advice/i);
    expect(instructions).toMatch(/holds no wallet data/i);
    /*
     * The claim narrowed on 2026-09-17 because the broad one had become
     * false: since the founder's 2026-09-14 amendment HEY does keep a daily
     * snapshot of a single token's largest balances, for the distribution map
     * on that token's market page. What stays true, and is what a model needs,
     * is that no tool here returns any of it.
     */
    expect(instructions).toMatch(/No tool here returns holder data of any kind/i);
    // Absence is a real answer, and the model is told so before it asks anything.
    expect(instructions).toMatch(/Absent means HEY does not know/i);
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

  it('reports a rate limit as temporary rather than as "no results"', async () => {
    const client = await connect(async () => respond({}, 429));
    const result = await client.callTool({ name: 'list_ships', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(/try again in a minute/i);
  });

  it('refuses a query shorter than HEY will match, before making a request', async () => {
    const client = await connect(fetchOk(projectsPage));
    const result = await client.callTool({ name: 'search_projects', arguments: { query: 'a' } });

    expect(result.isError).toBe(true);
    expect(requested).toHaveLength(0);
  });
});
