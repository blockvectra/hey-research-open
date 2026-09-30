import type { BenchObservation } from './evaluate';

/**
 * The doors a benchmark question can knock on (2026-09-30). The CI run
 * supplies in-process doors over the demo seed; `httpTransport` knocks on a
 * deployed HEY — read-only, paced, and naming itself.
 */
export interface BenchTransport {
  /** `GET /api/agent/{capability}?…` */
  agent(capability: string, query: URLSearchParams): Promise<BenchObservation>;
  /** Another public GET: `/api/search/suggest?q=…`, `/api/evidence/{id}` … */
  get(path: string): Promise<BenchObservation>;
  /** `POST /mcp` `tools/call`. */
  mcp(tool: string, args: Record<string, unknown>): Promise<BenchObservation>;
  /** `POST /api/a2a` `SendMessage` with one data part. */
  a2a(data: Record<string, unknown>): Promise<BenchObservation>;
}

export const BENCH_USER_AGENT = 'hey-internal/agent-benchmark';

export type HttpTransportOptions = {
  baseUrl: string;
  userAgent?: string;
  /** The gap between two requests to the public read API: 550 ms keeps a run under ~1.8 a second, inside the 120-a-minute anonymous allowance. */
  minIntervalMs?: number;
  /** MCP and A2A are 60 a minute each, and an MCP tool call reads the API once more on the caller's behalf. */
  slowIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** For tests: the clock and the sleep. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const KEPT_HEADERS = ['cf-cache-status', 'age', 'retry-after', 'x-request-id', 'cache-control', 'content-type'] as const;

/**
 * HEY over HTTP. Read-only: GETs, and the two POSTs that only read (MCP
 * `tools/call`, A2A `SendMessage`). No key is sent. One request at a time,
 * paced; a 429 is waited out once with its `retry-after` and then recorded
 * as the answer, never hammered.
 */
export function httpTransport(options: HttpTransportOptions): BenchTransport {
  const base = options.baseUrl.replace(/\/+$/, '');
  const userAgent = options.userAgent ?? BENCH_USER_AGENT;
  const minInterval = options.minIntervalMs ?? 550;
  const slowInterval = options.slowIntervalMs ?? 1_100;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last = -Infinity;
  let rpcId = 0;

  const paced = async (interval: number) => {
    const wait = last + interval - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };

  const send = async (url: string, init: RequestInit, interval: number, retried = false): Promise<BenchObservation> => {
    await paced(interval);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal, headers: { 'user-agent': userAgent, accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
      const raw = await response.text();
      const ms = now() - started;
      const headers = Object.fromEntries(KEPT_HEADERS.flatMap((name) => (response.headers.get(name) !== null ? [[name, response.headers.get(name)!]] : [])));
      if (response.status === 429 && !retried) {
        const after = Math.min(90, Math.max(1, Number(response.headers.get('retry-after')) || 30));
        await sleep(after * 1_000);
        return send(url, init, interval, true);
      }
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* a non-JSON body is kept as text */
      }
      return { httpStatus: response.status, ms: Math.round(ms * 10) / 10, bytes: new TextEncoder().encode(raw).length, body, headers };
    } catch (error) {
      return { httpStatus: 0, ms: Math.round((now() - started) * 10) / 10, bytes: 0, body: null, headers: {}, failure: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    agent: (capability, query) => send(`${base}/api/agent/${encodeURIComponent(capability)}${query.size > 0 ? `?${query.toString()}` : ''}`, { method: 'GET' }, minInterval),
    get: (path) => send(`${base}${path.startsWith('/') ? path : `/${path}`}`, { method: 'GET' }, minInterval),
    mcp: (tool, args) =>
      send(
        `${base}/mcp`,
        { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }) },
        slowInterval,
      ),
    a2a: (data) =>
      send(
        `${base}/api/a2a`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'a2a-version': '1.0' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'SendMessage', params: { message: { messageId: `hey-benchmark-${rpcId}`, role: 'ROLE_USER', parts: [{ data }] } } }),
        },
        slowInterval,
      ),
  };
}
