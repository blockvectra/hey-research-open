import { afterEach, describe, expect, it } from 'vitest';

import { createDexscreenerAdapter } from './adapters/dexscreener';
import { systemLookup } from './http/url-safety';

/**
 * Guards the M2 acceptance criterion "no live API dependency in CI".
 *
 * `vitest.setup.ts` replaces the real `fetch` and refuses non-loopback DNS
 * lookups, and fails any test that reaches either. This asserts the guard itself
 * works — if it were ever removed, this test fails rather than CI quietly starting
 * to make live requests. It is the one suite that reaches the guard on purpose,
 * so it takes the recorded hits itself and asserts on them.
 */
const blockedNetwork = (): { take: () => string[] } => {
  const ledger = (globalThis as Record<symbol, unknown>)[Symbol.for('hey.test.blockedNetwork')];
  if (!ledger) throw new Error('vitest.setup.ts did not install the network guard');
  return ledger as { take: () => string[] };
};

describe('network access is disabled in tests', () => {
  afterEach(() => {
    // Nothing left over for the setup's own check.
    expect(blockedNetwork().take()).toEqual([]);
  });

  it('throws if anything calls the global fetch, and records the call', async () => {
    await expect(fetch('https://api.dexscreener.com/')).rejects.toThrow(
      /Network access is disabled in tests/,
    );
    expect(blockedNetwork().take()).toEqual(['fetch https://api.dexscreener.com/']);
  });

  it('makes an adapter fail loudly when no fetchImpl is injected', async () => {
    const result = await createDexscreenerAdapter().fetch(
      { chainId: 4663, tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { timeoutMs: 1000, retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 } },
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toMatch(/Network access is disabled in tests/);
    const hits = blockedNetwork().take();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.startsWith('fetch https://api.dexscreener.com/'))).toBe(true);
  });

  it('refuses a DNS lookup of a real host, and records it', async () => {
    await expect(systemLookup('api.dexscreener.com')).rejects.toThrow(/DNS lookups are disabled in tests/);
    expect(blockedNetwork().take()).toEqual(['dns api.dexscreener.com']);
  });

  it('still resolves localhost', async () => {
    const addresses = await systemLookup('localhost');
    expect(addresses.length).toBeGreaterThan(0);
    expect(blockedNetwork().take()).toEqual([]);
  });
});
