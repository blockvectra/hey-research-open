import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseServerEnv } from './env';

/**
 * Every variable the server environment reads is named in `.env.example`
 * (2026-09-24). Nine were not — among them the Terminal's own flag and the
 * worker's concurrency — so an operator setting up a host had no way to know
 * they existed.
 */
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
// The published subset of the source carries this package without the private root's example file.
const HAS_EXAMPLE = existsSync(fileURLToPath(new URL('../../../.env.example', import.meta.url)));

describe.skipIf(!HAS_EXAMPLE)('.env.example', () => {
  it('names every variable env.ts reads', () => {
    const source = read('./env.ts');
    const example = read('../../../.env.example');
    const keys = [...new Set([...source.matchAll(/\braw\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]!))];
    expect(keys.length).toBeGreaterThan(50);
    const named = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]!));
    expect(keys.filter((key) => !named.has(key))).toEqual([]);
  });
});

describe('reader feature kill switches', () => {
  const base = { DATABASE_URL: 'postgresql://hey:hey@localhost:5432/hey_research' };

  it('are on unless set to exactly "false"', () => {
    const on = parseServerEnv(base).hey;
    expect([on.askEnabled, on.compareEnabled, on.watchlistEnabled]).toEqual([true, true, true]);
    const off = parseServerEnv({ ...base, HEY_ASK_ENABLED: 'false', HEY_COMPARE_ENABLED: 'false', HEY_WATCHLIST_ENABLED: 'false' }).hey;
    expect([off.askEnabled, off.compareEnabled, off.watchlistEnabled]).toEqual([false, false, false]);
    expect(parseServerEnv({ ...base, HEY_ASK_ENABLED: '' }).hey.askEnabled).toBe(true);
  });
});
