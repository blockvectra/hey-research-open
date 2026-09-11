import { describe, expect, it, vi } from 'vitest';

import { stubFetch, testContext } from '../testing';
import { backoffDelayMs, httpRequest, MAX_RESPONSE_BYTES } from './client';

const ok = (body: string, headers: Record<string, string> = {}) => ({ status: 200, body, headers });

describe('conditional requests', () => {
  it('sends If-None-Match and If-Modified-Since when validators are known', async () => {
    const stub = stubFetch(ok('{}'));
    await httpRequest(
      { url: 'https://api.example.com/x' },
      testContext({
        fetchImpl: stub.fetchImpl,
        etag: 'W/"abc"',
        lastModified: 'Wed, 20 Aug 2026 09:30:00 GMT',
      }),
    );

    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('W/"abc"');
    expect(headers['if-modified-since']).toBe('Wed, 20 Aug 2026 09:30:00 GMT');
  });

  it('reports 304 as not_modified rather than an error', async () => {
    const stub = stubFetch({ status: 304 });
    const outcome = await httpRequest(
      { url: 'https://api.example.com/x' },
      testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"abc"' }),
    );

    expect(outcome.kind).toBe('not_modified');
  });

  it('captures ETag and Last-Modified from the response', async () => {
    const stub = stubFetch(
      ok('{}', { etag: 'W/"v2"', 'last-modified': 'Sun, 30 Aug 2026 12:00:00 GMT' }),
    );
    const outcome = await httpRequest(
      { url: 'https://api.example.com/x' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(outcome.kind === 'ok' && outcome.response.etag).toBe('W/"v2"');
    expect(outcome.kind === 'ok' && outcome.response.lastModified).toBe(
      'Sun, 30 Aug 2026 12:00:00 GMT',
    );
  });
});

describe('retry and backoff', () => {
  it('retries transient 5xx and succeeds', async () => {
    const stub = stubFetch([{ status: 503, body: 'nope' }, ok('{"ok":true}')]);
    const outcome = await httpRequest(
      { url: 'https://api.example.com/x' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(outcome.kind).toBe('ok');
    expect(stub.callCount()).toBe(2);
  });

  it('retries a 429 and honours Retry-After over its own backoff', async () => {
    const sleep = vi.fn(async () => {});
    const stub = stubFetch([{ status: 429, headers: { 'retry-after': '2' } }, ok('{}')]);

    await httpRequest(
      { url: 'https://api.example.com/x' },
      testContext({
        fetchImpl: stub.fetchImpl,
        retry: { attempts: 3, baseDelayMs: 1000, maxDelayMs: 4000, sleep },
      }),
    );

    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('gives up after the configured attempts and reports RATE_LIMITED', async () => {
    const stub = stubFetch({ status: 429 });
    await expect(
      httpRequest({ url: 'https://api.example.com/x' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect(stub.callCount()).toBe(3);
  });

  it('does not retry a 404', async () => {
    const stub = stubFetch({ status: 404 });
    await expect(
      httpRequest({ url: 'https://api.example.com/x' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(stub.callCount()).toBe(1);
  });

  it('grows the delay exponentially up to the ceiling', () => {
    const policy = { attempts: 5, baseDelayMs: 100, maxDelayMs: 500 };
    expect(backoffDelayMs(1, policy)).toBe(100);
    expect(backoffDelayMs(2, policy)).toBe(200);
    expect(backoffDelayMs(3, policy)).toBe(400);
    expect(backoffDelayMs(4, policy)).toBe(500);
  });

  it('classifies a timeout distinctly from a network failure', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const stub = stubFetch({ throws: timeout });

    await expect(
      httpRequest({ url: 'https://api.example.com/x' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('response limits', () => {
  it('rejects a body larger than the cap', async () => {
    const stub = stubFetch(ok('x'.repeat(120)));
    await expect(
      httpRequest(
        { url: 'https://api.example.com/x', maxBytes: 100 },
        testContext({ fetchImpl: stub.fetchImpl }),
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('rejects on a declared content-length over the cap without reading', async () => {
    const stub = stubFetch(ok('small', { 'content-length': String(MAX_RESPONSE_BYTES + 1) }));
    await expect(
      httpRequest({ url: 'https://api.example.com/x' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('rejects an unexpected content type', async () => {
    const stub = stubFetch(ok('<html></html>', { 'content-type': 'text/html; charset=utf-8' }));
    await expect(
      httpRequest(
        { url: 'https://api.example.com/x', allowedContentTypes: ['application/json'] },
        testContext({ fetchImpl: stub.fetchImpl }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
  });
});

describe('SSRF protection', () => {
  it('blocks private and loopback destinations by default', async () => {
    const stub = stubFetch(ok('{}'));
    for (const url of [
      'http://127.0.0.1/admin',
      'http://localhost:3000/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'file:///etc/passwd',
    ]) {
      await expect(
        httpRequest({ url }, testContext({ fetchImpl: stub.fetchImpl })),
      ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    }

    expect(stub.callCount()).toBe(0);
  });

  it('identifies HEY in the user agent', async () => {
    const stub = stubFetch(ok('{}'));
    await httpRequest(
      { url: 'https://api.example.com/x' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers['user-agent']).toContain('HEYResearchBot');
  });
});

describe('SSRF protection by resolution (submitted URLs)', () => {
  const resolving = (answers: Record<string, string[]>) => async (hostname: string) =>
    answers[hostname] ?? ['93.184.216.34'];

  it('refuses a submitted URL whose host resolves to a private address', async () => {
    const stub = stubFetch(ok('{}'));
    await expect(
      httpRequest(
        { url: 'http://metadata.attacker.example/', enforceUrlSafety: true },
        testContext({
          fetchImpl: stub.fetchImpl,
          lookupImpl: resolving({ 'metadata.attacker.example': ['169.254.169.254'] }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.callCount()).toBe(0);
  });

  it('checks every redirect hop, not just the first URL', async () => {
    const stub = stubFetch([
      { status: 302, headers: { location: 'http://internal.attacker.example/' } },
      ok('{}'),
    ]);
    await expect(
      httpRequest(
        { url: 'https://public.example/', enforceUrlSafety: true },
        testContext({
          fetchImpl: stub.fetchImpl,
          lookupImpl: resolving({ 'internal.attacker.example': ['10.0.0.9'] }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.callCount()).toBe(1);
  });

  it('does not resolve names for configured providers (default tier)', async () => {
    const stub = stubFetch(ok('{}'));
    let looked = false;
    const outcome = await httpRequest(
      { url: 'https://api.example.com/x' },
      testContext({
        fetchImpl: stub.fetchImpl,
        lookupImpl: async () => {
          looked = true;
          return ['10.0.0.1'];
        },
      }),
    );
    expect(outcome.kind).toBe('ok');
    expect(looked).toBe(false);
  });
});
