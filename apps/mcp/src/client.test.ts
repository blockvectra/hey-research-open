import { describe, expect, it, vi } from 'vitest';

import { HeyApiError, HeyClient } from './client';

/**
 * Talking to HEY (2026-09-05).
 *
 * The server runs beside an assistant on someone else's machine, so the
 * failures that matter are the ones an agent would otherwise paraphrase into a
 * confident wrong answer: a site that is down, a rate limit, a slug that does
 * not exist. Each has to come back as a sentence saying what happened.
 */
const ok = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('HeyClient', () => {
  it('builds the query from named parameters and drops the empty ones', async () => {
    // Typed with the signature the client calls, so `mock.calls` carries the url.
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => ok({ items: [] }));
    const client = new HeyClient({ baseUrl: 'https://hey.test', fetchImpl });

    await client.get('/api/projects', { q: 'agent', limit: 10, launchpad: undefined, sort: '' });

    const parsed = new URL(fetchImpl.mock.calls[0]![0]);
    expect(parsed.origin + parsed.pathname).toBe('https://hey.test/api/projects');
    expect(parsed.searchParams.get('q')).toBe('agent');
    expect(parsed.searchParams.get('limit')).toBe('10');
    // An empty `q=` would read as a query the caller made; it is not sent.
    expect(parsed.searchParams.has('sort')).toBe(false);
    expect(parsed.searchParams.has('launchpad')).toBe(false);
  });

  it('tolerates a base url with a trailing slash', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => ok({}));
    await new HeyClient({ baseUrl: 'https://hey.test/', fetchImpl }).get('/api/projects');

    expect(fetchImpl.mock.calls[0]![0]).toBe('https://hey.test/api/projects');
  });

  it('turns a missing record into a sentence, not a status code', async () => {
    const client = new HeyClient({ baseUrl: 'https://hey.test', fetchImpl: async () => ok({}, 404) });

    await expect(client.get('/api/projects/nope')).rejects.toThrow(HeyApiError);
    await expect(client.get('/api/projects/nope')).rejects.toThrow(/no published record/i);
  });

  it('says a rate limit is temporary, so the agent waits instead of concluding', async () => {
    const client = new HeyClient({ baseUrl: 'https://hey.test', fetchImpl: async () => ok({}, 429) });

    await expect(client.get('/api/projects')).rejects.toThrow(/try again in a minute/i);
  });

  it('names the host when HEY cannot be reached at all', async () => {
    const client = new HeyClient({
      baseUrl: 'https://hey.test',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    await expect(client.get('/api/projects')).rejects.toThrow(/Could not reach HEY at https:\/\/hey\.test/);
  });

  it('gives up rather than hanging an assistant on a slow reply', async () => {
    const client = new HeyClient({
      baseUrl: 'https://hey.test',
      timeoutMs: 10,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    await expect(client.get('/api/projects')).rejects.toThrow(/Could not reach HEY/);
  });

  it('sends the API key as a bearer token and explains a refused key or a spent allowance', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => ok({ items: [] }));
    const client = new HeyClient({ baseUrl: 'https://hey.test', fetchImpl, apiKey: 'hey_abc' });
    await client.get('/api/projects');
    expect((fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>).authorization).toBe('Bearer hey_abc');
    expect(new HeyClient({ baseUrl: 'https://hey.test', fetchImpl: vi.fn(async () => ok({}, 200)) })).toBeInstanceOf(HeyClient);

    const refused = new HeyClient({ baseUrl: 'https://hey.test', fetchImpl: vi.fn(async () => ok({ error: 'unauthorized' }, 401)), apiKey: 'hey_abc' });
    await expect(refused.get('/api/projects')).rejects.toMatchObject({ status: 401, message: expect.stringContaining('HEY_API_KEY') });
    const spent = new HeyClient({ baseUrl: 'https://hey.test', fetchImpl: vi.fn(async () => ok({ error: 'quota', message: 'Monthly allowance used. It resets on 2026-11-01.' }, 429)) });
    await expect(spent.get('/api/projects')).rejects.toMatchObject({ status: 429, message: expect.stringContaining('resets on 2026-11-01') });
    // A hold placed in the console carries its reason and whom to write to; the assistant should say that, not "403".
    const held = new HeyClient({ baseUrl: 'https://hey.test', fetchImpl: vi.fn(async () => ok({ error: 'forbidden', reason: 'key_suspended', message: 'This API key is suspended. Contact hi@heyresearch.xyz if you think that is wrong.' }, 403)), apiKey: 'hey_abc' });
    await expect(held.get('/api/projects')).rejects.toMatchObject({ status: 403, message: expect.stringContaining('suspended') });
  });
});
