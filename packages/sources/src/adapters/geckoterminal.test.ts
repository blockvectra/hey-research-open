import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createGeckoterminalAdapter } from './geckoterminal';

/**
 * GeckoTerminal answers that are not market data (overnight audit
 * 2026-09-12). A maintenance page or a reshaped payload must come back as
 * an invalid response, so the market refresh records nothing and the card
 * keeps its last honest reading.
 */
describe('geckoterminal market context: answers that are not data', () => {
  const input = { chainId: 4663, network: 'robinhood-chain', tokenAddress: '0xb33eb16782776b4d738c0fd643577cb0284db610' };

  it('reports a body that is not JSON as an invalid response', async () => {
    const stub = stubFetch({ status: 200, body: '<!doctype html><title>Maintenance</title>' });
    const result = await createGeckoterminalAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result).toMatchObject({ status: 'error', errorCode: 'INVALID_RESPONSE' });
  });

  it('reports JSON of the wrong shape as an invalid response', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: 42 }) });
    const result = await createGeckoterminalAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result).toMatchObject({ status: 'error', errorCode: 'INVALID_RESPONSE' });
  });
});
