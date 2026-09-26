import { errorResult, type SourceResult } from '../adapter';

/**
 * Redirect policy for a configured provider (2026-09-27): the answer must come
 * from the host HEY asked. The HTTP client follows redirects and re-checks
 * every hop for private addresses; this narrows it further for the developer
 * footprint adapters, so a provider redirecting a read to some other host
 * yields a refusal rather than a payload HEY would then store as the
 * provider's.
 */
export function keepToProviderHost<T>(result: SourceResult<T>, baseUrl: string): SourceResult<T> {
  if (result.status !== 'fresh' || !result.sourceUrl) return result;
  const ctx = { timeoutMs: 0, now: () => result.fetchedAt };
  let asked: string;
  let answered: string;
  try {
    asked = new URL(baseUrl).host.toLowerCase();
    answered = new URL(result.sourceUrl).host.toLowerCase();
  } catch {
    return errorResult(ctx, 'INVALID_RESPONSE', 'unparseable provider URL', { sourceUrl: result.sourceUrl });
  }
  if (asked === answered) return result;
  return errorResult(ctx, 'BLOCKED_URL', `provider answered from ${answered}, not ${asked}`, { sourceUrl: result.sourceUrl });
}

/**
 * A registry name, version or similar token HEY will put in a provider path
 * or body: 1–`max` characters, no whitespace and no control characters.
 * Everything else about the value is the provider's to reject.
 */
export function printableToken(value: string, max: number): boolean {
  if (value.length < 1 || value.length > max || /\s/.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
