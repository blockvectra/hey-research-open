import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createBlockscoutVerifiedAdapter } from './blockscout-verified';

/*
 * Keyed only (founder ruling, 2026-09-30). The instance's REST listing sat
 * behind a bot filter HEY got past with a crawler-form agent string; HEY no
 * longer relies on that. The listing is read through Blockscout's keyed API,
 * and anything else is not read — no request leaves, and the key is never
 * sent to the instance.
 */
describe('Blockscout verified-contract listing', () => {
  const adapter = createBlockscoutVerifiedAdapter();
  const keyed = { baseUrl: 'https://api.blockscout.com', chainId: 4663, apiKey: 'proapi_secret' };

  it('handles only the keyed API', () => {
    expect(adapter.canHandle(keyed)).toBe(true);
    expect(adapter.canHandle({ baseUrl: 'https://api.blockscout.com' })).toBe(false);
    expect(adapter.canHandle({ baseUrl: 'https://robinhoodchain.blockscout.com', apiKey: 'proapi_secret' })).toBe(false);
  });

  it('reads nothing from the instance, keyless or with a key handed to it, and says why', async () => {
    for (const input of [{ baseUrl: 'https://robinhoodchain.blockscout.com' }, { baseUrl: 'https://robinhoodchain.blockscout.com', chainId: 4663, apiKey: 'proapi_secret' }]) {
      const stub = stubFetch({ status: 200, body: readFixture('blockscout-pro-listcontracts.json') });
      const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
      expect(stub.requests).toHaveLength(0);
      expect(result).toMatchObject({ status: 'error', errorCode: 'BLOCKED_URL' });
      expect(result.errorMessage).toMatch(/^not read: /);
      expect(result.data).toBeUndefined();
    }
  });

  it('sends HEY\'s own agent string to the keyed API, never a browser-form one', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-pro-listcontracts.json') });
    await adapter.fetch(keyed, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url.startsWith('https://api.blockscout.com/v2/api?')).toBe(true);
    const headers = (stub.requests[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(String(headers['user-agent'] ?? '')).not.toMatch(/^Mozilla/);
  });
});
