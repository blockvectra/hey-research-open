import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../adapter';
import { testContext } from '../testing';
import { readTar } from '../tar';
import { createOpenDevDataAdapter, OPEN_DEV_DATA_ARCHIVE_URL, OPEN_DEV_DATA_MAX_ERRORS, parseOpenDevDataArchive, snapshotFromArchive } from './open-dev-data';
import { isMigrationFileName, normalizeGithubRepoUrl, replayTaxonomy, splitDslArguments } from './open-dev-data-taxonomy';

/**
 * Open Dev Data contract tests (2026-09-28). The fixture archive is packed
 * the way GitHub's codeload packs the upstream repository — a pax global
 * header carrying the commit id, then `open-dev-data-master/…` — from the
 * plain-text migrations in `fixtures/open-dev-data/` (rebuild with its
 * `build.py`). The expected listings below are what Electric Capital's own
 * tool exports for those migrations (`open-dev-data export -r`, run
 * 2026-09-28 with the one deliberately failing line removed, since their
 * validator stops on any error): the replay here must agree with theirs.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const archive = readFileSync(path.join(here, '../fixtures/open-dev-data-archive.tar.gz'));
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

const binaryFetch = (responses: { status: number; body?: Uint8Array; headers?: Record<string, string> }[]) => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
    const spec = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return new Response(spec.status === 304 ? null : (spec.body ?? new Uint8Array()), { status: spec.status, headers: spec.headers ?? {} });
  };
  return { fetchImpl, requests };
};
const GZIP = { 'content-type': 'application/x-gzip', etag: '"abc123"' };

describe('the Open Dev Data archive', () => {
  it('reads the migrations and the commit id from a codeload-shaped archive', async () => {
    const stub = binaryFetch([{ status: 200, body: archive, headers: GZIP }]);
    const result = await createOpenDevDataAdapter().fetch({}, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(stub.requests[0]?.url).toBe(OPEN_DEV_DATA_ARCHIVE_URL);
    expect(result.etag).toBe('"abc123"');
    expect(result.data).toMatchObject({ commit: COMMIT, migrations: 2, ignoredFiles: 2, errorCount: 1 });
    expect(result.data?.errors).toEqual([{ file: '2020-06-30T235959_mutations', line: 10, kind: 'InvalidEcosystem' }]);
  });

  it('sends the stored ETag and reads a 304 as unchanged', async () => {
    const stub = binaryFetch([{ status: 304 }]);
    const result = await createOpenDevDataAdapter().fetch({}, testContext({ fetchImpl: stub.fetchImpl, etag: '"abc123"' }));
    expect(result.status).toBe('not_modified');
    expect(stub.requests[0]?.headers['if-none-match']).toBe('"abc123"');
  });

  it('refuses a body that is not a gzip archive, and a content type it was not built for', async () => {
    const notGzip = binaryFetch([{ status: 200, body: new TextEncoder().encode('<html>rate limited</html>'), headers: GZIP }]);
    const bad = await createOpenDevDataAdapter().fetch({}, testContext({ fetchImpl: notGzip.fetchImpl }));
    expect(bad).toMatchObject({ status: 'error', errorCode: 'INVALID_RESPONSE' });
    const html = binaryFetch([{ status: 200, body: archive, headers: { 'content-type': 'text/html' } }]);
    expect(await createOpenDevDataAdapter().fetch({}, testContext({ fetchImpl: html.fetchImpl }))).toMatchObject({ status: 'error', errorCode: 'UNSUPPORTED_CONTENT_TYPE' });
  });

  it('refuses an archive whose replay fails past the error cap', () => {
    const text = Array.from({ length: OPEN_DEV_DATA_MAX_ERRORS + 1 }, (_, i) => `repadd Missing https://github.com/x/y${i}`).join('\n');
    expect(() => snapshotFromArchive({ commit: null, files: [{ name: '2019-01-01T000000_bad', text }], ignoredFiles: 0 })).toThrow(/taxonomy replay failed on 51 commands/);
  });

  it('refuses an archive with no migrations at all', async () => {
    const empty = gzipSync(Buffer.alloc(1024));
    const stub = binaryFetch([{ status: 200, body: empty, headers: GZIP }]);
    expect(await createOpenDevDataAdapter().fetch({}, testContext({ fetchImpl: stub.fetchImpl }))).toMatchObject({ status: 'error', errorCode: 'INVALID_RESPONSE' });
  });

  it('verifies every tar header checksum', () => {
    const unpacked = Buffer.from(parseTarBytes());
    // A byte inside the first header (its name field).
    unpacked[10] = (unpacked[10] ?? 0) ^ 0xff;
    expect(() => readTar(unpacked, { keep: () => true, maxEntries: 100 })).toThrow(/checksum/);
  });
});

function parseTarBytes(): Uint8Array {
  // The fixture's tar, unzipped, for the header test.
  return new Uint8Array(gunzipSync(archive));
}

describe('the taxonomy replay agrees with Electric Capital’s own tool', () => {
  const snapshot = snapshotFromArchive(parseOpenDevDataArchive(archive.toString('latin1')));
  const answer = snapshot.taxonomy.lookup([
    'https://github.com/walletco/mobile',
    'https://github.com/WalletCo/Extension/',
    'https://github.com/walletco/old-name',
    'https://github.com/kr105/catcoin.git',
    'https://github.com/acme/multichain-sdk',
    'https://github.com/hoodbuilder/app',
    'https://github.com/plainbuilder/dapp',
    'https://github.com/renamer/after',
    'https://github.com/owner60/app',
    'https://github.com/quoted/repo',
    'https://github.com/nowhere/repo',
    'https://gitlab.com/walletco/mobile',
  ]);
  const names = (url: string) => answer.get(url)?.ecosystems.map((eco) => eco.name);

  it('lists a repository under each ecosystem that holds it directly, with the tags it carries', () => {
    expect(names('https://github.com/walletco/mobile')).toEqual(['Ethereum', 'WalletCo']);
    expect(answer.get('https://github.com/walletco/mobile')?.tags).toEqual(['#wallet']);
    expect(names('https://github.com/acme/multichain-sdk')).toEqual(['Base', 'BNB Chain', 'Ethereum', 'Optimism', 'Polygon']);
    expect(names('https://github.com/hoodbuilder/app')).toEqual(['Arbitrum', 'Robinhood']);
    expect(names('https://github.com/kr105/catcoin')).toEqual(['Catcoin']);
  });

  it('follows renames and merges (repmov, ecomov) and forgets removals (reprem, ecorem)', () => {
    // `old-name` was merged into `extension`; `before` was renamed to `Renamer/After`.
    expect(names('https://github.com/walletco/extension')).toEqual(['WalletCo']);
    expect(answer.has('https://github.com/walletco/old-name')).toBe(false);
    expect(names('https://github.com/renamer/after')).toEqual(['Ethereum']);
    expect(names('https://github.com/owner60/app')).toEqual(['Base', 'BNB Chain', 'Optimism', 'Polygon']);
    // `Doomed` was removed, so the repository it held is listed under Ethereum only.
    expect(names('https://github.com/plainbuilder/dapp')).toEqual(['Ethereum']);
    expect(names('https://github.com/quoted/repo')).toEqual(["Quote 'Eco"]);
  });

  it('skips files without the dated prefix, as their tool does', () => {
    expect(names('https://github.com/plainbuilder/dapp')).not.toContain('Catcoin');
    expect(names('https://github.com/plainbuilder/dapp')).not.toContain('Ignored');
  });

  it('keeps no answer for a repository it does not list, or a host that is not GitHub', () => {
    expect(answer.has('https://github.com/nowhere/repo')).toBe(false);
    expect([...answer.keys()].some((key) => key.includes('gitlab'))).toBe(false);
  });

  it('counts owners and the repository owner’s share per ecosystem — counts only, never the owners', () => {
    const walletco = answer.get('https://github.com/walletco/mobile')?.ecosystems.find((eco) => eco.name === 'WalletCo');
    expect(walletco).toEqual({ name: 'WalletCo', repos: 8, owners: 2, ownerShare: 0.875 });
    const ethereum = answer.get('https://github.com/walletco/mobile')?.ecosystems.find((eco) => eco.name === 'Ethereum');
    expect(ethereum).toMatchObject({ repos: 63, owners: 63 });
    expect(Object.keys(walletco ?? {})).toEqual(['name', 'repos', 'owners', 'ownerShare']);
  });

  it('reports what it replayed', () => {
    expect(snapshot).toMatchObject({ migrations: 2, ignoredFiles: 2, ecosystems: 11, errorCount: 1 });
  });
});

describe('the DSL pieces', () => {
  it('splits arguments like their shell lexer', () => {
    expect(splitDslArguments(` "Wallet Co" https://github.com/a/b #x`)).toEqual(['Wallet Co', 'https://github.com/a/b', '#x']);
    expect(splitDslArguments(` 'Quote \\'Eco' url`)).toEqual(["Quote 'Eco", 'url']);
    expect(() => splitDslArguments(` "open`)).toThrow(/Unterminated/);
  });

  it('accepts only real dated file names', () => {
    expect(isMigrationFileName('2026-04-08T165859_mutations')).toBe(true);
    expect(isMigrationFileName('2026-02-30T000000_x')).toBe(false);
    expect(isMigrationFileName('20260910T091352_kiteai')).toBe(false);
    expect(isMigrationFileName('2026-04-20_starmaker_hackathon_repos.txt')).toBe(false);
  });

  it('normalises GitHub repository URLs only', () => {
    expect(normalizeGithubRepoUrl('http://www.GitHub.com/MetaMask/metamask-mobile.git/')).toBe('https://github.com/metamask/metamask-mobile');
    expect(normalizeGithubRepoUrl('https://github.com/metamask')).toBeUndefined();
    expect(normalizeGithubRepoUrl('https://gitlab.com/a/b')).toBeUndefined();
  });

  it('replays in dated order whatever order the files arrive in', () => {
    const replay = replayTaxonomy([
      { name: '2020-01-01T000000_second', text: 'reprem A https://github.com/o/r' },
      { name: '2019-01-01T000000_first', text: 'ecoadd A\nrepadd A https://github.com/o/r' },
    ]);
    expect(replay.errorCount).toBe(0);
    expect(replay.lookup(['https://github.com/o/r']).size).toBe(0);
  });
});
