/**
 * What a provider says is left of its own allowance, read from the headers of
 * a response HEY already received (provider capacity advisor, 2026-10-11).
 *
 * Two families only, each a number and nothing else:
 *
 *   x-credits-remaining           Blockscout: credits left in the plan's day
 *   x-ratelimit-remaining/-limit  GitHub (and any API that sends the same
 *   x-ratelimit-reset/-resource   names): requests left in the current
 *                                 window, the window's size, when it resets
 *                                 (epoch seconds) and which pool it is
 *
 * No other header is read, no value is kept that is not a bare integer (or a
 * short lowercase pool name), and nothing here sees the request's URL or its
 * headers — a key in a query string or a bearer never reaches this reading.
 */
export type ProviderQuotaReading = {
  /** `credits` for Blockscout's plan; `requests` for a rate-limit window. */
  unit: 'credits' | 'requests';
  /** What the provider says is left, as it said it. */
  remaining: number;
  /** The window's size, when the provider says it. */
  limit?: number;
  /** When the window resets, when the provider says it as epoch seconds. */
  resetAt?: Date;
  /** GitHub's pool name (`core`, `search`, `code_search`, `graphql`), when sent. */
  resource?: string;
};

/** The largest value a column can hold; anything larger is not a quota HEY believes. */
const MAX_QUOTA = 2_147_483_647;

const integerHeader = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed <= MAX_QUOTA ? parsed : undefined;
};

/** Epoch seconds between 2001 and 2286 only; a header that counts seconds from now is not guessed at. */
const epochSecondsHeader = (value: string | null): Date | undefined => {
  const seconds = integerHeader(value);
  if (seconds === undefined || seconds < 1_000_000_000) return undefined;
  return new Date(seconds * 1000);
};

const resourceHeader = (value: string | null): string | undefined => {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && /^[a-z_]{1,32}$/.test(trimmed) ? trimmed : undefined;
};

/** The provider's own remaining quota from a response's headers, or undefined when it sent none. */
export function readQuotaHeaders(headers: Pick<Headers, 'get'> | undefined | null): ProviderQuotaReading | undefined {
  if (!headers || typeof headers.get !== 'function') return undefined;
  const credits = integerHeader(headers.get('x-credits-remaining'));
  if (credits !== undefined) return { unit: 'credits', remaining: credits };
  const remaining = integerHeader(headers.get('x-ratelimit-remaining'));
  if (remaining === undefined) return undefined;
  const limit = integerHeader(headers.get('x-ratelimit-limit'));
  const resetAt = epochSecondsHeader(headers.get('x-ratelimit-reset'));
  const resource = resourceHeader(headers.get('x-ratelimit-resource'));
  return {
    unit: 'requests',
    remaining,
    ...(limit === undefined ? {} : { limit }),
    ...(resetAt === undefined ? {} : { resetAt }),
    ...(resource === undefined ? {} : { resource }),
  };
}
