import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FetchLike, SourceContext } from './adapter';

/**
 * Test helpers.
 *
 * Every adapter test drives a stubbed fetch over saved fixtures, so CI never
 * depends on a live third-party API (CLAUDE.md rule 16).
 */
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

export type StubResponse = {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Throw instead of responding, to simulate a network failure. */
  throws?: Error;
  url?: string;
};

export type RecordedRequest = { url: string; init?: RequestInit };

export type FetchStub = {
  fetchImpl: FetchLike;
  requests: RecordedRequest[];
  callCount: () => number;
};

/**
 * Queue of responses returned in order; the last one repeats once exhausted, so a
 * single entry can serve every retry attempt.
 */
export function stubFetch(responses: StubResponse | StubResponse[]): FetchStub {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const requests: RecordedRequest[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, ...(init === undefined ? {} : { init }) });
    const spec = queue[Math.min(index, queue.length - 1)] ?? {};
    index += 1;

    if (spec.throws) throw spec.throws;

    const status = spec.status ?? 200;
    const response = new Response(status === 304 ? null : (spec.body ?? ''), {
      status,
      headers: spec.headers ?? {},
    });
    if (spec.url) Object.defineProperty(response, 'url', { value: spec.url });
    return response;
  };

  return { fetchImpl, requests, callCount: () => requests.length };
}

/** Deterministic context: fixed clock, no real sleeping between retries. */
export function testContext(overrides: Partial<SourceContext> = {}): SourceContext {
  return {
    timeoutMs: 5_000,
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} },
    // Every test host resolves to a public address; none reaches real DNS.
    lookupImpl: async () => ['93.184.216.34'],
    ...overrides,
  };
}
