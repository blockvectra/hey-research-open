import { describe, expect, it } from 'vitest';

import { createDexscreenerAdapter } from './adapters/dexscreener';

/**
 * Guards the M2 acceptance criterion "no live API dependency in CI".
 *
 * `vitest.setup.ts` replaces the real `fetch`, so this asserts the guard itself
 * works — if it were ever removed, this test fails rather than CI quietly starting
 * to make live requests.
 */
describe('network access is disabled in tests', () => {
  it('throws if anything calls the global fetch', async () => {
    await expect(fetch('https://api.dexscreener.com/')).rejects.toThrow(
      /Network access is disabled in tests/,
    );
  });

  it('makes an adapter fail loudly when no fetchImpl is injected', async () => {
    const result = await createDexscreenerAdapter().fetch(
      { chainId: 4663, tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { timeoutMs: 1000, retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 } },
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toMatch(/Network access is disabled in tests/);
  });
});
