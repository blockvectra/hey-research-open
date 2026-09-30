/**
 * Explorer API addressing (2026-09-12).
 *
 * A Blockscout instance answers at `<instance>/api/v2/...`. The Blockscout PRO
 * API answers the same paths at `https://api.blockscout.com` with the chain
 * selected by `chain_id` and the account by `apikey`, both query parameters.
 * HEY reads only the PRO API, with the key (2026-09-30, the founder's
 * ruling); the instance serves explorer links for people and is never read. The key never appears in
 * a stored URL, a log line or an error: `redactApiKey` strips it wherever a
 * request URL is echoed back.
 */
import { errorResult, type SourceContext, type SourceResult } from '../adapter';

/** Robinhood Chain's public explorer, where people follow a link (2026-09-24: one constant, not a literal per page). */
export const ROBINHOOD_EXPLORER_URL = 'https://robinhoodchain.blockscout.com';

export type ExplorerApi = {
  /** `https://robinhoodchain.blockscout.com` or `https://api.blockscout.com`. */
  baseUrl: string;
  /** Sent as `chain_id` when set (the PRO API needs it; an instance ignores it). */
  chainId?: number | undefined;
  /** Sent as `apikey` when set. */
  apiKey?: string | undefined;
};

export const BLOCKSCOUT_PRO_API_BASE_URL = 'https://api.blockscout.com';

const PRO_ORIGIN = new URL(BLOCKSCOUT_PRO_API_BASE_URL).origin;

/** Whether an API address is Blockscout's own keyed API (and not an instance, whatever it is called). */
export function isBlockscoutProApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).origin === PRO_ORIGIN;
  } catch {
    return false;
  }
}

/** Whether HEY may read through this API: the keyed PRO API, with a key (2026-09-30). */
export const isKeyedExplorerApi = (api: ExplorerApi | undefined): api is ExplorerApi & { apiKey: string } =>
  Boolean(api?.apiKey) && isBlockscoutProApi(api!.baseUrl);

/**
 * What an explorer adapter answers when it is handed anything but the keyed
 * API (2026-09-30): not read, with the reason, and no request sent.
 */
export function explorerNotKeyed<T>(ctx: SourceContext): SourceResult<T> {
  return errorResult<T>(ctx, 'BLOCKED_URL', 'not read: HEY reads the explorer only through the keyed Blockscout API (RH_BLOCKSCOUT_API_KEY), never the instance');
}

/**
 * The key and the chain travel only to Blockscout's own API (2026-09-30).
 * HEY reads the explorer through the keyed PRO API alone — the founder's
 * ruling that day, because the instance sits behind a bot filter HEY must not
 * rely on getting past. An `ExplorerApi` that names any other host never
 * carries the key in its query string, even if one was handed to it by
 * mistake: the instance has no use for it and the URL would be logged there.
 */
export function explorerApiUrl(api: ExplorerApi, path: string, query: Record<string, string | number> = {}): string {
  const base = api.baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  const pro = isBlockscoutProApi(base);
  if (pro && api.chainId !== undefined) params.set('chain_id', String(api.chainId));
  if (pro && api.apiKey) params.set('apikey', api.apiKey);
  const encoded = params.toString();
  return `${base}${path.startsWith('/') ? path : `/${path}`}${encoded ? `?${encoded}` : ''}`;
}

/** The URL with the key replaced, for evidence rows, logs and errors. */
export function redactApiKey(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/([?&]apikey=)[^&#]*/gi, '$1REDACTED');
}

/** Apply the redaction to a source result's echoed URL, whatever else it carries. */
export function redactResultUrl<T extends { sourceUrl?: string; errorMessage?: string }>(result: T): T {
  const sourceUrl = redactApiKey(result.sourceUrl);
  const errorMessage = redactApiKey(result.errorMessage);
  return { ...result, ...(sourceUrl === undefined ? {} : { sourceUrl }), ...(errorMessage === undefined ? {} : { errorMessage }) };
}
