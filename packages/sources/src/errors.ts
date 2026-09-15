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
  constructor(
    readonly code: SourceErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(redactSecrets(message));
    this.name = 'SourceError';
  }

  get retryable(): boolean {
    return isRetryableErrorCode(this.code);
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
