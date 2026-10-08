import type { SourceContext } from '../adapter';
import { SourceError } from '../errors';
import { httpRequest, type HttpOutcome, type HttpRequest } from './client';

/**
 * A second chain node for every JSON-RPC read an adapter makes (2026-09-30).
 *
 * `RH_RPC_FALLBACK_URL` covered the `$HEY` reads (viem's `fallback`
 * transport) and nothing else: the launch scans, the log counts, the token
 * supply and metadata reads, the upgrade slots and the curve readers all go
 * through the source adapters' own HTTP client, and on 2026-09-29/30 the one
 * public node refused them in bursts (a 429 or a 403 challenge, and every
 * scan that met one stopped part-way).
 *
 * With `ctx.rpcFallback` set, a POST to the primary node that the node
 * refused — a 429, a 403, a 5xx, a timeout, a dropped connection — is asked
 * once more of the fallback, exactly as it was. A deterministic answer (a
 * JSON-RPC error in a 200, an invalid response) is not moved: the second node
 * would say the same.
 *
 * The fallback proves its chain first, as the `$HEY` transport's does
 * (`chainCheckedHttp`): its first use asks `eth_chainId`, a node for another
 * chain is remembered and never read, and a check that could not be made is
 * asked again next time. The answer names the node that gave it
 * (`sourceUrl`), and the attempts count both requests, so the budget meters
 * what actually left.
 */
export type RpcFallback = {
  /** The node every adapter is handed (`RH_RPC_URL`); only requests to it fail over. */
  primaryUrl: string;
  /** The second node (`RH_RPC_FALLBACK_URL`). */
  url: string;
  /** The chain the fallback must answer `eth_chainId` for. */
  chainId: number;
};

type ChainCheck = { ok: true } | { ok: false; answered: number };

const checks = new Map<string, Promise<ChainCheck>>();

/** Tests only: forget every chain check. */
export function resetRpcFallbackChecks(): void {
  checks.clear();
}

const refusedStatuses = new Set([401, 403, 408, 425, 429]);

/** Whether the primary node refused (or never answered), as opposed to answering. */
export function isNodeRefusal(error: unknown): boolean {
  if (!(error instanceof SourceError)) return false;
  if (error.code === 'RATE_LIMITED' || error.code === 'UPSTREAM_ERROR' || error.code === 'TIMEOUT' || error.code === 'NETWORK') return true;
  return error.status !== undefined && refusedStatuses.has(error.status);
}

async function checkChain(fallback: RpcFallback, ctx: SourceContext): Promise<ChainCheck> {
  const key = `${fallback.url}|${fallback.chainId}`;
  let pending = checks.get(key);
  if (!pending) {
    pending = (async (): Promise<ChainCheck> => {
      const outcome = await httpRequest(
        {
          url: fallback.url,
          method: 'POST',
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          headers: { 'content-type': 'application/json' },
          conditional: false,
        },
        { ...ctx, rpcFallback: undefined },
      );
      if (outcome.kind !== 'ok') throw new SourceError('INVALID_RESPONSE', 'eth_chainId answered not-modified');
      const parsed = JSON.parse(outcome.response.body) as { result?: unknown };
      const answered = typeof parsed.result === 'string' ? Number.parseInt(parsed.result, 16) : Number.NaN;
      if (!Number.isFinite(answered)) throw new SourceError('INVALID_RESPONSE', 'eth_chainId gave no chain id');
      return answered === fallback.chainId ? { ok: true } : { ok: false, answered };
    })();
    checks.set(key, pending);
    // A check that could not be made is asked again next time; a mismatch is remembered.
    pending.catch(() => checks.delete(key));
  }
  return pending;
}

/**
 * The fallback node's URL for a read sent to `primaryUrl`, once it has proved its chain, or
 * undefined (2026-10-09, overnight audit C5): for readers that post with their own `fetch`
 * (the launch-factory scanner) and so cannot go through `requestWithRpcFailover`. A check that
 * could not be made answers undefined; the primary's refusal then stands.
 */
export async function chainCheckedFallbackUrl(primaryUrl: string, ctx: SourceContext): Promise<string | undefined> {
  const fallback = ctx.rpcFallback;
  if (!fallback || primaryUrl !== fallback.primaryUrl || fallback.url === fallback.primaryUrl) return undefined;
  try {
    return (await checkChain(fallback, ctx)).ok ? fallback.url : undefined;
  } catch {
    return undefined;
  }
}

export type RpcOutcome = { outcome: HttpOutcome; url: string; attempts: number };

/**
 * The request, and once more on the fallback when the primary node refused
 * it. Throws what the node that was asked last threw.
 */
export async function requestWithRpcFailover(request: HttpRequest, ctx: SourceContext): Promise<RpcOutcome> {
  const fallback = ctx.rpcFallback;
  const eligible = fallback !== undefined && request.method === 'POST' && request.url === fallback.primaryUrl && fallback.url !== fallback.primaryUrl;
  try {
    const outcome = await httpRequest(request, ctx);
    return { outcome, url: request.url, attempts: outcome.kind === 'ok' ? outcome.response.attempts : 1 };
  } catch (error) {
    if (!eligible || !isNodeRefusal(error)) throw error;
    const primaryAttempts = (error as SourceError).attempts ?? 1;
    let check: ChainCheck;
    try {
      check = await checkChain(fallback, ctx);
    } catch {
      // The fallback could not even say which chain it is: the primary's refusal stands.
      throw error;
    }
    if (!check.ok) {
      const refused = error as SourceError;
      throw new SourceError(refused.code, `${refused.message}; RH_RPC_FALLBACK_URL answers chain ${check.answered}, not ${fallback.chainId}, and is not used`, refused.status, refused.retryAfterSeconds, {
        ...(refused.retryAfterMs !== undefined ? { retryAfterMs: refused.retryAfterMs } : {}),
        attempts: primaryAttempts,
      });
    }
    try {
      const outcome = await httpRequest({ ...request, url: fallback.url }, { ...ctx, rpcFallback: undefined });
      return { outcome, url: fallback.url, attempts: primaryAttempts + (outcome.kind === 'ok' ? outcome.response.attempts : 1) };
    } catch (second) {
      if (second instanceof SourceError) second.attempts = primaryAttempts + (second.attempts ?? 1);
      throw second;
    }
  }
}
