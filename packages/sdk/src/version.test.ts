import { describe, expect, it } from 'vitest';

import { DEV_VERSION, SDK_VERSION, sdkVersionFrom } from './version';

/**
 * The version in the user-agent (2026-09-19). In a checkout there is no
 * define, so the placeholder must be what goes out; in a bundle the stamped
 * string must win and an empty stamp must not.
 */
describe('SDK_VERSION', () => {
  it('is the development placeholder when nothing was defined at build time', () => {
    expect(SDK_VERSION).toBe(DEV_VERSION);
    expect(DEV_VERSION).toBe('0.0.0-dev');
  });

  it('takes the stamped version and falls back on anything that is not one', () => {
    expect(sdkVersionFrom('0.1.0')).toBe('0.1.0');
    expect(sdkVersionFrom('')).toBe(DEV_VERSION);
    expect(sdkVersionFrom(undefined)).toBe(DEV_VERSION);
    expect(sdkVersionFrom(1)).toBe(DEV_VERSION);
  });
});
