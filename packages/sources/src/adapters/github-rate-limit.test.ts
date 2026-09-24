import { describe, expect, it } from 'vitest';

import { testContext, stubFetch } from '../testing';
import { createGithubCommitsAdapter } from './github-commits';

/*
 * Graceful degradation (2026-09-24): GitHub is the primary builder-activity
 * source, so a rate limit on the commits read must never look like a quiet
 * week — it comes back rate_limited with no commits, after one request.
 */
const input = { owner: 'agentos', repo: 'core', since: new Date('2026-08-25T00:00:00Z') };

describe('GitHub commits adapter under a rate limit', () => {
  const adapter = createGithubCommitsAdapter();

  it('reports a 429 as rate_limited with the advertised wait, and no commits', async () => {
    const stub = stubFetch({ status: 429, body: '{"message":"rate limited"}', headers: { 'retry-after': '90' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.errorCode).toBe('RATE_LIMITED');
    expect(result.retryAfterSeconds).toBe(90);
    expect(result.data).toBeUndefined();
    expect(stub.callCount()).toBe(1);
  });

  it('reports the secondary-limit 403 (Retry-After) as rate_limited, not as an error', async () => {
    const stub = stubFetch({
      status: 403,
      body: '{"message":"You have exceeded a secondary rate limit."}',
      headers: { 'retry-after': '60' },
    });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(60);
    expect(result.data).toBeUndefined();
    expect(stub.callCount()).toBe(1);
  });

  it('reports the primary-limit 403 (x-ratelimit-remaining: 0) as rate_limited', async () => {
    const stub = stubFetch({
      status: 403,
      body: '{"message":"API rate limit exceeded"}',
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
    });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.data).toBeUndefined();
  });
});
