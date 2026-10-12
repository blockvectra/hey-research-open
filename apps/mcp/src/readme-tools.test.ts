import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { HEY_MCP_TOOLS } from '@hey/mcp-core';

/**
 * The README's tool count and table follow the catalogue (2026-10-12, AG-9):
 * the docs said twelve, thirteen or fourteen tools for one set. This one
 * states the count in words and lists each tool, so both are held here.
 */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

describe('apps/mcp/README.md', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const count = WORDS[HEY_MCP_TOOLS.length]!;

  it('states the count the catalogue lists', () => {
    expect(readme).toContain(`## The ${count} tools`);
    expect(readme).toContain(`the server offers ${count} tools`);
    for (const word of WORDS.filter((w) => w !== count)) expect(readme).not.toMatch(new RegExp(`\\b${word} tools\\b`, 'i'));
  });

  it('lists every tool the catalogue lists in its table', () => {
    const table = [...readme.matchAll(/^\| `([a-z_0-9]+)` \|/gm)].map((match) => match[1]);
    for (const tool of HEY_MCP_TOOLS) expect(table, tool.name).toContain(tool.name);
  });
});
