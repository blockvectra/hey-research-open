import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { AGENT_CAPABILITIES, agentIntelligenceResponseSchema, composeResearch, HEY_OWN_TOKEN_DISCLOSURE, QUOTED_TEXT_LEGEND, type AgentComposeContext } from '@hey/agent-provider-core';
import { HeyClient } from '@hey-research-lab/sdk';

import * as fx from './fixtures/api';
import { createHeyMcpServer, MCP_API_ANSWER_SCHEMA, type HeyMcpOptions } from './server';
import { HEY_MCP_DEPRECATED_TOOLS, HEY_MCP_QUESTIONS, HEY_MCP_RESEARCH_PROFILE_SCOPE, HEY_MCP_TOOL_LIST_BUDGET, mcpToolsFor, type HeyMcpProfile } from './tools';

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
    expect(tools.map((tool) => tool.name).sort()).toEqual(['explain_fact', 'find_projects', 'get_changes', 'get_contract', 'get_evidence', 'get_project_timeline', 'get_v4_hook', 'research_answer']);
    const listing = JSON.stringify(tools);
    for (const word of ['under-the-radar', 'shipping-in-silence', 'builder-radar', 'maxMarketCap', 'minLiquidity', 'marketCap', 'market.valuation', 'market.status', 'discovery_gap', 'market.volume_spike', '"market"', 'get_token_market', 'market-moves']) expect(listing, word).not.toContain(word);
    // Market Integrity is not offered on the research profile even where the site publishes it.
    const gated = await connect({ profile: 'research', marketIntegrity: true });
    expect((await gated.client.listTools()).tools.map((tool) => tool.name)).not.toContain('market_integrity');
    const handshake = gated.client.getInstructions() ?? '';
    expect(handshake).toContain('research profile');
    expect(handshake).not.toContain('get_token_market');
    // It says what research_answer still carries (full audit 2026-10-03), never "builder intelligence only".
    expect(handshake).toContain(HEY_MCP_RESEARCH_PROFILE_SCOPE);
    expect(handshake).not.toMatch(/builder intelligence only/i);
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
    // No market filter reaches the read there: the argument is not part of the tool, and is refused rather than dropped (AG-1).
    const filtered = await client.callTool({ name: 'find_projects', arguments: { query: 'agent', maxMarketCap: 5 } });
    expect(filtered.isError).toBe(true);
    expect(textOf(filtered)).toContain('find_projects does not take maxMarketCap');
    expect(requested).toHaveLength(2);
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

/*
 * An agent picks a tool from the list alone (2026-10-13: ~600 tool calls in ~30,000 MCP requests a month),
 * so every description opens on the question it answers, in the words a user types, and names the inputs an
 * agent holds. The claims behind the question stay the API's (machine rule 7: the tests above and in
 * server.test.ts pin them).
 */
describe('question-first tool list (2026-10-13)', () => {
  const firstSentence = (text: string) => text.split(/(?<=[.?!])\s+/)[0] ?? '';

  it.each(['full', 'research'] as const)('%s: every description opens on the question it answers', async (profile) => {
    const { client } = await connect({ profile, marketIntegrity: true });
    for (const tool of (await client.listTools()).tools) expect(firstSentence(tool.description ?? ''), tool.name).toMatch(/\?$/);
  });

  /*
   * Anthropic's MCP Directory policy (2026-10-13): a tool description carries no instruction about other tools. No
   * description or input schema names another listed tool; the server's instructions, which are not a tool, may.
   */
  it.each(['full', 'research'] as const)('%s: no tool description or input schema names another tool', async (profile) => {
    const { client } = await connect({ profile });
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    const crossed = tools.flatMap((tool) => {
      const text = `${tool.description ?? ''} ${JSON.stringify(tool.inputSchema)}`;
      // A tool's name is matched as a word, so the enum values `market_integrity` and `market_integrity.state` (data, not a tool) are told apart by context below.
      return names
        .filter((other) => other !== tool.name && new RegExp(`\\b${other}\\b(?![._])`).test(text.replace(/"market_integrity"/g, '')))
        .map((other) => `${tool.name} → ${other}`);
    });
    expect(crossed).toEqual([]);
  });

  it.each(['full', 'research'] as const)('%s: names the inputs an agent holds and where a name or ticker becomes a slug', async (profile) => {
    const { client } = await connect({ profile });
    const { tools } = await client.listTools();
    const described = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    expect(described('find_projects')).toMatch(/name, \$TICKER or 0x contract/);
    expect(described('research_answer')).toMatch(/q: a name or \$TICKER, or address, or project: a slug/);
    expect(described('research_answer')).toMatch(/still being built/);
    expect(described('research_answer')).toContain('Not price advice or a safety verdict.');
    expect(described('get_changes')).toMatch(/^What changed on Robinhood Chain today or this week/);
    expect(described('get_contract')).toMatch(/^Who made this Robinhood Chain contract, and is it a known project's\?/);
  });

  it.each(['full', 'research'] as const)('%s: the handshake opens on when to reach for HEY', async (profile) => {
    const { client } = await connect({ profile });
    const opening = (client.getInstructions() ?? '').split('\n')[0]!;
    expect(opening).toMatch(/^Use HEY Research Lab for any question about a Robinhood Chain \(chain id 4663\) project, token, \$TICKER or 0x contract: is it still being built, what did it ship and when, what changed today or this week/);
    expect(opening).toContain('nothing here is price advice or a safety verdict');
    expect(opening).toContain('heyresearch.xyz link');
    // The research profile offers no market-attention surface, so its handshake does not promise one.
    expect(opening.includes('building ahead of their market attention')).toBe(profile === 'full');
  });

  it('drops only the default execution stamp: MCP reads an absent taskSupport as "forbidden"', async () => {
    const { client } = await connect();
    for (const tool of (await client.listTools()).tools) expect(tool.execution, tool.name).toBeUndefined();
  });

  it('maps every question to tools the catalogue lists, and the research questions to research-profile tools', () => {
    const full = new Set(mcpToolsFor('full').map((tool) => tool.name));
    const research = new Set(mcpToolsFor('research').map((tool) => tool.name));
    for (const entry of HEY_MCP_QUESTIONS) {
      expect(entry.question, entry.question).toMatch(/\?$/);
      for (const tool of entry.tools) {
        expect(full.has(tool), `${entry.question} → ${tool}`).toBe(true);
        expect(entry.answer, `${entry.question} names ${tool}`).toContain(tool);
        if (entry.research) expect(research.has(tool), `${entry.question} → ${tool} on research`).toBe(true);
      }
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
