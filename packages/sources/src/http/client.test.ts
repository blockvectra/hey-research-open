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

  it('never retries a 429 in-process: one request, and the Retry-After unclamped in ms (round-8, 2026-09-18)', async () => {
    const sleep = vi.fn(async () => {});
    const stub = stubFetch([{ status: 429, headers: { 'retry-after': '3600' } }, ok('{}')]);

    await expect(
      httpRequest(
        { url: 'https://api.example.com/x' },
        testContext({ fetchImpl: stub.fetchImpl, retry: { attempts: 3, baseDelayMs: 1000, maxDelayMs: 4000, sleep } }),
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 3_600_000, retryAfterSeconds: 3600, attempts: 1 });

    expect(stub.callCount()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("treats GitHub's rate-limiting 403 the same way: no in-process retry", async () => {
    const stub = stubFetch([{ status: 403, headers: { 'x-ratelimit-remaining': '0' } }, ok('{}')]);
    await expect(
      httpRequest({ url: 'https://api.github.com/x' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', attempts: 1 });
    expect(stub.callCount()).toBe(1);
  });

  it('retries a 5xx once at most, whatever the policy asks, and reports the attempts', async () => {
    const stub = stubFetch([{ status: 503 }, { status: 503 }, ok('{}')]);
    await expect(
      httpRequest(
        { url: 'https://api.example.com/x' },
        testContext({ fetchImpl: stub.fetchImpl, retry: { attempts: 5, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} } }),
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', attempts: 2 });
    expect(stub.callCount()).toBe(2);
  });

  it('counts the attempts on a success that needed a retry (503, then 200 → attempts 2)', async () => {
    const stub = stubFetch([{ status: 503 }, ok('{"ok":true}')]);
    const outcome = await httpRequest({ url: 'https://api.example.com/x' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(outcome.kind === 'ok' && outcome.response.attempts).toBe(2);

    const direct = await httpRequest({ url: 'https://api.example.com/x' }, testContext({ fetchImpl: stubFetch(ok('{}')).fetchImpl }));
    expect(direct.kind === 'ok' && direct.response.attempts).toBe(1);
  });

  it('exposes the Link header so a paging adapter can see rel="next"', async () => {
    const stub = stubFetch(ok('[]', { link: '<https://api.example.com/x?page=2>; rel="next"' }));
    const outcome = await httpRequest({ url: 'https://api.example.com/x' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(outcome.kind === 'ok' && outcome.response.link).toContain('rel="next"');
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

  it('stops reading a chunked body the moment it passes the cap (audit H04)', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(64));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1_000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const response = new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async () => response) as unknown as typeof fetch;
    await expect(
      httpRequest({ url: 'https://api.example.com/x', maxBytes: 200 }, testContext({ fetchImpl })),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    // Four chunks cross 200 bytes; nothing like the thousand the stream would offer.
    expect(pulled).toBeLessThan(10);
  });

  it('pins the connection to the addresses the SSRF check validated (audit H05)', async () => {
    const seen: unknown[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen.push(init);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await httpRequest(
      { url: 'https://public.example/x', enforceUrlSafety: true },
      testContext({ fetchImpl, lookupImpl: async () => ['93.184.216.34'] }),
    );
    const init = seen[0] as { dispatcher?: { close?: unknown } };
    expect(init.dispatcher).toBeDefined();
    expect(typeof init.dispatcher?.close).toBe('function');
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

  it('refuses a response with no Content-Type when an allow-list is set (round-8, 2026-09-18)', async () => {
    const stub = stubFetch(ok('<rss/>'));
    await expect(
      httpRequest(
        { url: 'https://api.example.com/feed.xml', allowedContentTypes: ['application/rss+xml'] },
        testContext({ fetchImpl: stub.fetchImpl }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });

    // With no allow-list a bare response is still fine.
    const open = await httpRequest({ url: 'https://api.example.com/x' }, testContext({ fetchImpl: stubFetch(ok('{}')).fetchImpl }));
    expect(open.kind).toBe('ok');
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
