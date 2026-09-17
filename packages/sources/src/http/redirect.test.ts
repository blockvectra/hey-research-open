import { describe, expect, it } from 'vitest';

import { httpRequest, MAX_REDIRECTS } from './client';
import { stubFetch, testContext } from '../testing';

const redirectTo = (location: string, status = 302) => ({ status, headers: { location } });
const page = (body: string) => ({
  status: 200,
  body,
  headers: { 'content-type': 'text/html' },
});

describe('redirect handling', () => {
  it('follows an ordinary redirect and reports the final URL', async () => {
    const stub = stubFetch([redirectTo('https://agentos.xyz/changelog'), page('<h1>ok</h1>')]);
    const outcome = await httpRequest(
      { url: 'https://agentos.xyz/blog' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(outcome.kind).toBe('ok');
    expect(outcome.kind === 'ok' && outcome.response.url).toBe('https://agentos.xyz/changelog');
    expect(stub.requests.map((r) => r.url)).toEqual([
      'https://agentos.xyz/blog',
      'https://agentos.xyz/changelog',
    ]);
  });

  it('never carries a credential to another host (2026-09-17)', async () => {
    const stub = stubFetch([redirectTo('https://attacker.example/collect'), page('ok')]);
    await httpRequest(
      { url: 'https://api.github.com/repos/x/y', headers: { authorization: 'Bearer secret-token' }, enforceUrlSafety: false },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    const sent = stub.requests.map((r) => (r.init?.headers as Record<string, string> | undefined)?.authorization);
    expect(sent[0]).toBe('Bearer secret-token');
    expect(sent[1]).toBeUndefined();
    // The same host keeps it: a renamed repository still needs the token.
    const same = stubFetch([redirectTo('https://api.github.com/repos/x/z'), page('ok')]);
    await httpRequest(
      { url: 'https://api.github.com/repos/x/y', headers: { authorization: 'Bearer secret-token' }, enforceUrlSafety: false },
      testContext({ fetchImpl: same.fetchImpl }),
    );
    expect((same.requests[1]?.init?.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer secret-token');
  });

  it('resolves a relative Location against the current URL', async () => {
    const stub = stubFetch([redirectTo('/changelog'), page('ok')]);
    await httpRequest(
      { url: 'https://agentos.xyz/blog/index.html' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(stub.requests[1]?.url).toBe('https://agentos.xyz/changelog');
  });

  /**
   * The regression that motivated manual redirect handling: letting the runtime
   * follow redirects hides every hop, so a public URL could reach a private one.
   */
  it('blocks a redirect into a private address and never requests it', async () => {
    const stub = stubFetch([
      redirectTo('http://169.254.169.254/latest/meta-data/'),
      page('SECRET'),
    ]);

    await expect(
      httpRequest(
        { url: 'https://agentos.xyz/', enforceUrlSafety: true },
        testContext({ fetchImpl: stub.fetchImpl }),
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });

    expect(stub.requests.map((r) => r.url)).toEqual(['https://agentos.xyz/']);
  });

  it('blocks a redirect to loopback', async () => {
    const stub = stubFetch([redirectTo('http://127.0.0.1:6379/'), page('SECRET')]);

    await expect(
      httpRequest({ url: 'https://agentos.xyz/' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.callCount()).toBe(1);
  });

  it('caps a redirect chain and does not retry it', async () => {
    const stub = stubFetch(redirectTo('https://agentos.xyz/next'));

    await expect(
      httpRequest({ url: 'https://agentos.xyz/start' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    // A redirect loop is not transient: retrying would walk the same chain again.
    expect(stub.callCount()).toBe(MAX_REDIRECTS + 1);
  });

  it('downgrades a 302 to GET and drops the body', async () => {
    const stub = stubFetch([redirectTo('https://rpc.example/v2'), page('{}')]);
    await httpRequest(
      { url: 'https://rpc.example/v1', method: 'POST', body: '{"method":"eth_getCode"}' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(stub.requests[1]?.init?.method).toBe('GET');
    expect(stub.requests[1]?.init?.body).toBeUndefined();
  });

  it('preserves method and body across a 307', async () => {
    const stub = stubFetch([redirectTo('https://rpc.example/v2', 307), page('{}')]);
    await httpRequest(
      { url: 'https://rpc.example/v1', method: 'POST', body: '{"method":"eth_getCode"}' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(stub.requests[1]?.init?.method).toBe('POST');
    expect(stub.requests[1]?.init?.body).toBe('{"method":"eth_getCode"}');
  });
});

describe('timeout wiring', () => {
  it('aborts the request when it outlives ctx.timeoutMs', async () => {
    // Honours the abort signal rather than simulating the rejection, so this
    // proves ctx.timeoutMs is actually attached to the request.
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
        });
      });

    await expect(
      httpRequest(
        { url: 'https://slow.example/' },
        testContext({
          fetchImpl,
          timeoutMs: 20,
          retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('passes an abort signal on every request', async () => {
    const stub = stubFetch({ status: 200, body: '{}' });
    await httpRequest(
      { url: 'https://api.example.com/' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(stub.requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });
});
