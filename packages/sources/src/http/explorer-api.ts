/**
 * Explorer API addressing (2026-09-12).
 *
 * A Blockscout instance answers at `<instance>/api/v2/...`. The Blockscout PRO
 * API answers the same paths at `https://api.blockscout.com` with the chain
 * selected by `chain_id` and the account by `apikey`, both query parameters.
 * HEY reads the instance until a key is configured, then the PRO API; the
 * instance keeps serving explorer links for people. The key never appears in
 * a stored URL, a log line or an error: `redactApiKey` strips it wherever a
 * request URL is echoed back.
 */
export type ExplorerApi = {
  /** `https://robinhoodchain.blockscout.com` or `https://api.blockscout.com`. */
  baseUrl: string;
  /** Sent as `chain_id` when set (the PRO API needs it; an instance ignores it). */
  chainId?: number | undefined;
  /** Sent as `apikey` when set. */
  apiKey?: string | undefined;
};

export const BLOCKSCOUT_PRO_API_BASE_URL = 'https://api.blockscout.com';

export function explorerApiUrl(api: ExplorerApi, path: string, query: Record<string, string | number> = {}): string {
  const base = api.baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  if (api.chainId !== undefined) params.set('chain_id', String(api.chainId));
  if (api.apiKey) params.set('apikey', api.apiKey);
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
