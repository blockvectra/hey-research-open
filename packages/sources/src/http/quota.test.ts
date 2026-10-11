import { describe, expect, it } from 'vitest';

import { SourceError } from '../errors';
import { stubFetch, testContext } from '../testing';
import { httpRequest } from './client';
import { performSourceFetch } from './perform';
import { readQuotaHeaders } from './quota';
import { z } from 'zod';

const headers = (values: Record<string, string>) => new Headers(values);

describe('provider quota headers (2026-10-11)', () => {
  it('reads Blockscout’s remaining credits', () => {
    expect(readQuotaHeaders(headers({ 'x-credits-remaining': '83240' }))).toEqual({ unit: 'credits', remaining: 83_240 });
  });

  it('reads GitHub’s window: remaining, limit, reset and pool', () => {
    expect(
      readQuotaHeaders(headers({ 'x-ratelimit-remaining': '4211', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1791727200', 'x-ratelimit-resource': 'core' })),
    ).toEqual({ unit: 'requests', remaining: 4_211, limit: 5_000, resetAt: new Date(1_791_727_200 * 1000), resource: 'core' });
  });

  it('keeps numbers only: a value that is not a bare integer, or a strange pool name, is dropped', () => {
    expect(readQuotaHeaders(headers({ 'x-credits-remaining': 'not-a-number-abcdefghijklmnopqrstuvwxyz' }))).toBeUndefined();
    expect(readQuotaHeaders(headers({ 'x-ratelimit-remaining': '12abc' }))).toBeUndefined();
    expect(readQuotaHeaders(headers({ 'x-ratelimit-remaining': '-4' }))).toBeUndefined();
    expect(readQuotaHeaders(headers({ 'x-ratelimit-remaining': '99999999999' }))).toBeUndefined();
    const reading = readQuotaHeaders(headers({ 'x-ratelimit-remaining': '10', 'x-ratelimit-resource': 'Bearer abc123', 'x-ratelimit-reset': '60' }));
    expect(reading).toEqual({ unit: 'requests', remaining: 10 });
  });

  it('reads nothing else: no credential, cookie or URL header reaches the reading', () => {
    const reading = readQuotaHeaders(
      headers({ authorization: 'Bearer secret-token', 'set-cookie': 'session=abc', location: 'https://x/?apikey=SECRET', 'x-ratelimit-remaining': '7' }),
    );
    expect(JSON.stringify(reading)).not.toMatch(/secret|SECRET|session|apikey|Bearer/);
    expect(readQuotaHeaders(headers({ authorization: 'Bearer secret-token' }))).toBeUndefined();
    expect(readQuotaHeaders(undefined)).toBeUndefined();
  });

  it('rides on an ok response, a 304 and a refusal from the HTTP client', async () => {
    const ok = await httpRequest({ url: 'https://api.github.com/x' }, testContext({ fetchImpl: stubFetch({ status: 200, body: '{}', headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000' } }).fetchImpl }));
    expect(ok.kind === 'ok' && ok.response.quota).toEqual({ unit: 'requests', remaining: 4_999, limit: 5_000 });

    const notModified = await httpRequest(
      { url: 'https://api.github.com/x' },
      testContext({ etag: 'W/"a"', fetchImpl: stubFetch({ status: 304, headers: { 'x-ratelimit-remaining': '4998' } }).fetchImpl }),
    );
    expect(notModified).toMatchObject({ kind: 'not_modified', quota: { remaining: 4_998 } });

    const refused = await httpRequest(
      { url: 'https://api.github.com/x' },
      testContext({ fetchImpl: stubFetch({ status: 403, body: 'rate limited', headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000' } }).fetchImpl }),
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SourceError);
    expect((refused as SourceError).code).toBe('RATE_LIMITED');
    expect((refused as SourceError).quota).toEqual({ unit: 'requests', remaining: 0, limit: 5_000 });
  });

  it('reaches the adapter’s result, fresh or refused', async () => {
    const schema = z.object({ ok: z.boolean() });
    const fresh = await performSourceFetch(
      testContext({ fetchImpl: stubFetch({ status: 200, body: '{"ok":true}', headers: { 'x-credits-remaining': '50000', 'content-type': 'application/json' } }).fetchImpl }),
      { url: 'https://explorer.example/api?apikey=SECRET' },
      { schema, parse: (body) => JSON.parse(body) as unknown, normalize: (raw) => raw, cacheTtlSeconds: 0 },
    );
    expect(fresh.quota).toEqual({ unit: 'credits', remaining: 50_000 });
    expect(JSON.stringify(fresh.quota)).not.toContain('SECRET');

    const refused = await performSourceFetch(
      testContext({ fetchImpl: stubFetch({ status: 429, body: 'slow down', headers: { 'x-credits-remaining': '0' } }).fetchImpl }),
      { url: 'https://explorer.example/api' },
      { schema, parse: (body) => JSON.parse(body) as unknown, normalize: (raw) => raw, cacheTtlSeconds: 0 },
    );
    expect(refused).toMatchObject({ status: 'rate_limited', quota: { unit: 'credits', remaining: 0 } });
  });
});
