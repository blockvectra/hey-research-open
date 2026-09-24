import { HeyApiError, errorFromResponse } from './error';
import { itemsOf, nextOffsetPages, totalPages } from './paging';
import type {
  HeyAskAnswer,
  HeyBountiesQuery,
  HeyContractChanges,
  HeyBountyDetail,
  HeyBountyPage,
  HeyBuildersPage,
  HeyBuildersQuery,
  HeyChain,
  HeyPage,
  HeyProject,
  HeyProjectDetail,
  HeyProjectIntelligence,
  HeyProjectsQuery,
  HeyScanCard,
  HeyShip,
  HeyShipsQuery,
  HeySignalDetail,
  HeySignalPage,
  HeySignalsQuery,
  HeyStatus,
  HeyThisWeek,
  HeyTokenLookup,
  HeyTokenMarket,
  HeyWeeklyIndex,
  HeyWeeklyReport,
} from './types';
import { SDK_VERSION } from './version';

/**
 * The HEY client (2026-09-05; a package of its own since 2026-09-19).
 *
 * HEY's public API is the same record its pages render — which projects on
 * Robinhood Chain are still building, what they shipped, and which of them
 * nobody is looking at — and this is that API as typed calls. Anyone can
 * point it at `https://heyresearch.xyz` with no credentials; a key from
 * /account lifts the anonymous rate limit and nothing else.
 *
 * It began as the MCP server's fetch layer and still is: the server bundles
 * it, names itself in `userAgent`, and reads the same routes. Everything
 * here is data HEY already publishes on its own pages — nothing about a
 * wallet, a holder, or what a token might do next, because HEY holds none
 * of that.
 */
export const DEFAULT_BASE_URL = 'https://heyresearch.xyz';

/** Long enough for a cold cache on a small box, short enough that a caller is not left hanging. */
const TIMEOUT_MS = 15_000;

export const USER_AGENT = `hey-research-sdk/${SDK_VERSION}`;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HeyClientOptions = {
  /** Defaults to the public site; point it at a local HEY when developing. */
  baseUrl?: string;
  /** An API key from /account; sent as a bearer token, never logged. */
  apiKey?: string;
  /** The global `fetch` by default. Tests and exotic runtimes pass their own. */
  fetchImpl?: FetchLike;
  /** Milliseconds before a request is abandoned; default 15 000. */
  timeoutMs?: number;
  /**
   * Named first in the user-agent, before `hey-research-sdk/<version>`, so a
   * product built on the SDK is counted as itself in HEY's traffic console
   * rather than as the SDK. Browsers may drop the header; that is fine.
   */
  userAgent?: string;
};

export type QueryParams = Record<string, string | number | boolean | readonly string[] | undefined>;

/** A 3xx, or the opaque stand-in a browser returns for one under `redirect: 'manual'`. */
function isRedirect(response: Response): boolean {
  if (response.type === 'opaqueredirect') return true;
  return response.status >= 300 && response.status < 400;
}

/** The host a `Location` names, resolved against the request URL; a word when there is nothing to read. */
function locationHost(location: string | null, requestUrl: URL): string {
  if (!location) return 'an undisclosed host';
  try {
    return new URL(location, requestUrl).host;
  } catch {
    return 'an unreadable location';
  }
}

/** `has: ['token', 'github']` travels as `has=token,github`, the way the API reads it. */
function encodeParam(value: string | number | boolean | readonly string[]): string | undefined {
  if (Array.isArray(value)) return value.length === 0 ? undefined : value.join(',');
  return String(value);
}

export class HeyClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;
  private readonly userAgent: string;

  constructor(options: HeyClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.apiKey = options.apiKey?.trim() || undefined;
    const prefix = options.userAgent?.trim();
    this.userAgent = prefix ? `${prefix} ${USER_AGENT}` : USER_AGENT;
  }

  /**
   * One GET against the public API. Kept public so a route the typed
   * methods do not cover yet can still be read with the same errors and
   * headers.
   *
   * Undefined and empty parameters are dropped rather than sent blank: HEY
   * ignores what it does not recognise, but an empty `q=` would still read
   * as a query the caller made.
   */
  async get<T>(path: string, params: QueryParams = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      const encoded = encodeParam(value);
      if (encoded !== undefined) url.searchParams.set(key, encoded);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
        /*
         * The key never follows a redirect (round-9 security, 2026-09-19).
         *
         * `fetch` follows up to twenty hops by default and replays the request
         * headers on each one, so a caller pointed at a base URL that answers
         * 302 — a shortener, a stale vanity domain, a proxy someone else
         * controls — handed the bearer token to whatever host the `Location`
         * named, silently. Manual, and a 3xx is an error naming that host:
         * HEY's public API answers every documented route directly, so a
         * redirect is a misconfigured base URL, not a thing to chase.
         */
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          'user-agent': this.userAgent,
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HeyApiError(`HEY at ${this.baseUrl} did not answer within ${this.timeoutMs} ms.`, { code: 'timeout', cause: error });
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new HeyApiError(`Could not reach HEY at ${this.baseUrl}: ${reason}`, { code: 'network', cause: error });
    } finally {
      clearTimeout(timer);
    }

    /*
     * A redirect is a misconfigured base URL, and it is reported as one. The
     * browser fetch hides the target behind an opaque response, so the
     * message says what it can: the host when the header is readable, and
     * otherwise that there was one.
     */
    if (isRedirect(response)) {
      const target = locationHost(response.headers?.get('location') ?? null, url);
      throw new HeyApiError(
        `HEY at ${this.baseUrl} answered with a redirect to ${target}. The SDK does not follow redirects, because the API key travels with the request; point baseUrl at the origin that answers directly.`,
        { code: 'http', status: response.status || undefined },
      );
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      throw errorFromResponse({ status: response.status, body, retryAfter: response.headers?.get('retry-after') ?? null, baseUrl: this.baseUrl });
    }

    return (await response.json()) as T;
  }

  /* ---------------------------------------------------------------- projects */

  readonly projects = {
    /** `GET /api/projects`. */
    list: (query: HeyProjectsQuery = {}): Promise<HeyPage<HeyProject>> => this.get('/api/projects', query),
    /** `GET /api/projects/{slug}`: the dossier. */
    get: (slug: string): Promise<HeyProjectDetail> => this.get(`/api/projects/${encodeURIComponent(slug)}`),
    /** `GET /api/projects/{slug}/market`: HEY's own daily index of the token; `days` 1–400, default 30. */
    market: (slug: string, options: { days?: number } = {}): Promise<HeyTokenMarket> =>
      this.get(`/api/projects/${encodeURIComponent(slug)}/market`, { days: options.days }),
    /** `GET /api/projects/{slug}/intelligence`. */
    intelligence: (slug: string): Promise<HeyProjectIntelligence> => this.get(`/api/projects/${encodeURIComponent(slug)}/intelligence`),
    /** `GET /api/projects/{slug}/ask?q=`: a question matched to the evidence HEY holds, every line tagged. */
    ask: (slug: string, question: string): Promise<HeyAskAnswer> => this.get(`/api/projects/${encodeURIComponent(slug)}/ask`, { q: question }),
    /** Every page, following `nextOffset` from `query.offset`. */
    pages: (query: HeyProjectsQuery = {}): AsyncIterable<HeyPage<HeyProject>> =>
      nextOffsetPages((offset) => this.projects.list({ ...query, offset }), query.offset ?? 0),
    /** Every project across every page. */
    items: (query: HeyProjectsQuery = {}): AsyncIterable<HeyProject> => itemsOf(this.projects.pages(query)),
  };

  readonly ships = {
    /** `GET /api/ships`: a record of ships, not of projects. */
    list: (query: HeyShipsQuery = {}): Promise<HeyPage<HeyShip>> => this.get('/api/ships', query),
    pages: (query: HeyShipsQuery = {}): AsyncIterable<HeyPage<HeyShip>> =>
      nextOffsetPages((offset) => this.ships.list({ ...query, offset }), query.offset ?? 0),
    items: (query: HeyShipsQuery = {}): AsyncIterable<HeyShip> => itemsOf(this.ships.pages(query)),
  };

  /* ------------------------------------------------------------ intelligence */

  readonly signals = {
    /** `GET /api/signals`. */
    list: (query: HeySignalsQuery = {}): Promise<HeySignalPage> => this.get('/api/signals', query),
    /** `GET /api/signals/{id}`. */
    get: (id: string): Promise<HeySignalDetail> => this.get(`/api/signals/${encodeURIComponent(id)}`),
    /** Every page, stepping by what each page held until `total`. */
    pages: (query: HeySignalsQuery = {}): AsyncIterable<HeySignalPage> =>
      totalPages((offset) => this.signals.list({ ...query, offset }), query.offset ?? 0),
  };

  readonly builders = {
    /** `GET /api/builders`: the Builder Radar. */
    list: (query: HeyBuildersQuery = {}): Promise<HeyBuildersPage> => this.get('/api/builders', query),
    pages: (query: HeyBuildersQuery = {}): AsyncIterable<HeyBuildersPage> =>
      totalPages((offset) => this.builders.list({ ...query, offset }), query.offset ?? 0),
  };

  readonly reports = {
    weekly: {
      /** `GET /api/reports/weekly`: the archive index, newest first. */
      list: (): Promise<HeyWeeklyIndex> => this.get('/api/reports/weekly'),
      /** `GET /api/reports/weekly/{week}`, an ISO week such as `2026-W37`. */
      get: (week: string): Promise<HeyWeeklyReport> => this.get(`/api/reports/weekly/${encodeURIComponent(week)}`),
    },
  };

  /* ------------------------------------------------------------------ tokens */

  readonly token = {
    /** `GET /api/token/{chainId}/{address}`: `status: 'unknown'` is an answer, not an error. */
    lookup: (chainId: number, address: string): Promise<HeyTokenLookup> =>
      this.get(`/api/token/${encodeURIComponent(String(chainId))}/${encodeURIComponent(address)}`),
  };

  /** `GET /api/v1/scan?chain=&token=`: the partner card; `found: false` means print nothing. */
  scanCard(chain: number, token: string): Promise<HeyScanCard> {
    return this.get('/api/v1/scan', { chain, token });
  }

  /* ---------------------------------------------------------------- the rest */

  readonly bounties = {
    /** `GET /api/bounties`. Read-only: claiming is a wallet sign-in on the site. */
    list: (query: HeyBountiesQuery = {}): Promise<HeyBountyPage> => this.get('/api/bounties', query),
    /** `GET /api/bounties/{id}`. */
    get: (id: string): Promise<HeyBountyDetail> => this.get(`/api/bounties/${encodeURIComponent(id)}`),
  };

  /** `GET /api/chain/contract-changes`: evidence-backed contract changes; `days` 1–90, default 30. */
  contractChanges(options: { days?: number } = {}): Promise<HeyContractChanges> {
    return this.get('/api/chain/contract-changes', { days: options.days });
  }

  /** `GET /api/chain`: Robinhood Chain day by day; `days` 1–400, default 14. */
  chain(options: { days?: number } = {}): Promise<HeyChain> {
    return this.get('/api/chain', { days: options.days });
  }

  /** `GET /api/this-week`: the weekly rollup. */
  thisWeek(): Promise<HeyThisWeek> {
    return this.get('/api/this-week');
  }

  /** `GET /api/status`: the public status page as JSON. */
  status(): Promise<HeyStatus> {
    return this.get('/api/status');
  }
}
