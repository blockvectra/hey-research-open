import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
 *
 * It enforced almost nothing until 2026-09-15. The skip for this file's own
 * name was a `return` rather than a `continue`, so the walk — alphabetical —
 * left the test after 17 of 652 files, and `apps/web/src`, `packages/domain`
 * and the seed scripts were never scanned at all. That is every page in the
 * product. A check like this is worse than none: it reports green over ground
 * it never covered. The scan now skips the test suite instead of one filename,
 * which removes the special case that hid the bug.
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
    /*
     * Production source only (2026-09-15). A test is not the interface, and
     * two of them have to contain emoji to be worth anything — `plainText`
     * strips them, and the test that proves it needs one to strip. Skipping
     * the suite is also what lets this file stop special-casing its own name,
     * which is what hid the `return`-instead-of-`continue` bug.
     */
    else if (/\.(tsx?|css)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no emoji in production UI', () => {
  it('has no emoji anywhere in the UI source tree', () => {
    const offenders: string[] = [];
    /*
     * The public export carries `packages/` and not `apps/web`, so a root can
     * legitimately be absent there — but only there. A missing root in this
     * repository is the check silently covering less ground than it claims,
     * which is the bug this file was written about, so it is asserted.
     */
    const present = ROOTS.filter((root) => existsSync(join(REPO_ROOT, root)));
    if (existsSync(join(REPO_ROOT, 'apps/web'))) expect(present).toEqual(ROOTS);

    for (const root of present) {
      for (const file of sourceFiles(join(REPO_ROOT, root))) {
        const contents = readFileSync(file, 'utf8');
        contents.split('\n').forEach((line, index) => {
          if (EMOJI.test(line)) offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 60)}`);
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
