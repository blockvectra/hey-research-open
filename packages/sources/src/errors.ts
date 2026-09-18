/**
 * Normalized error model shared by every source adapter (PRD V4 section 55).
 *
 * Adapters never throw for upstream conditions: they return a `SourceResult` whose
 * status and `errorCode` describe what happened. Degraded mode depends on this —
 * a provider outage must be distinguishable from "the project stopped shipping"
 * (PRD V4 section 50).
 */
export const SOURCE_ERROR_CODES = [
  'TIMEOUT',
  'NETWORK',
  'RATE_LIMITED',
  /**
   * HEY declined to make the request to stay inside a provider's published
   * rate (2026-09-06). Distinct from RATE_LIMITED on purpose: that one is the
   * provider refusing us, and a health view that cannot tell them apart
   * reports our own pacing as a provider problem.
   */
  'PACED',
  'NOT_FOUND',
  'UPSTREAM_ERROR',
  'INVALID_RESPONSE',
  'BLOCKED_URL',
  'TOO_LARGE',
  'UNSUPPORTED_CONTENT_TYPE',
] as const;

export type SourceErrorCode = (typeof SOURCE_ERROR_CODES)[number];

/** Transient conditions are worth retrying; the rest are not. */
const RETRYABLE: ReadonlySet<SourceErrorCode> = new Set<SourceErrorCode>([
  'TIMEOUT',
  'NETWORK',
  'RATE_LIMITED',
  // Retryable by definition: the pace window empties on its own.
  'PACED',
  'UPSTREAM_ERROR',
]);

export function isRetryableErrorCode(code: SourceErrorCode): boolean {
  return RETRYABLE.has(code);
}

/**
 * The subset the HTTP client may retry inside one call (round-8 audit,
 * 2026-09-18). A 429 is retryable in the job sense — the caller's cooldown
 * and `retryAt` own it — but never in-process: the client used to repeat it
 * up to three times with the provider's Retry-After clamped to 4 s, so a
 * "come back in an hour" became three requests in eight seconds, and the
 * budget meter counted one.
 */
const RETRYABLE_IN_PROCESS: ReadonlySet<SourceErrorCode> = new Set<SourceErrorCode>([
  'TIMEOUT',
  'NETWORK',
  'UPSTREAM_ERROR',
]);

export function isRetryableInProcess(code: SourceErrorCode): boolean {
  return RETRYABLE_IN_PROCESS.has(code);
}

/** Internal carrier used between the HTTP layer and adapters. */
/**
 * Strip a credential out of anything that might be shown to a person
 * (2026-09-15).
 *
 * Every adapter already redacted its own result, and one caller did not: the
 * on-chain project claim put a failed explorer request's message straight into
 * the refusal a signed-in reader sees, so a 429 from the explorer would have
 * shown them `…&apikey=<the real key>`. Redacting in the adapters was the
 * right idea in the wrong place — it left the guarantee to whoever wrote the
 * next caller.
 *
 * Doing it in the constructor makes it a property of the error rather than a
 * habit of its callers: a `SourceError` cannot carry a credential in its
 * message, whoever builds it and wherever it is printed.
 */
const SECRET_PARAM = /([?&](?:apikey|api_key|key|token|access_token|auth|password)=)[^&#\s]*/gi;

export function redactSecrets(message: string): string {
  return message.replace(SECRET_PARAM, '$1REDACTED');
}

export class SourceError extends Error {
  /**
   * Provider cool-off in milliseconds, exactly as the `Retry-After` header
   * said it — never clamped. `retryAfterSeconds` is the same figure rounded
   * up, kept for the callers that already read seconds.
   */
  readonly retryAfterMs?: number;

  /**
   * How many requests the HTTP client actually sent before giving up
   * (round-8 audit, 2026-09-18): 1 for anything it did not retry, up to the
   * in-process cap for a 5xx. Telemetry should meter this number, not one
   * per call. Set by the client; absent on an error built elsewhere.
   */
  attempts?: number;

  constructor(
    readonly code: SourceErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
    options: { retryAfterMs?: number; attempts?: number } = {},
  ) {
    super(redactSecrets(message));
    this.name = 'SourceError';
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    else if (retryAfterSeconds !== undefined) this.retryAfterMs = retryAfterSeconds * 1000;
    if (options.attempts !== undefined) this.attempts = options.attempts;
  }

  /** Worth retrying at all — by a later job, a cooldown, or the client itself. */
  get retryable(): boolean {
    return isRetryableErrorCode(this.code);
  }

  /** Worth the HTTP client repeating right now, inside the same call. */
  get retryableInProcess(): boolean {
    return isRetryableInProcess(this.code);
  }
}

/** Map an HTTP status onto the normalized model. */
export function errorCodeForStatus(status: number): SourceErrorCode {
  // 451 (unavailable for legal reasons) is a takedown: gone, for HEY's purposes.
  if (status === 404 || status === 410 || status === 451) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM_ERROR';
  return 'INVALID_RESPONSE';
}
