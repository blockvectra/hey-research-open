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

  for (const name of files) {
    const source = readFileSync(join(DIR, name), 'utf8');
    /*
     * One file can hold several documents — `bitquery-days.ts` holds the
     * trade-days one, which may read the archive, and the chain-days one,
     * which is pinned to realtime because it counts transactions. So the check
     * is per template literal, not per file.
     */
    const documents = [...source.matchAll(/`query [\s\S]*?`;/g)].map((match) => match[0]);
    const archiveDocs = documents.filter((doc) => doc.includes('dataset: ${dataset}'));
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
