import { z } from 'zod';

import { errorResult, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { SourceError } from '../errors';
import type { HttpResponse } from '../http/client';
import { performSourceFetch } from '../http/perform';

/**
 * twitterapi.io (2026-10-18, founder: "ok buat"): an independent, pay-per-use X data API, not affiliated
 * with X. HEY reads two things from it and nothing else:
 *
 *  - `GET /twitter/user/info?userName=<handle>`: the state of a project's OFFICIAL X account — its stable
 *    user id, the handle as read, the display name, when it was created, the verification flags, the
 *    links on its profile, and whether it is suspended, otherwise unavailable or does not exist;
 *  - `GET /twitter/user/last_tweets?userId=<id>&includeReplies=false`: the newest page of that account's
 *    own posts.
 *
 * Never anyone else's account, never followers, never mentions or a search of people. No follower,
 * following or engagement count leaves this adapter: popularity is not research. Every answer is
 * untrusted: validated with Zod, capped in size and string length, read only from the API's own host
 * (an answer that redirected anywhere else is refused whole), and refused when it answers a different
 * question than the one asked.
 *
 * Cost is metered in the provider's credits (`meteredUnits`): about 18 a profile lookup, 15 a post
 * returned, 15 at least a call; 100,000 credits are one US dollar (provider's pricing, read 2026-10-18).
 */
export const TWITTERAPI_IO_BASE_URL = 'https://api.twitterapi.io';

/** Credits per profile lookup, per post returned, and the floor of any call (provider pricing, 2026-10-18). */
export const TWITTERAPI_IO_PROFILE_CREDITS = 18;
export const TWITTERAPI_IO_POST_CREDITS = 15;
export const TWITTERAPI_IO_MIN_CREDITS = 15;
/** One page of `last_tweets` holds at most twenty posts: the most one read can cost. */
export const TWITTERAPI_IO_POSTS_PER_PAGE = 20;
export const TWITTERAPI_IO_MAX_PAGE_CREDITS = TWITTERAPI_IO_POSTS_PER_PAGE * TWITTERAPI_IO_POST_CREDITS;

/** How much of a post's text HEY keeps. */
export const X_POST_TEXT_MAX = 280;

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID = /^\d{1,25}$/;
const PROFILE_MAX_BYTES = 64 * 1024;
const POSTS_MAX_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_URLS = 20;
const MAX_POST_URLS = 20;

export type XAccountReading =
  | {
      kind: 'ACTIVE';
      userId: string;
      /** The handle as X spells it now. */
      userName: string;
      displayName?: string;
      createdAt?: Date;
      isBlueVerified?: boolean;
      verifiedType?: string;
      /** The links on the profile: the bio's and the profile website's expanded URLs, http(s) only. */
      profileUrls: string[];
    }
  | { kind: 'SUSPENDED' | 'UNAVAILABLE'; reason?: string }
  | { kind: 'NOT_FOUND' };

export type XPost = {
  id: string;
  url: string;
  createdAt: Date;
  /** At most {@link X_POST_TEXT_MAX} characters, control characters removed. */
  text: string;
  expandedUrls: string[];
  /** Every 0x-prefixed 40-hex address in the full text or the URLs, lower-cased. */
  contractAddresses: string[];
};

export type XPostsPage = {
  posts: XPost[];
  /** Posts the page returned that HEY does not keep: retweets of others, replies, another author's. */
  skipped: number;
  /** Posts the page returned, kept or not: what the read cost. */
  returned: number;
  hasNextPage: boolean;
};

export type XUserInfoInput = { apiKey: string; userName: string; baseUrl?: string };
export type XLastPostsInput = { apiKey: string; userId: string; baseUrl?: string };

// A numeric id is read as written; one past the safe-integer range would have lost digits and is refused.
const idSchema = z.union([z.string().regex(USER_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const idOf = (value: string | number): string => String(value);
const urlEntity = z.object({ expanded_url: z.string().max(4_096).nullish() }).passthrough();
const urlEntities = z.object({ urls: z.array(urlEntity).max(100).nullish() }).passthrough();

const userData = z
  .object({
    id: idSchema.nullish(),
    userName: z.string().max(64).nullish(),
    name: z.string().max(500).nullish(),
    url: z.string().max(4_096).nullish(),
    profile_bio: z
      .object({ entities: z.object({ description: urlEntities.nullish(), url: urlEntities.nullish() }).passthrough().nullish() })
      .passthrough()
      .nullish(),
    createdAt: z.string().max(64).nullish(),
    isBlueVerified: z.boolean().nullish(),
    verifiedType: z.string().max(40).nullish(),
    unavailable: z.boolean().nullish(),
    unavailableReason: z.string().max(500).nullish(),
    message: z.string().max(2_000).nullish(),
  })
  .passthrough();

const userInfoSchema = z
  .object({
    status: z.enum(['success', 'error']),
    msg: z.string().max(2_000).nullish(),
    data: userData.nullish(),
  })
  .passthrough();

const postSchema = z
  .object({
    id: idSchema,
    url: z.string().max(4_096).nullish(),
    text: z.string().max(50_000).nullish(),
    createdAt: z.string().max(64).nullish(),
    entities: urlEntities.nullish(),
    retweeted_tweet: z.unknown().nullish(),
    isReply: z.boolean().nullish(),
    author: z.object({ id: idSchema.nullish() }).passthrough().nullish(),
  })
  .passthrough();

const postsSchema = z
  .object({
    status: z.enum(['success', 'error']),
    msg: z.string().max(2_000).nullish(),
    data: z.object({ tweets: z.array(postSchema).max(100).nullish(), pin_tweet: z.unknown().nullish() }).passthrough().nullish(),
    // Older answers carry the page at the top level; read either, never both.
    tweets: z.array(postSchema).max(100).nullish(),
    has_next_page: z.boolean().nullish(),
    next_cursor: z.string().max(4_000).nullish(),
  })
  .passthrough();

type RawUserInfo = z.infer<typeof userInfoSchema>;
type RawPosts = z.infer<typeof postsSchema>;
type RawPost = z.infer<typeof postSchema>;

/** Control characters, zero-width marks and direction overrides: never part of a post HEY prints. */
const isHidden = (code: number): boolean =>
  code < 0x20 || code === 0x7f || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);

/** Text with control and direction-override characters removed, trimmed to `max` characters. */
export function boundedText(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const clean = Array.from(
    Array.from(value, (char) => (isHidden(char.codePointAt(0) ?? 0) ? ' ' : char))
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (clean.length === 0) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1).join('')}…` : clean.join('');
}

/** An http(s) URL of sane length, or undefined; X's own short links are not a destination. */
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

function uniqueUrls(values: readonly (string | null | undefined)[], max: number): string[] {
  const out: string[] = [];
  for (const value of values) {
    const url = cleanUrl(value);
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

const ADDRESS = /\b0x[0-9a-fA-F]{40}\b/g;

/**
 * Every 0x-prefixed 40-hex address in a post's text and links, lower-cased and once each. An address is a
 * string here: whether it is a contract (never an account) is the chain's to say, and nothing reads it as
 * one until the founder rules (`x_names_contract`, unused).
 */
export function contractAddressesIn(text: string | null | undefined, urls: readonly string[] = []): string[] {
  const found = new Set<string>();
  for (const source of [text ?? '', ...urls]) {
    for (const match of source.slice(0, 50_000).matchAll(ADDRESS)) found.add(match[0].toLowerCase());
    if (found.size >= 20) break;
  }
  return [...found].slice(0, 20);
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

const NOT_FOUND_MESSAGE = /\b(user|account)\b[^.]{0,40}\b(not found|not exist|does not exist|doesn't exist)\b|^not found$/i;

/** The answer must come from the API's own host: a redirect elsewhere is refused (credentials are dropped by the client; the answer is too). */
function answeredByApi(response: HttpResponse, base: string): boolean {
  if (!response.url) return true;
  try {
    return new URL(response.url).host === new URL(base).host;
  } catch {
    return false;
  }
}

const wrongHost = (): SourceError => new SourceError('INVALID_RESPONSE', 'the answer came from another host than the API');

/**
 * What a call cost, in credits. Every result from the HTTP path counts as sent — a timeout or a network
 * failure too, since HEY cannot know whether the provider billed it — so the meter errs high, never low.
 */
const metered = <T>(result: SourceResult<T>, perAttempt: number): SourceResult<T> => ({
  ...result,
  meteredUnits: Math.max(TWITTERAPI_IO_MIN_CREDITS, perAttempt) * Math.max(1, result.attempts ?? 1),
});

function normalizeUserInfo(raw: RawUserInfo, asked: string): XAccountReading | { error: string } {
  if (raw.status === 'error') {
    const message = boundedText(raw.msg, 200) ?? '';
    return NOT_FOUND_MESSAGE.test(message) ? { kind: 'NOT_FOUND' } : { error: `provider error: ${message || 'no message'}` };
  }
  const data = raw.data;
  if (!data) return { error: 'success without data' };
  if (data.unavailable === true) {
    const reason = boundedText(data.unavailableReason ?? data.message, 120);
    return /suspend/i.test(`${data.unavailableReason ?? ''} ${data.message ?? ''}`) ? { kind: 'SUSPENDED', ...(reason ? { reason } : {}) } : { kind: 'UNAVAILABLE', ...(reason ? { reason } : {}) };
  }
  if (data.id === null || data.id === undefined || !data.userName) return { error: 'an account without an id or a handle' };
  if (data.userName.toLowerCase() !== asked.toLowerCase()) return { error: `answered for @${boundedText(data.userName, 20)} when @${asked} was asked` };
  if (!HANDLE.test(data.userName)) return { error: 'a handle X would not allow' };
  const entities = data.profile_bio?.entities;
  const expanded = [...(entities?.url?.urls ?? []), ...(entities?.description?.urls ?? [])].map((entry) => entry.expanded_url);
  const displayName = boundedText(data.name, 100);
  const createdAt = parseDate(data.createdAt);
  const verifiedType = boundedText(data.verifiedType, 40);
  return {
    kind: 'ACTIVE',
    userId: idOf(data.id),
    userName: data.userName,
    ...(displayName ? { displayName } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(typeof data.isBlueVerified === 'boolean' ? { isBlueVerified: data.isBlueVerified } : {}),
    ...(verifiedType ? { verifiedType } : {}),
    profileUrls: uniqueUrls([...expanded, data.url], MAX_PROFILE_URLS),
  };
}

const isPostUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /^(www\.)?(x|twitter)\.com$/i.test(parsed.hostname) && /^\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
};

function normalizePost(raw: RawPost, userId: string): XPost | undefined {
  if (raw.retweeted_tweet !== null && raw.retweeted_tweet !== undefined) return undefined;
  if (raw.isReply === true) return undefined;
  if (raw.author?.id !== null && raw.author?.id !== undefined && idOf(raw.author.id) !== userId) return undefined;
  const createdAt = parseDate(raw.createdAt);
  if (!createdAt) return undefined;
  const id = idOf(raw.id);
  const url = raw.url && isPostUrl(raw.url) ? new URL(raw.url).toString() : `https://x.com/i/status/${id}`;
  const expandedUrls = uniqueUrls((raw.entities?.urls ?? []).map((entry) => entry.expanded_url), MAX_POST_URLS);
  return {
    id,
    url,
    createdAt,
    text: boundedText(raw.text, X_POST_TEXT_MAX) ?? '',
    expandedUrls,
    contractAddresses: contractAddressesIn(raw.text, expandedUrls),
  };
}

export function createTwitterApiIoUserInfoAdapter(): SourceAdapter<XUserInfoInput, XAccountReading> {
  return {
    name: 'twitterapi-io:profile',
    canHandle: (input) => input.apiKey.length > 0 && HANDLE.test(input.userName),
    async fetch(input, ctx: SourceContext): Promise<SourceResult<XAccountReading>> {
      if (!this.canHandle(input)) return errorResult(ctx, 'INVALID_RESPONSE', 'not an X handle, or no key; nothing was asked');
      const base = (input.baseUrl ?? TWITTERAPI_IO_BASE_URL).replace(/\/+$/, '');
      const url = `${base}/twitter/user/info?userName=${encodeURIComponent(input.userName)}`;
      const result: SourceResult<XAccountReading | { error: string }> = await performSourceFetch(
        ctx,
        { url, headers: { 'x-api-key': input.apiKey, accept: 'application/json' }, conditional: false, allowedContentTypes: ['application/json'], maxBytes: PROFILE_MAX_BYTES },
        {
          schema: userInfoSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 3_600,
          normalize: (raw, response) => {
            if (!answeredByApi(response, base)) throw wrongHost();
            return normalizeUserInfo(raw, input.userName);
          },
        },
      );
      if (result.data && 'error' in result.data) {
        const { data, ...rest } = result;
        return metered({ ...rest, status: 'error', errorCode: 'INVALID_RESPONSE', errorMessage: data.error }, TWITTERAPI_IO_PROFILE_CREDITS);
      }
      return metered(result as SourceResult<XAccountReading>, TWITTERAPI_IO_PROFILE_CREDITS);
    },
  };
}

export function createTwitterApiIoLastPostsAdapter(): SourceAdapter<XLastPostsInput, XPostsPage> {
  return {
    name: 'twitterapi-io:posts',
    canHandle: (input) => input.apiKey.length > 0 && USER_ID.test(input.userId),
    async fetch(input, ctx: SourceContext): Promise<SourceResult<XPostsPage>> {
      if (!this.canHandle(input)) return errorResult(ctx, 'INVALID_RESPONSE', 'not an X user id, or no key; nothing was asked');
      const base = (input.baseUrl ?? TWITTERAPI_IO_BASE_URL).replace(/\/+$/, '');
      const url = `${base}/twitter/user/last_tweets?userId=${encodeURIComponent(input.userId)}&includeReplies=false`;
      let returned = 0;
      const result: SourceResult<XPostsPage | { error: string }> = await performSourceFetch(
        ctx,
        { url, headers: { 'x-api-key': input.apiKey, accept: 'application/json' }, conditional: false, allowedContentTypes: ['application/json'], maxBytes: POSTS_MAX_BYTES },
        {
          schema: postsSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 3_600,
          normalize: (raw: RawPosts, response) => {
            if (!answeredByApi(response, base)) throw wrongHost();
            if (raw.status === 'error') return { error: `provider error: ${boundedText(raw.msg, 200) || 'no message'}` };
            const page = raw.data?.tweets ?? raw.tweets ?? [];
            returned = page.length;
            const posts: XPost[] = [];
            for (const entry of page) {
              const post = normalizePost(entry, input.userId);
              if (post && !posts.some((kept) => kept.id === post.id)) posts.push(post);
            }
            return { posts, skipped: page.length - posts.length, returned: page.length, hasNextPage: raw.has_next_page === true };
          },
        },
      );
      const cost = Math.max(TWITTERAPI_IO_MIN_CREDITS, returned * TWITTERAPI_IO_POST_CREDITS);
      if (result.data && 'error' in result.data) {
        const { data, ...rest } = result;
        return metered({ ...rest, status: 'error', errorCode: 'INVALID_RESPONSE', errorMessage: data.error }, cost);
      }
      return metered(result as SourceResult<XPostsPage>, cost);
    },
  };
}
