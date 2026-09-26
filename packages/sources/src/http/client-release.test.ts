import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { fetch as undiciFetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FetchLike } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { httpRequest } from './client';

/**
 * Responses HEY does not read are let go of at once (2026-09-27, audit G
 * S4–S7). These run the real undici stack against a loopback server — no
 * third party is reached — because the failure was in how sockets and pinned
 * dispatchers are released, which a stubbed fetch cannot show:
 *
 * - S4: a redirect whose body trickles made `dispatcher.close()` wait for the
 *   whole request deadline (measured: 3.9 s of a 4 s signal);
 * - S5: a non-OK or wrong-type response's socket stayed open after the error;
 * - S6: an https→http redirect on the same host kept the bearer header;
 * - S7: the DNS lookup ran outside the request's deadline.
 *
 * The builder-URL tier (`enforceUrlSafety: true`) pins every hop to the address
 * it checked. The test resolver answers with a public address, and the fetch
 * below points `pinned.example` at the loopback server by IP literal, which the
 * pinned dispatcher connects to without a lookup.
 */
const PUBLIC = '93.184.216.34';

let server: Server;
let origin = '';
const open = new Map<string, Set<Socket>>();

const trickle = (res: ServerResponse, status: number, headers: Record<string, string>) => {
  res.writeHead(status, headers);
  res.write('x');
  const timer = setInterval(() => res.write('x'), 25);
  res.on('close', () => clearInterval(timer));
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    const sockets = open.get(path) ?? new Set<Socket>();
    open.set(path, sockets);
    sockets.add(req.socket);
    req.socket.on('close', () => sockets.delete(req.socket));

    if (path === '/redirect-trickle') return trickle(res, 302, { location: '/final', 'content-type': 'text/plain' });
    if (path === '/not-found-trickle') return trickle(res, 404, { 'content-type': 'text/html' });
    if (path === '/pdf-trickle') return trickle(res, 200, { 'content-type': 'application/pdf' });
    if (path === '/too-large') return trickle(res, 200, { 'content-type': 'text/html', 'content-length': String(10 * 1024 * 1024) });
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<h1>final</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const loopback: FetchLike = (url, init) =>
  undiciFetch(url.replace('http://pinned.example', origin), init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;

const ctx = (timeoutMs = 4_000) =>
  testContext({ fetchImpl: loopback, timeoutMs, lookupImpl: async () => [PUBLIC], retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 } });

/** Wait (bounded) until the server has no open socket left for a path. */
const socketsClosed = async (path: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((open.get(path)?.size ?? 0) === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

describe.each([
  ['a pinned builder URL', true],
  ['a configured provider', undefined],
] as const)('releasing unread responses: %s', (_label, enforceUrlSafety) => {
  it('follows a redirect whose body never ends without waiting for it (S4)', async () => {
    const started = Date.now();
    const outcome = await httpRequest({ url: 'http://pinned.example/redirect-trickle', ...(enforceUrlSafety ? { enforceUrlSafety } : {}) }, ctx());
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(outcome.kind === 'ok' && outcome.response.body).toBe('<h1>final</h1>');
    expect(await socketsClosed('/redirect-trickle')).toBe(true);
  });

  it('closes the socket of a non-OK response it will not read (S5)', async () => {
    await expect(
      httpRequest({ url: 'http://pinned.example/not-found-trickle', ...(enforceUrlSafety ? { enforceUrlSafety } : {}) }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await socketsClosed('/not-found-trickle')).toBe(true);
  });

  it('closes the socket of a response whose content type is refused (S5)', async () => {
    await expect(
      httpRequest(
        { url: 'http://pinned.example/pdf-trickle', allowedContentTypes: ['text/html'], ...(enforceUrlSafety ? { enforceUrlSafety } : {}) },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
    expect(await socketsClosed('/pdf-trickle')).toBe(true);
  });

  it('closes the socket of a response that declares more than the cap (S5)', async () => {
    await expect(
      httpRequest({ url: 'http://pinned.example/too-large', maxBytes: 1024, ...(enforceUrlSafety ? { enforceUrlSafety } : {}) }, ctx()),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(await socketsClosed('/too-large')).toBe(true);
  });
});

describe('credentials never travel in clear text (S6)', () => {
  const redirectTo = (location: string) => ({ status: 302, headers: { location } });
  const page = { status: 200, body: 'ok', headers: { 'content-type': 'text/html' } };

  it('refuses an https→http redirect on the same host while a secret header is set', async () => {
    for (const header of ['authorization', 'x-api-key', 'cookie']) {
      const stub = stubFetch([redirectTo('http://api.example.com/next'), page]);
      await expect(
        httpRequest({ url: 'https://api.example.com/x', headers: { [header]: 'secret' }, enforceUrlSafety: false }, testContext({ fetchImpl: stub.fetchImpl })),
      ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
      expect(stub.callCount(), header).toBe(1);
    }
  });

  it('follows the same downgrade when nothing secret is carried, and an upgrade either way', async () => {
    const plain = stubFetch([redirectTo('http://site.example/next'), page]);
    const outcome = await httpRequest({ url: 'https://site.example/x' }, testContext({ fetchImpl: plain.fetchImpl }));
    expect(outcome.kind).toBe('ok');

    const upgrade = stubFetch([redirectTo('https://api.example.com/next'), page]);
    await httpRequest({ url: 'http://api.example.com/x', headers: { authorization: 'Bearer t' }, enforceUrlSafety: false }, testContext({ fetchImpl: upgrade.fetchImpl }));
    expect((upgrade.requests[1]?.init?.headers as Record<string, string>).authorization).toBe('Bearer t');
  });

  it('drops the secret first when the downgrade also changes host, so that hop is allowed', async () => {
    const stub = stubFetch([redirectTo('http://cdn.example.net/file'), page]);
    await httpRequest({ url: 'https://api.example.com/x', headers: { authorization: 'Bearer t' }, enforceUrlSafety: false }, testContext({ fetchImpl: stub.fetchImpl }));
    expect((stub.requests[1]?.init?.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('a builder URL is read on its scheme’s own port (S10)', () => {
  const page = { status: 200, body: 'ok', headers: { 'content-type': 'text/html' } };

  it('refuses an explicit port on the strict tier, before any request', async () => {
    const stub = stubFetch(page);
    await expect(
      httpRequest({ url: 'https://example.com:6379/', enforceUrlSafety: true }, testContext({ fetchImpl: stub.fetchImpl })),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(stub.callCount()).toBe(0);
  });

  it('refuses a redirect to an explicit port, and leaves configured providers alone', async () => {
    const hop = stubFetch([{ status: 302, headers: { location: 'http://example.com:11211/' } }, page]);
    await expect(
      httpRequest({ url: 'https://example.com/', enforceUrlSafety: true }, testContext({ fetchImpl: hop.fetchImpl })),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    expect(hop.callCount()).toBe(1);

    const provider = stubFetch(page);
    const outcome = await httpRequest({ url: 'https://rpc.example.com:8545/' }, testContext({ fetchImpl: provider.fetchImpl }));
    expect(outcome.kind).toBe('ok');
  });

  it('treats the default port written out as no port', async () => {
    const stub = stubFetch(page);
    const outcome = await httpRequest({ url: 'https://example.com:443/', enforceUrlSafety: true }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(outcome.kind).toBe('ok');
  });
});

describe('DNS resolution runs inside the request deadline (S7)', () => {
  it('reports a timeout when the resolver never answers', async () => {
    const stub = stubFetch({ status: 200, body: 'ok', headers: { 'content-type': 'text/html' } });
    const started = Date.now();
    await expect(
      httpRequest(
        { url: 'https://hanging-dns.example/', enforceUrlSafety: true },
        testContext({ fetchImpl: stub.fetchImpl, timeoutMs: 100, lookupImpl: () => new Promise<string[]>(() => {}) }),
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(stub.callCount()).toBe(0);
  });
});
