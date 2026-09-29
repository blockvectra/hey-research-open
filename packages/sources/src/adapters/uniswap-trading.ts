import { z } from 'zod';

import { errorResult, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * An indicative quote from the Uniswap Trading API (2026-09-30).
 *
 * Official and documented only: `POST https://trade-api.gateway.uniswap.org/v1/quote`
 * with the integrator's key in `x-api-key` (developers.uniswap.org, "Swapping
 * API Integration Guide"; the request and response shapes are the published
 * OpenAPI document at `/v1/api.json`). Robinhood Chain (4663) is in that
 * document's `ChainId` enum and on the supported-chains page.
 *
 * This asks for a price and nothing else. It never calls `/swap`, `/order` or
 * `/check_approval`, never receives calldata HEY would pass on, and never
 * sends a reader's address: the API requires a `swapper`, and HEY sends the
 * fixed placeholder its caller names (`INDICATIVE_QUOTE_SWAPPER` in the
 * domain), so a quote can never be tied to a person and can never be
 * executed as-is.
 *
 * The answer is checked against the question before anything is normalised:
 * the chain, the input token and the output token must be the ones asked
 * for, or the whole answer is refused. A quote is market context from
 * Uniswap Labs; it is never stored by HEY beyond a few seconds of cache
 * (API Terms of Use §2.4(g)), and never a trade.
 */
export const UNISWAP_TRADING_API_BASE_URL = 'https://trade-api.gateway.uniswap.org/v1';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS = /^[1-9]\d{0,77}$/;

export type UniswapQuoteInput = {
  apiKey: string;
  baseUrl?: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  /** In the input token's base units, a positive integer string. */
  amount: string;
  /** The API requires one; the caller passes a fixed placeholder, never a reader's address. */
  swapper: string;
};

export type UniswapQuote = {
  /** `CLASSIC` (a Uniswap v2/v3/v4 route), `DUTCH_V2`, `DUTCH_V3`, `PRIORITY` (UniswapX), `WRAP`, `UNWRAP`… as the API names it. */
  routing: string;
  requestId: string;
  quoteId?: string;
  /** The chain the quote names, when it names one (classic quotes do). */
  chainId?: number;
  tokenIn: string;
  tokenOut: string;
  /** Base units, as strings: the input the quote assumes and the output it expects. */
  amountIn: string;
  amountOut: string;
  gasFeeUsd?: number;
  priceImpactPct?: number;
  /** The route in the API's own words, e.g. "[V4] 100.00% = WETH -- 0.30% [0x…]TOKEN". */
  routeString?: string;
};

const amount = z.string().regex(/^\d{1,78}$/);
const side = z.object({ amount, token: z.string().regex(ADDRESS) });

const quoteSchema = z
  .object({
    chainId: z.number().int().optional(),
    input: side,
    output: side,
    quoteId: z.string().max(200).optional(),
    // UniswapX quotes carry the amount the filler expects beside the auction's start amount.
    expectedAmountOut: amount.optional(),
    gasFeeUSD: z.union([z.string(), z.number()]).optional(),
    priceImpact: z.number().optional(),
    routeString: z.string().max(2_000).optional(),
  })
  .passthrough();

const responseSchema = z
  .object({
    requestId: z.string().max(200),
    routing: z.string().regex(/^[A-Z_0-9]{2,40}$/),
    quote: quoteSchema,
  })
  .passthrough();

type Raw = z.infer<typeof responseSchema>;

const finite = (value: string | number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function createUniswapQuoteAdapter(): SourceAdapter<UniswapQuoteInput, UniswapQuote> {
  return {
    name: 'uniswap-api',

    canHandle(input) {
      return (
        input.apiKey.length > 0 &&
        Number.isInteger(input.chainId) &&
        ADDRESS.test(input.tokenIn) &&
        ADDRESS.test(input.tokenOut) &&
        input.tokenIn.toLowerCase() !== input.tokenOut.toLowerCase() &&
        ADDRESS.test(input.swapper) &&
        BASE_UNITS.test(input.amount)
      );
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<UniswapQuote>> {
      if (!this.canHandle(input)) return errorResult(ctx, 'INVALID_RESPONSE', 'the quote request was malformed; nothing was asked');
      const base = (input.baseUrl ?? UNISWAP_TRADING_API_BASE_URL).replace(/\/+$/, '');
      const body = JSON.stringify({
        type: 'EXACT_INPUT',
        amount: input.amount,
        tokenInChainId: input.chainId,
        tokenOutChainId: input.chainId,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        swapper: input.swapper,
        // Required with no auto value for UniswapX; it sets a minimum HEY never shows or uses.
        slippageTolerance: 0.5,
        routingPreference: 'BEST_PRICE',
      });

      const result = await performSourceFetch(
        ctx,
        {
          url: `${base}/quote`,
          method: 'POST',
          body,
          headers: { 'x-api-key': input.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          conditional: false,
          allowedContentTypes: ['application/json'],
          maxBytes: 512 * 1024,
        },
        {
          schema: responseSchema,
          parse: (raw) => JSON.parse(raw) as unknown,
          // Seconds, not minutes: a quote is a moment's price and the terms forbid keeping it.
          cacheTtlSeconds: 15,
          normalize: (raw: Raw): UniswapQuote => ({
            routing: raw.routing,
            requestId: raw.requestId,
            ...opt('quoteId', raw.quote.quoteId),
            ...opt('chainId', raw.quote.chainId),
            tokenIn: raw.quote.input.token.toLowerCase(),
            tokenOut: raw.quote.output.token.toLowerCase(),
            amountIn: raw.quote.input.amount,
            amountOut: raw.quote.expectedAmountOut ?? raw.quote.output.amount,
            ...opt('gasFeeUsd', finite(raw.quote.gasFeeUSD)),
            ...opt('priceImpactPct', finite(raw.quote.priceImpact)),
            ...opt('routeString', raw.quote.routeString),
          }),
        },
      );

      /*
       * The answer must be about the question. A quote for another chain or
       * other tokens — a proxy's mistake, a cached answer for someone else's
       * request — is refused whole rather than shown beside this token.
       */
      if (result.data) {
        const quote = result.data;
        const sameTokens = quote.tokenIn === input.tokenIn.toLowerCase() && quote.tokenOut === input.tokenOut.toLowerCase();
        const sameChain = quote.chainId === undefined || quote.chainId === input.chainId;
        if (!sameTokens || !sameChain || quote.amountIn !== input.amount || !BASE_UNITS.test(quote.amountOut)) {
          return errorResult(ctx, 'INVALID_RESPONSE', 'the quote answered a different question (chain, tokens or amount)');
        }
      }
      return result;
    },
  };
}
