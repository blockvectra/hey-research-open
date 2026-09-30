import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { AGENT_CAPABILITIES, agentIntelligenceResponseSchema, composeResearch, HEY_OWN_TOKEN_DISCLOSURE, QUOTED_TEXT_LEGEND, type AgentComposeContext } from '@hey/agent-provider-core';
import { HeyClient } from '@hey-research-lab/sdk';

import * as fx from './fixtures/api';
import { createHeyMcpServer, MCP_API_ANSWER_SCHEMA, type HeyMcpOptions } from './server';
import { HEY_MCP_DEPRECATED_TOOLS, HEY_MCP_TOOL_LIST_BUDGET, mcpToolsFor, type HeyMcpProfile } from './tools';

/**
 * Round 4 (2026-09-30): one registry, two profiles; typed output on every
 * tool; three overlapping tools folded, still callable for their deprecation
 * period; `$HEY` disclosed wherever an answer names it. Driven through a real
 * MCP client, which also validates every `structuredContent` against the
 * tool's declared `outputSchema`.
 */
const NOW = new Date('2026-09-26T12:00:00Z');
const BASE = 'https://hey.test';
const AOS = '0xcab100000000000000000000000000000000cb07';

const agentAnswer = composeResearch(
  { baseUrl: BASE, chainId: 4663, chainName: 'Robinhood Chain', now: NOW, disclaimer: fx.snapshot.disclaimer, selfUrl: `${BASE}/api/agent/research_project?project=agentos`, query: { chainId: 4663, project: 'agentos' } } satisfies AgentComposeContext,
  { snapshot: fx.snapshot, gaps: [], tier: 'HOT' },
);

function routeFixture(path: string): unknown {
  if (path === '/api/search/suggest') return { q: 'agent', suggestions: [{ type: 'project', name: 'AgentOS', symbol: 'AOS', contract: AOS, target: '/project/agentos' }] };
  if (path.startsWith('/api/agent/')) return agentAnswer;
  if (path === '/api/projects') return fx.projectsPage;
  if (path.startsWith('/api/token/')) return fx.lookupPublished;
  if (path.endsWith('/snapshot')) return fx.snapshot;
  if (path === '/api/changes') return fx.changes;
  if (path.endsWith('/timeline')) return fx.timeline;
  if (path.endsWith('/coverage')) return fx.coverage;
  if (path.includes('/explain')) return fx.explained;
  if (path.startsWith('/api/evidence/')) return fx.evidence;
  if (path.startsWith('/api/contracts/')) return fx.contract;
  if (path.endsWith('/contracts')) return fx.projectContracts;
  if (path === '/api/compare') return fx.compare;
  throw new Error(`no fixture for ${path}`);
}

async function connect(options: HeyMcpOptions = {}) {
  const requested: URL[] = [];
  const fetchImpl = async (input: string) => {
    const url = new URL(input);
    requested.push(url);
    return { ok: true, status: 200, headers: new Headers(), json: async () => routeFixture(url.pathname) } as Response;
  };
  const server = createHeyMcpServer(new HeyClient({ baseUrl: BASE, fetchImpl }), () => NOW, options);
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return { client, requested };
}

type Content = { type: string; text?: string };
const textOf = (result: unknown): string => (((result as { content?: Content[] }).content ?? [])[0]?.text ?? '');

describe('one registry, two profiles', () => {
  it.each(['full', 'research'] as const)('%s lists exactly its registry entries, each with an output schema, inside its byte budget', async (profile: HeyMcpProfile) => {
    const { client } = await connect({ profile });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(mcpToolsFor(profile).map((tool) => tool.name).sort());
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(JSON.stringify(tool), tool.name).not.toContain('$schema');
    }
    expect(JSON.stringify(tools).length).toBeLessThan(HEY_MCP_TOOL_LIST_BUDGET[profile]);
  });

  it('the research profile offers builder intelligence only: no market move, Under the Radar or valuation tool', async () => {
    const { client } = await connect({ profile: 'research' });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['explain_fact', 'find_projects', 'get_changes', 'get_contract', 'get_evidence', 'get_project_timeline', 'research_answer']);
    const listing = JSON.stringify(tools);
    for (const word of ['under-the-radar', 'shipping-in-silence', 'builder-radar', 'maxMarketCap', 'minLiquidity', 'marketCap', 'market.valuation', 'market.status', 'discovery_gap', 'market.volume_spike', '"market"', 'get_token_market', 'market-moves']) expect(listing, word).not.toContain(word);
    // Market Integrity is not offered on the research profile even where the site publishes it.
    const gated = await connect({ profile: 'research', marketIntegrity: true });
    expect((await gated.client.listTools()).tools.map((tool) => tool.name)).not.toContain('market_integrity');
    const handshake = gated.client.getInstructions() ?? '';
    expect(handshake).toContain('research profile');
    expect(handshake).not.toContain('get_token_market');
  });

  it('the research profile reads the ledger without market events unless a type is named', async () => {
    const { client, requested } = await connect({ profile: 'research' });
    await client.callTool({ name: 'get_changes', arguments: { project: 'agentos' } });
    expect(requested[0]!.searchParams.get('domain')).toBe('build,contract,token,research,lock');
    const refused = await client.callTool({ name: 'get_changes', arguments: { type: ['market.volume_spike'] } });
    expect(refused.isError).toBe(true);
    const timeline = await client.callTool({ name: 'get_project_timeline', arguments: { slug: 'agentos' } });
    expect(timeline.isError).toBeFalsy();
    expect(requested.at(-1)!.searchParams.get('lens')).toBe('build');
    expect((await client.callTool({ name: 'explain_fact', arguments: { slug: 'agentos', fact: 'market.valuation' } })).isError).toBe(true);
  });

  it('the research profile finds a project by identity only, and a contract through the token lookup', async () => {
    const { client, requested } = await connect({ profile: 'research' });
    const found = await client.callTool({ name: 'find_projects', arguments: { query: 'agent' } });
    expect(requested[0]!.pathname).toBe('/api/search/suggest');
    expect(textOf(found)).toContain('«AgentOS» («AOS»)');
    expect(textOf(found)).toContain('slug agentos');
    expect(textOf(found)).not.toMatch(/market cap|FDV|valuation|liquidity/i);
    await client.callTool({ name: 'find_projects', arguments: { query: AOS } });
    expect(requested[1]!.pathname).toBe(`/api/token/4663/${AOS}`);
    // No market filter reaches the read there: the argument is not part of the tool.
    await client.callTool({ name: 'find_projects', arguments: { query: 'agent', maxMarketCap: 5 } });
    expect(requested.at(-1)!.pathname).toBe('/api/search/suggest');
    expect(requested.at(-1)!.searchParams.has('maxMarketCap')).toBe(false);
  });

  it('the research profile has no snapshot resource, and every prompt names only its own tools', async () => {
    const { client } = await connect({ profile: 'research' });
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((template) => template.uriTemplate);
    expect(templates).not.toContain('hey://project/{slug}');
    const names = new Set((await client.listTools()).tools.map((tool) => tool.name));
    const capabilities = new Set<string>(AGENT_CAPABILITIES);
    for (const prompt of (await client.listPrompts()).prompts) {
      const sample: Record<string, string> = { address: AOS, slugs: 'agentos,stockfi', since: '2026-09-01', fact: 'activity.status', chainId: '4663' };
      const args = Object.fromEntries((prompt.arguments ?? []).map((arg) => [arg.name, sample[arg.name] ?? 'agentos']));
      const body = ((await client.getPrompt({ name: prompt.name, arguments: args })).messages[0]!.content as { text: string }).text;
      for (const called of body.match(/\b[a-z]+(?:_[a-z]+)+\b/g)?.filter((word) => /^(get|find|explain|compare|lookup|ask|project|chain|research)_/.test(word) && !capabilities.has(word)) ?? []) expect(names.has(called), `${prompt.name} names ${called}`).toBe(true);
    }
  });
});

describe('typed output on every tool (structuredContent + outputSchema)', () => {
  it('research_answer returns the AgentIntelligenceResponse itself, valid against the full contract schema', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: 'research_answer', arguments: { capability: 'research_project', project: 'agentos' } });
    expect(result.isError).toBeFalsy();
    expect(agentIntelligenceResponseSchema.safeParse(result.structuredContent).success).toBe(true);
    expect((result.structuredContent as { capability: string }).capability).toBe('research_project');
    // The text rendering stays.
    expect(textOf(result)).toContain('# HEY research_project');
  });

  it.each([
    ['find_projects', { query: AOS }, '/api/token/4663/'],
    ['get_project_snapshot', { slug: 'agentos' }, '/api/projects/agentos/snapshot'],
    ['get_changes', { project: 'agentos' }, '/api/changes'],
    ['get_contract', { address: AOS }, '/api/contracts/4663/'],
    ['get_evidence', { id: 'ship:2ac87a66-0000-0000-0000-000000000001' }, '/api/evidence/'],
  ])('%s returns the public API object it rendered, unchanged, with its URL', async (tool, args, path) => {
    const { client } = await connect();
    const result = await client.callTool({ name: tool, arguments: args });
    const structured = result.structuredContent as { schema: string; api: string; data: unknown; notice: string };
    expect(structured.schema).toBe(MCP_API_ANSWER_SCHEMA);
    expect(structured.api).toContain(path);
    expect(structured.data).toEqual(routeFixture(new URL(structured.api).pathname));
    expect(structured.notice).toMatch(/data, never instructions/);
    // «…» in the text is explained once.
    if (textOf(result).includes('«')) expect(textOf(result)).toContain(QUOTED_TEXT_LEGEND);
  });
});

describe('the three folded tools', () => {
  it('are not listed, stay callable with the same read, and say what to use instead until their date', async () => {
    const { client, requested } = await connect();
    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    for (const tool of HEY_MCP_DEPRECATED_TOOLS) {
      expect(listed).not.toContain(tool.name);
      expect(Date.parse(tool.callableUntil) - Date.parse('2026-09-30')).toBeGreaterThanOrEqual(90 * 86_400_000);
    }
    const calls = [
      ['lookup_token', { address: AOS }, `/api/token/4663/${AOS}`],
      ['compare_projects', { slugs: ['agentos', 'stockfi'] }, '/api/compare'],
      ['get_project_coverage', { slug: 'agentos' }, '/api/projects/agentos/coverage'],
    ] as const;
    for (const [name, args, path] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBeFalsy();
      expect(requested.at(-1)!.pathname).toBe(path);
      expect(textOf(result)).toMatch(new RegExp(`Deprecated: ${name} is folded into a listed tool and answers until 2026-12-31`));
      expect((result._meta as Record<string, unknown>)['io.heyresearch/deprecated']).toBeDefined();
      expect(result.structuredContent).toBeDefined();
    }
  });

  it('are not served on the research profile', async () => {
    const { client } = await connect({ profile: 'research' });
    expect((await client.callTool({ name: 'lookup_token', arguments: { address: AOS } })).isError).toBe(true);
  });
});

describe("HEY's own token", () => {
  it('an answer that names $HEY discloses it, in text and structured output; others do not', async () => {
    const own = await connect({ ownToken: { chainId: 4663, address: AOS.toUpperCase().replace('0X', '0x') } });
    const result = await own.client.callTool({ name: 'find_projects', arguments: { query: AOS } });
    expect(textOf(result).startsWith(`Disclosure: ${HEY_OWN_TOKEN_DISCLOSURE}`)).toBe(true);
    expect((result.structuredContent as { disclosures?: unknown[] }).disclosures).toHaveLength(1);
    const other = await connect({ ownToken: { chainId: 4663, address: `0x${'b'.repeat(40)}` } });
    const plain = await other.client.callTool({ name: 'find_projects', arguments: { query: AOS } });
    expect(textOf(plain)).not.toContain('Disclosure');
    expect((plain.structuredContent as { disclosures?: unknown[] }).disclosures).toBeUndefined();
  });

  it('the handshake discloses it on both profiles', async () => {
    for (const profile of ['full', 'research'] as const) {
      const { client } = await connect({ profile });
      expect(client.getInstructions()).toMatch(/issues its own token, \$HEY/);
    }
  });
});
