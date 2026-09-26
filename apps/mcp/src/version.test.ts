import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MCP_PACKAGE_VERSION } from '@hey/mcp-core';

/**
 * The hosted `/mcp` has no build step that stamps a version (2026-09-26), so
 * it reports `MCP_PACKAGE_VERSION`. A release bumps this package; this test
 * fails until the constant says the same, so the hosted server and the npm
 * package never claim two versions for one tool set.
 */
describe('the version the hosted server reports', () => {
  it('is this package’s own version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(MCP_PACKAGE_VERSION).toBe(pkg.version);
  });
});
