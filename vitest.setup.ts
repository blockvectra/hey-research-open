/**
 * No test may touch the network.
 *
 * CLAUDE.md rule 16 and the M2 acceptance criteria require that CI never depends
 * on a live third-party provider. Source adapters take an injected `fetchImpl`,
 * so any call reaching the real `fetch` is a mistake — fail loudly instead of
 * silently making a request.
 *
 * Failing the call alone is not loud enough (test hardening, 2026-10-22): the
 * HTTP client turns the rejection into a retryable `SourceError('NETWORK')`, so a
 * test that asserts a provider-failure state passed by accident when its stub was
 * missing. Every blocked call is therefore recorded, and the test that made it
 * fails in `afterEach` whatever it asserted. `no-network.test.ts`, which proves
 * the guard itself, takes its hits with `takeBlockedNetworkHits` (below).
 *
 * The same holds for DNS: a hostname lookup other than localhost (or the test
 * database's own host) is refused and recorded, so `systemLookup` in
 * `url-safety.ts` cannot quietly resolve a real provider's name.
 */
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';

import { afterAll, afterEach } from 'vitest';

const hits: string[] = [];

/**
 * The guard's ledger, shared with `no-network.test.ts` through a registered
 * symbol (a setup file is not a module a test imports).
 */
const ledger = { take: (): string[] => hits.splice(0, hits.length) };
(globalThis as Record<symbol, unknown>)[Symbol.for('hey.test.blockedNetwork')] = ledger;

// Declared async so it fails the way the real `fetch` does — a rejected promise,
// not a synchronous throw — and code that only catches rejections still sees it.
const blocked = async (input: unknown): Promise<never> => {
  const target =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : typeof input === 'object' && input !== null && 'url' in input
          ? String((input as { url: unknown }).url)
          : String(input);
  hits.push(`fetch ${target}`);
  throw new Error(
    `Network access is disabled in tests. Something tried to fetch ${target}. ` +
      'Adapters must be driven with a stubbed fetchImpl over saved fixtures.',
  );
};

globalThis.fetch = blocked as unknown as typeof fetch;

// ------------------------------------------------------------------ DNS

const hostOf = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return undefined;
  }
};

/** Loopback names, plus the database host CI or a developer points the suites at. */
const allowedHosts = new Set(
  ['localhost', hostOf(process.env.TEST_DATABASE_URL), hostOf(process.env.DATABASE_URL)].filter(
    (host): host is string => typeof host === 'string' && host.length > 0,
  ),
);

const isAllowedHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.has(host) || host.endsWith('.localhost') || /^[0-9.]+$/.test(host) || host.includes(':');
};

const refusal = (hostname: string): NodeJS.ErrnoException => {
  hits.push(`dns ${hostname}`);
  const error: NodeJS.ErrnoException = new Error(
    `DNS lookups are disabled in tests. Something tried to resolve ${hostname}. ` +
      'Inject a lookup stub (lookupImpl) instead of resolving real hosts.',
  );
  error.code = 'ENOTFOUND';
  error.syscall = 'getaddrinfo';
  return error;
};

const realLookup = dns.lookup;
const realPromiseLookup = dnsPromises.lookup;

const guardedLookup = ((hostname: string, ...rest: unknown[]) => {
  if (isAllowedHost(String(hostname))) {
    return (realLookup as (...args: unknown[]) => unknown)(hostname, ...rest);
  }
  const callback = rest[rest.length - 1];
  const error = refusal(String(hostname));
  if (typeof callback === 'function') {
    process.nextTick(() => (callback as (err: NodeJS.ErrnoException) => void)(error));
    return undefined;
  }
  throw error;
}) as typeof dns.lookup;

const guardedPromiseLookup = (async (hostname: string, ...rest: unknown[]) => {
  if (isAllowedHost(String(hostname))) {
    return (realPromiseLookup as (...args: unknown[]) => Promise<unknown>)(hostname, ...rest);
  }
  throw refusal(String(hostname));
}) as typeof dnsPromises.lookup;

dns.lookup = guardedLookup;
dnsPromises.lookup = guardedPromiseLookup;
if (dns.promises !== dnsPromises) dns.promises.lookup = guardedPromiseLookup;
// `import('node:dns/promises')` reads the ES module namespace; carry the patch over.
syncBuiltinESMExports();

// --------------------------------------------------------------- the check

const failOnHits = (where: string): void => {
  const taken = ledger.take();
  if (taken.length === 0) return;
  throw new Error(
    `${where} reached the network ${taken.length} time(s) with no stub:\n` +
      taken.map((hit) => `  - ${hit}`).join('\n') +
      '\nInject a fetchImpl / lookupImpl over saved fixtures (CLAUDE.md architecture rule 16).',
  );
};

afterEach(() => failOnHits('This test'));
afterAll(() => failOnHits('A hook of this file'));
