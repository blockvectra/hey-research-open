import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import {
  createUniswapHooklistAdapter,
  createUniswapHooklistHeadAdapter,
  createUniswapHooklistSubmissionsAdapter,
  uniswapHooklistIssueUrl,
  uniswapHooklistSubmissionFacts,
  UNISWAP_HOOKLIST_FLAGS,
  UNISWAP_HOOKLIST_MAX_INVALID,
  uniswapHooklistEntries,
  uniswapHooklistFileUrl,
} from './uniswap-hooklist';

/**
 * Uniswap hooklist contract tests (2026-10-04). The fixture is six real
 * entries of `hooklist.json` at commit c6ada11 (2026-10-01) — two on another
 * chain, four on Robinhood Chain — with every description emptied and the one
 * deployer replaced by a placeholder: HEY stores neither (the deployer is
 * compared in memory, never kept), and the fixture
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

  /*
   * Since 2026-10-04 (founder: the list is a source of leads, never proof) the
   * listed deployer is handed over in memory as `claimedDeployer`, for one
   * comparison with HEY's deployer records; the description and the audit link
   * are still never read.
   */
  it('never carries a description or an audit link, and hands the claimed deployer over only as a claim', async () => {
    const withText = (JSON.parse(aggregate) as { hook: Record<string, unknown> }[]).map((entry) => ({
      ...entry,
      hook: { ...entry.hook, description: 'Generated prose HEY must not keep.', deployer: `0x${'AB'.repeat(20)}`, auditUrl: 'https://audits.example/report.pdf' },
    }));
    const snapshot = uniswapHooklistEntries(withText, 4663, COMMIT);
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain('Generated prose');
    expect(text).not.toContain('audits.example');
    for (const entry of snapshot.entries) {
      expect(Object.keys(entry).sort()).toEqual(['address', 'chainId', 'claimedDeployer', 'flags', 'name', 'path', 'properties', 'verifiedSource']);
      expect(entry.claimedDeployer).toBe(`0x${'ab'.repeat(20)}`);
    }
  });

  it('reads an empty, zero or malformed deployer as no claim', () => {
    const entries = JSON.parse(aggregate) as { hook: Record<string, unknown> }[];
    const robinhood = entries.filter((entry) => entry.hook.chainId === 4663);
    const variants = ['', '   ', `0x${'0'.repeat(40)}`, 'deployer.eth', '0x1234'].map((deployer, index) => ({
      ...robinhood[index % robinhood.length]!,
      hook: { ...robinhood[index % robinhood.length]!.hook, address: `0x${String(index + 1).padStart(40, '7')}`, deployer },
    }));
    const snapshot = uniswapHooklistEntries(variants, 4663, COMMIT);
    expect(snapshot.entries).toHaveLength(5);
    for (const entry of snapshot.entries) expect(entry.claimedDeployer).toBeUndefined();
    // The fixture's two placeholder deployers are claims; the empty ones are not.
    const fixture = uniswapHooklistEntries(entries, 4663, COMMIT);
    expect(fixture.entries.filter((entry) => entry.claimedDeployer).map((entry) => entry.name).sort()).toEqual(['CreatorFeeHookV1', 'MidasRWAHook']);
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

/*
 * Builders' own submissions (2026-10-04). The fixture is five issues shaped as
 * the GitHub API returns them — two Robinhood Chain submissions in the issue
 * form, one with no form sections, one on another chain and the list's own
 * pull request — with every description replaced by fixture text: HEY keeps no
 * issue text, and the fixture does not republish the builders' words either.
 */
describe('the hooklist submissions (2026-10-04)', () => {
  const page = readFixture('uniswap-hooklist-submissions.json');

  it('keeps per Robinhood Chain submission only the number, the hook and the website hosts, and pages by update', async () => {
    const stub = stubFetch({ status: 200, body: page, headers: { 'content-type': 'application/json; charset=utf-8', etag: 'W/"page-one"' } });
    const result = await createUniswapHooklistSubmissionsAdapter().fetch({ chainId: 4663, page: 1, token: 'ghp_test' }, testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"before"' }));
    expect(result.status).toBe('fresh');
    expect(result.etag).toBe('W/"page-one"');
    expect(result.data).toEqual({
      issuesOnPage: 5,
      newestUpdatedAt: new Date('2026-10-03T08:02:11Z'),
      oldestUpdatedAt: new Date('2026-09-29T09:00:00Z'),
      invalid: 0,
      submissions: [
        { issueNumber: 10499, hookAddress: '0x7d309a342f12e7f788ccf992740e5c482d4b6044', hosts: ['floor.top'], updatedAt: new Date('2026-10-03T08:02:11Z') },
        { issueNumber: 10496, hookAddress: '0xcb6c4fe8be76538e865489818e1b420aa4fd2840', hosts: ['boundlaunch.com'], updatedAt: new Date('2026-10-02T23:10:00Z') },
        { issueNumber: 10463, hookAddress: '0xe7c4c3b075c317c3473866afbc1516ccb863a0cc', hosts: [], updatedAt: new Date('2026-10-01T12:00:00Z') },
      ],
    });
    // No text, no account, no deployer, no audit link leaves the adapter.
    const out = JSON.stringify(result.data);
    for (const word of ['Fixture text', 'fixture-submitter', 'fee1dead', 'audits.example-auditor.io', 'github.com/example', 't.me', 'FloorHook', 'blockscout']) expect(out).not.toContain(word);
    const request = stub.requests[0]!;
    expect(request.url).toBe('https://api.github.com/repos/Uniswap/hooklist/issues?labels=submission&state=all&sort=updated&direction=desc&per_page=100&page=1');
    expect(new Headers(request.init?.headers).get('authorization')).toBe('Bearer ghp_test');
    expect(new Headers(request.init?.headers).get('if-none-match')).toBe('W/"before"');
  });

  it('answers 304 on an unchanged first page, and never sends a validator for a later page', async () => {
    const stub = stubFetch({ status: 304, body: '' });
    const first = await createUniswapHooklistSubmissionsAdapter().fetch({ chainId: 4663, page: 1 }, testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"page-one"' }));
    expect(first.status).toBe('not_modified');
    const later = stubFetch({ status: 200, body: '[]', headers: { 'content-type': 'application/json' } });
    const second = await createUniswapHooklistSubmissionsAdapter().fetch({ chainId: 4663, page: 3 }, testContext({ fetchImpl: later.fetchImpl, etag: 'W/"page-one"' }));
    expect(second.data).toMatchObject({ issuesOnPage: 0, submissions: [], newestUpdatedAt: null });
    expect(new Headers(later.requests[0]!.init?.headers).get('if-none-match')).toBeNull();
  });

  it('reads the chain from the form, else the title; the hook from the form, else the title; drops nobody’s-site hosts', () => {
    expect(uniswapHooklistSubmissionFacts({ number: 1, title: 'hook: X on Robinhood Chain', body: '### Chain\n\nbase\n\n### Hook Address\n\n0x1111111111111111111111111111111111111111' }, 'robinhood')).toBeNull();
    expect(uniswapHooklistSubmissionFacts({ number: 2, title: 'hook: 0x2222222222222222222222222222222222222222 (robinhood)', body: 'See https://www.example-project.xyz/app, https://x.com/team.' }, 'robinhood')).toEqual({
      issueNumber: 2,
      hookAddress: '0x2222222222222222222222222222222222222222',
      hosts: ['example-project.xyz'],
    });
    expect(uniswapHooklistSubmissionFacts({ number: 3, title: 'hook: Y on Robinhood Chain', body: '### Chain\n\nrobinhood\n\n### Hook Address\n\nnone' }, 'robinhood')).toBeNull();
    expect(uniswapHooklistSubmissionFacts({ number: 4, title: 'Add Y hook on robinhood', body: '', pull_request: {} }, 'robinhood')).toBeNull();
    expect(uniswapHooklistIssueUrl(10499)).toBe('https://github.com/Uniswap/hooklist/issues/10499');
  });
});
