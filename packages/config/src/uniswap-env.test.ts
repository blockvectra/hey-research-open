import { describe, expect, it } from 'vitest';

import { parseServerEnv } from './env';

/** The Uniswap switches (2026-09-30): all off unless set to exactly "true". */
describe('Uniswap configuration', () => {
  const base = { DATABASE_URL: 'postgresql://hey:hey@localhost:5432/hey_research' };

  it('is off with nothing set, and no key is invented', () => {
    const env = parseServerEnv(base).uniswap;
    expect(env).toEqual({ enabled: false, swapEnabled: false, apiKey: undefined });
  });

  it('turns on only on the literal "true"', () => {
    expect(parseServerEnv({ ...base, UNISWAP_ENABLED: 'true', UNISWAP_SWAP_ENABLED: 'true', UNISWAP_API_KEY: 'k' }).uniswap).toEqual({
      enabled: true,
      swapEnabled: true,
      apiKey: 'k',
    });
    for (const value of ['1', 'yes', 'TRUE', 'on', '']) {
      expect(parseServerEnv({ ...base, UNISWAP_ENABLED: value }).uniswap.enabled, value).toBe(false);
    }
  });
});
