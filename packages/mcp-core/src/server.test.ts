import { readFileSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HeyClient } from '@hey-research/sdk';

import * as fx from './fixtures/api';
import { MAX_OUTPUT_BYTES, capOutput, createHeyMcpServer, marketIntegrityFromEnv, type HeyMcpCallEvent, type HeyMcpOptions } from './server';
import { HEY_MCP_GATED_TOOLS, HEY_MCP_TOOLS } from './tools';

/**
 * The tools as an assistant sees them (2026-09-05; the 14-tool set since
 * 2026-09-26).
 *
 * Driven through a real MCP client over the in-memory transport, so what is
 * tested is the contract a client actually gets: the tool list and its
 * annotations, the argument schemas, the resources and prompts, and the text
 * that comes back — including when HEY is unreachable.
 */
const NOW = new Date('2026-09-26T12:00:00Z');
const thisWeek = JSON.parse(readFileSync(new URL('./fixtures/this-week.json', import.meta.url), 'utf8')) as unknown;

/** The API answer for each route the tools read, by path. */
function routeFixture(path: string): unknown {
  if (path === '/api/projects') return fx.projectsPage;
  if (path === '/api/chain/silence') return fx.silence;
  if (path === '/api/chain/accelerating') return fx.accelerating;
  if (path === '/api/builders') return fx.builders;
  if (path.startsWith('/api/token/')) return path.endsWith('a'.repeat(40)) ? fx.lookupUnknown : fx.lookupPublished;
  if (path.endsWith('/snapshot')) return fx.snapshot;
  if (path === '/api/changes') return fx.changes;
  if (path.endsWith('/timeline')) return fx.timeline;
  if (path.endsWith('/coverage')) return fx.coverage;
  if (path.includes('/explain')) return fx.explained;
  if (path.startsWith('/api/evidence/')) return fx.evidence;
  if (path.endsWith('/market-moves')) return fx.marketMoves;
  if (path.endsWith('/market-integrity')) return fx.marketIntegrity;
  if (path.endsWith('/market')) return fx.tokenMarket;
  if (path.startsWith('/api/contracts/')) return fx.contract;
  if (path.endsWith('/contracts')) return fx.projectContracts;
  if (path.endsWith('/diff')) return fx.diff;
  if (path === '/api/compare') return fx.compare;
  if (path.endsWith('/ask')) return fx.ask;
  if (path === '/api/chain') return fx.chain;
  if (path === '/api/this-week') return thisWeek;
  if (path === '/api/reports/weekly') return { items: [{ week: '2026-W38' }], disclaimer: 'd' };
  if (path.startsWith('/api/reports/weekly/')) return fx.weeklyReport;
  if (path === '/api/chain/unlocks') return fx.unlocks;
  if (path === '/api/chain/build-market') return fx.buildMarket;
  throw new Error(`no fixture for ${path}`);
}

const respond = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }) as Response;

async function connect(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>, options: HeyMcpOptions = {}) {
  const server = createHeyMcpServer(new HeyClient({ baseUrl: 'https://hey.test', fetchImpl }), () => NOW, options);
  const client = new Client({ name: 'test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

type Content = { type: string; text?: string; uri?: string };
const textOf = (result: unknown): string => (((result as { content?: Content[] }).content ?? [])[0]?.text ?? '');

describe('the HEY MCP server', () => {
  let requested: URL[];
  const fixtures = vi.fn(async (input: string) => {
    const url = new URL(input);
    requested.push(url);
    return respond(routeFixture(url.pathname));
  });

  beforeEach(() => {
    requested = [];
  });

  it('offers exactly the fourteen tools in the catalogue, each read-only, titled and annotated', async () => {
    const client = await connect(fixtures);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(HEY_MCP_TOOLS.map((tool) => tool.name).sort());
    expect(tools).toHaveLength(14);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.openWorldHint, tool.name).toBe(true);
    }
    // The whole list costs a model less than the old 22-tool list's 19,179 bytes.
    expect(JSON.stringify(tools).length).toBeLessThan(19_179);
    // No tool promises a valuation, a recommendation or a price ranking.
    const descriptions = tools.map((tool) => tool.description ?? '').join(' ').toLowerCase();
    for (const forbidden of ['undervalued', 'price target', 'predict', 'you should buy', 'invest in']) expect(descriptions).not.toContain(forbidden);
    expect(tools.find((tool) => tool.name === 'find_projects')?.description).toMatch(/Not a ranking by price/);
  });

  it('describes Under the Radar as the domain does, and says back-from-dormancy is narrower (M2 G1/G2)', async () => {
    const client = await connect(fixtures);
    const find = (await client.listTools()).tools.find((tool) => tool.name === 'find_projects')!;
    expect(find.description).toContain('under-the-radar: a positive Discovery Gap');
    expect(find.description).toContain('it does not bound attention itself');
    expect(find.description).toContain('shipping-in-silence: under-the-radar AND below the 40th market-attention percentile');
    expect(find.description).toContain('back-from-dormancy: status RESUMED, narrowed to verified builders');
    expect(find.description?.toLowerCase()).not.toContain('little market attention');
  });

  it('offers market_integrity only where the site publishes it, by the same flag', async () => {
    expect((await (await connect(fixtures)).listTools()).tools.map((tool) => tool.name)).not.toContain('market_integrity');
    const names = (await (await connect(fixtures, { marketIntegrity: true })).listTools()).tools.map((tool) => tool.name);
    expect(names).toContain(HEY_MCP_GATED_TOOLS[0].name);
    expect(names).toHaveLength(15);
    expect(marketIntegrityFromEnv(undefined)).toBe(false);
    expect(marketIntegrityFromEnv('internal')).toBe(false);
    expect(marketIntegrityFromEnv('terminal')).toBe(false);
    expect(marketIntegrityFromEnv(' PUBLIC ')).toBe(true);
  });

  it('tells the model, up front, what HEY does not hold, and what the tags mean', async () => {
    const instructions = (await connect(fixtures)).getInstructions() ?? '';
    expect(instructions).toMatch(/not investment advice/i);
    expect(instructions).toMatch(/holds no wallet data and no cross-token address data/i);
    expect(instructions).toMatch(/get_token_market: it returns one token's supply-concentration summary and names only that token's contract deployer/i);
    expect(instructions).toMatch(/No other tool here returns holder data/i);
    expect(instructions).toMatch(/Absent means HEY does not know/i);
    expect(instructions).toMatch(/FACT .*DERIVED .*UNKNOWN/);
  });

  /*
   * Every tool, end to end, on the API-shaped fixtures: the right route, a
   * tagged answer, and a resource_link to the canonical JSON. This is the
   * renderer test for every tool through the server itself.
   */
  const calls: [string, Record<string, unknown>, string, RegExp][] = [
    ['find_projects', { surface: 'still-building', limit: 2 }, '/api/projects', /Showing 2 of 17/],
    ['find_projects', { surface: 'shipping-in-silence' }, '/api/chain/silence', /40th market-attention percentile/],
    ['find_projects', { surface: 'accelerating' }, '/api/chain/accelerating', /Shipping faster/],
    ['find_projects', { surface: 'builder-radar', radar: 'most-improved' }, '/api/builders', /Builder Radar/],
    ['find_projects', { query: '0xcab100000000000000000000000000000000cb07' }, '/api/token/4663/0xcab100000000000000000000000000000000cb07', /AgentOS \(\$AOS\) — Shipping/],
    ['lookup_token', { address: '0xcab100000000000000000000000000000000cb07' }, '/api/token/4663/0xcab100000000000000000000000000000000cb07', /ship records/],
    ['get_project_snapshot', { slug: 'agentos' }, '/api/projects/agentos/snapshot', /snapshot as of/],
    ['get_changes', { project: 'agentos' }, '/api/changes', /What changed/],
    ['get_project_timeline', { slug: 'equifold' }, '/api/projects/equifold/timeline', /Showing 3 of 412/],
    ['get_project_coverage', { slug: 'agentos' }, '/api/projects/agentos/coverage', /what HEY knows and does not/],
    ['explain_fact', { slug: 'agentos', fact: 'market.valuation' }, '/api/projects/agentos/explain', /Rule: valuation-kind/],
    ['get_evidence', { id: 'ship:2ac87a66-0000-0000-0000-000000000001' }, '/api/evidence/ship:2ac87a66-0000-0000-0000-000000000001', /Evidence ship:/],
    ['get_token_market', { slug: 'agentos' }, '/api/projects/agentos/market', /daily index/],
    ['get_contract', { address: '0xcab100000000000000000000000000000000cb07' }, '/api/contracts/4663/0xcab100000000000000000000000000000000cb07', /beacon proxy/],
    ['get_contract', { slug: 'agentos' }, '/api/projects/agentos/contracts', /contracts on chain 4663/],
    ['project_diff', { slug: 'agentos', from: '2026-09-01', to: '2026-09-25' }, '/api/projects/agentos/diff', /never a cause/],
    ['compare_projects', { slugs: ['agentos', 'quiet-token'] }, '/api/compare', /No winner|no winner/],
    ['ask_hey', { slug: 'agentos', question: 'what shipped?' }, '/api/projects/agentos/ask', /Ask HEY about AgentOS/],
    ['chain_overview', {}, '/api/chain', /day by day/],
    ['chain_overview', { view: 'this-week' }, '/api/this-week', /This week on Robinhood Chain/],
    ['chain_overview', { view: 'weekly-report', week: '2026-W38' }, '/api/reports/weekly/2026-W38', /2026-W38/],
    ['chain_overview', { view: 'unlocks', days: 30 }, '/api/chain/unlocks', /HoodLock only/],
    ['chain_overview', { view: 'build-market' }, '/api/chain/build-market', /a map, not a ranking/],
  ];

  for (const [tool, args, path, answer] of calls) {
    it(`${tool} ${JSON.stringify(args)} reads ${path}, answers tagged text and links the canonical JSON`, async () => {
      const client = await connect(fixtures);
      const result = await client.callTool({ name: tool, arguments: args });
      expect(result.isError, textOf(result)).toBeFalsy();
      expect(decodeURIComponent(requested[0]!.pathname)).toBe(path);
      const text = textOf(result);
      expect(text).toMatch(answer);
      expect(text).toMatch(/\b(FACT|DERIVED|UNKNOWN)\b/);
      expect(text).not.toMatch(/undefined|\[object|NaN/);
      const link = (result.content as Content[]).find((item) => item.type === 'resource_link');
      expect(link?.uri).toMatch(/^https:\/\/heyresearch\.xyz\/api\//);
    });
  }

  it('market_integrity, where offered, reads its route and puts the builder first', async () => {
    const client = await connect(fixtures, { marketIntegrity: true });
    const result = await client.callTool({ name: 'market_integrity', arguments: { slug: 'drained' } });
    expect(requested[0]!.pathname).toBe('/api/projects/drained/market-integrity');
    expect(textOf(result)).toMatch(/DERIVED builder activity/);
  });

  it('passes find_projects filters to /api/projects in the API’s own spelling', async () => {
    const client = await connect(fixtures);
    await client.callTool({ name: 'find_projects', arguments: { query: 'agent', surface: 'under-the-radar', has: ['token', 'github'], sort: 'shipped', minVolume: 100, age: 'week', deployed: 'month', limit: 5, offset: 10 } });
    expect(Object.fromEntries(requested[0]!.searchParams)).toEqual({ q: 'agent', tab: 'under-the-radar', has: 'token,github', sort: 'shipped', minVolume: '100', age: 'week', deployed: 'month', limit: '5', offset: '10' });
  });

  it('says which filters a view did not apply, rather than dropping them in silence', async () => {
    const client = await connect(fixtures);
    const silent = await client.callTool({ name: 'find_projects', arguments: { surface: 'shipping-in-silence', kind: 'MEME', limit: 5 } });
    expect(textOf(silent)).toMatch(/^Not applied to this view: kind, limit\./);
    const radar = await client.callTool({ name: 'find_projects', arguments: { surface: 'builder-radar', radar: 'pons', limit: 5 } });
    expect(textOf(radar)).not.toContain('Not applied');
  });

  it('get_changes passes the caller’s filters and cursor through', async () => {
    const client = await connect(fixtures);
    await client.callTool({ name: 'get_changes', arguments: { project: 'arrow', type: ['build.release', 'build.dormant'], after: 'c1.0' } });
    expect(Object.fromEntries(requested[0]!.searchParams)).toEqual({ project: 'arrow', type: 'build.release,build.dormant', after: 'c1.0', limit: '30' });
  });

  it('get_token_market with include=moves reads both routes and prints the sequence', async () => {
    const client = await connect(fixtures);
    const result = await client.callTool({ name: 'get_token_market', arguments: { slug: 'agentos', include: ['moves'], min_change_pct: 30 } });
    expect(requested.map((url) => url.pathname)).toEqual(['/api/projects/agentos/market', '/api/projects/agentos/market-moves']);
    expect(requested[1]!.searchParams.get('min')).toBe('30');
    expect(textOf(result)).toContain('A sequence, never a cause.');
  });

  it('escapes a slug rather than pasting it into the path', async () => {
    const client = await connect(async (input) => {
      requested.push(new URL(input));
      return respond(fx.snapshot);
    });
    await client.callTool({ name: 'get_project_snapshot', arguments: { slug: 'a b/../c' } });
    expect(requested[0]!.href).toBe('https://hey.test/api/projects/a%20b%2F..%2Fc/snapshot');
  });

  it('refuses bad arguments before making a request', async () => {
    const client = await connect(fixtures);
    expect((await client.callTool({ name: 'find_projects', arguments: { query: 'a' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'lookup_token', arguments: { address: '0x' + 'g'.repeat(40) } })).isError).toBe(true);
    expect((await client.callTool({ name: 'project_diff', arguments: { slug: 'a', from: 'yesterday', to: '2026-09-25' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'get_contract', arguments: {} })).isError).toBe(true);
    expect(requested).toHaveLength(0);
  });

  it('reports an unreachable HEY, a rate limit and a refused key as errors a model can act on', async () => {
    const down = await connect(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await down.callTool({ name: 'get_project_snapshot', arguments: { slug: 'agentos' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Could not reach HEY at https://hey.test');

    const limited = await connect(async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '30' }), json: async () => ({ error: 'rate_limited', message: 'Too many requests.' }) }) as Response);
    expect(textOf(await limited.callTool({ name: 'get_changes', arguments: {} }))).toMatch(/30 seconds/);

    const refused = await connect(async () => ({ ok: false, status: 401, headers: new Headers(), json: async () => ({ error: 'unauthorized' }) }) as Response);
    expect(textOf(await refused.callTool({ name: 'chain_overview', arguments: {} }))).toContain('HEY_API_KEY');
  });

  it('tells whoever mounted it about every call: tool, outcome, size and whether the output was cut', async () => {
    const events: HeyMcpCallEvent[] = [];
    const client = await connect(fixtures, { onCall: (event) => events.push(event) });
    await client.callTool({ name: 'get_project_snapshot', arguments: { slug: 'agentos' } });
    const failing = await connect(async () => respond({ error: 'not_found', message: 'No such project.' }, 404), { onCall: (event) => events.push(event) });
    await failing.callTool({ name: 'get_project_snapshot', arguments: { slug: 'nope' } });
    expect(events.map((event) => [event.tool, event.ok, event.truncated])).toEqual([
      ['get_project_snapshot', true, false],
      ['get_project_snapshot', false, false],
    ]);
    expect(events[0]!.bytes).toBeGreaterThan(100);
  });

  it('serves the snapshot, timeline, coverage, contract and latest changes as resources', async () => {
    const client = await connect(fixtures);
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((template) => template.uriTemplate).sort();
    expect(templates).toEqual(['hey://contract/{chainId}/{address}', 'hey://project/{slug}', 'hey://project/{slug}/coverage', 'hey://project/{slug}/timeline']);
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual(['hey://changes/latest']);
    const project = await client.readResource({ uri: 'hey://project/agentos' });
    expect((project.contents[0] as { text: string }).text).toContain('snapshot as of');
    const contract = await client.readResource({ uri: 'hey://contract/4663/0xcab100000000000000000000000000000000cb07' });
    expect((contract.contents[0] as { text: string }).text).toContain('beacon proxy');
    const latest = await client.readResource({ uri: 'hey://changes/latest' });
    expect((latest.contents[0] as { text: string }).text).toContain('What changed');
  });

  it('offers four research workflows as prompts, each naming its tools and the rules', async () => {
    const client = await connect(fixtures);
    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name).sort()).toEqual(['deep_research_project', 'explain_metric', 'investigate_contract', 'what_changed_since']);
    const prompt = await client.getPrompt({ name: 'investigate_contract', arguments: { address: '0xcab100000000000000000000000000000000cb07' } });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    expect(text).toContain('get_contract');
    expect(text).toContain('never "partnership"');
    expect(requested).toHaveLength(0);
  });
});

describe('the output cap', () => {
  it('passes a short answer through untouched', () => {
    expect(capOutput('short', 'https://x')).toEqual({ text: 'short', truncated: false });
  });

  it('cuts a long answer on a line, says how much was cut and where the whole answer is', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const { text, truncated } = capOutput(long, 'https://heyresearch.xyz/api/chain?days=400');
    expect(truncated).toBe(true);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(text).toMatch(/\[Output cut at 24 KB: \d+ more lines not shown\. .*https:\/\/heyresearch\.xyz\/api\/chain\?days=400\.\]$/);
  });
});
