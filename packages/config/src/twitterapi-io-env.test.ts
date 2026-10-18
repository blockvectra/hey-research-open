import { describe, expect, it } from 'vitest';

import { isTwitterApiIoEnabled, parseServerEnv } from './env';

/** The twitterapi.io switches (2026-10-18): off unless the flag is exactly "true" and a key is set. */
describe('twitterapi.io configuration', () => {
  const base = { DATABASE_URL: 'postgresql://hey:hey@localhost:5432/hey_research' };

  it('is off with nothing set, and no key or ceiling is invented', () => {
    const env = parseServerEnv(base);
    expect(env.twitterapiIo).toEqual({ enabled: false, apiKey: undefined, dailyCredits: undefined });
    expect(isTwitterApiIoEnabled(env)).toBe(false);
  });

  it('needs both the literal "true" and a key', () => {
    expect(isTwitterApiIoEnabled(parseServerEnv({ ...base, TWITTERAPI_IO_KEY: 'k' }))).toBe(false);
    expect(isTwitterApiIoEnabled(parseServerEnv({ ...base, TWITTERAPI_IO_ENABLED: 'true' }))).toBe(false);
    expect(isTwitterApiIoEnabled(parseServerEnv({ ...base, TWITTERAPI_IO_ENABLED: 'true', TWITTERAPI_IO_KEY: 'k' }))).toBe(true);
    for (const value of ['1', 'yes', 'TRUE', 'on', '']) {
      expect(isTwitterApiIoEnabled(parseServerEnv({ ...base, TWITTERAPI_IO_ENABLED: value, TWITTERAPI_IO_KEY: 'k' })), value).toBe(false);
    }
  });

  it('reads an optional lower ceiling and refuses a nonsense one', () => {
    expect(parseServerEnv({ ...base, TWITTERAPI_IO_DAILY_CREDITS: '12000' }).twitterapiIo.dailyCredits).toBe(12_000);
    expect(parseServerEnv({ ...base, TWITTERAPI_IO_DAILY_CREDITS: '0' }).twitterapiIo.dailyCredits).toBe(0);
    expect(() => parseServerEnv({ ...base, TWITTERAPI_IO_DAILY_CREDITS: '-5' })).toThrow();
  });
});
