import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * hood.fun bonding-curve state, read from the launchpad contract (2026-09-05).
 *
 * A hood.fun token that has not graduated has no liquidity pool, so no
 * aggregator prices it: DEX Screener returns zero pairs and GeckoTerminal does
 * not index it. That left 415 published tokens with no market context at all.
 * The launchpad contract knows, and both of hood.fun's are verified on
 * Blockscout, so the price comes from the chain rather than from anyone's API.
 *
 * `currentPrice(token)` is the launchpad's own function — HEY does not
 * reimplement the curve maths, it asks the contract that runs it.
 *
 * **The graduation guard is the point of this file.** Once a token graduates,
 * its curve is reset to the seed values and `currentPrice` keeps answering,
 * with a number that no longer means anything: two graduated tokens both
 * returned 27031716026 while hood.fun's own board showed them at very
 * different prices. Reading that as a market cap would publish a wrong figure
 * rather than a missing one, which is worse. So `curves(token).graduated` is
 * checked first and a graduated token is reported as such and priced by the
 * DEX adapters, which can see its pool.
 */
export type HoodfunCurveInput = {
  rpcUrl: string;
  /** The launchpad contract that issued the token. */
  launchpadAddress: string;
  /** The token to price. */
  address: string;
  call: 'curves' | 'currentPrice' | 'totalSupply';
};

export type HoodfunCurveValue =
  | { call: 'curves'; graduated: boolean; migrated: boolean; virtualEth: bigint; realTokens: bigint }
  | { call: 'currentPrice'; priceWei: bigint }
  | { call: 'totalSupply'; totalSupply: bigint };

/** `keccak(signature)[0:4]`, fixed here so a call needs no ABI encoder at runtime. */
export const HOODFUN_SELECTORS = {
  curves: '0x2cc3dc6e',
  currentPrice: '0xe9833c2f',
  totalSupply: '0x18160ddd',
} as const;

/**
 * The two hood.fun launchpads, both verified on Blockscout.
 * `HoodLaunchpad` issues the standard launches; `HoodCustomLaunchpad` the
 * community ones. A token belongs to exactly one, and `isHoodToken` on the
 * wrong one answers false.
 */
export const HOODFUN_LAUNCHPADS = [
  '0x6a63d96ef77ae569fcb85934cf1bd1ec7fe9b33d',
  '0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c',
  '0x8c529f0a77c07ce0e6796f153d292501ee6f66f6',
] as const;

const CACHE_TTL_SECONDS = 300;

const envelopeSchema = z.object({
  result: z.string().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

/** One 32-byte word of a return value, as a bigint. */
const word = (hex: string, index: number): bigint => {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const slice = body.slice(index * 64, (index + 1) * 64);
  return slice.length === 64 ? BigInt(`0x${slice}`) : 0n;
};

/** A 20-byte address, left-padded to a 32-byte argument. */
export const padAddress = (address: string): string =>
  address.replace(/^0x/i, '').toLowerCase().padStart(64, '0');

export function createHoodfunCurveAdapter(): SourceAdapter<HoodfunCurveInput, HoodfunCurveValue> {
  return {
    name: 'hoodfun-curve',
    canHandle(input) {
      return /^https?:\/\//.test(input.rpcUrl) && /^0x[a-fA-F0-9]{40}$/.test(input.address);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<HoodfunCurveValue>> {
      // `totalSupply` is asked of the token; the curve reads of the launchpad.
      const to = input.call === 'totalSupply' ? input.address : input.launchpadAddress;
      const data =
        input.call === 'totalSupply'
          ? HOODFUN_SELECTORS.totalSupply
          : `${HOODFUN_SELECTORS[input.call]}${padAddress(input.address)}`;

      return performSourceFetch(
        ctx,
        {
          url: input.rpcUrl,
          method: 'POST',
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
          headers: { 'content-type': 'application/json' },
          conditional: false,
        },
        {
          schema: envelopeSchema.superRefine((value, context) => {
            /*
             * A revert is an answer — the token is not this launchpad's — but a
             * transport or node error is not, and must not be read as one.
             */
            if (value.error) {
              context.addIssue({ code: z.ZodIssueCode.custom, message: `rpc error: ${value.error.message}` });
            }
          }),
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): HoodfunCurveValue => {
            const result = raw.result ?? '0x';
            if (input.call === 'curves') {
              return {
                call: 'curves',
                virtualEth: word(result, 0),
                realTokens: word(result, 3),
                graduated: word(result, 6) === 1n,
                migrated: word(result, 7) === 1n,
              };
            }
            if (input.call === 'currentPrice') {
              return { call: 'currentPrice', priceWei: word(result, 0) };
            }
            return { call: 'totalSupply', totalSupply: word(result, 0) };
          },
        },
      );
    },
  };
}

/**
 * Market capitalisation in the chain's native asset (ETH), from the launchpad's
 * own price and the token's own supply.
 *
 * Both are 18-decimal fixed-point, so the product carries 36 decimals and is
 * divided once by 1e18 to land back in whole native units. Returned as a
 * number because it is a display figure, not an accounting one; a zero price or
 * supply yields undefined rather than a zero market cap, which would be a
 * measurement HEY never made.
 */
export function curveMarketCapNative(totalSupply: bigint, priceWei: bigint): number | undefined {
  if (totalSupply <= 0n || priceWei <= 0n) return undefined;
  const WEI = 10n ** 18n;
  // Scale to six decimal places of native before converting, so a very small
  // price does not round to zero on the way through Number.
  const scaled = (totalSupply * priceWei) / (WEI * WEI / 1_000_000n);
  const native = Number(scaled) / 1_000_000;
  return Number.isFinite(native) && native > 0 ? native : undefined;
}
