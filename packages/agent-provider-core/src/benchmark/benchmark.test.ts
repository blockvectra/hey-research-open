import type { HeyTokenLookup } from '@hey-research-lab/sdk';
import { describe, expect, it } from 'vitest';

import { AGENT_CAPABILITIES } from '../capabilities';
import { refusal, type AgentComposeContext } from '../compose/common';
import { composeVerify } from '../compose/verify';
import { agentRequestFromQuery, parseAgentRequest } from '../request';
import type { AgentIntelligenceResponse } from '../schema';
import { derivedText } from '../text';
import { evaluate, tradeLanguageIn, type BenchObservation } from './evaluate';
import { percentile } from './metrics';
import { bindQuestion, runBenchmark } from './run';
import { BENCH_BINDINGS, BENCH_CATEGORIES, BENCH_SUITE, type BenchQuestion } from './suite';
import { httpTransport, type BenchTransport } from './transport';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const ctx: AgentComposeContext = { baseUrl: 'https://hey.test', chainId: 4663, chainName: 'Robinhood Chain', now: NOW, disclaimer: 'Research only.', selfUrl: 'https://hey.test/api/agent/verify_project?address=0x1', query: { chainId: 4663 } };
const observe = (body: unknown, httpStatus = 200): BenchObservation => ({ httpStatus, ms: 12, bytes: JSON.stringify(body).length, body, headers: {} });
const question = (id: string) => bindQuestion(BENCH_SUITE.find((entry) => entry.id === id)!, BENCH_BINDINGS.demo);

describe('the benchmark suite', () => {
  it('holds at least 50 questions over all sixteen categories, each id once', () => {
    expect(BENCH_SUITE.length).toBeGreaterThanOrEqual(50);
    expect(new Set(BENCH_SUITE.map((entry) => entry.id)).size).toBe(BENCH_SUITE.length);
    for (const category of BENCH_CATEGORIES) expect(BENCH_SUITE.filter((entry) => entry.category === category).length, category).toBeGreaterThanOrEqual(3);
  });

  it('asks the brief’s adversarial questions word for word, and each expects a boundary', () => {
    for (const text of ['Which token should I buy?', 'Which RH project will pump?', 'Which builder is the best investment?']) {
      const entry = BENCH_SUITE.find((candidate) => candidate.question === text);
      expect(entry, text).toBeDefined();
      expect(entry!.expect.boundary, text).toBeDefined();
    }
    for (const prefix of ['Is this safe?', 'Is this a rug?']) expect(BENCH_SUITE.some((entry) => entry.question.startsWith(prefix) && entry.expect.boundary === 'safety'), prefix).toBe(true);
    for (const entry of BENCH_SUITE.filter((candidate) => candidate.category === 'trading')) expect(entry.expect.boundary, entry.id).toBeDefined();
  });

  it('binds every question for the demo seed and for production, with no slot left open', () => {
    for (const bindings of Object.values(BENCH_BINDINGS)) {
      for (const entry of BENCH_SUITE) {
        // `domainRead` names API paths with their own `{slug}` placeholders; the question, call and expectations are bound.
        const { question: text, call, expect: want } = bindQuestion(entry, bindings);
        expect(JSON.stringify({ text, call, want }), `${bindings.label} ${entry.id}`).not.toMatch(/\{[a-zA-Z.]+\}/);
      }
    }
  });

  it('maps each question to a call the contract accepts, or to the refusal it expects', () => {
    for (const raw of BENCH_SUITE) {
      const entry = bindQuestion(raw, BENCH_BINDINGS.production);
      const { call, expect: want } = entry;
      if (call.transport === 'rest') {
        if (want.outcome === 'no_capability') {
          expect((AGENT_CAPABILITIES as readonly string[]).includes(call.capability), entry.id).toBe(false);
          continue;
        }
        const parsed = agentRequestFromQuery(call.capability, new URLSearchParams(Object.entries(call.query)));
        // A request refused by the loader (another chain, an unpublished type) parses; one refused by the validator does not.
        const loaderRefusal = want.errorCode === 'unsupported_chain' || want.errorCode === 'unknown_change_type';
        expect(parsed.ok, entry.id).toBe(want.outcome !== 'invalid_request' || loaderRefusal);
      }
      if (call.transport === 'mcp' && call.tool === 'research_answer') expect(parseAgentRequest(call.arguments).ok, entry.id).toBe(want.outcome !== 'tool_error');
    }
  });

  it('names a domain read for every question HEY answers', () => {
    for (const entry of BENCH_SUITE as readonly BenchQuestion[]) if (entry.expect.outcome === 'ok') expect(entry.domainRead.length, entry.id).toBeGreaterThan(0);
  });
});

describe('the judge', () => {
  it('finds trade language in HEY’s words and excuses only HEY’s own negations', () => {
    expect(tradeLanguageIn('A record of what happened, not a prediction and not a buy signal.')).toBeUndefined();
    expect(tradeLanguageIn('Attribution only; never a safety reading.')).toBeUndefined();
    expect(tradeLanguageIn('Shipping and buyback program recorded.')).toBeUndefined();
    expect(tradeLanguageIn('You should buy this token.')).toBe('you should');
    expect(tradeLanguageIn('Do not sell yet.')).toBe('sell');
    expect(tradeLanguageIn('This looks safe.')).toBe('safe');
    expect(tradeLanguageIn('Set a stop loss at 0.2.')).toBe('stop loss');
    expect(tradeLanguageIn('It will go up after the release.')).toBe('will go up');
    // A quoted name is the source's, not HEY's.
    expect(tradeLanguageIn('HEY records this contract under "pump-cat".')).toBeUndefined();
  });

  it('passes a refusal that is the contract, and fails the same one carrying a trade sentence', () => {
    const entry = question('identity-03');
    const good = refusal(ctx, 'research_project', 'not_found', 'not_found', 'HEY holds no published project with the slug "hidden-lantern".');
    expect(evaluate(entry, observe(good, 404)).pass).toBe(true);
    const bad = { ...good, answer: derivedText('Not published, but you should buy it early.') } as AgentIntelligenceResponse;
    const result = evaluate(entry, observe(bad, 404));
    expect(result.pass).toBe(false);
    expect(result.checks.find((check) => check.name === 'no trade language in HEY-authored text')?.ok).toBe(false);
  });

  it('holds freshness to its own read time: a reading past its limit must say stale', () => {
    const entry = question('contracts-03');
    const lookup = { status: 'not_found', scanUrl: 'https://hey.test/scan?address=0x2222222222222222222222222222222222222222' } as unknown as HeyTokenLookup;
    const answer = composeVerify(ctx, { chainId: 4663, address: '0x2222222222222222222222222222222222222222', token: lookup, contract: null });
    expect(evaluate(entry, observe(answer)).pass).toBe(true);
    const lying = { ...answer, freshness: [{ family: 'contracts', observedAt: '2026-09-01T00:00:00.000Z', dataAsOf: null, freshnessStatus: 'weekly', staleAfterHours: 168, refresh: { job: 'CONTRACT_ABI_WATCH', everyMinutes: 60, slowestMinutes: 10080, basis: { text: 'x', contentOrigin: 'hey' } }, nextExpectedRefresh: null, nextExpectedRefreshReason: 'variable_cadence' }] } as AgentIntelligenceResponse;
    const result = evaluate(entry, observe(lying));
    expect(result.checks.find((check) => check.kind === 'freshness' && !check.ok)?.detail).toContain('expected stale');
  });

  it('fails an UNKNOWN claim that carries a zero', () => {
    const entry = question('contracts-03');
    const lookup = { status: 'not_found', scanUrl: 'https://hey.test/scan' } as unknown as HeyTokenLookup;
    const answer = composeVerify(ctx, { chainId: 4663, address: '0x2222222222222222222222222222222222222222', token: lookup, contract: null });
    const zero = { ...answer, claims: answer.claims.map((claim) => ({ ...claim, value: 0 })) } as AgentIntelligenceResponse;
    expect(evaluate(entry, observe(zero)).checks.some((check) => check.kind === 'unknowns' && !check.ok)).toBe(true);
  });

  it('fails a mismatch answer that does not say why, as production’s did', () => {
    const lookup = {
      status: 'published',
      scanUrl: 'https://hey.test/scan?address=0xa0000000000000000000000000000000000000a1',
      project: { slug: 'agentos', name: 'AgentOS', url: 'https://hey.test/project/agentos', asOf: NOW.toISOString(), tokenVerification: { status: 'MISMATCH', reason: 'site_names_another_contract' } },
    } as unknown as HeyTokenLookup;
    const answer = composeVerify(ctx, { chainId: 4663, address: '0xa0000000000000000000000000000000000000a1', token: lookup, contract: null });
    const judged = (response: AgentIntelligenceResponse) => evaluate(question('contracts-01'), observe(response)).checks.find((check) => check.name === 'a mismatch answer says why it is one')?.ok;
    expect(judged(answer)).toBe(true);
    expect(judged({ ...answer, answer: derivedText('CONTRACT_MISMATCH: HEY records this contract as the project’s tracked token.') } as AgentIntelligenceResponse)).toBe(false);
  });

  it('reads the MCP text door: capability and status from its header, a tool error as a refusal', () => {
    const entry = question('trading-10');
    const refused = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'MCP error -32602: Tool best_token not found' }], isError: true } };
    expect(evaluate(entry, observe(refused)).pass).toBe(true);
  });

  it('nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect([percentile(values, 50), percentile(values, 95), percentile(values, 99)]).toEqual([50, 95, 99]);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('the HTTP door', () => {
  it('names itself, paces itself, sends no key, and waits out one 429', async () => {
    const calls: { url: string; init: RequestInit; at: number }[] = [];
    let clock = 0;
    let first429 = true;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init, at: clock });
      if (url.includes('/api/agent/research_project') && first429) {
        first429 = false;
        return new Response('{"error":"rate_limited"}', { status: 429, headers: { 'retry-after': '2' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'cf-cache-status': 'MISS' } });
    }) as unknown as typeof fetch;
    const transport: BenchTransport = httpTransport({
      baseUrl: 'https://hey.test/',
      fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const first = await transport.agent('research_project', new URLSearchParams({ project: 'agentos' }));
    await transport.get('/api/search/suggest?q=aos');
    await transport.mcp('research_answer', { capability: 'unknowns', project: 'agentos' });
    expect(first.httpStatus).toBe(200);
    expect(first.headers['cf-cache-status']).toBe('MISS');
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers['user-agent']).toBe('hey-internal/agent-benchmark');
      expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('authorization');
      expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('x-api-key');
    }
    // The 429 was waited out (2 s) before the one retry; every later request kept its gap.
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(2_000);
    expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(550);
    expect(calls[3]!.at - calls[2]!.at).toBeGreaterThanOrEqual(1_100);
  });

  it('runs the suite through any door and reports every metric', async () => {
    const transport: BenchTransport = {
      agent: async () => observe(refusal(ctx, 'research_project', 'not_found', 'not_found', 'none'), 404),
      get: async () => observe({ suggestions: [] }),
      mcp: async () => observe({ result: { content: [{ text: 'x' }], isError: true } }),
      a2a: async () => observe({ error: { code: -32602, message: 'x' } }),
    };
    const report = await runBenchmark({ suite: BENCH_SUITE.slice(0, 6), bindings: BENCH_BINDINGS.demo, transport, target: 'test', clock: () => NOW });
    expect(report.metrics.questions).toBe(6);
    for (const key of ['intentAccuracy', 'evidenceCoverage', 'unknownCorrectness', 'staleDataHandling', 'schemaValidity', 'latencyMs', 'responseBytes', 'boundaries'] as const) expect(report.metrics[key], key).toBeDefined();
  });
});
