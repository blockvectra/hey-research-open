import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createUniswapQuoteAdapter, UNISWAP_TRADING_API_BASE_URL, type UniswapQuoteInput } from './uniswap-trading';

/**
 * The Trading API's `/quote` (2026-09-30). The fixture is the 200 example
 * Uniswap publishes in its own OpenAPI document
 * (trade-api.gateway.uniswap.org/v1/api.json, read 2026-09-30): a CLASSIC
 * quote on chain 1, WBTC in, ETH out. The contract under test is the shape,
 * so the published example is the right fixture; the request below asks the
 * same question the example answers.
 */
const fixture = readFixture('uniswap-quote-classic.json');
const EXAMPLE = JSON.parse(fixture) as { quote: { input: { token: string; amount: string }; output: { token: string } } };

const input: UniswapQuoteInput = {
  apiKey: 'test-key-not-a-secret',
  chainId: 1,
  tokenIn: EXAMPLE.quote.input.token,
  tokenOut: EXAMPLE.quote.output.token,
  amount: EXAMPLE.quote.input.amount,
  swapper: '0x0000000000000000000000000000000000000001',
};

describe('createUniswapQuoteAdapter', () => {
  it('posts one documented quote request with the key in x-api-key and normalises the answer', async () => {
    const stub = stubFetch({ status: 200, body: fixture, headers: { 'content-type': 'application/json' } });
    const result = await createUniswapQuoteAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.callCount()).toBe(1);
    const request = stub.requests[0]!;
    expect(request.url).toBe(`${UNISWAP_TRADING_API_BASE_URL}/quote`);
    expect(request.init?.method).toBe('POST');
    const headers = new Headers(request.init?.headers);
    expect(headers.get('x-api-key')).toBe('test-key-not-a-secret');
    const body = JSON.parse(String(request.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'EXACT_INPUT',
      tokenInChainId: 1,
      tokenOutChainId: 1,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amount: input.amount,
      swapper: input.swapper,
      routingPreference: 'BEST_PRICE',
    });
    // Nothing that would prepare an execution: no permit, no recipient, no fee.
    expect(Object.keys(body).sort()).toEqual(['amount', 'routingPreference', 'slippageTolerance', 'swapper', 'tokenIn', 'tokenInChainId', 'tokenOut', 'tokenOutChainId', 'type']);

    expect(result.status).toBe('fresh');
    expect(result.data).toMatchObject({
      routing: 'CLASSIC',
      requestId: '34784ef4-065a-4fa2-b77c-521f785fc068',
      quoteId: '62e83902-9455-405d-8c62-cdf8ee9e2042',
      chainId: 1,
      tokenIn: input.tokenIn.toLowerCase(),
      tokenOut: input.tokenOut.toLowerCase(),
      amountIn: '2516',
      amountOut: '996320746321162',
      priceImpactPct: 0.14,
    });
    expect(result.data?.gasFeeUsd).toBeCloseTo(1.275, 2);
    // Seconds, not minutes (API Terms of Use §2.4(g)).
    expect(result.cacheTtlSeconds).toBeLessThanOrEqual(15);
  });

  it('refuses an answer about another chain, other tokens or another amount', async () => {
    const adapter = createUniswapQuoteAdapter();
    const variants = [
      { ...input, chainId: 4663 },
      { ...input, tokenOut: '0x00000000000000000000000000000000000000aa' },
      { ...input, amount: '2517' },
    ];
    for (const asked of variants) {
      const stub = stubFetch({ status: 200, body: fixture, headers: { 'content-type': 'application/json' } });
      const result = await adapter.fetch(asked, testContext({ fetchImpl: stub.fetchImpl }));
      expect(result.data, JSON.stringify(asked)).toBeUndefined();
      expect(result.errorCode).toBe('INVALID_RESPONSE');
    }
  });

  it('maps the documented refusals to error codes and never to a quote of zero', async () => {
    const cases: [number, string][] = [
      [404, 'NOT_FOUND'],
      [429, 'RATE_LIMITED'],
      [401, 'UPSTREAM_ERROR'],
      [500, 'UPSTREAM_ERROR'],
    ];
    for (const [status] of cases) {
      const stub = stubFetch({ status, body: JSON.stringify({ errorCode: 'ResourceNotFound', detail: 'No quotes available' }), headers: { 'content-type': 'application/json' } });
      const result = await createUniswapQuoteAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl, retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 } }));
      expect(result.data, String(status)).toBeUndefined();
      expect(result.status).not.toBe('fresh');
    }
    const notFound = await createUniswapQuoteAdapter().fetch(
      input,
      testContext({ fetchImpl: stubFetch({ status: 404, body: '{}', headers: { 'content-type': 'application/json' } }).fetchImpl, retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 } }),
    );
    expect(notFound.errorCode).toBe('NOT_FOUND');
  });

  it('rejects a body that is not the published shape', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ requestId: 'x', routing: 'CLASSIC', quote: { input: { amount: '-1', token: 'nope' } } }), headers: { 'content-type': 'application/json' } });
    const result = await createUniswapQuoteAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toBeUndefined();
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('asks nothing for a malformed request: bad address, same token twice, zero or fractional amount, no key', async () => {
    const stub = stubFetch({ status: 200, body: fixture });
    const adapter = createUniswapQuoteAdapter();
    for (const bad of [
      { ...input, tokenIn: '0xabc' },
      { ...input, tokenOut: input.tokenIn },
      { ...input, amount: '0' },
      { ...input, amount: '1.5' },
      { ...input, amount: '1e18' },
      { ...input, apiKey: '' },
      { ...input, swapper: 'me' },
    ]) {
      const result = await adapter.fetch(bad, testContext({ fetchImpl: stub.fetchImpl }));
      expect(result.data).toBeUndefined();
    }
    expect(stub.callCount()).toBe(0);
  });
});
