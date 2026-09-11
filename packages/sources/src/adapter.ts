import type { AddressLookup } from './http/url-safety';
import type { SourceErrorCode } from './errors';

/**
 * Source adapter contract (PRD V4 section 55).
 *
 * Adapters are the only place HEY talks to third parties. They are replaceable by
 * design (CLAUDE.md rule 18), never called from a page render path (rule 14), and
 * every one of them ships with saved fixtures so CI needs no live provider (rule 16).
 */

export type SourceStatus = 'fresh' | 'not_modified' | 'missing' | 'rate_limited' | 'error';

export type SourceResult<T> = {
  data?: T;
  fetchedAt: Date;
  sourceUrl?: string;
  etag?: string;
  lastModified?: string;
  /** How long a caller may reuse this result before refetching. */
  cacheTtlSeconds: number;
  status: SourceStatus;
  errorCode?: SourceErrorCode;
  /** Human-readable detail for logs and the admin source-health view. */
  errorMessage?: string;
  /** Provider-advertised cool-off, from `Retry-After` on a 429. */
  retryAfterSeconds?: number;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RetryPolicy = {
  /** Total attempts including the first. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
};

export type SourceContext = {
  /** Conditional-request hints from the previous fetch of the same source. */
  etag?: string;
  lastModified?: string;
  /** Hard ceiling for a single outbound request. */
  timeoutMs: number;
  signal?: AbortSignal;
  /** Injected in tests so no adapter test touches the network. */
  fetchImpl?: FetchLike;
  /** Injected so `fetchedAt` is deterministic in tests. */
  now?: () => Date;
  retry?: RetryPolicy;
  /** Sent so operators can identify HEY traffic (PRD V4 section 27). */
  userAgent?: string;
  /**
   * DNS resolver used by the strict SSRF check on submitted URLs
   * (`enforceUrlSafety: true`). Injected in tests so no test resolves a name.
   */
  lookupImpl?: AddressLookup;
};

export interface SourceAdapter<TInput, TOutput> {
  readonly name: string;
  canHandle(input: TInput): boolean;
  fetch(input: TInput, ctx: SourceContext): Promise<SourceResult<TOutput>>;
}

export const DEFAULT_SOURCE_TIMEOUT_MS = 10_000;

export const DEFAULT_USER_AGENT =
  'HEYResearchBot/0.1 (+https://heyresearch.xyz; builder discovery for Robinhood Chain)';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
};

/** A source result is usable as project data only when it carries a payload. */
export function hasData<T>(result: SourceResult<T>): result is SourceResult<T> & { data: T } {
  return result.status === 'fresh' && result.data !== undefined;
}

/**
 * Degraded-mode helper (PRD V4 section 50): a failed or rate-limited fetch must
 * never be mistaken for "the project stopped building". Callers keep the previous
 * value and mark the source stale instead.
 */
export function shouldRetainPreviousData(result: SourceResult<unknown>): boolean {
  return result.status !== 'fresh';
}

export function resolveNow(ctx: SourceContext): Date {
  return ctx.now?.() ?? new Date();
}

/** Build a failure result without throwing, preserving provenance fields. */
export function errorResult<T>(
  ctx: SourceContext,
  code: SourceErrorCode,
  message: string,
  options: { sourceUrl?: string; retryAfterSeconds?: number; cacheTtlSeconds?: number } = {},
): SourceResult<T> {
  return {
    fetchedAt: resolveNow(ctx),
    cacheTtlSeconds: options.cacheTtlSeconds ?? 0,
    // PACED is a throttle like RATE_LIMITED: the caller should wait, not treat
    // it as the source having failed.
    status:
      code === 'RATE_LIMITED' || code === 'PACED'
        ? 'rate_limited'
        : code === 'NOT_FOUND'
          ? 'missing'
          : 'error',
    errorCode: code,
    errorMessage: message,
    ...(options.sourceUrl === undefined ? {} : { sourceUrl: options.sourceUrl }),
    ...(options.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: options.retryAfterSeconds }),
  };
}

/**
 * Narrow a result whose normalizer may legitimately produce nothing.
 *
 * A provider answering correctly with "no coverage for this token" is `missing`,
 * not an error — and not a value the caller should have to null-check. Written as
 * a real narrowing rather than a cast so the absence is handled, not asserted away.
 */
export function requireData<T>(
  result: SourceResult<T | undefined>,
  ctx: SourceContext,
  message: string,
  options: { sourceUrl?: string; cacheTtlSeconds?: number } = {},
): SourceResult<T> {
  if (result.status === 'fresh' && result.data === undefined) {
    return errorResult<T>(ctx, 'NOT_FOUND', message, options);
  }
  const { data, ...rest } = result;
  return data === undefined ? rest : { ...rest, data };
}
