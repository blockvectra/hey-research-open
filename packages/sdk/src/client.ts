import { HeyApiError, errorFromResponse } from './error';
import { cursorPages, itemsOf, nextOffsetPages, totalPages } from './paging';
import type { HeyChangeEvent, HeyChangesPage, HeyChangesQuery } from './types/changes';
import type {
  HeyContract,
  HeyDiff,
  HeyHistory,
  HeyHistoryQuery,
  HeyProjectContracts,
  HeyScanBulk,
  HeySnapshotsBulk,
  HeyTokenLookupBulk,
} from './types/contracts';
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
  HeyBuilderCard,
  HeyBuildersPage,
  HeyBuildersQuery,
  HeyCompare,
  HeySearchSuggestions,
  HeyStatus,
  HeyWeeklyIndex,
  HeyWeeklyReport,
} from './types/misc';
import type { HeyTokenProfile } from './types/hey';
import type { HeyAgentCapability, HeyAgentCatalogue, HeyAgentQuery, HeyAgentResponseOf } from './types/agent';
import type { HeyEvidenceReceipt, HeyExplainedFact, HeyExplainFact, HeyExplainIndex, HeyProjectCoverage, HeyProjectSnapshot } from './types/snapshot';
import type { HeyProjectUsage } from './types/usage';
import type { HeyProjectBuiltOn, HeyProjectRelationships } from './types/graph';
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
import type { HeyV4HookDetail, HeyV4Hooks, HeyV4HooksQuery } from './types/v4-hooks';
import { SDK_VERSION } from './version';

/**
 * The HEY client (2026-09-05; a package of its own since 2026-09-19).
 *
 * HEY's public API is the same record its pages render — which projects on
 * Robinhood Chain are still building, what they shipped, and which of them
 * nobody is looking at — and this is that API as typed calls. Anyone can
 * point it at `https://heyresearch.xyz` with no credentials. A key from
 * /account names the integration, gives it its own per-minute bucket and the
 * bulk reads, and carries a monthly allowance; a free key keeps the anonymous
 * per-minute figure (2026-10-12, AG-1: this said it "lifts the anonymous rate
 * limit", which a free key never did).
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
  /**
   * Your integration's name, optionally with its version — `my-bot` or
   * `my-bot/1.4.0` (2026-09-30): sent as `x-hey-integration` so HEY's partner
   * console can count your calls by version, and used as `utm_source` on the
   * `project_link` the partner cards return. Lower-case letters, digits,
   * `.`, `_` and `-`; anything else is ignored by the server. Optional.
   */
  integration?: string;
  /**
   * What the client does about a temporary rate limit (2026-10-18, persona
   * audit PB-31). By default the walks — `pages()`, `items()`, `sync()` —
   * wait out a 429 by its `retry-after` and pace their pages by the budget
   * HEY states (`RateLimit-*`); a single call still throws at once.
   */
  rateLimit?: HeyRateLimitOptions;
  /** How the client waits; `setTimeout` by default. Tests pass their own. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Waiting out a rate limit (2026-10-18, persona audit PB-31): 94% of the
 * SDK's requests were refused, nearly all of them 429s from walks that asked
 * for the next page the moment the last one arrived. A monthly `quota` is
 * never waited for: it lasts until the month resets.
 */
export type HeyRateLimitOptions = {
  /** `walks` (the default): the walks wait and pace; `always`: every call waits; `never`: nothing waits, as before 0.3.3. */
  wait?: 'walks' | 'always' | 'never';
  /** Waits per request before the 429 is thrown; default 3. */
  maxRetries?: number;
  /** The longest single wait, in seconds; a `retry-after` beyond it throws at once. Default 60. */
  maxWaitSeconds?: number;
};

/** The per-minute budget HEY stated on its last answer (`RateLimit-Limit`, `RateLimit-Policy`, `RateLimit-Remaining`). */
type StatedBudget = { limit: number; windowSeconds: number; remaining: number | undefined };

/** Without a stated budget, a walk paces by the anonymous policy: 120 a minute. */
const FALLBACK_PAGE_INTERVAL_MS = 500;

/** Above this share of the bucket left, a walk does not pace at all. */
const PACE_BELOW_SHARE = 0.1;

/** The budget a response states; undefined when it states none. */
function statedBudget(headers: Headers | undefined): StatedBudget | undefined {
  const limit = Number(headers?.get('ratelimit-limit'));
  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  const window = /;\s*w=(\d+)/.exec(headers?.get('ratelimit-policy') ?? '');
  const remaining = headers?.get('ratelimit-remaining');
  return {
    limit,
    windowSeconds: window ? Number(window[1]) : 60,
    remaining: typeof remaining === 'string' && /^\d+$/.test(remaining) ? Number(remaining) : undefined,
  };
}

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
    cursor: query.cursor,
    limit: query.limit,
  };
}

/** A 3xx, or the opaque stand-in a browser returns for one under `redirect: 'manual'`. */
/**
 * One value as one path segment (2026-10-25): always percent-encoded, so a `/`, `?` or `#` inside it stays
 * inside the segment.
 */
function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Whether a path holds a dot-segment (2026-10-25): `.` or `..`, or either spelt with `%2e`, which a URL
 * resolves as a step through the path rather than a name. `encodeURIComponent` leaves a bare `.` as it is,
 * so the SDK refuses such a path before anything is sent: every read goes to the route its method names.
 */
export function hasDotSegment(path: string): boolean {
  const bare = path.split(/[?#]/, 1)[0] ?? '';
  return bare.split('/').some((part) => {
    const plain = part.replace(/%2e/gi, '.');
    return plain === '.' || plain === '..';
  });
}

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
  private readonly integration: string | undefined;
  private readonly wait: 'walks' | 'always' | 'never';
  private readonly maxRetries: number;
  private readonly maxWaitSeconds: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private budget: StatedBudget | undefined;
  private lastRequestAt = 0;

  constructor(options: HeyClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.apiKey = options.apiKey?.trim() || undefined;
    const prefix = options.userAgent?.trim();
    this.userAgent = prefix ? `${prefix} ${USER_AGENT}` : USER_AGENT;
    this.integration = options.integration?.trim() || undefined;
    this.wait = options.rateLimit?.wait ?? 'walks';
    this.maxRetries = Math.max(0, Math.floor(options.rateLimit?.maxRetries ?? 3));
    this.maxWaitSeconds = Math.max(0, options.rateLimit?.maxWaitSeconds ?? 60);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * A call, again after each temporary rate limit (`rate_limited`, never a
   * monthly `quota`), at most `maxRetries` times, each wait the `retry-after`
   * HEY sent (one second when it sent none). A wait longer than
   * `maxWaitSeconds` is not waited: the error is thrown at once.
   */
  private async patiently<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof HeyApiError) || error.code !== 'rate_limited' || attempt >= this.maxRetries) throw error;
        const seconds = error.retryAfterSeconds ?? 1;
        if (seconds > this.maxWaitSeconds) throw error;
        await this.sleep(seconds * 1000);
      }
    }
  }

  /**
   * One step of a walk: after its first page, paced by the budget HEY stated
   * (none while more than a tenth of the bucket is left; else the policy's
   * interval, 500 ms at 120 a minute), and patient with a rate limit unless
   * `wait` is `never`.
   */
  private walker(): <T>(call: () => Promise<T>) => Promise<T> {
    let first = true;
    return async <T>(call: () => Promise<T>): Promise<T> => {
      if (this.wait === 'never') return call();
      if (!first) {
        const interval = this.pageInterval();
        const waited = Date.now() - this.lastRequestAt;
        if (interval > waited) await this.sleep(interval - waited);
      }
      first = false;
      // Under `always`, `get` is already patient: one set of retries, never one inside another.
      return this.wait === 'always' ? call() : this.patiently(call);
    };
  }

  /** Milliseconds between a walk's pages: none with budget to spare, else the stated policy's interval. */
  private pageInterval(): number {
    const budget = this.budget;
    if (!budget) return FALLBACK_PAGE_INTERVAL_MS;
    if (budget.remaining !== undefined && budget.remaining > budget.limit * PACE_BELOW_SHARE) return 0;
    return Math.ceil((budget.windowSeconds * 1000) / budget.limit);
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
    return this.wait === 'always' ? this.patiently(() => this.request<T>(path, params)) : this.request<T>(path, params);
  }

  private async request<T>(path: string, params: QueryParams): Promise<T> {
    if (hasDotSegment(path)) {
      throw new HeyApiError('A path segment cannot be "." or "..": pass a project slug, id or address as it is.', { code: 'bad_request' });
    }
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
      throw errorFromResponse({
        status: response.status,
        body,
        retryAfter: response.headers?.get('retry-after') ?? null,
        baseUrl: this.baseUrl,
        requestId: response.headers?.get('x-request-id') ?? null,
      });
    }

    // The budget HEY stated, for the walks' pacing; an answer that states none keeps the last one.
    this.budget = statedBudget(response.headers) ?? this.budget;
    return (await response.json()) as T;
  }

  /** One request, never following a redirect itself. */
  private async fetchOnce(url: URL): Promise<Response> {
    this.lastRequestAt = Date.now();
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
          ...(this.integration ? { 'x-hey-integration': this.integration } : {}),
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
    get: (slug: string): Promise<HeyProjectDetail> => this.get(`/api/projects/${pathSegment(slug)}`),
    /** `GET /api/projects/{slug}/market`: HEY's own daily index of the token; `days` 1–400, default 30. */
    market: (slug: string, options: { days?: number } = {}): Promise<HeyTokenMarket> =>
      this.get(`/api/projects/${pathSegment(slug)}/market`, { days: options.days }),
    /** `GET /api/projects/{slug}/intelligence`. */
    intelligence: (slug: string): Promise<HeyProjectIntelligence> => this.get(`/api/projects/${pathSegment(slug)}/intelligence`),
    /** `GET /api/projects/{slug}/ask?q=`: a question matched to the evidence HEY holds, every line tagged. */
    ask: (slug: string, question: string): Promise<HeyAskAnswer> => this.get(`/api/projects/${pathSegment(slug)}/ask`, { q: question }),
    /**
     * `GET /api/projects/{slug}/timeline?lens=&limit=&before=`: every kind of
     * evidence on one axis, newest first, with `totals`, `truncated` and a
     * `nextCursor` to pass as `before`.
     */
    timeline: (slug: string, options: { lens?: string; limit?: number; before?: string } = {}): Promise<HeyTimeline> =>
      this.get(`/api/projects/${pathSegment(slug)}/timeline`, { lens: options.lens, limit: options.limit, before: options.before }),
    /** Every page of a project's timeline, older and older, until `nextCursor` is null. */
    timelinePages: (slug: string, options: { lens?: string; limit?: number } = {}): AsyncIterable<HeyTimeline> =>
      ((step) => cursorPages((before) => step(() => this.projects.timeline(slug, { ...options, ...(before ? { before } : {}) }))))(this.walker()),
    /** `GET /api/projects/{slug}/market-integrity`: the tracked token market beside the builder activity, and their conflicts (404 until published). */
    marketIntegrity: (slug: string): Promise<HeyMarketIntegrity> => this.get(`/api/projects/${pathSegment(slug)}/market-integrity`),
    /** `GET /api/projects/{slug}/market-moves?days=&min=`: day-on-day market moves with what shipped in the week up to each — a sequence, never a cause. */
    marketMoves: (slug: string, options: { days?: number; min?: number } = {}): Promise<HeyMarketMoves> =>
      this.get(`/api/projects/${pathSegment(slug)}/market-moves`, { days: options.days, min: options.min }),
    /** `GET /api/compare?slugs=`: two to four projects side by side, no winner. */
    compare: (slugs: readonly string[]): Promise<HeyCompare> => this.get('/api/compare', { slugs: slugs.join(',') }),
    /**
     * `GET /api/projects/{slug}/snapshot` (2026-09-26): the important state of
     * one project in one read — identity, build, market with its withholding,
     * on-chain, verification, locks, the newest changes, freshness and coverage.
     */
    snapshot: (slug: string): Promise<HeyProjectSnapshot> => this.get(`/api/projects/${pathSegment(slug)}/snapshot`),
    /**
     * `GET /api/projects/{slug}/usage?window=1|7|30` (2026-09-28): is what the
     * project shipped being used — calls, active contracts, distinct caller
     * addresses by day (addresses, not people), events, top methods by bucket,
     * and up to thirty rolled-up days. Its own dimension, never a ranking input.
     */
    usage: (slug: string, options: { window?: 1 | 7 | 30 } = {}): Promise<HeyProjectUsage> =>
      this.get(`/api/projects/${pathSegment(slug)}/usage`, { window: options.window }),
    /**
     * `GET /api/projects/{slug}/relationships` (2026-09-28): what is connected
     * to one project and why HEY thinks so — first degree, every edge with its
     * state, typed evidence and when HEY observed it. No account is a node and
     * there is no partnership edge; what HEY does not hold is in `notHeld`.
     */
    relationships: (slug: string): Promise<HeyProjectRelationships> => this.get(`/api/projects/${pathSegment(slug)}/relationships`),
    /**
     * `GET /api/projects/{slug}/built-on` (2026-10-17): which builders the
     * project builds on and which build on it — named in code or runs on a
     * hook, each link with its evidence. Never a partnership, never an
     * on-chain interaction.
     */
    builtOn: (slug: string): Promise<HeyProjectBuiltOn> => this.get(`/api/projects/${pathSegment(slug)}/built-on`),
    /** `GET /api/projects/{slug}/coverage`: what HEY knows and does not, per dimension, as states — never a score. */
    coverage: (slug: string): Promise<HeyProjectCoverage> => this.get(`/api/projects/${pathSegment(slug)}/coverage`),
    /**
     * `GET /api/projects/{slug}/explain?fact=&source=&event=`: why HEY publishes a
     * fact, from the persisted evaluation. Without `fact`, the facts HEY can
     * explain for this project. `event` (with `build.change`, 2026-10-20): a
     * ledger event id of this project; without it, the latest builder change.
     */
    explain: ((slug: string, fact?: HeyExplainFact, options: { source?: string; event?: string } = {}): Promise<HeyExplainedFact | HeyExplainIndex> =>
      this.get(`/api/projects/${pathSegment(slug)}/explain`, { fact, source: options.source, event: options.event })) as {
      (slug: string): Promise<HeyExplainIndex>;
      (slug: string, fact: HeyExplainFact, options?: { source?: string; event?: string }): Promise<HeyExplainedFact>;
    },
    /**
     * `GET /api/projects/{slug}/history?series=&from=&to=`: the points HEY
     * persisted, each with its basis; a day HEY did not record is absent.
     */
    history: (slug: string, query: HeyHistoryQuery = {}): Promise<HeyHistory> =>
      this.get(`/api/projects/${pathSegment(slug)}/history`, { series: query.series, from: query.from, to: query.to }),
    /** `GET /api/projects/{slug}/diff?from=&to=` (YYYY-MM-DD, at most 400 days apart): then and now, never a cause. */
    diff: (slug: string, window: { from: string; to: string }): Promise<HeyDiff> =>
      this.get(`/api/projects/${pathSegment(slug)}/diff`, { from: window.from, to: window.to }),
    /** `GET /api/projects/{slug}/contracts`: the project's contracts, each as `contracts.get` serves it. */
    contracts: (slug: string): Promise<HeyProjectContracts> => this.get(`/api/projects/${pathSegment(slug)}/contracts`),
    /** Every page, following `nextOffset` from `query.offset`. */
    pages: (query: HeyProjectsQuery = {}): AsyncIterable<HeyPage<HeyProject>> =>
      ((step) => nextOffsetPages((offset) => step(() => this.projects.list({ ...query, offset })), query.offset ?? 0))(this.walker()),
    /** Every project across every page. */
    items: (query: HeyProjectsQuery = {}): AsyncIterable<HeyProject> => itemsOf(this.projects.pages(query)),
  };

  readonly ships = {
    /** `GET /api/ships`: a record of ships, not of projects. */
    list: (query: HeyShipsQuery = {}): Promise<HeyPage<HeyShip>> => this.get('/api/ships', query),
    pages: (query: HeyShipsQuery = {}): AsyncIterable<HeyPage<HeyShip>> =>
      ((step) => nextOffsetPages((offset) => step(() => this.ships.list({ ...query, offset })), query.offset ?? 0))(this.walker()),
    items: (query: HeyShipsQuery = {}): AsyncIterable<HeyShip> => itemsOf(this.ships.pages(query)),
  };

  /* ------------------------------------------------------------ intelligence */

  readonly signals = {
    /** `GET /api/signals`. */
    list: (query: HeySignalsQuery = {}): Promise<HeySignalPage> => this.get('/api/signals', query),
    /** `GET /api/signals/{id}`. */
    get: (id: string): Promise<HeySignalDetail> => this.get(`/api/signals/${pathSegment(id)}`),
    /** Every page, stepping by what each page held until `total`. */
    pages: (query: HeySignalsQuery = {}): AsyncIterable<HeySignalPage> =>
      ((step) => totalPages((offset) => step(() => this.signals.list({ ...query, offset })), query.offset ?? 0))(this.walker()),
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
      ((step) => cursorPages((before) => step(() => this.changes.list({ ...query, ...(before ? { before } : {}) })), query.before))(this.walker()),
    /** Every event, newest first. */
    items: (query: Omit<HeyChangesQuery, 'after' | 'detectedSince'> = {}): AsyncIterable<HeyChangeEvent> => itemsOf(this.changes.pages(query)),
    /** Sync forward from `cursor` (default the start, `c1.0`) to the head, page by page. */
    sync: (cursor = 'c1.0', query: Omit<HeyChangesQuery, 'after' | 'before' | 'detectedSince'> = {}): AsyncIterable<HeyChangesPage> =>
      ((step) => cursorPages((after) => step(() => this.changes.list({ ...query, after: after ?? cursor })), cursor))(this.walker()),
  };

  readonly builders = {
    /** `GET /api/builders`: the Builder Radar. */
    list: (query: HeyBuildersQuery = {}): Promise<HeyBuildersPage> => this.get('/api/builders', query),
    pages: (query: HeyBuildersQuery = {}): AsyncIterable<HeyBuildersPage> =>
      ((step) => totalPages((offset) => step(() => this.builders.list({ ...query, offset })), query.offset ?? 0))(this.walker()),
  };

  readonly reports = {
    weekly: {
      /** `GET /api/reports/weekly`: the archive index, newest first. */
      list: (): Promise<HeyWeeklyIndex> => this.get('/api/reports/weekly'),
      /** `GET /api/reports/weekly/{week}`, an ISO week such as `2026-W37`. */
      get: (week: string): Promise<HeyWeeklyReport> => this.get(`/api/reports/weekly/${pathSegment(week)}`),
    },
  };

  /* ------------------------------------------------------------------ tokens */

  readonly token = {
    /** `GET /api/token/{chainId}/{address}`: `status: 'unknown'` is an answer, not an error. */
    lookup: (chainId: number, address: string): Promise<HeyTokenLookup> =>
      this.get(`/api/token/${pathSegment(String(chainId))}/${pathSegment(address)}`),
    /**
     * `GET /api/token/{chainId}?addresses=` (2026-09-26): up to 30 addresses in
     * one call, each answered in input order with its own `found`/`error`.
     * Keyed only; it costs one request per address.
     */
    bulk: (chainId: number, addresses: readonly string[]): Promise<HeyTokenLookupBulk> =>
      this.get(`/api/token/${pathSegment(String(chainId))}`, { addresses }),
  };

  /** `GET /api/v1/scan?chain=&token=`: the partner card; `found: false` means print nothing. */
  scanCard(chain: number, token: string): Promise<HeyScanCard> {
    return this.get('/api/v1/scan', { chain, token });
  }

  /** `GET /api/v1/scan?chain=&tokens=` (2026-09-26): up to 30 partner cards in input order. Keyed only; one request per token. */
  scanCards(chain: number, tokens: readonly string[]): Promise<HeyScanBulk> {
    return this.get('/api/v1/scan', { chain, tokens });
  }

  /**
   * `GET /api/v1/builder?chain=&token=` (2026-09-26 in the SDK): the RHTools
   * card — builder activity by contract, snake_case, explicit nulls. A
   * contract HEY has not published throws `not_found`; another chain `bad_request`.
   */
  builderCard(chain: number, token: string): Promise<HeyBuilderCard> {
    return this.get('/api/v1/builder', { chain, token });
  }

  /* ------------------------------------------------- evidence and contracts */

  readonly evidence = {
    /**
     * `GET /api/evidence/{id}` (2026-09-26): one published record by its typed
     * id (`ship:<uuid>`, `signal:<uuid>`, `abi:<uuid>`, `lock:<chainId>:<lockId>`,
     * `source:<uuid>`, `claim:<uuid>`, `state:…`, `impl:…`), as a receipt. A
     * withdrawn or hidden record answers `withdrawn: true` and names nothing
     * it may not.
     */
    get: (id: string): Promise<HeyEvidenceReceipt> => this.get(`/api/evidence/${pathSegment(id)}`),
  };

  readonly contracts = {
    /** `GET /api/contracts/{chainId}/{address}` (2026-09-26): one contract as a research entity — counts, proxy, source, interface, activity. */
    get: (chainId: number, address: string): Promise<HeyContract> =>
      this.get(`/api/contracts/${pathSegment(String(chainId))}/${pathSegment(address)}`),
  };

  readonly v4Hooks = {
    /**
     * `GET /api/v4-hooks` (2026-10-04): the Uniswap v4 hooks HEY ties to a
     * published project on Robinhood Chain — listed hooks only, newest
     * deployment first, shown of total, each with its `v4hook:` id — and one
     * aggregate count for every other hook. `under` narrows by market context,
     * never orders. `asOf` dates HEY's hourly copy.
     */
    list: (query: HeyV4HooksQuery = {}): Promise<HeyV4Hooks> => this.get('/api/v4-hooks', query),
    /**
     * `GET /api/v4-hooks/{address}` (2026-10-11): one hook HEY holds — who HEY
     * ties it to (a project is named only while HEY lists the hook), its
     * callbacks, source, hooklist entry, pools on tracked tokens by week, and
     * what HEY does not know, each null with its reason. A hook HEY does not
     * hold throws `not_found`; a malformed address `invalid_address`.
     */
    get: (address: string): Promise<HeyV4HookDetail> => this.get(`/api/v4-hooks/${pathSegment(address)}`),
  };

  /* ------------------------------------------------------ the agent contract */

  readonly agent = {
    /** `GET /api/agent` (2026-09-30): the agent contract described by itself — its capabilities, their parameters, schema, freshness contract and boundaries. */
    capabilities: (): Promise<HeyAgentCatalogue> => this.get('/api/agent'),
    /**
     * `GET /api/agent/{capability}` (2026-09-30): one AgentIntelligenceResponse
     * v1. Every answer is the contract's envelope, a refusal included: a 400 or
     * 404 whose body is the envelope resolves with it (`status` and `error` say
     * why) instead of throwing; a rate limit or an unreachable HEY still throws.
     */
    answer: async <C extends HeyAgentCapability>(capability: C, query: HeyAgentQuery[C]): Promise<HeyAgentResponseOf<C>> => {
      const params: QueryParams = {};
      for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
        if (value === undefined) continue;
        params[key] = Array.isArray(value) ? (value as string[]).join(',') : (value as string | number);
      }
      try {
        return await this.get<HeyAgentResponseOf<C>>(`/api/agent/${pathSegment(capability)}`, params);
      } catch (error) {
        const body = error instanceof HeyApiError && error.body && typeof error.body === 'object' ? (error.body as { schema?: unknown }) : undefined;
        if (body?.schema === 'hey.agent-intelligence-response') return body as HeyAgentResponseOf<C>;
        throw error;
      }
    },
  };

  readonly snapshots = {
    /** `GET /api/snapshots?slugs=` (2026-09-26): up to 10 snapshots in input order. Keyed only; one request per slug. */
    bulk: (slugs: readonly string[]): Promise<HeySnapshotsBulk> => this.get('/api/snapshots', { slugs }),
  };

  readonly search = {
    /** `GET /api/search/suggest?q=`: type-ahead over names, symbols, contracts, old slugs, verified domains and corroborated repositories (one matcher with the site, 2026-09-27), 2–64 characters, at most eight rows. */
    suggest: (q: string): Promise<HeySearchSuggestions> => this.get('/api/search/suggest', { q }),
  };

  /* ---------------------------------------------------------------- the rest */

  readonly bounties = {
    /** `GET /api/bounties`. Read-only: claiming is a wallet sign-in on the site. */
    list: (query: HeyBountiesQuery = {}): Promise<HeyBountyPage> => this.get('/api/bounties', query),
    /** `GET /api/bounties/{id}`. */
    get: (id: string): Promise<HeyBountyDetail> => this.get(`/api/bounties/${pathSegment(id)}`),
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

  /**
   * `GET /api/hey/profile` (2026-09-28): `$HEY` researched like any token —
   * contract, supply and market readings with their dates, locks, HEY's own
   * project snapshot, and each documented utility as LIVE / PLANNED / RETIRED /
   * UNKNOWN. Research data, not advice.
   */
  heyProfile(): Promise<HeyTokenProfile> {
    return this.get('/api/hey/profile');
  }

  /** `GET /api/status`: the public status page as JSON. */
  status(): Promise<HeyStatus> {
    return this.get('/api/status');
  }
}
