import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_USER_AGENT,
  type FetchLike,
  type RetryPolicy,
  type SourceContext,
} from '../adapter';
import { errorCodeForStatus, SourceError } from '../errors';
import type { Agent } from 'undici';

import { isIpLiteralHost, pinnedDispatcher, withDispatcherClose } from './pinned';
import { assertResolvesPublic, assertSafeUrl, systemLookup } from './url-safety';

/** 5 MB ceiling on any single response body (PRD V4 section 27). */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Redirect cap (PRD V4 section 27). */
export const MAX_REDIRECTS = 5;

export type HttpRequest = {
  url: string;
  headers?: Record<string, string>;
  /** Conditional-request headers are added when the caller has prior validators. */
  conditional?: boolean;
  method?: 'GET' | 'POST';
  body?: string;
  /** Reject responses whose content type is not in this list. */
  allowedContentTypes?: readonly string[];
  /**
   * URL safety tiers:
   * - `true` — builder/user-submitted URL: literal host check plus DNS
   *   resolution before every hop, so a name pointing at a private address is
   *   refused (SSRF via DNS);
   * - `undefined` — configured provider: literal host check only;
   * - `false` — no check.
   */
  enforceUrlSafety?: boolean;
  maxBytes?: number;
};

export type HttpResponse = {
  status: number;
  body: string;
  etag?: string;
  lastModified?: string;
  contentType?: string;
  /** Final URL after redirects, when the runtime exposes it. */
  url?: string;
};

/** `304 Not Modified` — the source is unchanged, so no downstream work is needed. */
export type HttpOutcome = { kind: 'ok'; response: HttpResponse } | { kind: 'not_modified' };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);


const isRedirect = (status: number): boolean => REDIRECT_STATUSES.has(status);

const jitter = (value: number): number => value / 2 + Math.random() * (value / 2);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function backoffDelayMs(attempt: number, policy: RetryPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(exponential, policy.maxDelayMs);
}

const parseRetryAfter = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
};

/**
 * Read a body up to the cap and no further (audit H04, 2026-09-11). The old
 * version called `response.text()` and checked the length afterwards, so a
 * site that lied about `Content-Length` (or sent chunked) was buffered whole
 * before it was refused. Now the stream is counted chunk by chunk and
 * cancelled the moment it passes the cap.
 */
async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SourceError('TOO_LARGE', `response declares ${declared} bytes (cap ${maxBytes})`);
  }

  const body = response.body;
  // A test stub may carry a string body; only a real stream is read chunk by chunk.
  if (!body || typeof (body as { getReader?: unknown }).getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new SourceError('TOO_LARGE', `response exceeded ${maxBytes} bytes`);
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SourceError('TOO_LARGE', `response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))).toString('utf8');
}

/** Headers that carry a secret and must not follow a redirect to another host. */
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization', 'if-none-match', 'if-modified-since']);

async function attemptOnce(
  request: HttpRequest,
  ctx: SourceContext,
  fetchImpl: FetchLike,
): Promise<HttpOutcome> {
  let headers: Record<string, string> = {
    'user-agent': ctx.userAgent ?? DEFAULT_USER_AGENT,
    accept: '*/*',
    ...request.headers,
  };

  if (request.conditional !== false) {
    if (ctx.etag) headers['if-none-match'] = ctx.etag;
    if (ctx.lastModified) headers['if-modified-since'] = ctx.lastModified;
  }

  const timeout = AbortSignal.timeout(ctx.timeoutMs);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;

  let currentUrl = request.url;
  let method = request.method ?? 'GET';
  let body = request.body;
  let response: Response;
  let hops = 0;

  // Redirects are followed manually rather than by the runtime. Letting undici
  // follow them would hide every hop, so a public URL could redirect into a
  // private address and bypass the SSRF guard entirely.
  for (;;) {
    let dispatcher: Agent | undefined;
    if (request.enforceUrlSafety === true) {
      const resolved = await assertResolvesPublic(currentUrl, ctx.lookupImpl ?? systemLookup);
      if (!resolved.ok) throw new SourceError('BLOCKED_URL', resolved.detail);
      // Pin the connection to what was checked; an IP literal needs no pin.
      if (!isIpLiteralHost(currentUrl)) dispatcher = pinnedDispatcher(resolved.addresses);
    }

    try {
      response = await fetchImpl(currentUrl, {
        method,
        headers,
        redirect: 'manual',
        signal,
        ...(body === undefined ? {} : { body }),
        // Node's fetch is undici's: `dispatcher` is honoured, and a test stub ignores it.
        ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {}),
      });
    } catch (error) {
      if (error instanceof SourceError) throw error;
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new SourceError('TIMEOUT', `request to ${currentUrl} timed out`);
      }
      throw new SourceError(
        'NETWORK',
        error instanceof Error ? error.message : `network failure for ${currentUrl}`,
      );
    }

    if (!isRedirect(response.status)) {
      if (dispatcher) response = withDispatcherClose(response, dispatcher);
      break;
    }
    await dispatcher?.close().catch(() => undefined);

    const location = response.headers.get('location');
    if (!location) break; // A 3xx without Location is handled as a normal response.

    hops += 1;
    if (hops > MAX_REDIRECTS) {
      // Not retryable: repeating the request walks the identical chain again.
      throw new SourceError('INVALID_RESPONSE', `exceeded ${MAX_REDIRECTS} redirects`);
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new SourceError('INVALID_RESPONSE', `unusable redirect target: ${location}`);
    }

    // Every hop is re-validated, not just the URL the caller supplied.
    if (request.enforceUrlSafety !== false) {
      const safety = assertSafeUrl(nextUrl);
      if (!safety.ok) {
        throw new SourceError('BLOCKED_URL', `redirect to ${safety.detail}`);
      }
    }

    // Per fetch semantics, 301/302/303 downgrade to GET and drop the body.
    if (response.status !== 307 && response.status !== 308) {
      method = 'GET';
      body = undefined;
    }
    /*
     * Credentials never cross a host (2026-09-17). The header set was built
     * once and replayed on every hop, so a repository, an RPC or a Bitquery
     * endpoint answering with a redirect would have received HEY's bearer at
     * whatever host it named. Dropped for the rest of the chain.
     */
    if (new URL(nextUrl).host !== new URL(currentUrl).host) {
      // A fresh object: the one already handed to fetch stays as it was sent.
      headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())));
    }
    currentUrl = nextUrl;
  }

  if (response.status === 304) return { kind: 'not_modified' };

  if (!response.ok) {
    /*
     * GitHub answers a primary or secondary rate limit with 403, not 429,
     * distinguished only by `Retry-After` or an exhausted `X-RateLimit`
     * window. A 403 that names its own end is a rate limit anywhere; a bare
     * 403 stays what it was.
     */
    const rateLimited403 =
      response.status === 403 &&
      (response.headers.get('retry-after') !== null ||
        response.headers.get('x-ratelimit-remaining') === '0');
    const code = rateLimited403 ? 'RATE_LIMITED' : errorCodeForStatus(response.status);
    throw new SourceError(
      code,
      `${currentUrl} responded ${response.status}`,
      response.status,
      parseRetryAfter(response.headers.get('retry-after')),
    );
  }

  const contentType = response.headers.get('content-type') ?? undefined;
  if (request.allowedContentTypes && contentType) {
    const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!request.allowedContentTypes.some((allowed) => base === allowed)) {
      throw new SourceError('UNSUPPORTED_CONTENT_TYPE', `unexpected content type ${base}`);
    }
  }

  const responseBody = await readBodyCapped(response, request.maxBytes ?? MAX_RESPONSE_BYTES);

  return {
    kind: 'ok',
    response: {
      status: response.status,
      body: responseBody,
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag') as string } : {}),
      ...(response.headers.get('last-modified')
        ? { lastModified: response.headers.get('last-modified') as string }
        : {}),
      ...(contentType === undefined ? {} : { contentType }),
      // The URL we actually ended on, so callers record real provenance.
      url: response.url || currentUrl,
    },
  };
}

/**
 * Perform one source request with timeout, conditional headers, size and
 * content-type limits, and exponential backoff with jitter on transient failures.
 *
 * Throws `SourceError`; adapters convert that into a `SourceResult`.
 */
export async function httpRequest(request: HttpRequest, ctx: SourceContext): Promise<HttpOutcome> {
  if (request.enforceUrlSafety !== false) {
    const safety = assertSafeUrl(request.url);
    if (!safety.ok) throw new SourceError('BLOCKED_URL', safety.detail);
  }

  const fetchImpl = ctx.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) throw new SourceError('NETWORK', 'no fetch implementation available');

  const policy = ctx.retry ?? DEFAULT_RETRY_POLICY;
  const sleep = policy.sleep ?? defaultSleep;

  let lastError: SourceError | undefined;
  for (let attempt = 1; attempt <= Math.max(1, policy.attempts); attempt += 1) {
    try {
      return await attemptOnce(request, ctx, fetchImpl);
    } catch (error) {
      const sourceError =
        error instanceof SourceError
          ? error
          : new SourceError('NETWORK', error instanceof Error ? error.message : 'unknown failure');
      lastError = sourceError;

      const isLast = attempt >= policy.attempts;
      if (!sourceError.retryable || isLast) throw sourceError;

      // Respect a provider-advertised cool-off over our own backoff curve.
      const advertised = sourceError.retryAfterSeconds;
      const delay =
        advertised !== undefined
          ? Math.min(advertised * 1000, policy.maxDelayMs)
          : jitter(backoffDelayMs(attempt, policy));
      await sleep(delay);
    }
  }

  throw lastError ?? new SourceError('NETWORK', 'request failed');
}
