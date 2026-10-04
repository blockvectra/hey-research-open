import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import {
  createUniswapHooklistAdapter,
  createUniswapHooklistHeadAdapter,
  UNISWAP_HOOKLIST_FLAGS,
  UNISWAP_HOOKLIST_MAX_INVALID,
  uniswapHooklistEntries,
  uniswapHooklistFileUrl,
} from './uniswap-hooklist';

/**
 * Uniswap hooklist contract tests (2026-10-04). The fixture is six real
 * entries of `hooklist.json` at commit c6ada11 (2026-10-01) — two on another
 * chain, four on Robinhood Chain — with every description emptied and the one
 * deployer replaced by a placeholder: HEY stores neither, and the fixture
 * does not republish the generated prose either.
 */
const COMMIT = 'c6ada11a89041095957cae00f845a5fab2776408';
const aggregate = readFixture('uniswap-hooklist.json');
const JSON_HEADERS = { 'content-type': 'text/plain; charset=utf-8', etag: '"e60fab"' };

describe('the hooklist head commit', () => {
  it('reads the sha of main, sends the token, and keeps the ETag', async () => {
    const stub = stubFetch({ status: 200, body: `${COMMIT}`, headers: { 'content-type': 'application/vnd.github.sha; charset=utf-8', etag: `"${COMMIT}"` } });
    const result = await createUniswapHooklistHeadAdapter().fetch({ token: 'ghp_test' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data).toEqual({ commit: COMMIT });
    expect(result.etag).toBe(`"${COMMIT}"`);
    expect(stub.requests[0]?.url).toBe('https://api.github.com/repos/Uniswap/hooklist/commits/main');
    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers.accept).toBe('application/vnd.github.sha');
    expect(headers.authorization).toBe('Bearer ghp_test');
  });

  it('sends the stored ETag and reads a 304 as unchanged', async () => {
    const stub = stubFetch({ status: 304 });
    const result = await createUniswapHooklistHeadAdapter().fetch({}, testContext({ fetchImpl: stub.fetchImpl, etag: `"${COMMIT}"` }));
    expect(result.status).toBe('not_modified');
    expect((stub.requests[0]?.init?.headers as Record<string, string>)['if-none-match']).toBe(`"${COMMIT}"`);
  });

  it('refuses an answer that is not a commit sha', async () => {
    const stub = stubFetch({ status: 200, body: '<html>sign in</html>', headers: { 'content-type': 'text/plain' } });
    const result = await createUniswapHooklistHeadAdapter().fetch({}, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});

describe('the hooklist at a commit', () => {
  it('reads the file pinned to the commit, never conditionally, and keeps only the chain’s entries', async () => {
    const stub = stubFetch({ status: 200, body: aggregate, headers: JSON_HEADERS });
    const result = await createUniswapHooklistAdapter().fetch({ commit: COMMIT, chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl, etag: '"stale"' }));
    expect(result.status).toBe('fresh');
    expect(stub.requests[0]?.url).toBe(`https://raw.githubusercontent.com/Uniswap/hooklist/${COMMIT}/hooklist.json`);
    expect((stub.requests[0]?.init?.headers as Record<string, string>)['if-none-match']).toBeUndefined();
    const snapshot = result.data!;
    expect(snapshot).toMatchObject({ commit: COMMIT, chainId: 4663, totalEntries: 6, invalidEntries: 0, duplicateEntries: 0 });
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(['VladdyHook', 'CreatorFeeHookV1', 'MidasRWAHook', 'InitializerHook']);
    const vladdy = snapshot.entries.find((entry) => entry.name === 'VladdyHook')!;
    expect(vladdy).toEqual({
      chainId: 4663,
      address: '0x0022e098b9baf3c758496092b312126ec84780cc',
      name: 'VladdyHook',
      verifiedSource: true,
      flags: Object.fromEntries(UNISWAP_HOOKLIST_FLAGS.map((flag) => [flag, ['beforeSwap', 'afterSwap', 'beforeSwapReturnsDelta', 'afterSwapReturnsDelta'].includes(flag)])),
      properties: { dynamicFee: false, upgradeable: false, requiresCustomSwapData: false, vanillaSwap: false, swapAccess: 'other' },
      path: 'hooks/robinhood/0x0022e098b9baf3c758496092b312126ec84780cc.json',
    });
    expect(snapshot.entries.find((entry) => entry.name === 'MidasRWAHook')?.properties.swapAccess).toBe('governance');
  });

  it('never carries a description, a deployer or an audit link', async () => {
    const withText = (JSON.parse(aggregate) as { hook: Record<string, unknown> }[]).map((entry) => ({
      ...entry,
      hook: { ...entry.hook, description: 'Generated prose HEY must not keep.', deployer: `0x${'ab'.repeat(20)}`, auditUrl: 'https://audits.example/report.pdf' },
    }));
    const snapshot = uniswapHooklistEntries(withText, 4663, COMMIT);
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain('Generated prose');
    expect(text).not.toContain('ab'.repeat(20));
    expect(text).not.toContain('audits.example');
    for (const entry of snapshot.entries) expect(Object.keys(entry).sort()).toEqual(['address', 'chainId', 'flags', 'name', 'path', 'properties', 'verifiedSource']);
  });

  it('skips and counts a malformed entry and a duplicate, and fails when most of the chain is unreadable', () => {
    const entries = JSON.parse(aggregate) as { hook: Record<string, unknown>; flags: Record<string, unknown> }[];
    const broken = { ...entries[2]!, flags: { ...entries[2]!.flags, beforeSwap: 'yes' } };
    const snapshot = uniswapHooklistEntries([...entries, broken, entries[3]!], 4663, COMMIT);
    expect(snapshot).toMatchObject({ invalidEntries: 1, duplicateEntries: 1 });
    expect(snapshot.entries).toHaveLength(4);
    const many = Array.from({ length: UNISWAP_HOOKLIST_MAX_INVALID + 1 }, () => broken);
    expect(() => uniswapHooklistEntries(many, 4663, COMMIT)).toThrow(/failed the schema/);
    expect(() => uniswapHooklistEntries(entries, 1, COMMIT)).toThrow(/no chain name/);
  });

  it('reports a body that is not the aggregate as an error, never as an empty list', async () => {
    const notJson = stubFetch({ status: 200, body: '404: Not Found', headers: JSON_HEADERS });
    expect((await createUniswapHooklistAdapter().fetch({ commit: COMMIT, chainId: 4663 }, testContext({ fetchImpl: notJson.fetchImpl }))).status).toBe('error');
    const empty = stubFetch({ status: 200, body: '[]', headers: JSON_HEADERS });
    expect((await createUniswapHooklistAdapter().fetch({ commit: COMMIT, chainId: 4663 }, testContext({ fetchImpl: empty.fetchImpl }))).errorCode).toBe('INVALID_RESPONSE');
    expect(createUniswapHooklistAdapter().canHandle({ commit: 'main', chainId: 4663 })).toBe(false);
  });

  it('links each entry to its own file at the commit HEY read', () => {
    expect(uniswapHooklistFileUrl(COMMIT, 'hooks/robinhood/0x0022e098b9baf3c758496092b312126ec84780cc.json')).toBe(
      `https://github.com/Uniswap/hooklist/blob/${COMMIT}/hooks/robinhood/0x0022e098b9baf3c758496092b312126ec84780cc.json`,
    );
  });
});
