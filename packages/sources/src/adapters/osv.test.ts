import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createOsvBatchAdapter, createOsvVulnAdapter, OSV_MAX_BATCH } from './osv';

/**
 * OSV contract tests (2026-09-27). Fixtures saved from live reads on
 * 2026-09-27: a querybatch of one chain-native SDK (no advisory) and a control
 * package with advisories, trimmed to three; one advisory, its long details
 * trimmed.
 */
const JSON_HEADERS = { 'content-type': 'application/json' };

describe('OSV querybatch', () => {
  const adapter = createOsvBatchAdapter();
  const queries = [
    { ecosystem: 'npm' as const, name: '@useboardwalk/sdk', version: '2.1.1' },
    { ecosystem: 'npm' as const, name: 'axios', version: '1.6.0' },
  ];

  it('POSTs every query in one request and returns the ids in query order', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('osv-querybatch.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch({ queries }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.url).toBe('https://api.osv.dev/v1/querybatch');
    expect(stub.requests[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(stub.requests[0]?.init?.body))).toEqual({
      queries: [
        { package: { ecosystem: 'npm', name: '@useboardwalk/sdk' }, version: '2.1.1' },
        { package: { ecosystem: 'npm', name: 'axios' }, version: '1.6.0' },
      ],
    });
    expect(result.data?.results[0]).toEqual({ ids: [], modified: {}, truncated: false });
    expect(result.data?.results[1]?.ids).toEqual(['GHSA-35jp-ww65-95wh', 'GHSA-3g43-6gmg-66jw', 'GHSA-3p68-rc4w-qgx5']);
  });

  it('refuses an answer that does not line up with the queries', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ results: [{}] }), headers: JSON_HEADERS });
    const result = await adapter.fetch({ queries }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('holds the batch to OSV\'s ceiling and to known ecosystems', () => {
    expect(adapter.canHandle({ queries: [] })).toBe(false);
    const many = Array.from({ length: OSV_MAX_BATCH + 1 }, (_, i) => ({ ecosystem: 'npm' as const, name: `p${i}`, version: '1.0.0' }));
    expect(adapter.canHandle({ queries: many })).toBe(false);
    expect(adapter.canHandle({ queries: [{ ecosystem: 'Debian' as never, name: 'x', version: '1' }] })).toBe(false);
    expect(adapter.canHandle({ queries })).toBe(true);
  });

  it('drops an id that is not an advisory id', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ results: [{ vulns: [{ id: '../../etc' }, { id: 'GHSA-aaaa-bbbb-cccc' }] }] }), headers: JSON_HEADERS });
    const result = await adapter.fetch({ queries: [queries[0]!] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.results[0]?.ids).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });
});

describe('OSV advisory', () => {
  it('keeps the id, aliases, a short summary and the affected ranges — not the long details or a severity', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('osv-vuln.json'), headers: JSON_HEADERS });
    const result = await createOsvVulnAdapter().fetch({ id: 'GHSA-35jp-ww65-95wh' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests[0]?.url).toBe('https://api.osv.dev/v1/vulns/GHSA-35jp-ww65-95wh');
    expect(result.data).toMatchObject({
      id: 'GHSA-35jp-ww65-95wh',
      aliases: ['CVE-2026-44494'],
      affected: [{ ecosystem: 'npm', name: 'axios', ranges: [{ type: 'SEMVER', events: [{ introduced: '1.0.0' }, { fixed: '1.16.0' }] }] }],
    });
    expect(result.data?.summary?.length).toBeLessThanOrEqual(300);
    const text = JSON.stringify(result.data);
    expect(text).not.toMatch(/CVSS|severity|details/i);
  });

  it('refuses an advisory id that is not one', () => {
    expect(createOsvVulnAdapter().canHandle({ id: '../x' })).toBe(false);
    expect(createOsvVulnAdapter().canHandle({ id: 'GHSA-35jp-ww65-95wh' })).toBe(true);
  });
});
