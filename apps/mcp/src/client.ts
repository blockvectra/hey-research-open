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
        headers: { accept: 'application/json', 'user-agent': 'hey-research-mcp/0.1.0', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
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
    if (response.status === 403) {
      // A hold the lab placed on the key or the account (2026-09-18): the body says which and whom to write to.
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new HeyApiError(body.message ?? 'HEY has suspended this API key or its account.', 403);
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
  /** Where the token trades, in words, when a pool reading exists (2026-09-13). */
  venue?: string;
  trades24h?: { buys: number; sells: number; source: string };
  priceChange24hPct?: number;
  /** Whether HEY holds a repository, org, changelog or feed to read building from. */
  hasBuilderSource?: boolean;
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
  /**
   * Whether the token still has a market HEY can read (2026-09-17).
   *
   * An agent reading the market figures without this was shown liquidity and
   * volume for a pool HEY had already classified as removed or abandoned, with
   * nothing saying so. Context on the token, never a verdict on the team.
   */
  tokenMarket?: {
    status: string;
    reason?: string;
    evaluatedAt?: string;
    liquidityUsd?: number;
    volume24hUsd?: number;
    peakLiquidityUsd?: number;
    pairCreatedAt?: string;
  };
  /** Events the token contract emitted, as HEY last read them from the chain. Context only. */
  onchainActivity?: { events24h: number; events7d: number; daysCovered: number; truncated: boolean; observedAt: string };
  /** TVL DefiLlama reports for the project's protocol on this chain. Context only. */
  defiTvl?: { tvlUsd: number; protocol: string; protocolName: string; matchedBy: string; source: string; observedAt: string };
  market?: {
    marketCapUsd?: number;
    fdvUsd?: number;
    liquidityUsd?: number;
    volume24hUsd?: number;
    priceUsd?: number;
    buys24h?: number;
    sells24h?: number;
    priceChange1hPct?: number;
    priceChange6hPct?: number;
    priceChange24hPct?: number;
    venue?: string;
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

/** A research bounty as `/api/bounties` returns it (2026-09-13). Read-only: claiming is a wallet sign-in on the site. */
export type HeyBounty = {
  id: string;
  url: string;
  title: string;
  description: string;
  kind: string;
  scope: string;
  evidence: string;
  status: string;
  taskStatus: string;
  project?: { slug: string; name: string; url: string };
  reward: { hey: string; heyBaseUnits: string; tier?: string; targetUsd?: string; quote?: { priceUsd: string; at: string; source: string } };
  claim: { holdersOnlyUntil?: string; openToAll: boolean; claimed: boolean; claimedBy?: string; expiresAt?: string };
  createdAt: string;
  awardedAt?: string;
};

export type HeyBountyPage = {
  open: boolean;
  summary?: { openBounties: number; committedHey: string; paidHey: string };
  items: HeyBounty[];
  rules: Record<string, string>;
  disclaimer: string;
};


/** `GET /api/projects/{slug}/market` (2026-09-13). */
export type HeyTokenMarket = {
  slug: string;
  name: string;
  symbol?: string;
  token: { chainId: number; contractAddress: string };
  marketStatus: string;
  verification: string;
  current?: { priceUsd?: number; marketCapUsd?: number; liquidityUsd?: number; volume24hUsd?: number; buys24h?: number; sells24h?: number; priceChange24hPct?: number; venue?: string; source: string; observedAt: string };
  days: { day: string; priceCloseUsd?: number; liquidityCloseUsd?: number; volume24hUsd?: number; marketCapCloseUsd?: number; source?: string; trades?: number; buys?: number; sells?: number; buyVolumeUsd?: number; sellVolumeUsd?: number; tradeCloseUsd?: number; transfers?: number }[];
  lifecycle: { launchSeenAt?: string; publishedAt?: string; pairCreatedAt?: string; launchStage?: string; launchStageAt?: string; firstTradeDay?: string; lastTradeDay?: string; peakLiquidityUsd?: number; liquidityBelowPeakPct?: number; priceChange7dPct?: number; priceChange30dPct?: number };
  checks: { key: string; label: string; finding: string; provenance?: string; checkedAt?: string; tone: 'plain' | 'noted' }[];
  onchainDays: { day: string; events: number; truncated: boolean }[];
  tvlDays: { day: string; tvlUsd: number; protocolName: string }[];
  url: string;
};

/** `GET /api/chain` (2026-09-13). */
export type HeyChain = {
  chainId: number;
  days: { day: string; dexTrades?: number; dexVolumeUsd?: number; tokensTraded?: number; poolsTraded?: number; transactions?: number; transfers?: number; launches?: number; projectsPublished?: number; ships?: number; buildersShipping?: number }[];
  today?: string;
  lastFullDay?: string;
  volumeNote: string;
};

/** `GET /api/signals` (2026-09-13). */
export type HeySignal = {
  id: string;
  kind: string;
  group: string;
  label: string;
  meaning: string;
  severity: string;
  confidence: number;
  importance: number;
  observedAt: string;
  title: string;
  summary: string;
  before?: number;
  after?: number;
  changePct?: number;
  unit?: string;
  evidence: { label: string; url?: string; value?: string }[];
  source: string;
  project: { slug: string; name: string; symbol?: string; activityStatus: string; url: string };
  url: string;
};
export type HeySignalPage = { query: Record<string, unknown>; total: number; items: HeySignal[] };

/** `GET /api/builders` (2026-09-13). */
export type HeyBuilder = {
  rank: number;
  rank7d?: number;
  rank30d?: number;
  slug: string;
  name: string;
  symbol?: string;
  activityStatus: string;
  catalogStatus: string;
  launchpad?: string;
  lastShippedAt?: string;
  scores: { overall: number; development: number; onchain: number; research: number };
  liquidityHealth?: number;
  url: string;
};
/** `query` is echoed so a dropped filter can be seen rather than inferred (2026-09-17). */
export type HeyBuildersPage = { query?: Record<string, unknown>; day: string; ranked: number; total: number; method: string; items: HeyBuilder[] };

/** `GET /api/token/{chainId}/{address}` (2026-09-16): one project, by the identity a reader holds. */
export type HeyTokenLookup = {
  chainId: number;
  contractAddress: string;
  status: 'published' | 'unknown';
  project?: {
    slug: string;
    name: string;
    symbol?: string;
    url: string;
    activityStatus: string;
    activityLabel: string;
    activityHelp: string;
    researchLevel?: string;
    shipsLast30Days: number;
    lastShipAt?: string;
    lastShip?: { title: string; publishedAt: string; sourceUrl?: string };
    deployedAt?: string;
    badgeUrl: string;
  };
  scanUrl: string;
  disclaimer: string;
};

/** `GET /api/reports/weekly/{week}` (2026-09-13). */
export type HeyWeeklyReport = {
  week: string;
  window: { start: string; end: string };
  final: boolean;
  headline: string;
  overview: { published: number; verifiedBuilders: number; ships: number; projectsShipping: number; newBuilders: number; backToShipping: number; stillBuilding: number; underTheRadar: number };
  chain: { days: number; dexTrades?: number; dexVolumeUsd?: number; tokensTraded?: number; launches?: number; projectsPublished?: number };
  shipped: { slug: string; name: string; ships: number; latest: string }[];
  newBuilders: { slug: string; name: string }[];
  backToShipping: { slug: string; name: string; from: string; to: string }[];
  topBuilders: { slug: string; name: string; rank: number; overall: number }[];
  movers: { slug: string; name: string; rank: number; rank7d: number; gained: number }[];
  signals: { id: string; kind: string; label: string; title: string; name: string }[];
  url: string;
};
export type HeyWeeklyIndex = { items: { week: string; headline: string; final: boolean; url: string }[] };

/** `GET /api/this-week` (2026-09-05): the weekly rollup, each figure with the window it was counted over. */
/*
 * The shape `GET /api/this-week` actually returns (2026-09-17). The first
 * version of this type was written from memory — `window.start`, a `ships`
 * group — and the renderer threw on the real payload, so the tool answered
 * every call with an error. `fixtures/this-week.json` is a captured response
 * and the tests render it, so the type cannot drift from the API again.
 */
export type HeyThisWeekProject = {
  slug: string;
  name: string;
  symbol?: string;
  activityStatus: string;
  marketCapUsd?: number;
  url: string;
};
export type HeyThisWeekShip = { title: string; eventType: string; publishedAt: string; verification: string; sourceUrl?: string };
export type HeyThisWeek = {
  window: { since: string; until: string; days: number; label: string };
  summary: string;
  shipped: { ships: number; projects: number; items: { project: HeyThisWeekProject; ships: number; latest?: HeyThisWeekShip }[] };
  newBuilders: { total: number; items: { project: HeyThisWeekProject; verifiedAt: string }[] };
  backToShipping: { total: number; comparable?: number; items: { project: HeyThisWeekProject; from: string; to: string; changedAt: string }[] };
  stillBuilding: { total: number; items: HeyThisWeekProject[] };
  underTheRadar?: { total: number; items: HeyThisWeekProject[] };
  links: { page: string; ships: string; radar: string; methodology: string };
  disclaimer: string;
};
