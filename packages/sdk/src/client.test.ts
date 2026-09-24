import { describe, expect, it, vi } from 'vitest';

import { HeyApiError, HeyClient, USER_AGENT } from './index';

/**
 * Talking to HEY (2026-09-05; extended for the SDK 2026-09-19).
 *
 * The client runs beside an assistant or inside someone else's product, so
 * the failures that matter are the ones a caller would otherwise paraphrase
 * into a confident wrong answer: a site that is down, a rate limit, a slug
 * that does not exist. Each has to come back as one `code` and a sentence
 * saying what happened. The typed methods are tested for the one thing that
 * can go wrong in them — the path and the parameters they build.
 */
const ok = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body }) as Response;

type Call = { url: URL; init: RequestInit | undefined };

/** A client whose every request is recorded, answering `body` to all of them. */
function recording(body: unknown = { items: [] }, options: { apiKey?: string; userAgent?: string } = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ url: new URL(input), init });
    return ok(body);
  });
  return { client: new HeyClient({ baseUrl: 'https://hey.test', fetchImpl, ...options }), calls };
}

const failing = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new HeyClient({ baseUrl: 'https://hey.test', fetchImpl: async () => ok(body, status, headers) });

const caught = async (promise: Promise<unknown>): Promise<HeyApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HeyApiError) return error;
    throw error;
  }
  throw new Error('expected a HeyApiError');
};

describe('HeyClient.get', () => {
  it('builds the query from named parameters and drops the empty ones', async () => {
    const { client, calls } = recording();

    await client.get('/api/projects', { q: 'agent', limit: 10, launchpad: undefined, sort: '' });

    const { url } = calls[0]!;
    expect(url.origin + url.pathname).toBe('https://hey.test/api/projects');
    expect(url.searchParams.get('q')).toBe('agent');
    expect(url.searchParams.get('limit')).toBe('10');
    // An empty `q=` would read as a query the caller made; it is not sent.
    expect(url.searchParams.has('sort')).toBe(false);
    expect(url.searchParams.has('launchpad')).toBe(false);
  });

  it('joins array parameters with commas, the way the API reads `has`', async () => {
    const { client, calls } = recording();

    await client.get('/api/projects', { has: ['token', 'github'], stage: 'dex', empty: [] });

    expect(calls[0]!.url.searchParams.get('has')).toBe('token,github');
    expect(calls[0]!.url.searchParams.has('empty')).toBe(false);
  });

  it('tolerates a base url with a trailing slash', async () => {
    const { client, calls } = recording();
    await client.get('/api/projects');

    expect(calls[0]!.url.toString()).toBe('https://hey.test/api/projects');
  });

  it('names itself in the user-agent, after the caller when the caller has a name', async () => {
    const bare = recording();
    await bare.client.get('/api/status');
    expect((bare.calls[0]!.init?.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^hey-research-sdk\/\S+$/);

    /*
     * The caller's name goes first: HEY's traffic console reads the surface
     * from the start of the header, so an MCP server built on the SDK must
     * still be counted as the MCP server and not as the SDK.
     */
    const named = recording({}, { userAgent: 'hey-research-mcp/0.1.0' });
    await named.client.get('/api/status');
    expect((named.calls[0]!.init?.headers as Record<string, string>)['user-agent']).toBe(`hey-research-mcp/0.1.0 ${USER_AGENT}`);
  });

  it('sends the API key as a bearer token and never without one', async () => {
    const keyed = recording({}, { apiKey: 'hey_abc' });
    await keyed.client.get('/api/projects');
    expect((keyed.calls[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer hey_abc');

    const anonymous = recording({}, { apiKey: '  ' });
    await anonymous.client.get('/api/projects');
    expect((anonymous.calls[0]!.init?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  /*
   * The key must not follow a redirect (round-9 security, 2026-09-19). `fetch`
   * replays request headers across hops by default, so a base URL that
   * forwards — a shortener, a stale vanity domain, someone else's proxy —
   * handed the bearer token to that host without a word.
   */
  it('asks fetch not to follow redirects', async () => {
    const { client, calls } = recording({}, { apiKey: 'hey_abc' });
    await client.get('/api/status');
    expect(calls[0]!.init?.redirect).toBe('manual');
  });

  it('turns a redirect into an error naming the host, and never re-sends the key', async () => {
    const calls: string[] = [];
    const client = new HeyClient({
      baseUrl: 'https://hey.test',
      apiKey: 'hey_abc',
      fetchImpl: async (input) => {
        calls.push(input);
        return ok({}, 302, { location: 'https://collector.example/api/status' });
      },
    });

    const error = await caught(client.status());
    expect(error.code).toBe('http');
    expect(error.status).toBe(302);
    expect(error.message).toContain('collector.example');
    // One request, not two: nothing chased the Location.
    expect(calls).toEqual(['https://hey.test/api/status']);
  });

  it('reports a browser’s opaque redirect too, which names no host at all', async () => {
    const client = new HeyClient({
      baseUrl: 'https://hey.test',
      fetchImpl: async () => ({ ...ok({}, 0), type: 'opaqueredirect' }) as Response,
    });

    const error = await caught(client.status());
    expect(error.code).toBe('http');
    expect(error.status).toBeUndefined();
    expect(error.message).toContain('an undisclosed host');
  });
});

describe('HeyClient typed methods', () => {
  it('build the documented paths and encode every path segment', async () => {
    const { client, calls } = recording();

    await client.projects.list({ tab: 'still-building', has: ['token'], limit: 5 });
    await client.projects.get('a b/../c');
    await client.projects.market('agentos', { days: 90 });
    await client.projects.intelligence('agentos');
    await client.projects.ask('agentos', 'what changed?');
    await client.projects.timeline('agentos', { lens: 'locks' });
    await client.projects.compare(['agentos', 'darkroute']);
    await client.ships.list({ sort: 'detected', detectedSince: '2026-09-01T00:00:00.000Z' });
    await client.signals.list({ group: 'development', include: 'published' });
    await client.signals.get('sig 1');
    await client.builders.list({ filter: 'pons', limit: 50 });
    await client.token.lookup(4663, '0X' + 'A'.repeat(40));
    await client.scanCard(4663, '0x' + 'a'.repeat(40));
    await client.bounties.list({ status: 'all' });
    await client.bounties.get('b1');
    await client.reports.weekly.list();
    await client.reports.weekly.get('2026-W37');
    await client.chain({ days: 7 });
    await client.contractChanges({ days: 30 });
    await client.silence();
    await client.accelerating();
    await client.projects.marketMoves('agentos', { days: 60, min: 30 });
    await client.comebacks();
    await client.unlocks({ days: 90 });
    await client.buildMarket();
    await client.thisWeek();
    await client.status();

    const seen = calls.map(({ url }) => url.pathname + url.search);
    expect(seen).toEqual([
      '/api/projects?tab=still-building&has=token&limit=5',
      '/api/projects/a%20b%2F..%2Fc',
      '/api/projects/agentos/market?days=90',
      '/api/projects/agentos/intelligence',
      '/api/projects/agentos/ask?q=what+changed%3F',
      '/api/projects/agentos/timeline?lens=locks',
      '/api/compare?slugs=agentos%2Cdarkroute',
      '/api/ships?sort=detected&detectedSince=2026-09-01T00%3A00%3A00.000Z',
      '/api/signals?group=development&include=published',
      '/api/signals/sig%201',
      '/api/builders?filter=pons&limit=50',
      `/api/token/4663/0X${'A'.repeat(40)}`,
      `/api/v1/scan?chain=4663&token=0x${'a'.repeat(40)}`,
      '/api/bounties?status=all',
      '/api/bounties/b1',
      '/api/reports/weekly',
      '/api/reports/weekly/2026-W37',
      '/api/chain?days=7',
      '/api/chain/contract-changes?days=30',
      '/api/chain/silence',
      '/api/chain/accelerating',
      '/api/projects/agentos/market-moves?days=60&min=30',
      '/api/chain/comebacks',
      '/api/chain/unlocks?days=90',
      '/api/chain/build-market',
      '/api/this-week',
      '/api/status',
    ]);
  });

  it('walk projects by nextOffset and signals by total', async () => {
    const projectPages = [
      { query: {}, total: 3, nextOffset: 2, items: [{ slug: 'a' }, { slug: 'b' }], disclaimer: '' },
      { query: {}, total: 3, items: [{ slug: 'c' }], disclaimer: '' },
    ];
    const signalPages = [
      { query: {}, total: 3, items: [{ id: '1' }, { id: '2' }], disclaimer: '' },
      { query: {}, total: 3, items: [{ id: '3' }], disclaimer: '' },
    ];
    const requested: string[] = [];
    const client = new HeyClient({
      baseUrl: 'https://hey.test',
      fetchImpl: async (input) => {
        const url = new URL(input);
        requested.push(url.pathname + url.search);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return ok(url.pathname === '/api/projects' ? projectPages[offset === 0 ? 0 : 1] : signalPages[offset === 0 ? 0 : 1]);
      },
    });

    const slugs: string[] = [];
    for await (const project of client.projects.items({ limit: 2 })) slugs.push(project.slug);
    const ids: string[] = [];
    for await (const page of client.signals.pages({ limit: 2 })) ids.push(...page.items.map((s) => s.id));

    expect(slugs).toEqual(['a', 'b', 'c']);
    expect(ids).toEqual(['1', '2', '3']);
    expect(requested).toEqual([
      '/api/projects?limit=2&offset=0',
      '/api/projects?limit=2&offset=2',
      '/api/signals?limit=2&offset=0',
      '/api/signals?limit=2&offset=2',
    ]);
  });
});

describe('HeyApiError', () => {
  it('turns a missing record into not_found with a sentence, not a status code', async () => {
    const error = await caught(failing(404, { error: 'not_found', message: 'No published project has the slug "nope".' }).projects.get('nope'));
    expect(error).toMatchObject({ code: 'not_found', status: 404, message: 'No published project has the slug "nope".' });

    const bare = await caught(failing(404).projects.get('nope'));
    expect(bare.message).toMatch(/no published record/i);
  });

  it('says a refused key is unauthorized, and a hold is forbidden with its reason', async () => {
    const refused = await caught(failing(401, { error: 'unauthorized' }).status());
    expect(refused).toMatchObject({ code: 'unauthorized', status: 401 });
    expect(refused.message).toMatch(/refused the API key/i);

    const held = await caught(
      failing(403, { error: 'forbidden', reason: 'key_suspended', message: 'This API key is suspended. Contact hi@heyresearch.xyz if you think that is wrong.' }).status(),
    );
    expect(held).toMatchObject({ code: 'forbidden', status: 403, reason: 'key_suspended' });
    expect(held.message).toContain('suspended');
  });

  it('tells a spent allowance from a rate limit, and reads retry-after either way', async () => {
    const spent = await caught(failing(429, { error: 'quota', message: 'Monthly allowance used. It resets on 2026-11-01.' }, { 'retry-after': '3600' }).status());
    expect(spent).toMatchObject({ code: 'quota', status: 429, retryAfterSeconds: 3600 });
    expect(spent.message).toContain('resets on 2026-11-01');

    // The anonymous limiter's body is a sentence under `error`, not a code word.
    const limited = await caught(failing(429, { error: 'Too many requests from this address; try again in 12 seconds.' }, { 'retry-after': '12' }).status());
    expect(limited).toMatchObject({ code: 'rate_limited', status: 429, retryAfterSeconds: 12 });
    expect(limited.message).toContain('try again in 12 seconds');

    // No body and no header: still temporary, still says so.
    const bare = await caught(failing(429).status());
    expect(bare).toMatchObject({ code: 'rate_limited', retryAfterSeconds: undefined });
    expect(bare.message).toMatch(/try again in a minute/i);

    // An HTTP-date retry-after comes back as seconds from now, never negative.
    const dated = await caught(failing(429, {}, { 'retry-after': new Date(Date.now() + 30_000).toUTCString() }).status());
    expect(dated.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(dated.retryAfterSeconds).toBeLessThanOrEqual(31);
  });

  it('maps 400, 503 and everything else', async () => {
    expect(await caught(failing(400, { error: 'bad_request', message: 'chain must be a number' }).status())).toMatchObject({ code: 'bad_request', message: 'chain must be a number' });
    expect(await caught(failing(503).status())).toMatchObject({ code: 'unavailable', status: 503 });
    expect(await caught(failing(500).status())).toMatchObject({ code: 'http', status: 500, message: 'HEY answered 500.' });
  });

  it('keeps the parsed body without ever putting it in the message', async () => {
    const error = await caught(failing(403, { error: 'forbidden', reason: 'account_suspended', internal: 'x' }).status());
    expect(error.body).toEqual({ error: 'forbidden', reason: 'account_suspended', internal: 'x' });
    expect(error.message).not.toContain('internal');
  });

  it('names the host when HEY cannot be reached at all', async () => {
    const client = new HeyClient({
      baseUrl: 'https://hey.test',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    const error = await caught(client.status());
    expect(error).toMatchObject({ code: 'network', status: undefined });
    expect(error.message).toMatch(/Could not reach HEY at https:\/\/hey\.test/);
  });

  it('gives up rather than hanging a caller on a slow reply, and says it was a timeout', async () => {
    const client = new HeyClient({
      baseUrl: 'https://hey.test',
      timeoutMs: 10,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    const error = await caught(client.status());
    expect(error).toMatchObject({ code: 'timeout' });
    expect(error.message).toMatch(/did not answer within 10 ms/);
  });
});
