import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('reports the URL that answered a 304 after a redirect (OA-A, 2026-10-02)', async () => {
    /*
     * GitHub answers a renamed repository with a 301 to /repositories/<id>/…;
     * the validators ride the same-host hop, so the answer is a 304 — and the
     * redirect was dropped with it, so the rename was never followed.
     */
    const stub = stubFetch([redirectTo('https://api.github.com/repositories/1369635198/releases?per_page=30', 301), { status: 304 }]);
    const outcome = await httpRequest(
      { url: 'https://api.github.com/repos/odaiin/assetfare-mcp/releases?per_page=30', enforceUrlSafety: false },
      testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"abc"' }),
    );

    expect(outcome).toEqual({ kind: 'not_modified', url: 'https://api.github.com/repositories/1369635198/releases?per_page=30' });
    // The validator rode the hop, which is why the hop answered 304.
    expect((stub.requests[1]?.init?.headers as Record<string, string> | undefined)?.['if-none-match']).toBe('W/"abc"');

    // Nothing redirected: the request's own URL.
    const plain = stubFetch({ status: 304 });
    const unchanged = await httpRequest({ url: 'https://api.github.com/repos/a/b/releases' }, testContext({ fetchImpl: plain.fetchImpl, etag: 'W/"abc"' }));
    expect(unchanged).toEqual({ kind: 'not_modified', url: 'https://api.github.com/repos/a/b/releases' });
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

/*
 * A configured provider is trusted for the host it was configured with only (2026-10-25): a redirect it answers with
 * to another host is checked as a submitted URL is — the name resolved, every address public and not HEY's own, the
 * socket pinned to the checked address, the scheme's own port.
 */
describe('a configured provider redirecting to another host', () => {
  const lookupOf = (table: Record<string, string[]>) => {
    const asked: string[] = [];
    const lookupImpl = async (hostname: string) => {
      asked.push(hostname);
      return table[hostname] ?? ['93.184.216.34'];
    };
    return { asked, lookupImpl };
  };

  it.each([
    ['an internal service name', 'http://web/api/health', { web: ['172.18.0.5'] }],
    ['an internal service name on its own port', 'http://web:3000/api/health', { web: ['172.18.0.5'] }],
    ['the database container', 'http://postgres/', { postgres: ['172.18.0.2'] }],
    ['a name pointing at the cloud metadata address', 'http://metadata.example/v1.json', { 'metadata.example': ['169.254.169.254'] }],
    ['a name pointing at the IPv6 metadata address', 'http://meta6.example/latest', { 'meta6.example': ['fd00:ec2::254'] }],
    ['a name pointing at IPv4 loopback', 'http://127.0.0.1.nip.io/', { '127.0.0.1.nip.io': ['127.0.0.1'] }],
    ['a name pointing at IPv6 loopback', 'http://loop6.example/', { 'loop6.example': ['::1'] }],
    ['a name pointing at a private network', 'http://lan.example/', { 'lan.example': ['10.0.0.7'] }],
    ['a name with one public and one private answer', 'http://mixed.example/', { 'mixed.example': ['93.184.216.34', '192.168.1.1'] }],
  ])('refuses %s and never requests it', async (_label, target, table) => {
    const stub = stubFetch([redirectTo(target), page('SECRET')]);
    const { lookupImpl } = lookupOf(table);
    await expect(
      httpRequest({ url: 'https://api.launchpad.example/v1/tokens' }, testContext({ fetchImpl: stub.fetchImpl, lookupImpl })),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.requests.map((r) => r.url)).toEqual(['https://api.launchpad.example/v1/tokens']);
  });

  it.each([
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['the IPv6 metadata address', 'http://[fd00:ec2::254]/latest/meta-data/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['a blocked metadata name', 'http://metadata.google.internal/computeMetadata/v1/'],
  ])('refuses %s as a literal host', async (_label, target) => {
    const stub = stubFetch([redirectTo(target), page('SECRET')]);
    await expect(
      httpRequest({ url: 'https://api.launchpad.example/v1/tokens' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.callCount()).toBe(1);
  });

  it('refuses another host on a port other than the scheme’s own', async () => {
    const stub = stubFetch([redirectTo('https://elsewhere.example:6379/'), page('x')]);
    await expect(
      httpRequest({ url: 'https://api.launchpad.example/v1' }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.callCount()).toBe(1);
  });

  it('follows a public host with the connection pinned to the checked address', async () => {
    const stub = stubFetch([redirectTo('https://objects.example/asset'), page('ok')]);
    const { asked, lookupImpl } = lookupOf({ 'objects.example': ['93.184.216.34'] });
    const outcome = await httpRequest({ url: 'https://api.launchpad.example/v1' }, testContext({ fetchImpl: stub.fetchImpl, lookupImpl }));
    expect(outcome.kind).toBe('ok');
    expect(asked).toEqual(['objects.example']);
    // The configured host is read as configured; the other host's socket is pinned.
    expect((stub.requests[0]?.init as Record<string, unknown> | undefined)?.dispatcher).toBeUndefined();
    expect((stub.requests[1]?.init as Record<string, unknown> | undefined)?.dispatcher).toBeDefined();
  });

  it('reads a redirect within the configured host without resolving it', async () => {
    const stub = stubFetch([redirectTo('https://api.github.com/repositories/1/releases', 301), page('[]')]);
    const { asked, lookupImpl } = lookupOf({});
    const outcome = await httpRequest({ url: 'https://api.github.com/repos/a/b/releases' }, testContext({ fetchImpl: stub.fetchImpl, lookupImpl }));
    expect(outcome.kind).toBe('ok');
    expect(asked).toEqual([]);
  });
});

describe("HEY's own origin addresses", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses a submitted URL whose name resolves to the origin', async () => {
    vi.stubEnv('WEBHOOK_DENY_ADDRESSES', '203.0.113.9, 2001:db8::1');
    const allowed = stubFetch(page('ok'));
    await expect(
      httpRequest(
        { url: 'https://looks-public.example/', enforceUrlSafety: true },
        testContext({ fetchImpl: allowed.fetchImpl, lookupImpl: async () => ['45.77.1.2'] }),
      ),
    ).resolves.toMatchObject({ kind: 'ok' });

    vi.stubEnv('WEBHOOK_DENY_ADDRESSES', '45.77.1.2');
    const refused = stubFetch(page('ok'));
    await expect(
      httpRequest(
        { url: 'https://looks-public.example/', enforceUrlSafety: true },
        testContext({ fetchImpl: refused.fetchImpl, lookupImpl: async () => ['45.77.1.2'] }),
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(refused.callCount()).toBe(0);
  });

  it('refuses the origin however its IPv6 address is spelled, and as a literal host', async () => {
    vi.stubEnv('WEBHOOK_DENY_ADDRESSES', '2A05:F480:1800:0:0::1');
    const stub = stubFetch(page('ok'));
    await expect(
      httpRequest(
        { url: 'https://looks-public.example/', enforceUrlSafety: true },
        testContext({ fetchImpl: stub.fetchImpl, lookupImpl: async () => ['2a05:f480:1800::1'] }),
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });

    vi.stubEnv('WEBHOOK_DENY_ADDRESSES', '45.77.1.2');
    await expect(
      httpRequest({ url: 'https://45.77.1.2/', enforceUrlSafety: true }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.callCount()).toBe(0);
  });

  it('refuses a configured provider’s redirect to a host that resolves to the origin', async () => {
    vi.stubEnv('WEBHOOK_DENY_ADDRESSES', '45.77.1.2');
    const stub = stubFetch([redirectTo('https://origin-alias.example/'), page('ok')]);
    await expect(
      httpRequest({ url: 'https://api.launchpad.example/v1' }, testContext({ fetchImpl: stub.fetchImpl, lookupImpl: async () => ['45.77.1.2'] })),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.callCount()).toBe(1);
  });
});
