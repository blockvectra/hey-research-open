import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A screen-reader-only table is hidden by a block wrapper, never by a class on the table itself
 * (2026-10-02). `sr-only` works by a 1px box with `overflow: hidden`, and a table box takes
 * neither: it is as wide as its columns. The market page's hidden candle table did exactly that
 * and gave every market page a sideways scroll — 1,061px at 375. The e2e
 * `market-overflow.spec.ts` measures the pages; this keeps the cause out of the source.
 */
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const ROOTS = ['packages/ui/src', 'apps/web/src'];
const HIDDEN_TABLE = /<table\b[^>]*\b(?:hey-)?sr-only\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry) && !/\.(test|spec)\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

describe('screen-reader-only tables', () => {
  it('never puts the visually-hidden class on a <table>', () => {
    const offenders: string[] = [];
    for (const root of ROOTS.filter((r) => existsSync(join(REPO_ROOT, r)))) {
      for (const file of sourceFiles(join(REPO_ROOT, root))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (HIDDEN_TABLE.test(line)) offenders.push(`${file}:${index + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('recognises the pattern it forbids', () => {
    expect(HIDDEN_TABLE.test('<table className="sr-only" data-testid="x">')).toBe(true);
    expect(HIDDEN_TABLE.test('<table className="hey-sr-only">')).toBe(true);
    expect(HIDDEN_TABLE.test('<div className="sr-only">')).toBe(false);
  });
});
