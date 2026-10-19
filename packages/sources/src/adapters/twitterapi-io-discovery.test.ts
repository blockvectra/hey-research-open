import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import {
  batchCredits,
  createTwitterApiIoBatchUsersAdapter,
  createTwitterApiIoSearchPostsAdapter,
  createTwitterApiIoSearchUsersAdapter,
  TWITTERAPI_IO_BASE_URL,
} from './twitterapi-io';

/**
 * The 2026-10-18 extension: profiles by stable id in one call, one page of a fixed discovery query, and the
 * ids X returns for a project's name. Fixtures in the live answers' shapes (read 2026-10-18). No live
 * network: `vitest.setup.ts` fails any real fetch.
 */
const json = (body: string) => ({ status: 200, body, headers: { 'content-type': 'application/json' } });
const KEY = 'test-key-not-a-secret';

describe('twitterapi.io profiles by id', () => {
  const adapter = createTwitterApiIoBatchUsersAdapter();

  it('reads the accounts asked for, reports the one left out as missing, and drops one nobody asked for', async () => {
    const stub = stubFetch(json(readFixture('twitterapi-io-batch-users.json')));
    const asked = ['1567890123456789012', '1700000000000000002', '1800000000000000003'];
    const result = await adapter.fetch({ apiKey: KEY, userIds: asked }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests[0]!.url).toBe(`${TWITTERAPI_IO_BASE_URL}/twitter/user/batch_info_by_ids?userIds=${asked.join(',')}`);
    expect(new Headers(stub.requests[0]!.init?.headers).get('x-api-key')).toBe(KEY);
    expect(result.status).toBe('fresh');
    expect(result.data!.accounts.map((entry) => entry.userId)).toEqual(['1567890123456789012', '1700000000000000002']);
    expect(result.data!.accounts[0]!.reading).toMatchObject({ kind: 'ACTIVE', userName: 'agentos_hq', profileUrls: ['https://www.agentos.example/'] });
    expect(result.data!.accounts[1]!.reading).toMatchObject({ kind: 'ACTIVE', userName: 'renamed_labs', profileUrls: [] });
    // Unknown, never gone: the caller reads a missing account by its handle.
    expect(result.data!.missing).toEqual(['1800000000000000003']);
    expect(JSON.stringify(result.data)).not.toMatch(/follow|favourite|statuses|12873/i);
    // Three accounts returned, under a hundred: the profile price each.
    expect(result.meteredUnits).toBe(3 * 18);
  });

  // 2026-10-19: an answer HEY could not read was booked by what it returned — nothing — though the provider may bill every id asked.
  it('books every id asked for an answer that is not fresh', async () => {
    const asked = ['1567890123456789012', '1700000000000000002', '1800000000000000003'];
    const result = await adapter.fetch({ apiKey: KEY, userIds: asked }, testContext({ fetchImpl: stubFetch(json('{"status":"error","msg":"try later"}')).fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.meteredUnits).toBe(batchCredits(asked.length));
  });

  it('prices a hundred or more at one credit each', () => {
    expect(batchCredits(100)).toBe(100);
    expect(batchCredits(99)).toBe(99 * 18);
    expect(batchCredits(0)).toBe(15);
  });

  it('asks nothing for more than a hundred ids, a non-numeric id or no key', async () => {
    const stub = stubFetch(json('{}'));
    const ctx = testContext({ fetchImpl: stub.fetchImpl });
    expect((await adapter.fetch({ apiKey: KEY, userIds: Array.from({ length: 101 }, (_, i) => String(i + 1)) }, ctx)).status).toBe('error');
    expect((await adapter.fetch({ apiKey: KEY, userIds: ['agentos_hq'] }, ctx)).status).toBe('error');
    expect((await adapter.fetch({ apiKey: '', userIds: ['1'] }, ctx)).status).toBe('error');
    expect(stub.callCount()).toBe(0);
  });
});

describe('twitterapi.io discovery search', () => {
  const adapter = createTwitterApiIoSearchPostsAdapter();

  it('keeps a post’s id, date, links and addresses — never its text, its author or a count — and skips retweets', async () => {
    const stub = stubFetch(json(readFixture('twitterapi-io-search-posts.json')));
    const result = await adapter.fetch({ apiKey: KEY, query: '"Robinhood Chain" url:github.com' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests[0]!.url).toBe(`${TWITTERAPI_IO_BASE_URL}/twitter/tweet/advanced_search?query=%22Robinhood%20Chain%22%20url%3Agithub.com&queryType=Latest&cursor=`);
    expect(result.status).toBe('fresh');
    expect(result.data!.posts.map((post) => post.id)).toEqual(['1979000000000000001', '1979000000000000003']);
    expect(result.data!.posts[0]).toEqual({
      id: '1979000000000000001',
      url: 'https://x.com/i/status/1979000000000000001',
      createdAt: new Date('2026-10-18T16:17:52.000Z'),
      expandedUrls: ['https://github.com/acme/rh-indexer'],
      contractAddresses: ['0xabcdef0123456789abcdef0123456789abcdef01'],
    });
    const kept = JSON.stringify(result.data);
    expect(kept).not.toMatch(/someone|open-sourced|likeCount|viewCount|followers/);
    expect(result.data!.nextCursor).toBe('DAABCgABGQ');
    expect(result.meteredUnits).toBe(3 * 18);
  });
});

describe('twitterapi.io account search', () => {
  const adapter = createTwitterApiIoSearchUsersAdapter();

  it('keeps the ids X returned for a name, once each, in order, and nothing else', async () => {
    const stub = stubFetch(json(readFixture('twitterapi-io-search-users.json')));
    const result = await adapter.fetch({ apiKey: KEY, query: 'AgentOS' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests[0]!.url).toBe(`${TWITTERAPI_IO_BASE_URL}/twitter/user/search?query=AgentOS`);
    expect(result.data).toEqual({ userIds: ['1567890123456789012', '1700000000000000002'] });
    expect(result.meteredUnits).toBe(4 * 18);
  });

  it('asks nothing for a one-letter name', async () => {
    const stub = stubFetch(json('{}'));
    expect((await adapter.fetch({ apiKey: KEY, query: 'a' }, testContext({ fetchImpl: stub.fetchImpl }))).status).toBe('error');
    expect(stub.callCount()).toBe(0);
  });
});
