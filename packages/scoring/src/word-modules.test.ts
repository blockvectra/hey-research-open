import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The word modules are HEY's one vocabulary (2026-10-28 simplicity study, CON-9): activity, research level, market
 * status, token and ship verification, and why a gap or a badge is withheld. The MCP (`@hey/mcp-core`, bundled into
 * the published stdio server) and the agent contract (`@hey/agent-provider-core`) read them directly, so each must
 * import nothing at run time — a type import is erased — or the bundle would carry the scorer with it. Until this
 * test, those two packages kept literal copies held equal by parity tests.
 */
const WORD_MODULES = ['activity-words.ts', 'research-level-words.ts', 'market-status-words.ts', 'verification-words.ts', 'withheld-words.ts'];

describe('the word modules import nothing at run time', () => {
  it.each(WORD_MODULES)('%s', (file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const imports = source.split('\n').filter((line) => /^\s*import\s/.test(line) || /^\s*export\s.*\sfrom\s/.test(line));
    for (const line of imports) expect(line, `${file}: ${line}`).toMatch(/^\s*import type\s/);
  });
});
