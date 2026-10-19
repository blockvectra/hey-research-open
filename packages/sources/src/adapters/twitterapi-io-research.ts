import { z } from 'zod';

import { errorResult, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { SourceError } from '../errors';
import type { HttpResponse } from '../http/client';
import { performSourceFetch } from '../http/perform';
import {
  boundedText,
  contractAddressesIn,
  TWITTERAPI_IO_BASE_URL,
  TWITTERAPI_IO_MIN_CREDITS,
  TWITTERAPI_IO_POST_CREDITS,
  TWITTERAPI_IO_POSTS_PER_PAGE,
  TWITTERAPI_IO_SEARCH_POST_CREDITS,
  X_POST_TEXT_MAX,
} from './twitterapi-io';

/**
 * Bounded X research reads (2026-10-20, founder; CLAUDE.md cost rule 7, the "bounded X research" amendment;
 * docs/audits/2026-10-20-brief/X_CONTRACTS.md §1.3). Five GET reads, every one documented by twitterapi.io and
 * none live-tested before this was written — the fixtures follow the documented shapes:
 *
 *  - `GET /twitter/tweets?tweet_ids=<≤50 ids>` (g): re-reads posts HEY already holds. A post the answer leaves out —
 *    deleted, private, or its account suspended; the provider does not say which — is reported `missing`, never
 *    with a guessed reason;
 *  - `GET /twitter/tweet/advanced_search?query=…&queryType=Latest&cursor=` (a): the posts of the operator-verified
 *    ecosystem accounts, by `from:` groups. Each post carries its author's STABLE id so the caller drops any post not
 *    written by the allowlisted id (a renamed or reassigned handle can never inject another account);
 *  - `GET /twitter/tweet/replies?tweetId=&sinceTime=&cursor=` (d), `GET /twitter/tweet/quotes?tweetId=&sinceTime=
 *    &includeReplies=false&cursor=` (e) and `GET /twitter/tweet/thread_context?tweetId=&cursor=` (f): one page each, for
 *    an opportunity a person shortlisted, never on a schedule of their own.
 *
 * What leaves this module of a post: its id, an id-only link (`https://x.com/i/status/<id>`), its date, at most 280
 * characters of text with control and direction-override characters removed, its expanded links, the 0x addresses
 * it names, the handles it mentions (lower-cased, for exact matching only), its author's stable id, and how it sits
 * in a conversation (original, quote or reply, and the ids it quotes or answers). Never a handle or name of its
 * author, never a follower, following, like, view, repost, quote, reply or bookmark count (`likeCount`, `viewCount`,
 * `retweetCount`, `replyCount`, `quoteCount`, `bookmarkCount`, `followers`, `following` are never read), never an
 * engagement-ordered selection (`Likes`, `Relevance`, `Top`). Every answer is untrusted: validated with Zod, capped
 * in bytes and string length, read only from the API's own host. HEY never acts on X: no endpoint here writes.
 */

/** At most this many ids in one `/twitter/tweets` call (the provider returns 400 beyond it). */
export const TWITTERAPI_IO_TWEETS_BY_ID_MAX = 50;
/** The most one tweets-by-ids call can cost: every id returned, 15 credits each. */
export const TWITTERAPI_IO_TWEETS_BY_ID_MAX_CREDITS = TWITTERAPI_IO_TWEETS_BY_ID_MAX * TWITTERAPI_IO_POST_CREDITS;
/** The longest tweets-by-ids answer HEY accepts for `asked` ids (an unasked or empty entry is dropped); a longer one is refused whole. */
const postsByIdMaxPosts = (asked: number): number => asked * 2;
/** The most one request of a tweets-by-ids call for `asked` ids can be metered: its longest accepted answer at 15 a post. */
export const postsByIdMaxCredits = (asked: number): number => postsByIdMaxPosts(asked) * TWITTERAPI_IO_POST_CREDITS;
/** One page of replies or quotes: at most twenty posts at 15 credits. */
export const TWITTERAPI_IO_CONVERSATION_PAGE_CREDITS = TWITTERAPI_IO_POSTS_PER_PAGE * TWITTERAPI_IO_POST_CREDITS;
/**
 * Thread context's page size is "not fixed" and its price is undocumented (X_CONTRACTS.md §1.3 f): HEY reads at most
 * a hundred posts of one page (a longer page is refused whole) and books them at the search rate it measured, 18.
 */
export const TWITTERAPI_IO_THREAD_PAGE_MAX = 100;
export const TWITTERAPI_IO_THREAD_PAGE_CREDITS = TWITTERAPI_IO_THREAD_PAGE_MAX * TWITTERAPI_IO_SEARCH_POST_CREDITS;
/** One page of the ecosystem watch's search, at the search rate HEY measured (18 a post). */
export const TWITTERAPI_IO_WATCH_PAGE_CREDITS = TWITTERAPI_IO_POSTS_PER_PAGE * TWITTERAPI_IO_SEARCH_POST_CREDITS;

export type XResearchPostKind = 'ORIGINAL' | 'QUOTE' | 'REPLY';

export type XResearchPost = {
  id: string;
  /** Id-only: `https://x.com/i/status/<id>`. Never the author's handle. */
  url: string;
  createdAt: Date;
  text: string;
  expandedUrls: string[];
  contractAddresses: string[];
  /** Lower-cased handles the post mentions, for exact matching against a project's confirmed account. */
  mentionedHandles: string[];
  /** The author's stable X id; absent when the answer did not carry one. */
  authorId?: string;
  kind: XResearchPostKind;
  conversationId?: string;
  inReplyToPostId?: string;
  quotedPostId?: string;
};

export type XResearchPage = { posts: XResearchPost[]; returned: number; hasNextPage: boolean; nextCursor?: string };

const USER_ID = /^\d{1,25}$/;
const POST_ID = /^\d{1,25}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_URLS = 20;
const MAX_MENTIONS = 20;

const idSchema = z.union([z.string().regex(USER_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const optionalIdSchema = z.union([z.string().max(30), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).nullish();
const idOf = (value: string | number): string => String(value);
const cleanId = (value: string | number | null | undefined): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const id = String(value).trim();
  return POST_ID.test(id) ? id : undefined;
};

const postSchema = z
  .object({
    // An entry with an empty id (`/twitter/tweets` "occasionally" returns one for a post it could not load) is dropped.
    id: z.union([z.string().max(30), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]),
    text: z.string().max(50_000).nullish(),
    createdAt: z.string().max(64).nullish(),
    isReply: z.boolean().nullish(),
    inReplyToId: optionalIdSchema,
    conversationId: optionalIdSchema,
    entities: z
      .object({
        urls: z.array(z.object({ expanded_url: z.string().max(4_096).nullish() }).passthrough()).max(100).nullish(),
        user_mentions: z.array(z.object({ screen_name: z.string().max(64).nullish() }).passthrough()).max(100).nullish(),
      })
      .passthrough()
      .nullish(),
    author: z.object({ id: idSchema.nullish() }).passthrough().nullish(),
    quoted_tweet: z.object({ id: optionalIdSchema }).passthrough().nullish(),
    retweeted_tweet: z.unknown().nullish(),
  })
  .passthrough();

type RawPost = z.infer<typeof postSchema>;

const listSchema = (max: number) =>
  z
    .object({
      status: z.enum(['success', 'error']).nullish(),
      msg: z.string().max(2_000).nullish(),
      message: z.string().max(2_000).nullish(),
      tweets: z.array(postSchema).max(max).nullish(),
      has_next_page: z.boolean().nullish(),
      next_cursor: z.string().max(4_000).nullish(),
    })
    .passthrough();

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

function cleanUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2_048) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  if (parsed.username || parsed.password) return undefined;
  if (parsed.hostname.toLowerCase() === 't.co') return undefined;
  return parsed.toString();
}

/** The answer must come from the API's own host: a redirect elsewhere is refused whole. */
function answeredByApi(response: HttpResponse, base: string): boolean {
  if (!response.url) return true;
  try {
    return new URL(response.url).host === new URL(base).host;
  } catch {
    return false;
  }
}

/**
 * A post as HEY keeps it, or undefined: a repost of another post (`retweeted_tweet`) is never kept — a repost says
 * nothing of its own — nor is one without a readable id or date.
 */
export function researchPostOf(raw: RawPost): XResearchPost | undefined {
  if (raw.retweeted_tweet !== null && raw.retweeted_tweet !== undefined) return undefined;
  const id = cleanId(raw.id);
  const createdAt = parseDate(raw.createdAt);
  if (!id || !createdAt) return undefined;
  const expandedUrls: string[] = [];
  for (const entry of raw.entities?.urls ?? []) {
    const url = cleanUrl(entry.expanded_url);
    if (url && !expandedUrls.includes(url)) expandedUrls.push(url);
    if (expandedUrls.length >= MAX_URLS) break;
  }
  const mentionedHandles: string[] = [];
  for (const entry of raw.entities?.user_mentions ?? []) {
    const handle = entry.screen_name?.trim();
    if (handle && HANDLE.test(handle) && !mentionedHandles.includes(handle.toLowerCase())) mentionedHandles.push(handle.toLowerCase());
    if (mentionedHandles.length >= MAX_MENTIONS) break;
  }
  const authorId = raw.author?.id !== null && raw.author?.id !== undefined ? idOf(raw.author.id) : undefined;
  const quotedPostId = cleanId(raw.quoted_tweet?.id);
  const inReplyToPostId = cleanId(raw.inReplyToId);
  const conversationId = cleanId(raw.conversationId);
  const kind: XResearchPostKind = raw.isReply === true || inReplyToPostId ? 'REPLY' : quotedPostId ? 'QUOTE' : 'ORIGINAL';
  return {
    id,
    url: `https://x.com/i/status/${id}`,
    createdAt,
    text: boundedText(raw.text, X_POST_TEXT_MAX) ?? '',
    expandedUrls,
    contractAddresses: contractAddressesIn(raw.text, expandedUrls),
    mentionedHandles,
    ...(authorId && USER_ID.test(authorId) ? { authorId } : {}),
    kind,
    ...(conversationId ? { conversationId } : {}),
    ...(inReplyToPostId ? { inReplyToPostId } : {}),
    ...(quotedPostId ? { quotedPostId } : {}),
  };
}

/**
 * What a read cost: billed by what it returned when fresh, the expected cost of the call otherwise (`maxCost`), for
 * every request sent. A page is never longer than `maxPosts` (a longer one is refused whole) and `maxCost` is never
 * above `maxPosts × perPost`, so a read never meters more than `maxPosts × perPost` a request — the per-request
 * maximum its caller reserves, times the requests one call may send (2026-10-20 review, P3a; `xCreditedCall` reserves
 * `MAX_ATTEMPTS_IN_PROCESS` of them).
 */
const creditsFor = (fresh: boolean, returned: number, read: Pick<ListRead, 'perPost' | 'maxPosts' | 'maxCost'>, attempts: number | undefined): number =>
  Math.max(TWITTERAPI_IO_MIN_CREDITS, Math.min(fresh ? returned * read.perPost : read.maxCost, read.maxPosts * read.perPost)) * Math.max(1, attempts ?? 1);

type ListRead = { url: string; base: string; apiKey: string; maxPosts: number; perPost: number; maxCost: number; cacheTtlSeconds: number };

async function readList(read: ListRead, ctx: SourceContext): Promise<SourceResult<XResearchPage>> {
  let returned = 0;
  const result: SourceResult<XResearchPage | { error: string }> = await performSourceFetch(
    ctx,
    { url: read.url, headers: { 'x-api-key': read.apiKey, accept: 'application/json' }, conditional: false, allowedContentTypes: ['application/json'], maxBytes: MAX_BYTES },
    {
      schema: listSchema(read.maxPosts),
      parse: (body) => JSON.parse(body) as unknown,
      cacheTtlSeconds: read.cacheTtlSeconds,
      normalize: (raw, response) => {
        if (!answeredByApi(response, read.base)) throw new SourceError('INVALID_RESPONSE', 'the answer came from another host than the API');
        if (raw.status === 'error') return { error: `provider error: ${boundedText(raw.msg ?? raw.message, 200) || 'no message'}` };
        const page = raw.tweets ?? [];
        returned = page.length;
        const posts: XResearchPost[] = [];
        for (const entry of page) {
          const post = researchPostOf(entry);
          if (post && !posts.some((kept) => kept.id === post.id)) posts.push(post);
        }
        const nextCursor = raw.has_next_page === true && raw.next_cursor ? raw.next_cursor : undefined;
        return { posts, returned: page.length, hasNextPage: raw.has_next_page === true, ...(nextCursor ? { nextCursor } : {}) };
      },
    },
  );
  const fresh = result.status === 'fresh' && result.data !== undefined && !('error' in result.data);
  const meteredUnits = creditsFor(fresh, returned, read, result.attempts);
  if (result.data && 'error' in result.data) {
    const { data, ...rest } = result;
    return { ...rest, status: 'error', errorCode: 'INVALID_RESPONSE', errorMessage: data.error, meteredUnits };
  }
  return { ...(result as SourceResult<XResearchPage>), meteredUnits };
}

const baseOf = (baseUrl: string | undefined): string => (baseUrl ?? TWITTERAPI_IO_BASE_URL).replace(/\/+$/, '');

export type XPostsByIdInput = { apiKey: string; postIds: readonly string[]; baseUrl?: string };
export type XPostsById = {
  /** The posts the answer carried, matched to the ids asked: one nobody asked for is dropped. */
  found: XResearchPost[];
  /** Ids asked that the answer left out: not returned, for a reason the provider does not give. */
  missing: string[];
};

export function createTwitterApiIoPostsByIdAdapter(): SourceAdapter<XPostsByIdInput, XPostsById> {
  return {
    name: 'twitterapi-io:posts-by-id',
    canHandle: (input) =>
      input.apiKey.length > 0 && input.postIds.length > 0 && input.postIds.length <= TWITTERAPI_IO_TWEETS_BY_ID_MAX && input.postIds.every((id) => POST_ID.test(id)),
    async fetch(input, ctx): Promise<SourceResult<XPostsById>> {
      if (!this.canHandle(input)) return errorResult(ctx, 'INVALID_RESPONSE', 'not 1–50 X post ids, or no key; nothing was asked');
      const base = baseOf(input.baseUrl);
      const asked = [...new Set(input.postIds)];
      const page = await readList(
        // At most twice the ids asked (an unasked or empty entry is dropped, still billed): `postsByIdMaxCredits` prices it.
        { url: `${base}/twitter/tweets?tweet_ids=${asked.join(',')}`, base, apiKey: input.apiKey, maxPosts: postsByIdMaxPosts(asked.length), perPost: TWITTERAPI_IO_POST_CREDITS, maxCost: asked.length * TWITTERAPI_IO_POST_CREDITS, cacheTtlSeconds: 0 },
        ctx,
      );
      if (page.status !== 'fresh' || !page.data) {
        const { data: _data, ...rest } = page;
        return rest;
      }
      const wanted = new Set(asked);
      const found = page.data.posts.filter((post, index, all) => wanted.has(post.id) && all.findIndex((other) => other.id === post.id) === index);
      return { ...page, data: { found, missing: asked.filter((id) => !found.some((post) => post.id === id)) } };
    },
  };
}

export type XWatchSearchInput = { apiKey: string; query: string; cursor?: string; baseUrl?: string };

const SEARCH_QUERY_MAX = 500;

/** One page of an ecosystem watch query (`(from:a OR from:b) since_time:… -is:retweet`), newest first. */
export function createTwitterApiIoWatchSearchAdapter(): SourceAdapter<XWatchSearchInput, XResearchPage> {
  return {
    name: 'twitterapi-io:watch-search',
    canHandle: (input) => input.apiKey.length > 0 && input.query.trim().length > 0 && input.query.length <= SEARCH_QUERY_MAX,
    async fetch(input, ctx) {
      if (!this.canHandle(input)) return errorResult(ctx, 'INVALID_RESPONSE', 'no query, or no key; nothing was asked');
      const base = baseOf(input.baseUrl);
      return readList(
        {
          url: `${base}/twitter/tweet/advanced_search?query=${encodeURIComponent(input.query)}&queryType=Latest&cursor=${encodeURIComponent(input.cursor ?? '')}`,
          base,
          apiKey: input.apiKey,
          // One documented page (20); a longer one is refused whole, so the reservation (`TWITTERAPI_IO_WATCH_PAGE_CREDITS`) holds.
          maxPosts: TWITTERAPI_IO_POSTS_PER_PAGE,
          perPost: TWITTERAPI_IO_SEARCH_POST_CREDITS,
          maxCost: TWITTERAPI_IO_WATCH_PAGE_CREDITS,
          cacheTtlSeconds: 600,
        },
        ctx,
      );
    },
  };
}

export type XConversationRelation = 'replies' | 'quotes' | 'thread';
export type XConversationInput = { apiKey: string; postId: string; relation: XConversationRelation; sinceTime?: Date; cursor?: string; baseUrl?: string };

/** The most one page of a conversation read can cost, by relation. */
export const conversationPageCredits = (relation: XConversationRelation): number => (relation === 'thread' ? TWITTERAPI_IO_THREAD_PAGE_CREDITS : TWITTERAPI_IO_CONVERSATION_PAGE_CREDITS);

/**
 * One page of the replies to, the quotes of, or the thread around one post. Ordered by time ("Latest"), never by
 * engagement: the v2 replies endpoint's `Relevance` and `Likes` orders are never used.
 */
export function createTwitterApiIoConversationAdapter(): SourceAdapter<XConversationInput, XResearchPage> {
  return {
    name: 'twitterapi-io:conversation',
    canHandle: (input) => input.apiKey.length > 0 && POST_ID.test(input.postId) && ['replies', 'quotes', 'thread'].includes(input.relation),
    async fetch(input, ctx) {
      if (!this.canHandle(input)) return errorResult(ctx, 'INVALID_RESPONSE', 'not an X post id, or no key; nothing was asked');
      const base = baseOf(input.baseUrl);
      const since = input.sinceTime ? `&sinceTime=${Math.floor(input.sinceTime.getTime() / 1000)}` : '';
      const cursor = `&cursor=${encodeURIComponent(input.cursor ?? '')}`;
      const path =
        input.relation === 'replies'
          ? `/twitter/tweet/replies?tweetId=${input.postId}${since}${cursor}`
          : input.relation === 'quotes'
            ? `/twitter/tweet/quotes?tweetId=${input.postId}${since}&includeReplies=false${cursor}`
            : `/twitter/tweet/thread_context?tweetId=${input.postId}${cursor}`;
      return readList(
        {
          url: `${base}${path}`,
          base,
          apiKey: input.apiKey,
          // One page as `conversationPageCredits` prices it; a longer one is refused whole, so the reservation holds.
          maxPosts: input.relation === 'thread' ? TWITTERAPI_IO_THREAD_PAGE_MAX : TWITTERAPI_IO_POSTS_PER_PAGE,
          perPost: input.relation === 'thread' ? TWITTERAPI_IO_SEARCH_POST_CREDITS : TWITTERAPI_IO_POST_CREDITS,
          maxCost: conversationPageCredits(input.relation),
          cacheTtlSeconds: 600,
        },
        ctx,
      );
    },
  };
}
