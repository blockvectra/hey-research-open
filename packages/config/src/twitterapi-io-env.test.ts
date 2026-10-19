import { describe, expect, it } from 'vitest';

import { isTwitterApiIoEnabled, isXAnnouncementsEnabled, isXEcosystemWatchEnabled, isXOpportunitiesEnabled, isXOpportunityContextEnabled, isXPostRecheckEnabled, parseServerEnv } from './env';

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

  // Bounded X research (2026-10-20): four switches, off by default, each exactly "true"; the reads need twitterapi.io too.
  it('keeps every bounded X research switch off unless it is exactly "true", and the reads off without the key', () => {
    const off = parseServerEnv(base);
    expect(off.xResearch).toEqual({ announcements: false, ecosystemWatch: false, opportunities: false, postRecheck: false });
    for (const value of ['1', 'yes', 'TRUE', 'on', '']) expect(parseServerEnv({ ...base, X_ECOSYSTEM_WATCH_ENABLED: value }).xResearch.ecosystemWatch, value).toBe(false);
    const flags = { X_ANNOUNCEMENTS_ENABLED: 'true', X_ECOSYSTEM_WATCH_ENABLED: 'true', X_OPPORTUNITIES_ENABLED: 'true', X_POST_RECHECK_ENABLED: 'true' };
    const unkeyed = parseServerEnv({ ...base, ...flags });
    // No provider call: on by their own switch.
    expect(isXAnnouncementsEnabled(unkeyed)).toBe(true);
    expect(isXOpportunitiesEnabled(unkeyed)).toBe(true);
    // Provider reads: off until twitterapi.io is on and keyed.
    expect([isXEcosystemWatchEnabled(unkeyed), isXPostRecheckEnabled(unkeyed), isXOpportunityContextEnabled(unkeyed)]).toEqual([false, false, false]);
    const keyed = parseServerEnv({ ...base, ...flags, TWITTERAPI_IO_ENABLED: 'true', TWITTERAPI_IO_KEY: 'k' });
    expect([isXEcosystemWatchEnabled(keyed), isXPostRecheckEnabled(keyed), isXOpportunityContextEnabled(keyed)]).toEqual([true, true, true]);
    // The master switch turns every X read off at once.
    const master = parseServerEnv({ ...base, ...flags, TWITTERAPI_IO_ENABLED: 'false', TWITTERAPI_IO_KEY: 'k' });
    expect([isXEcosystemWatchEnabled(master), isXPostRecheckEnabled(master), isXOpportunityContextEnabled(master)]).toEqual([false, false, false]);
  });

  it('reads an optional lower ceiling and refuses a nonsense one', () => {
    expect(parseServerEnv({ ...base, TWITTERAPI_IO_DAILY_CREDITS: '12000' }).twitterapiIo.dailyCredits).toBe(12_000);
    expect(parseServerEnv({ ...base, TWITTERAPI_IO_DAILY_CREDITS: '0' }).twitterapiIo.dailyCredits).toBe(0);
    expect(() => parseServerEnv({ ...base, TWITTERAPI_IO_DAILY_CREDITS: '-5' })).toThrow();
  });
});
