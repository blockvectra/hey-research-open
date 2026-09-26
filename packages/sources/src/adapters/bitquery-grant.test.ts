import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BITQUERY_ARCHIVE_CUBES } from './bitquery';

/**
 * The historical add-on is granted per cube, and a document is refused whole.
 *
 * Asked on 2026-09-22, the provider states the grant verbatim:
 *
 *   realtime, archive:robinhood:DEXTradeByTokens, archive:robinhood:DEXTrades,
 *   archive:robinhood:Calls, archive:robinhood:Events
 *
 * So one `Transfers` cube in a document that asks for `archive` fails the
 * whole request with a 403 — which is exactly how the first backfill attempt
 * failed, in production, after the default had briefly been set to `combined`.
 * `combined` is stricter still: it spans both datasets and needs the grant for
 * both, so it fails for the same documents.
 *
 * This reads the documents and refuses to let a non-granted cube sit in one
 * that can be asked for the archive.
 */
const DIR = import.meta.dirname;
const CUBE = /\b(DEXTradeByTokens|DEXTrades|Transfers|Transactions|Calls|Events|DEXPoolEvents|DEXPoolSlippages|Holders|BalanceUpdates)\s*\(/g;

describe('the Bitquery archive grant', () => {
  const files = readdirSync(DIR).filter(
    (name) => name.startsWith('bitquery') && name.endsWith('.ts') && !name.includes('.test.'),
  );

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(4);
  });

  it('checks the upgrade-events document, which reads the archive (2026-09-26)', () => {
    expect(files).toContain('bitquery-upgrades.ts');
    const source = readFileSync(join(DIR, 'bitquery-upgrades.ts'), 'utf8');
    expect(source).toMatch(/dataset: combined/);
  });

  it('checks the contract-creations document, which reads 90 days of Calls (2026-09-27)', () => {
    expect(files).toContain('bitquery-creations.ts');
    const source = readFileSync(join(DIR, 'bitquery-creations.ts'), 'utf8');
    expect(source).toMatch(/dataset: combined/);
  });

  it('checks the method-days document, which the backfill sends to the archive (F9, 2026-09-27)', () => {
    expect(files).toContain('bitquery-methods.ts');
    const source = readFileSync(join(DIR, 'bitquery-methods.ts'), 'utf8');
    // Parameterised, so the fence below holds it to granted cubes for every dataset a caller may pass.
    expect(source).toMatch(/dataset: \$\{dataset\}/);
    const documents = [...source.matchAll(/`query [\s\S]*?`;/g)].map((match) => match[0]);
    expect(documents).toHaveLength(1);
    expect([...new Set([...documents[0]!.matchAll(CUBE)].map((match) => match[1]))]).toEqual(['Calls']);
  });

  for (const name of files) {
    const source = readFileSync(join(DIR, name), 'utf8');
    /*
     * One file can hold several documents — `bitquery-days.ts` holds the
     * trade-days one, which may read the archive, and the chain-days one,
     * which is pinned to realtime because it counts transactions. So the check
     * is per template literal, not per file.
     */
    const documents = [...source.matchAll(/`query [\s\S]*?`;/g)].map((match) => match[0]);
    /*
     * Two ways a document can reach past `realtime`, and until 2026-09-22 the
     * fence saw only the first.
     *
     * A parameterised document takes whatever a caller passes, so it must be
     * granted for every cube. A document that *hardcodes* `archive` or
     * `combined` is the same risk with none of the flexibility — and eight of
     * the ten documents here hardcode their dataset, so the fence was reading
     * two of them. Anything pinned to `realtime` needs no grant at all.
     */
    const archiveDocs = documents.filter(
      (doc) =>
        doc.includes('dataset: ${dataset}') ||
        /dataset: (archive|combined)\b/.test(doc),
    );
    if (archiveDocs.length === 0) continue;

    it(`${name} asks the archive only for cubes the plan grants`, () => {
      for (const doc of archiveDocs) {
        const asked = [...new Set([...doc.matchAll(CUBE)].map((match) => match[1]!))];
        const ungranted = asked.filter(
          (cube) => !(BITQUERY_ARCHIVE_CUBES as readonly string[]).includes(cube),
        );
        /*
         * A cube may still appear if it is spliced out for the archive, which
         * is what the trade-days document does with its transfer count.
         */
        const spliced = ungranted.filter(
          (cube) =>
            !new RegExp(`dataset === 'realtime'[\\s\\S]{0,400}${cube}\\s*\\(`).test(doc),
        );
        expect(spliced, `${name} would 403 on the archive for: ${spliced.join(', ')}`).toEqual([]);
      }
    });
  }
});
