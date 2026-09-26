import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_USER_AGENT,
  type FetchLike,
  type RetryPolicy,
  type SourceContext,
} from '../adapter';
import { errorCodeForStatus, SourceError } from '../errors';
import type { Agent } from 'undici';

import { isIpLiteralHost, pinnedDispatcher } from './pinned';
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
  /** The `Link` header, for adapters that page (`rel="next"` means more). */
  link?: string;
  /** Final URL after redirects, when the runtime exposes it. */
  url?: string;
  /**
   * Requests actually sent for this response (round-8 audit, 2026-09-18):
   * 1 normally, 2 when a 5xx was retried once. Telemetry meters this, not
   * one per call.
   */
  attempts: number;
};

/** The most times one `httpRequest` call may send a request (a 5xx retried once). */
export const MAX_ATTEMPTS_IN_PROCESS = 2;

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

/** `Retry-After` in milliseconds, exactly as sent: delay-seconds or an HTTP date. */
const parseRetryAfterMs = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
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
    await cancelBody(response);
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

/** Headers that carry a secret. */
const SECRET_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization']);

/** Headers that must not follow a redirect to another host: the secrets, and validators meant for this one. */
const CREDENTIAL_HEADERS = new Set([...SECRET_HEADERS, 'if-none-match', 'if-modified-since']);

/**
 * Let go of a response HEY will not read (2026-09-27, audit G S4/S5). An
 * unread body kept its socket open until garbage collection or the server's
 * own timeout, and closing a pinned dispatcher waited for it — a redirect with
 * a trickling body spent the whole request deadline in `close()`. The body is
 * cancelled first; then the dispatcher is destroyed, which does not wait.
 */
async function cancelBody(response: Response): Promise<void> {
  const body = response.body as { cancel?: () => Promise<void>; locked?: boolean } | null;
  if (body && typeof body.cancel === 'function' && !body.locked) await body.cancel().catch(() => undefined);
}

async function discard(response: Response, dispatcher: Agent | undefined): Promise<void> {
  await cancelBody(response);
  await dispatcher?.destroy().catch(() => undefined);
}

const isAbort = (error: unknown): boolean => {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
};

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
  let dispatcher: Agent | undefined;

  // Redirects are followed manually rather than by the runtime. Letting undici
  // follow them would hide every hop, so a public URL could redirect into a
  // private address and bypass the SSRF guard entirely.
  for (;;) {
    dispatcher = undefined;
    if (request.enforceUrlSafety === true) {
      /*
       * A stranger's URL is read on the scheme's own port (2026-09-27, audit G
       * S10): `https://example.com:6379` passed every check. No production
       * website or source URL names a port, so nothing real is refused.
       */
      if (new URL(currentUrl).port !== '') {
        throw new SourceError('BLOCKED_URL', `${currentUrl} names a port other than the scheme's own`);
      }
      let resolved: Awaited<ReturnType<typeof assertResolvesPublic>>;
      try {
        // Inside the request's deadline (2026-09-27, audit G S7).
        resolved = await assertResolvesPublic(currentUrl, ctx.lookupImpl ?? systemLookup, signal);
      } catch (error) {
        if (isAbort(error)) throw new SourceError('TIMEOUT', `resolving ${currentUrl} timed out`);
        throw error;
      }
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
      await dispatcher?.destroy().catch(() => undefined);
      if (error instanceof SourceError) throw error;
      if (isAbort(error)) {
        throw new SourceError('TIMEOUT', `request to ${currentUrl} timed out`);
      }
      throw new SourceError(
        'NETWORK',
        error instanceof Error ? error.message : `network failure for ${currentUrl}`,
      );
    }

    if (!isRedirect(response.status)) break;

    const location = response.headers.get('location');
    if (!location) break; // A 3xx without Location is handled as a normal response.
    // The redirect's own body is never read: cancelled, not waited for (audit G S4).
    await discard(response, dispatcher);
    dispatcher = undefined;

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
    /*
     * No secret in clear text (2026-09-27, audit G S6). The cross-host rule
     * compares hosts only, so `https://api.x/…` answering with a redirect to
     * `http://api.x/…` would have sent the bearer unencrypted. A downgrade that
     * still carries a secret is refused; one that carries none is followed.
     */
    const downgrade = new URL(currentUrl).protocol === 'https:' && new URL(nextUrl).protocol === 'http:';
    if (downgrade && Object.keys(headers).some((name) => SECRET_HEADERS.has(name.toLowerCase()))) {
      throw new SourceError('BLOCKED_URL', `redirect from ${currentUrl} downgrades to http while carrying credentials`);
    }
    currentUrl = nextUrl;
  }

  // From here the response is either read or discarded, and the pinned dispatcher always released.
  if (response.status === 304) {
    await discard(response, dispatcher);
    return { kind: 'not_modified' };
  }

  if (!response.ok) {
    await discard(response, dispatcher);
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
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    throw new SourceError(
      code,
      `${currentUrl} responded ${response.status}`,
      response.status,
      retryAfterMs === undefined ? undefined : Math.ceil(retryAfterMs / 1000),
      retryAfterMs === undefined ? {} : { retryAfterMs },
    );
  }

  const contentType = response.headers.get('content-type') ?? undefined;
  if (request.allowedContentTypes) {
    /*
     * A missing Content-Type is not a pass (round-8 audit, 2026-09-18): the
     * allow-list exists so a feed or document parser only sees what it was
     * built for, and a response that will not say what it is has not met it.
     */
    if (contentType === undefined) {
      await discard(response, dispatcher);
      throw new SourceError('UNSUPPORTED_CONTENT_TYPE', 'response carries no content type');
    }
    const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!request.allowedContentTypes.some((allowed) => base === allowed)) {
      await discard(response, dispatcher);
      throw new SourceError('UNSUPPORTED_CONTENT_TYPE', `unexpected content type ${base}`);
    }
  }

  let responseBody: string;
  try {
    responseBody = await readBodyCapped(response, request.maxBytes ?? MAX_RESPONSE_BYTES);
  } catch (error) {
    if (isAbort(error)) throw new SourceError('TIMEOUT', `reading ${currentUrl} timed out`);
    throw error;
  } finally {
    // Read to the end or given up on: either way the connection is finished with.
    await dispatcher?.destroy().catch(() => undefined);
  }

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
      ...(response.headers.get('link') ? { link: response.headers.get('link') as string } : {}),
      // The URL we actually ended on, so callers record real provenance.
      url: response.url || currentUrl,
      attempts: 1,
    },
  };
}

/**
 * Perform one source request with timeout, conditional headers, size and
 * content-type limits, and exponential backoff with jitter on transient failures.
 *
 * Throws `SourceError`; adapters convert that into a `SourceResult`.
 *
 * What is retried here, and how often (round-8 audit, 2026-09-18):
 * - a timeout, a network failure or a 5xx: once more, so at most
 *   `MAX_ATTEMPTS_IN_PROCESS` requests per call, whatever the policy asks;
 * - a 429 (or GitHub's rate-limiting 403): never. The error carries the
 *   provider's `Retry-After` unclamped as `retryAfterMs`, and the caller's
 *   cooldown / `retryAt` decides when to come back.
 * Either way the response or the error says how many requests were sent
 * (`attempts`), so the budget meter can count what actually left.
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

  const maxAttempts = Math.min(MAX_ATTEMPTS_IN_PROCESS, Math.max(1, policy.attempts));

  let lastError: SourceError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const outcome = await attemptOnce(request, ctx, fetchImpl);
      return outcome.kind === 'ok' ? { kind: 'ok', response: { ...outcome.response, attempts: attempt } } : outcome;
    } catch (error) {
      const sourceError =
        error instanceof SourceError
          ? error
          : new SourceError('NETWORK', error instanceof Error ? error.message : 'unknown failure');
      sourceError.attempts = attempt;
      lastError = sourceError;

      const isLast = attempt >= maxAttempts;
      const rateLimitedOptIn = policy.retryRateLimited === true && sourceError.code === 'RATE_LIMITED';
      if ((!sourceError.retryableInProcess && !rateLimitedOptIn) || isLast) throw sourceError;

      // An opted-in 429 waits what the provider asked for, not this curve.
      await sleep(rateLimitedOptIn && sourceError.retryAfterMs !== undefined ? sourceError.retryAfterMs : jitter(backoffDelayMs(attempt, policy)));
    }
  }

  throw lastError ?? new SourceError('NETWORK', 'request failed');
}
