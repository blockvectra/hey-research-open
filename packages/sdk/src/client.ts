import { HeyApiError, errorFromResponse } from './error';
import { cursorPages, itemsOf, nextOffsetPages, totalPages } from './paging';
import type { HeyChangeEvent, HeyChangesPage, HeyChangesQuery } from './types/changes';
import type {
  HeyAccelerating,
  HeyBuildMarket,
  HeyChain,
  HeyComebacks,
  HeyContractChanges,
  HeyMarketIntegrity,
  HeyMarketMoves,
  HeySignalDetail,
  HeySignalPage,
  HeySignalsQuery,
  HeySilentBuilders,
  HeyThisWeek,
  HeyTimeline,
  HeyUnlocks,
} from './types/feeds';
import type {
  HeyAskAnswer,
  HeyBountiesQuery,
  HeyBountyDetail,
  HeyBountyPage,
  HeyBuildersPage,
  HeyBuildersQuery,
  HeyCompare,
  HeyStatus,
  HeyWeeklyIndex,
  HeyWeeklyReport,
} from './types/misc';
import type {
  HeyPage,
  HeyProject,
  HeyProjectDetail,
  HeyProjectIntelligence,
  HeyProjectsQuery,
  HeyScanCard,
  HeyShip,
  HeyShipsQuery,
  HeyTokenLookup,
  HeyTokenMarket,
} from './types/projects';
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

/** A change query in the API's spelling: lists travel comma-joined. */
function changeParams(query: HeyChangesQuery): QueryParams {
  const list = (value: string | readonly string[] | undefined) => (value === undefined ? undefined : typeof value === 'string' ? value : value.join(','));
  return {
    project: query.project,
    contract: query.contract,
    domain: list(query.domain),
    type: list(query.type),
    since: query.since,
    until: query.until,
    detectedSince: query.detectedSince,
    after: query.after,
    before: query.before,
    limit: query.limit,
  };
}

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

/** The redirect's target when it stays on the request's origin and under `/api/`; undefined for anything else. */
function sameOriginApiRedirect(response: Response, requestUrl: URL): URL | undefined {
  if (response.type === 'opaqueredirect') return undefined;
  const location = response.headers?.get('location');
  if (!location) return undefined;
  try {
    const target = new URL(location, requestUrl);
    return target.origin === requestUrl.origin && target.pathname.startsWith('/api/') ? target : undefined;
  } catch {
    return undefined;
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

    let response = await this.fetchOnce(url);
    /*
     * One redirect, and only to HEY's own API (2026-09-26, M2 G5). A renamed
     * project's old slug answers `308` to its new API path, and refusing
     * every redirect failed 1,124 published projects' old slugs with a
     * message blaming the base URL. A 3xx to the same origin, under `/api/`,
     * is followed once with the key; anything else — another host, a page, a
     * second hop, a browser's opaque redirect — is still the error below, and
     * the key is never sent to where it pointed.
     */
    const target = isRedirect(response) ? sameOriginApiRedirect(response, url) : undefined;
    if (target) response = await this.fetchOnce(target);

    /*
     * A redirect is a misconfigured base URL, and it is reported as one. The
     * browser fetch hides the target behind an opaque response, so the
     * message says what it can: the host when the header is readable, and
     * otherwise that there was one.
     */
    if (isRedirect(response)) {
      const host = locationHost(response.headers?.get('location') ?? null, target ?? url);
      throw new HeyApiError(
        `HEY at ${this.baseUrl} answered with a redirect to ${host}. The SDK follows one redirect to HEY's own API and no other, because the API key travels with the request; point baseUrl at the origin that answers directly.`,
        { code: 'http', status: response.status || undefined },
      );
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      throw errorFromResponse({ status: response.status, body, retryAfter: response.headers?.get('retry-after') ?? null, baseUrl: this.baseUrl });
    }

    return (await response.json()) as T;
  }

  /** One request, never following a redirect itself. */
  private async fetchOnce(url: URL): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url.toString(), {
        signal: controller.signal,
        /*
         * The key never follows a redirect by itself (round-9 security,
         * 2026-09-19). `fetch` follows up to twenty hops by default and
         * replays the request headers on each one, so a caller pointed at a
         * base URL that answers 302 handed the bearer token to whatever host
         * the `Location` named, silently. Manual; `get` decides.
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
    /**
     * `GET /api/projects/{slug}/timeline?lens=&limit=&before=`: every kind of
     * evidence on one axis, newest first, with `totals`, `truncated` and a
     * `nextCursor` to pass as `before`.
     */
    timeline: (slug: string, options: { lens?: string; limit?: number; before?: string } = {}): Promise<HeyTimeline> =>
      this.get(`/api/projects/${encodeURIComponent(slug)}/timeline`, { lens: options.lens, limit: options.limit, before: options.before }),
    /** Every page of a project's timeline, older and older, until `nextCursor` is null. */
    timelinePages: (slug: string, options: { lens?: string; limit?: number } = {}): AsyncIterable<HeyTimeline> =>
      cursorPages((before) => this.projects.timeline(slug, { ...options, ...(before ? { before } : {}) })),
    /** `GET /api/projects/{slug}/market-integrity`: the tracked token market beside the builder activity, and their conflicts (404 until published). */
    marketIntegrity: (slug: string): Promise<HeyMarketIntegrity> => this.get(`/api/projects/${encodeURIComponent(slug)}/market-integrity`),
    /** `GET /api/projects/{slug}/market-moves?days=&min=`: day-on-day market moves with what shipped in the week up to each — a sequence, never a cause. */
    marketMoves: (slug: string, options: { days?: number; min?: number } = {}): Promise<HeyMarketMoves> =>
      this.get(`/api/projects/${encodeURIComponent(slug)}/market-moves`, { days: options.days, min: options.min }),
    /** `GET /api/compare?slugs=`: two to four projects side by side, no winner. */
    compare: (slugs: readonly string[]): Promise<HeyCompare> => this.get('/api/compare', { slugs: slugs.join(',') }),
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

  /* ------------------------------------------------------------- changes */

  /**
   * The change ledger (`GET /api/changes`, 2026-09-26): one canonical event
   * per meaningful change HEY recorded.
   *
   * `sync` is the mirroring contract: start from `'c1.0'` (or a cursor you
   * kept), apply each page in order — an upsert replaces your copy of its id
   * when its `revision` is higher, a retract deletes it — and keep the page's
   * `nextCursor` once applied. It ends at the head; call it again later with
   * the kept cursor. Nothing is missed: a fact HEY published late gets a new
   * position after your cursor.
   */
  readonly changes = {
    /** One page. With `after` it syncs forward; with `before`, or no cursor, it browses newest first. */
    list: (query: HeyChangesQuery = {}): Promise<HeyChangesPage> => this.get('/api/changes', changeParams(query)),
    /** Browse every page, newest first, following `nextCursor` as `before`. */
    pages: (query: Omit<HeyChangesQuery, 'after' | 'detectedSince'> = {}): AsyncIterable<HeyChangesPage> =>
      cursorPages((before) => this.changes.list({ ...query, ...(before ? { before } : {}) }), query.before),
    /** Every event, newest first. */
    items: (query: Omit<HeyChangesQuery, 'after' | 'detectedSince'> = {}): AsyncIterable<HeyChangeEvent> => itemsOf(this.changes.pages(query)),
    /** Sync forward from `cursor` (default the start, `c1.0`) to the head, page by page. */
    sync: (cursor = 'c1.0', query: Omit<HeyChangesQuery, 'after' | 'before' | 'detectedSince'> = {}): AsyncIterable<HeyChangesPage> =>
      cursorPages((after) => this.changes.list({ ...query, after: after ?? cursor }), cursor),
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

  /** `GET /api/chain/accelerating`: builders whose meaningful shipping is accelerating, by the project page's own rule. */
  accelerating(): Promise<HeyAccelerating> {
    return this.get('/api/chain/accelerating');
  }

  /** `GET /api/chain/silence`: building with comparatively little market attention. */
  silence(): Promise<HeySilentBuilders> {
    return this.get('/api/chain/silence');
  }

  /** `GET /api/chain/comebacks`: projects whose status is RESUMED. */
  comebacks(): Promise<HeyComebacks> {
    return this.get('/api/chain/comebacks');
  }

  /** `GET /api/chain/unlocks`: HoodLock's scheduled unlocks; `days` 1–365, default 30. */
  unlocks(options: { days?: number } = {}): Promise<HeyUnlocks> {
    return this.get('/api/chain/unlocks', { days: options.days });
  }

  /** `GET /api/chain/build-market`: Build Momentum against market attention, a map. */
  buildMarket(): Promise<HeyBuildMarket> {
    return this.get('/api/chain/build-market');
  }

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
