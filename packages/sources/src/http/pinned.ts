import { Agent } from 'undici';

/**
 * Connection pinning for SSRF-guarded fetches (audit H05, 2026-09-11; shared
 * 2026-09-15).
 *
 * An SSRF check resolves the hostname, and then the runtime resolves it again
 * when it opens the socket. A record that flips in between — DNS rebinding —
 * points the fetch at a private address the check never saw. Pinning makes
 * the second resolution return exactly what the first one validated. TLS
 * still verifies against the hostname; only the socket's destination is fixed.
 *
 * Lived in `client.ts` and was used by the source crawler alone; the logo
 * proxy in `@hey/domain` did the same check and then did not pin.
 */
export const isIpLiteralHost = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  } catch {
    return false;
  }
};

/** The dispatcher's type, re-exported so callers need no direct undici dependency. */
export type PinnedAgent = Agent;

export function pinnedDispatcher(addresses: readonly string[]): Agent {
  const family = (address: string): 4 | 6 => (address.includes(':') ? 6 : 4);
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const all = options && typeof options === 'object' && 'all' in options && options.all;
        if (all) callback(null, addresses.map((address) => ({ address, family: family(address) })));
        else callback(null, addresses[0] as string, family(addresses[0] as string));
      },
    },
  });
}

/** Close the pinned dispatcher once the body has been consumed or discarded. */
export function withDispatcherClose(response: Response, dispatcher: Agent): Response {
  const close = () => void dispatcher.close().catch(() => undefined);
  const body = response.body;
  if (!body || typeof (body as { getReader?: unknown }).getReader !== 'function') {
    close();
    return response;
  }
  const original = body.getReader;
  // Closing after the reader finishes keeps the socket alive exactly as long as the read.
  body.getReader = function patched(this: ReadableStream<Uint8Array>, ...args: unknown[]) {
    const reader = (original as (...a: unknown[]) => ReadableStreamDefaultReader<Uint8Array>).apply(this, args);
    reader.closed.then(close, close);
    return reader;
  } as typeof body.getReader;
  return response;
}
