import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { MAX_ATTEMPTS_IN_PROCESS } from '../http/client';
import { TWITTERAPI_IO_BASE_URL } from './twitterapi-io';
import {
  conversationPageCredits,
  createTwitterApiIoConversationAdapter,
  createTwitterApiIoPostsByIdAdapter,
  createTwitterApiIoWatchSearchAdapter,
  postsByIdMaxCredits,
  TWITTERAPI_IO_THREAD_PAGE_CREDITS,
  TWITTERAPI_IO_WATCH_PAGE_CREDITS,
} from './twitterapi-io-research';

/**
 * Bounded X research reads (2026-10-20). FIXTURES in the shapes docs.twitterapi.io documents — none of these
 * endpoints was live-tested when this was written (X_CONTRACTS.md §1.5). No live network: `vitest.setup.ts` fails
 * any real fetch.
 */
const json = (body: string, status = 200) => ({ status, body, headers: { 'content-type': 'application/json' } });
const KEY = 'test-key-not-a-secret';
const ENGAGEMENT = /likeCount|viewCount|retweetCount|replyCount|quoteCount|bookmarkCount|followers|following|"likes"|"views"/i;

describe('twitterapi.io posts by id (re-check)', () => {
  const adapter = createTwitterApiIoPostsByIdAdapter();
  const asked = ['1846000000000000005', '1846000000000000004', '1846000000000000003'];

  it('matches the answer to the ids asked: a left-out id is missing, an empty-id entry and an unasked post are dropped', async () => {
    const stub = stubFetch(json(readFixture('twitterapi-io-tweets-by-ids.json')));
    const result = await adapter.fetch({ apiKey: KEY, postIds: asked }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]!.url).toBe(`${TWITTERAPI_IO_BASE_URL}/twitter/tweets?tweet_ids=${asked.join(',')}`);
    expect(result.status).toBe('fresh');
    expect(result.data!.found.map((post) => post.id)).toEqual(['1846000000000000005', '1846000000000000004']);
    // Not returned, for a reason the provider does not give: never "deleted", never guessed.
    expect(result.data!.missing).toEqual(['1846000000000000003']);
    expect(JSON.stringify(result.data)).not.toMatch(ENGAGEMENT);
    // Four entries returned, at 15 each.
    expect(result.meteredUnits).toBe(4 * 15);
  });

  it('asks nothing for more than fifty ids, a non-numeric id or no key', async () => {
    const stub = stubFetch(json('{}'));
    const ctx = testContext({ fetchImpl: stub.fetchImpl });
    expect((await adapter.fetch({ apiKey: KEY, postIds: Array.from({ length: 51 }, (_, i) => String(i + 1)) }, ctx)).status).toBe('error');
    expect((await adapter.fetch({ apiKey: KEY, postIds: ['abc'] }, ctx)).status).toBe('error');
    expect((await adapter.fetch({ apiKey: '', postIds: ['1'] }, ctx)).status).toBe('error');
    expect(stub.requests).toHaveLength(0);
  });

  it('books every id asked when the answer is not fresh, and reports a 402 with its status', async () => {
    const failed = await adapter.fetch({ apiKey: KEY, postIds: asked }, testContext({ fetchImpl: stubFetch(json('{"status":"error","msg":"later"}')).fetchImpl }));
    expect(failed.status).toBe('error');
    expect(failed.meteredUnits).toBe(asked.length * 15);
    const credits = await adapter.fetch({ apiKey: KEY, postIds: asked }, testContext({ fetchImpl: stubFetch(json('{"message":"Credits is not enough"}', 402)).fetchImpl }));
    expect(credits.status).toBe('error');
    expect(credits.httpStatus).toBe(402);
  });
});

describe('twitterapi.io ecosystem watch search', () => {
  const adapter = createTwitterApiIoWatchSearchAdapter();

  it('keeps the author’s stable id, the kind and the links; drops reposts, hostile links and every count', async () => {
    const stub = stubFetch(json(readFixture('twitterapi-io-watch-search.json')));
    const query = '(from:chain_dev OR from:grants_prog) -is:retweet since_time:1792454400';
    const result = await adapter.fetch({ apiKey: KEY, query }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]!.url).toBe(`${TWITTERAPI_IO_BASE_URL}/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}&queryType=Latest&cursor=`);
    const posts = result.data!.posts;
    // The repost is gone; the impostor's post is still here with its own id — the caller drops it by id.
    expect(posts.map((post) => post.id)).toEqual(['1980000000000000010', '1980000000000000011', '1980000000000000012', '1980000000000000014', '1980000000000000015']);
    expect(posts.find((post) => post.id === '1980000000000000012')!.authorId).toBe('3000000000000000003');
    expect(posts[0]).toMatchObject({ authorId: '2000000000000000001', kind: 'ORIGINAL', url: 'https://x.com/i/status/1980000000000000010', mentionedHandles: ['agentos_hq'] });
    expect(posts.find((post) => post.id === '1980000000000000014')).toMatchObject({ kind: 'QUOTE', quotedPostId: '1979000000000000001' });
    expect(posts.find((post) => post.id === '1980000000000000015')).toMatchObject({ kind: 'REPLY', inReplyToPostId: '1970000000000000001', conversationId: '1970000000000000001' });
    // Hostile text is data: control and direction characters stripped; a javascript: or credentialed link is never kept.
    const hostile = posts.find((post) => post.id === '1980000000000000014')!;
    expect(hostile.text).not.toMatch(new RegExp('[\\u202e\\u200b]'));
    expect(hostile.expandedUrls).toEqual(['https://github.com/chain/sdk/releases/tag/v3.0.0']);
    // The id-only link never names the author.
    for (const post of posts) expect(post.url).toMatch(/^https:\/\/x\.com\/i\/status\/\d+$/);
    expect(JSON.stringify(result.data)).not.toMatch(ENGAGEMENT);
    expect(JSON.stringify(result.data)).not.toMatch(/chain_dev_|userName/);
    expect(result.data).toMatchObject({ returned: 6, hasNextPage: true, nextCursor: 'WATCH-CURSOR-1' });
    expect(result.meteredUnits).toBe(6 * 18);
  });

  it('refuses an answer that came from another host', async () => {
    const result = await adapter.fetch({ apiKey: KEY, query: 'from:a' }, testContext({ fetchImpl: stubFetch({ ...json(readFixture('twitterapi-io-watch-search.json')), url: 'https://evil.example/x' }).fetchImpl }));
    expect(result.status).toBe('error');
  });
});

describe('twitterapi.io conversation reads', () => {
  const adapter = createTwitterApiIoConversationAdapter();

  it('asks replies by time from the origin date, quotes without replies, and thread context by cursor', async () => {
    const stub = stubFetch([json(readFixture('twitterapi-io-replies.json')), json(readFixture('twitterapi-io-quotes.json')), json(readFixture('twitterapi-io-thread-context.json'))]);
    const ctx = testContext({ fetchImpl: stub.fetchImpl });
    const since = new Date('2026-10-20T08:00:00.000Z');
    const replies = await adapter.fetch({ apiKey: KEY, postId: '1980000000000000010', relation: 'replies', sinceTime: since }, ctx);
    const quotes = await adapter.fetch({ apiKey: KEY, postId: '1980000000000000010', relation: 'quotes', sinceTime: since }, ctx);
    const thread = await adapter.fetch({ apiKey: KEY, postId: '1980000000000000015', relation: 'thread', cursor: 'C1' }, ctx);
    expect(stub.requests.map((request) => request.url)).toEqual([
      `${TWITTERAPI_IO_BASE_URL}/twitter/tweet/replies?tweetId=1980000000000000010&sinceTime=1792483200&cursor=`,
      `${TWITTERAPI_IO_BASE_URL}/twitter/tweet/quotes?tweetId=1980000000000000010&sinceTime=1792483200&includeReplies=false&cursor=`,
      `${TWITTERAPI_IO_BASE_URL}/twitter/tweet/thread_context?tweetId=1980000000000000015&cursor=C1`,
    ]);
    expect(replies.data!.posts.map((post) => post.authorId)).toEqual(['5000000000000000005', '1567890123456789012', '6000000000000000006']);
    expect(replies.data!.posts.every((post) => post.kind === 'REPLY')).toBe(true);
    expect(quotes.data).toMatchObject({ hasNextPage: false, returned: 1 });
    expect(thread.data!.posts).toHaveLength(2);
    expect(JSON.stringify([replies.data, quotes.data, thread.data])).not.toMatch(ENGAGEMENT);
    expect(replies.meteredUnits).toBe(3 * 15);
    expect(thread.meteredUnits).toBe(2 * 18);
  });

  it('reads an empty page with has_next_page as an empty page (the documented platform limitation)', async () => {
    const result = await adapter.fetch({ apiKey: KEY, postId: '1', relation: 'replies' }, testContext({ fetchImpl: stubFetch(json(readFixture('twitterapi-io-replies-empty-next.json'))).fetchImpl }));
    expect(result.data).toMatchObject({ posts: [], returned: 0, hasNextPage: true });
    // A call that returns nothing still costs the minimum.
    expect(result.meteredUnits).toBe(15);
  });

  it('books the most a page can cost when it fails', async () => {
    const result = await adapter.fetch({ apiKey: KEY, postId: '1', relation: 'thread' }, testContext({ fetchImpl: stubFetch(json('{"status":"error","msg":"no"}')).fetchImpl }));
    expect(result.meteredUnits).toBe(TWITTERAPI_IO_THREAD_PAGE_CREDITS);
    expect(conversationPageCredits('replies')).toBe(300);
  });
});

describe('a research read never meters past the maximum its caller reserves (2026-10-20 review, P3a)', () => {
  const tweet = (i: number) => ({ id: `1980000000000000${100 + i}`, text: 'gm', createdAt: 'Tue Oct 20 08:00:00 +0000 2026', author: { id: '2000000000000000001' } });
  const page = (n: number) => JSON.stringify({ tweets: Array.from({ length: n }, (_, i) => tweet(i)), has_next_page: true, next_cursor: 'C' });

  it('meters a full page that took a retried request at most the page price per request sent', async () => {
    const search = createTwitterApiIoWatchSearchAdapter();
    const stub = stubFetch([{ status: 503, body: '' }, json(page(20))]);
    const result = await search.fetch({ apiKey: KEY, query: 'from:a' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.attempts).toBe(2);
    expect(result.meteredUnits).toBe(TWITTERAPI_IO_WATCH_PAGE_CREDITS * 2);
    expect(result.meteredUnits).toBeLessThanOrEqual(TWITTERAPI_IO_WATCH_PAGE_CREDITS * MAX_ATTEMPTS_IN_PROCESS);
  });

  it('refuses a page longer than the one it prices, and books it at that price, never the page’s length', async () => {
    const search = createTwitterApiIoWatchSearchAdapter();
    const long = await search.fetch({ apiKey: KEY, query: 'from:a' }, testContext({ fetchImpl: stubFetch(json(page(100))).fetchImpl }));
    expect(long.status).toBe('error');
    expect(long.meteredUnits).toBe(TWITTERAPI_IO_WATCH_PAGE_CREDITS);
    const replies = createTwitterApiIoConversationAdapter();
    const longReplies = await replies.fetch({ apiKey: KEY, postId: '1', relation: 'replies' }, testContext({ fetchImpl: stubFetch(json(page(40))).fetchImpl }));
    expect(longReplies.status).toBe('error');
    expect(longReplies.meteredUnits).toBe(conversationPageCredits('replies'));
    // Tweets by id: at most twice the ids asked, which is what the re-check reserves a request.
    const byId = createTwitterApiIoPostsByIdAdapter();
    const ids = ['1980000000000000100', '1980000000000000101'];
    const extra = await byId.fetch({ apiKey: KEY, postIds: ids }, testContext({ fetchImpl: stubFetch(json(page(4))).fetchImpl }));
    expect(extra.status).toBe('fresh');
    expect(extra.meteredUnits).toBeLessThanOrEqual(postsByIdMaxCredits(ids.length));
    const tooLong = await byId.fetch({ apiKey: KEY, postIds: ids }, testContext({ fetchImpl: stubFetch(json(page(5))).fetchImpl }));
    expect(tooLong.status).toBe('error');
  });
});

describe('the twitterapi.io adapters only read', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = ['twitterapi-io.ts', 'twitterapi-io-research.ts'].map((name) => readFileSync(path.join(here, name), 'utf8'));

  it('have no write endpoint, no non-GET method and no engagement field mapped out', () => {
    for (const source of files) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // Every path HEY asks is a read; none of the provider's acting endpoints is ever named in code.
      expect(code).not.toMatch(/create_tweet|tweet\/create|delete_tweet|like_tweet|\/like\b|retweet_tweet|\/retweet\b|follow_user|\/follow\b|send_dm|\/dm\b|login|upload_media|bookmark|\/community\/(create|join|post)|webhook|monitor/i);
      expect(code).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
      // Counts may arrive (passthrough) but are never read into anything HEY keeps.
      expect(code).not.toMatch(/\.(likeCount|viewCount|retweetCount|replyCount|quoteCount|bookmarkCount|followers|following)\b/);
      // Never an engagement-ordered selection.
      expect(code).not.toMatch(/queryType=(Top|Likes|Relevance)/);
    }
  });
});
