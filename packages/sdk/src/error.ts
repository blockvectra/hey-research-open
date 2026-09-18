/**
 * One error class for everything that can go wrong talking to HEY (2026-09-19).
 *
 * The API says what happened in its body — `{ error: 'not_found' }`,
 * `{ error: 'quota', message }`, `{ error: 'forbidden', reason }` — and the
 * anonymous rate limiter says it in a sentence with a `retry-after` header.
 * A caller should not have to know which is which, so every failure is
 * mapped to one `code` here, and the sentence HEY sent travels as the
 * message. No retries are made on the caller's behalf: a 429 surfaces with
 * `retryAfterSeconds` and the caller decides.
 */
export type HeyApiErrorCode =
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'quota'
  | 'rate_limited'
  | 'bad_request'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'http';

export type HeyApiErrorOptions = {
  status?: number | undefined;
  code: HeyApiErrorCode;
  /** The API's own word for a refusal (`key_suspended`, `account_suspended`) when it gave one. */
  reason?: string | undefined;
  /** From the `retry-after` header, when HEY sent one. */
  retryAfterSeconds?: number | undefined;
  /** The parsed body, when there was one; never logged by the SDK. */
  body?: unknown;
  cause?: unknown;
};

export class HeyApiError extends Error {
  readonly status: number | undefined;
  readonly code: HeyApiErrorCode;
  readonly reason: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly body: unknown;

  constructor(message: string, options: HeyApiErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HeyApiError';
    this.status = options.status;
    this.code = options.code;
    this.reason = options.reason;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.body = options.body;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * `retry-after` is either seconds or an HTTP date; both come back as whole
 * seconds from now, never negative. Absent or unreadable is undefined.
 */
export function retryAfterSeconds(header: string | null | undefined, now: () => number = Date.now): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now()) / 1000));
}

/**
 * A response HEY answered with a status the caller cannot use, as an error
 * that says what happened. The body is read here, once, so the mapping and
 * the caller see the same thing.
 */
export function errorFromResponse(input: { status: number; body: unknown; retryAfter: string | null; baseUrl: string }): HeyApiError {
  const { status, body } = input;
  const record = isRecord(body) ? body : {};
  const errorWord = text(record.error);
  const message = text(record.message);
  const reason = text(record.reason);
  const retry = retryAfterSeconds(input.retryAfter);
  const common = { status, body, reason, retryAfterSeconds: retry };

  switch (status) {
    case 400:
      return new HeyApiError(message ?? errorWord ?? 'HEY could not read that request.', { ...common, code: 'bad_request' });
    case 401:
      return new HeyApiError(message ?? 'HEY refused the API key.', { ...common, code: 'unauthorized' });
    case 403:
      // A hold the lab placed on the key or the account: the body says which and whom to write to.
      return new HeyApiError(message ?? 'HEY has suspended this API key or its account.', { ...common, code: 'forbidden' });
    case 404:
      return new HeyApiError(message ?? 'HEY has no published record at that address.', { ...common, code: 'not_found' });
    case 429:
      if (errorWord === 'quota') {
        return new HeyApiError(message ?? 'The monthly allowance for this API key is used.', { ...common, code: 'quota' });
      }
      /*
       * The anonymous limiter answers `{ error: <sentence> }` with a
       * `retry-after`; a keyed burst limit answers the same way. Either is
       * temporary, and the message says so even when HEY sent no sentence.
       */
      {
        const sentence = errorWord?.includes(' ') ? errorWord : undefined;
        const wait = retry === undefined ? 'a minute' : `${retry} seconds`;
        return new HeyApiError(message ?? sentence ?? `HEY is rate limiting this client; try again in ${wait}.`, { ...common, code: 'rate_limited' });
      }
    case 503:
      return new HeyApiError(message ?? 'HEY is not available right now; try again shortly.', { ...common, code: 'unavailable' });
    default:
      return new HeyApiError(message ?? `HEY answered ${status}.`, { ...common, code: 'http' });
  }
}
