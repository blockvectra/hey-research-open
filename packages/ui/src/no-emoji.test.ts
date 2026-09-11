import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Zero HEY-authored emoji in production UI (UI/UX V4 section 12, hard rule).
 *
 * Enforced by test rather than review: emoji creep back in one status map at a
 * time, and they are exactly the detail that makes a research product look like
 * a meme launchpad. Icons come from lucide-react so they inherit stroke weight,
 * size and colour like every other part of the system.
 */
// Resolved from this file, so the check works whatever the working directory is.
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
/*
 * Every tree whose strings can reach the interface. `packages/domain` is
 * included because it was where emoji actually survived: the weekly awards
 * shipped a glyph out of a database query, which no amount of checking the
 * component tree would have caught.
 */
const ROOTS = ['packages/ui/src', 'apps/web/src', 'packages/domain/src', 'packages/db/src/seed'];
const EMOJI = new RegExp(
  '[\\u{1F300}-\\u{1FAFF}]|[\\u{2600}-\\u{27BF}]|[\\u{2B00}-\\u{2BFF}]|' +
    '[\\u{1F000}-\\u{1F02F}]|\\u{FE0F}',
  'u',
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no emoji in production UI', () => {
  it('has no emoji anywhere in the UI source tree', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(join(REPO_ROOT, root))) {
        const contents = readFileSync(file, 'utf8');
        // Skip this file: it necessarily contains the ranges it screens for.
        if (file.endsWith('no-emoji.test.ts')) return;
        contents.split('\n').forEach((line, index) => {
          if (EMOJI.test(line)) offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 60)}`);
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
