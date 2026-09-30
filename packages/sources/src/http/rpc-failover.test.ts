import { beforeEach, describe, expect, it } from 'vitest';

import { createRpcContractAdapter } from '../adapters/rpc';
import { createRpcLogCountAdapter } from '../adapters/rpc-logs';
import { testContext } from '../testing';
import { isNodeRefusal, resetRpcFallbackChecks } from './rpc-failover';
import { SourceError } from '../errors';

/*
 * The bulk chain readers' fallback (2026-09-30). Every adapter's JSON-RPC
 * read to `RH_RPC_URL` that the node refused moves once to
 * `RH_RPC_FALLBACK_URL`, after that node has proved chain 4663; an answer is
 * never moved, and a node for another chain is never read.
 */
const PRIMARY = 'https://rpc.primary.test';
const FALLBACK = 'https://rpc.fallback.test';
const ADDRESS = '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f';
const rpcFallback = { primaryUrl: PRIMARY, url: FALLBACK, chainId: 4663 };

type Script = (method: string) => { status?: number; result?: unknown; error?: { code: number; message: string } };

function nodes(primary: Script, fallback: Script) {
  const asked: { url: string; method: string }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    asked.push({ url, method: body.method });
    const answer = (url === PRIMARY ? primary : fallback)(body.method);
    if (answer.status && answer.status !== 200) return new Response('refused', { status: answer.status, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...(answer.error ? { error: answer.error } : { result: answer.result }) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { asked, ctx: testContext({ fetchImpl, rpcFallback, retry: { attempts: 1, baseDelayMs: 0, maxDelayMs: 0 } }) };
}

const code = '0x6080604052';

describe('RPC failover for the adapters', () => {
  beforeEach(() => resetRpcFallbackChecks());

  it('moves a 429 from the primary to the fallback once it has proved chain 4663, and names the node that answered', async () => {
    const { asked, ctx } = nodes(
      () => ({ status: 429 }),
      (method) => (method === 'eth_chainId' ? { result: '0x1237' } : { result: code }),
    );
    const adapter = createRpcContractAdapter();
    const first = await adapter.fetch({ rpcUrl: PRIMARY, address: ADDRESS }, ctx);
    expect(first).toMatchObject({ status: 'fresh', sourceUrl: FALLBACK, attempts: 2, data: { isContract: true } });
    await adapter.fetch({ rpcUrl: PRIMARY, address: ADDRESS }, ctx);
    // The chain is proved once, not per read.
    expect(asked.filter((call) => call.url === FALLBACK && call.method === 'eth_chainId')).toHaveLength(1);
    expect(asked.filter((call) => call.url === FALLBACK && call.method === 'eth_getCode')).toHaveLength(2);
  });

  it('moves a 403 challenge and a 5xx the same way, and a launch scan\'s log read with them', async () => {
    for (const status of [403, 502]) {
      resetRpcFallbackChecks();
      const { ctx } = nodes(
        () => ({ status }),
        (method) => (method === 'eth_chainId' ? { result: '0x1237' } : { result: [{ address: ADDRESS }, { address: ADDRESS }] }),
      );
      const logs = await createRpcLogCountAdapter().fetch({ rpcUrl: PRIMARY, address: ADDRESS, fromBlock: 1, toBlock: 1000 }, ctx);
      expect(logs).toMatchObject({ status: 'fresh', sourceUrl: FALLBACK, data: { count: 2 } });
    }
  });

  it('never moves an answer: a JSON-RPC error in a 200 stays the primary\'s', async () => {
    const { asked, ctx } = nodes(
      () => ({ error: { code: -32000, message: 'execution reverted' } }),
      () => ({ result: code }),
    );
    const result = await createRpcContractAdapter().fetch({ rpcUrl: PRIMARY, address: ADDRESS }, ctx);
    expect(result.status).toBe('error');
    expect(asked.every((call) => call.url === PRIMARY)).toBe(true);
  });

  it('never reads a fallback for another chain, remembers it, and says so in the primary\'s refusal', async () => {
    const { asked, ctx } = nodes(
      () => ({ status: 429 }),
      (method) => (method === 'eth_chainId' ? { result: '0x1' } : { result: code }),
    );
    const adapter = createRpcContractAdapter();
    const first = await adapter.fetch({ rpcUrl: PRIMARY, address: ADDRESS }, ctx);
    expect(first).toMatchObject({ status: 'rate_limited', errorCode: 'RATE_LIMITED' });
    expect(first.errorMessage).toMatch(/RH_RPC_FALLBACK_URL answers chain 1, not 4663/);
    await adapter.fetch({ rpcUrl: PRIMARY, address: ADDRESS }, ctx);
    const fallbackCalls = asked.filter((call) => call.url === FALLBACK);
    expect(fallbackCalls.map((call) => call.method)).toEqual(['eth_chainId']);
  });

  it('asks the chain again when the fallback could not be asked, and keeps the primary\'s refusal meanwhile', async () => {
    let up = false;
    const { asked, ctx } = nodes(
      () => ({ status: 429 }),
      (method) => (!up ? { status: 503 } : method === 'eth_chainId' ? { result: '0x1237' } : { result: code }),
    );
    const adapter = createRpcContractAdapter();
    expect((await adapter.fetch({ rpcUrl: PRIMARY, address: ADDRESS }, ctx)).status).toBe('rate_limited');
    up = true;
    expect((await adapter.fetch({ rpcUrl: PRIMARY, address: ADDRESS }, ctx)).status).toBe('fresh');
    expect(asked.filter((call) => call.url === FALLBACK && call.method === 'eth_chainId')).toHaveLength(2);
  });

  it('leaves every other request alone: another URL, or no fallback configured', async () => {
    const { asked, ctx } = nodes(
      () => ({ status: 429 }),
      () => ({ result: '0x1237' }),
    );
    const other = await createRpcContractAdapter().fetch({ rpcUrl: 'https://rpc.other.test', address: ADDRESS }, ctx);
    expect(other.sourceUrl).toBe('https://rpc.other.test');
    const none = await createRpcContractAdapter().fetch({ rpcUrl: PRIMARY, address: ADDRESS }, { ...ctx, rpcFallback: undefined });
    expect(none.status).toBe('rate_limited');
    expect(asked.some((call) => call.url === FALLBACK)).toBe(false);
  });

  it('calls a refusal a refusal', () => {
    expect(isNodeRefusal(new SourceError('RATE_LIMITED', '429', 429))).toBe(true);
    expect(isNodeRefusal(new SourceError('INVALID_RESPONSE', '403', 403))).toBe(true);
    expect(isNodeRefusal(new SourceError('TIMEOUT', 'slow'))).toBe(true);
    expect(isNodeRefusal(new SourceError('INVALID_RESPONSE', 'schema'))).toBe(false);
    expect(isNodeRefusal(new SourceError('NOT_FOUND', '404', 404))).toBe(false);
  });
});
