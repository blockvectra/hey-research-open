import { describe, expect, it, vi } from 'vitest';

import type { Agent } from 'undici';

import { isIpLiteralHost, pinnedDispatcher, withDispatcherClose } from './pinned';

/**
 * The SSRF pin itself (round 9, 2026-09-19).
 *
 * `pinned.ts` is what stops DNS rebinding: the SSRF check resolves a hostname,
 * and this makes the socket's own resolution return exactly what the check
 * validated. It had no test of its own — `client.test.ts:169` asserted only
 * that *some* object with a `close` reached fetch, which a dispatcher pinned
 * to the wrong addresses would also satisfy.
 *
 * The lookup is read back off the real `undici` Agent rather than from a mock,
 * so what is asserted is the callback the runtime will actually call.
 */
type LookupOptions = { all?: boolean };
type LookupCallback = (
  error: Error | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;
type Lookup = (hostname: string, options: LookupOptions, callback: LookupCallback) => void;

/** The `connect.lookup` the Agent was built with, off its own options. */
const lookupOf = (agent: Agent): Lookup => {
  for (const key of Object.getOwnPropertySymbols(agent)) {
    const value = (agent as unknown as Record<symbol, { connect?: { lookup?: Lookup } }>)[key];
    if (value && typeof value === 'object' && typeof value.connect?.lookup === 'function') {
      return value.connect.lookup;
    }
  }
  throw new Error('the pinned dispatcher carries no connect.lookup');
};

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:4700:4700::1111';

describe('pinnedDispatcher', () => {
  it('answers the `options.all` shape with exactly the validated addresses', async () => {
    const agent = pinnedDispatcher([PUBLIC_V4, PUBLIC_V6]);
    const seen: unknown[] = [];
    lookupOf(agent)('api.example.com', { all: true }, (error, address) => seen.push([error, address]));

    expect(seen).toEqual([
      [
        null,
        [
          { address: PUBLIC_V4, family: 4 },
          { address: PUBLIC_V6, family: 6 },
        ],
      ],
    ]);
    await agent.close();
  });

  it('answers the single-callback shape with the first validated address and its family', async () => {
    const seen: unknown[] = [];
    const v4 = pinnedDispatcher([PUBLIC_V4, PUBLIC_V6]);
    lookupOf(v4)('api.example.com', {}, (error, address, family) => seen.push([error, address, family]));
    // `all: false` is the same shape as no `all` at all.
    lookupOf(v4)('api.example.com', { all: false }, (error, address, family) => seen.push([error, address, family]));

    const v6 = pinnedDispatcher([PUBLIC_V6]);
    lookupOf(v6)('api.example.com', {}, (error, address, family) => seen.push([error, address, family]));

    expect(seen).toEqual([
      [null, PUBLIC_V4, 4],
      [null, PUBLIC_V4, 4],
      [null, PUBLIC_V6, 6],
    ]);
    await Promise.all([v4.close(), v6.close()]);
  });

  it('is a pin and not a resolver, so no unvalidated address can come back', async () => {
    /*
     * The rebinding attack: the SSRF check resolved `rebind.example` to a
     * public address, and by the time the socket opens the record answers
     * 127.0.0.1. The lookup here never consults DNS and ignores the hostname
     * it is handed, so the second resolution cannot differ from the first —
     * whatever is asked for, only the validated set comes back.
     */
    const agent = pinnedDispatcher([PUBLIC_V4]);
    const answers: string[] = [];
    for (const hostname of ['rebind.example', 'localhost', '169.254.169.254', 'metadata.google.internal']) {
      lookupOf(agent)(hostname, { all: true }, (_error, address) => {
        for (const entry of address as { address: string }[]) answers.push(entry.address);
      });
      lookupOf(agent)(hostname, {}, (_error, address) => answers.push(address as string));
    }

    expect(new Set(answers)).toEqual(new Set([PUBLIC_V4]));
    expect(answers).not.toContain('127.0.0.1');
    await agent.close();
  });
});

describe('isIpLiteralHost', () => {
  it('knows when there is nothing to pin', () => {
    // A literal address was never resolved, so pinning it would pin nothing;
    // `client.ts` and the logo proxy both skip the dispatcher for these.
    expect(isIpLiteralHost('https://93.184.216.34/x')).toBe(true);
    expect(isIpLiteralHost('http://127.0.0.1:8080/x')).toBe(true);
    expect(isIpLiteralHost('https://[::1]/x')).toBe(true);
    expect(isIpLiteralHost('https://[2606:4700:4700::1111]/x')).toBe(true);
    expect(isIpLiteralHost('https://api.example.com/x')).toBe(false);
    expect(isIpLiteralHost('not a url')).toBe(false);
  });
});

describe('withDispatcherClose', () => {
  const fakeAgent = () => {
    const close = vi.fn(async () => {});
    return { close, agent: { close } as unknown as Agent };
  };

  /** Resolves once the microtask queue has drained the `closed` continuation. */
  const settle = async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  };

  it('holds the socket open until the body has been read, then closes it', async () => {
    const { close, agent } = fakeAgent();
    const response = withDispatcherClose(new Response('{"ok":true}'), agent);

    const reader = response.body!.getReader();
    expect(close).not.toHaveBeenCalled();

    let done = false;
    while (!done) ({ done } = await reader.read());
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes when the body throws rather than leaking the connection', async () => {
    const { close, agent } = fakeAgent();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const response = withDispatcherClose(new Response(stream), agent);

    const reader = response.body!.getReader();
    await expect(reader.read()).rejects.toThrow('connection reset');
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes immediately when there is no body to wait for', () => {
    const { close, agent } = fakeAgent();
    const response = withDispatcherClose(new Response(null, { status: 204 }), agent);

    expect(close).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(204);
  });

  it('swallows a failing close rather than turning it into an unhandled rejection', async () => {
    const close = vi.fn(async () => {
      throw new Error('already destroyed');
    });
    const response = withDispatcherClose(new Response('x'), { close } as unknown as Agent);

    const reader = response.body!.getReader();
    let done = false;
    while (!done) ({ done } = await reader.read());
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
