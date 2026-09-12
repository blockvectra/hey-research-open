/**
 * The HEY client (2026-09-05).
 *
 * The MCP server talks to HEY over its public API rather than its database.
 * That is the whole reason the API came first: anyone can run this server
 * against `https://heyresearch.xyz` with no credentials, no schema knowledge
 * and no second copy of the query layer — and when the catalogue's rules
 * change, they change in one place.
 *
 * Everything here is data HEY already publishes on its own pages.
 */
export const DEFAULT_BASE_URL = 'https://heyresearch.xyz';

/** Long enough for a cold cache on a small box, short enough that an agent is not left hanging. */
const TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HeyClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** An API key from /account (M13-E); sent as a bearer token, never logged. */
  apiKey?: string;
};

export class HeyApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HeyApiError';
  }
}

export class HeyClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(options: HeyClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.apiKey = options.apiKey?.trim() || undefined;
  }

  /**
   * One GET against the public API.
   *
   * Undefined and empty parameters are dropped rather than sent blank: HEY
   * ignores what it does not recognise, but an empty `q=` would still read as
   * a query the caller made.
   */
  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'hey-research-mcp', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HeyApiError(`Could not reach HEY at ${this.baseUrl}: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      throw new HeyApiError('HEY has no published record at that address.', 404);
    }
    if (response.status === 401) {
      throw new HeyApiError('HEY refused the API key in HEY_API_KEY. Check it on your HEY account page.', 401);
    }
    if (response.status === 429) {
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new HeyApiError(body.error === 'quota' ? (body.message ?? 'The monthly allowance for this API key is used.') : 'HEY is rate limiting this client; try again in a minute.', 429);
    }
    if (!response.ok) {
      throw new HeyApiError(`HEY answered ${response.status}.`, response.status);
    }

    return (await response.json()) as T;
  }
}

/* The shapes the public API returns; see docs/PUBLIC_API.md. */
export type HeyProject = {
  slug: string;
  name: string;
  symbol?: string;
  shortDescription?: string;
  projectKind: string;
  activityStatus: string;
  researchLevel: string;
  catalogStatus: string;
  stillBuilding: boolean;
  lastShippedAt?: string;
  primaryNarrative?: { slug: string; name: string };
  token?: { chainId: number; contractAddress: string };
  launchedVia?: { name: string; url?: string };
  websiteUrl?: string;
  officialX?: { handle: string; url: string };
  marketCap?: { usd: number; source: string };
  /** The same reading's liquidity and 24 h volume (Market Lens, 2026-09-12), with the provider; absent means the source reports none. */
  liquidity?: { usd: number; source: string };
  volume24h?: { usd: number; source: string };
  /** Where the launch stands: on its curve, graduated, or in a DEX pool. */
  launchStage?: 'CURVE' | 'GRADUATED' | 'DEX';
  url: string;
};

export type HeyProjectDetail = HeyProject & {
  longDescription?: string;
  firstSeenAt: string;
  isClaimed: boolean;
  submitted: boolean;
  narratives: { slug: string; name: string; isPrimary: boolean }[];
  sources: { url: string; sourceType: string; isVerified: boolean; confidence: string; contextOnly?: boolean; contextReason?: string }[];
  /** Whether the project stands behind the tracked contract (2026-09-11): VERIFIED, UNVERIFIED or MISMATCH. */
  tokenVerification?: { status: string; reason?: string };
  /** Events the token contract emitted, as HEY last read them from the chain. Context only. */
  onchainActivity?: { events24h: number; events7d: number; daysCovered: number; truncated: boolean; observedAt: string };
  /** TVL DefiLlama reports for the project's protocol on this chain. Context only. */
  defiTvl?: { tvlUsd: number; protocol: string; protocolName: string; matchedBy: string; source: string; observedAt: string };
  market?: {
    marketCapUsd?: number;
    fdvUsd?: number;
    liquidityUsd?: number;
    volume24hUsd?: number;
    observedAt: string;
    source: string;
  };
  score?: {
    buildMomentum?: number;
    discoveryGap?: number;
    stillBuilding: boolean;
    calculatedAt: string;
    scoringVersion: string;
  };
  disclaimer: string;
};

export type HeyShip = {
  id: string;
  title: string;
  summary?: string;
  eventType: string;
  publishedAt: string;
  verification: string;
  sourceUrl?: string;
  project: HeyProject;
  url: string;
};

export type HeyPage<T> = {
  query: Record<string, string | number>;
  total: number;
  nextOffset?: number;
  items: T[];
  /** Denominators the route adds when a market field was asked for (Market Lens, 2026-09-12). */
  catalogue?: { marketCoverage?: { base: number; marketCap: number; liquidity: number; volume24h: number; liveMarket: number; activeMarket: number; verifiedToken: number; github: number } };
  disclaimer: string;
};
