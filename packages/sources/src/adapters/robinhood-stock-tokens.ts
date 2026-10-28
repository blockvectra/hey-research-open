import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { cleanHttpUrl } from '../links';
import { toNumber } from '../market';
import { opt } from '../optional';

/**
 * Robinhood's Stock Token API — the issuer's own feed for its tokenized
 * equities on Robinhood Chain (https://docs.robinhood.com/chain/stock-token-apis/).
 *
 * Three read-only, keyless REST endpoints under `https://api.robinhood.com/rhj/`:
 *
 *   GET /assets            every Stock Token with its per-chain deployment,
 *                          `currentMultiplier` ("18-dp shares-per-token"),
 *                          `pendingMultiplier` (a corporate action announced,
 *                          not yet applied), status and `tradingCapabilities`
 *                          (market hours, extended hours and overnight, each
 *                          whole and fractional; 2026-10-29)
 *   GET /prices/{symbol}   live bid/ask **in raw underlying-equity terms, not
 *                          multiplier-adjusted**; 15 s cache
 *   GET /corporate-actions splits, dividends; 1 h cache (not read by HEY)
 *
 * Verified 2026-09-03: `/assets` → 194 assets, all deployed on 4663;
 * `/prices/AAPL` → one quote, `bid: "324.81", ask: "324.88"`, `currency: USD`;
 * the query-string form `/prices/?symbols=` answers 400, so the path form is
 * used. Documented limit 60 requests/second; HEY paces far below it.
 *
 * A per-token USD price is `mid(bid, ask) × currentMultiplier` — the docs say
 * to apply the multiplier to convert. There is no token supply in the feed,
 * so no market cap can be derived and none is invented.
 *
 * Prices stay behind `HEY_STOCK_TOKEN_PRICES_ENABLED`, off by default. The
 * assets list alone — multipliers, status and trading sessions, never a price —
 * is read by `SYNC_STOCK_TOKEN_FEED` for the /stock-tokens page (2026-10-29,
 * founder "kau bina 1,2,3"; `packages/domain/src/stock-tokens`).
 */
export const ROBINHOOD_STOCK_API_DEFAULT_BASE_URL = 'https://api.robinhood.com/rhj';

const ASSETS_CACHE_TTL_SECONDS = 60 * 60;
const PRICE_CACHE_TTL_SECONDS = 60;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,12}$/;

const deploymentSchema = z.object({
  contractAddress: z.string().nullish(),
  chainId: z.union([z.number(), z.string()]).nullish(),
  networkName: z.string().nullish(),
});

/** One session's two lots, as the feed states them: `TRADING_STATUS_TRADABLE` is the only value Robinhood's docs show. */
const sessionSchema = z.object({
  whole: z.string().nullish(),
  fractional: z.string().nullish(),
});

const tradingCapabilitiesSchema = z.object({
  market: sessionSchema.nullish(),
  extended: sessionSchema.nullish(),
  overnight: sessionSchema.nullish(),
});

const assetSchema = z.object({
  id: z.string().nullish(),
  tokenSymbol: z.string().nullish(),
  tokenName: z.string().nullish(),
  deployments: z.array(deploymentSchema).nullish(),
  currentMultiplier: z.union([z.string(), z.number()]).nullish(),
  pendingMultiplier: z.union([z.string(), z.number()]).nullish(),
  status: z.string().nullish(),
  logoUrl: z.string().nullish(),
  tokenDecimals: z.number().nullish(),
  tradingCapabilities: tradingCapabilitiesSchema.nullish(),
});

const assetsResponseSchema = z.object({ assets: z.array(assetSchema).nullish() });

const quoteSchema = z.object({
  tokenSymbol: z.string().nullish(),
  deployments: z.array(deploymentSchema).nullish(),
  bid: z.union([z.string(), z.number()]).nullish(),
  ask: z.union([z.string(), z.number()]).nullish(),
  currency: z.string().nullish(),
  isTradingHalt: z.boolean().nullish(),
  generatedAt: z.string().nullish(),
});

const priceResponseSchema = z.object({ quotes: z.array(quoteSchema).nullish() });

export type StockTokenAssetsInput = {
  chainId: number;
  baseUrl?: string;
};

/** The sessions the feed's `tradingCapabilities` names (https://docs.robinhood.com/chain/stock-tokens). */
export const STOCK_TOKEN_TRADING_SESSIONS = ['market', 'extended', 'overnight'] as const;
export type StockTokenTradingSession = (typeof STOCK_TOKEN_TRADING_SESSIONS)[number];
/** Whole shares and fractional shares, per session. */
export const STOCK_TOKEN_TRADING_LOTS = ['whole', 'fractional'] as const;
export type StockTokenTradingLot = (typeof STOCK_TOKEN_TRADING_LOTS)[number];

/**
 * The feed's trading statuses as it states them, upper-cased: `TRADING_STATUS_TRADABLE` or whatever else the
 * issuer writes. A session or lot the feed leaves out is absent here — not stated, never "not tradable".
 */
export type StockTokenTradingCapabilities = Partial<Record<StockTokenTradingSession, Partial<Record<StockTokenTradingLot, string>>>>;

export type StockTokenAsset = {
  chainId: number;
  /** The token contract on the requested chain, lowercase. */
  contractAddress: string;
  /** The issuer's asset id. */
  id: string;
  symbol: string;
  name?: string;
  /** Underlying shares one token represents; 1 until a corporate action changes it. */
  multiplier: number;
  /** A multiplier change the issuer has announced but not yet applied. */
  pendingMultiplier?: number;
  /**
   * The issuer's own figures, exact, as decimal strings (2026-10-29): absent when the feed carried none or one that
   * is not a positive decimal. Unlike `multiplier`, never defaulted to 1 — a figure HEY did not read stays unread.
   */
  multiplierText?: string;
  pendingMultiplierText?: string;
  /** What the feed says about each session; absent when it carried no `tradingCapabilities`. */
  tradingCapabilities?: StockTokenTradingCapabilities;
  status?: string;
  logoUrl?: string;
  decimals?: number;
};

export type StockTokenPriceInput = {
  chainId: number;
  symbol: string;
  baseUrl?: string;
};

export type StockTokenQuote = {
  chainId: number;
  symbol: string;
  /** The deployment on the requested chain, when the quote names one. */
  contractAddress?: string;
  /** Underlying-equity prices in `currency`, per share, not multiplier-adjusted. */
  bid: number;
  ask: number;
  mid: number;
  currency: string;
  tradingHalted: boolean;
  generatedAt?: Date;
  sourceUrl: string;
};

/** A positive decimal the database's `numeric(38, 18)` holds exactly. */
const DECIMAL_PATTERN = /^\d{1,20}(\.\d{1,18})?$/;
const TRADING_STATUS_PATTERN = /^[A-Z0-9_]{1,64}$/;

/** The issuer's figure as an exact decimal string, or undefined for an empty, malformed or non-positive one. */
export function stockTokenDecimal(value: string | number | null | undefined): string | undefined {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : (value ?? '').trim();
  if (!DECIMAL_PATTERN.test(text)) return undefined;
  return /[1-9]/.test(text) ? text : undefined;
}

function tradingCapabilitiesOf(raw: z.infer<typeof tradingCapabilitiesSchema> | null | undefined): StockTokenTradingCapabilities | undefined {
  if (!raw) return undefined;
  const out: StockTokenTradingCapabilities = {};
  for (const session of STOCK_TOKEN_TRADING_SESSIONS) {
    const lots = raw[session];
    if (!lots) continue;
    const kept: Partial<Record<StockTokenTradingLot, string>> = {};
    for (const lot of STOCK_TOKEN_TRADING_LOTS) {
      const status = lots[lot]?.trim().toUpperCase();
      if (status && TRADING_STATUS_PATTERN.test(status)) kept[lot] = status;
    }
    if (Object.keys(kept).length > 0) out[session] = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const deploymentOn = (
  deployments: z.infer<typeof deploymentSchema>[] | null | undefined,
  chainId: number,
): string | undefined => {
  for (const deployment of deployments ?? []) {
    if (Number(deployment.chainId) !== chainId) continue;
    const address = deployment.contractAddress?.trim().toLowerCase();
    if (address && ADDRESS_PATTERN.test(address)) return address;
  }
  return undefined;
};

export function createRobinhoodStockAssetsAdapter(): SourceAdapter<
  StockTokenAssetsInput,
  StockTokenAsset[]
> {
  return {
    name: 'robinhood-stock-assets',

    canHandle(input) {
      return input.chainId > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<StockTokenAsset[]>> {
      const base = (input.baseUrl ?? ROBINHOOD_STOCK_API_DEFAULT_BASE_URL).replace(/\/$/, '');

      return performSourceFetch(
        ctx,
        { url: `${base}/assets`, conditional: true },
        {
          schema: assetsResponseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: ASSETS_CACHE_TTL_SECONDS,
          normalize: (raw): StockTokenAsset[] => {
            const assets: StockTokenAsset[] = [];
            const seen = new Set<string>();
            for (const asset of raw.assets ?? []) {
              const symbol = asset.tokenSymbol?.trim().toUpperCase();
              const contractAddress = deploymentOn(asset.deployments, input.chainId);
              // Only equities deployed on the requested chain, and only with
              // a symbol the price endpoint can be asked for.
              if (!symbol || !SYMBOL_PATTERN.test(symbol) || !contractAddress) continue;
              if (seen.has(contractAddress)) continue;
              seen.add(contractAddress);

              const multiplier = toNumber(asset.currentMultiplier);
              const pending = toNumber(asset.pendingMultiplier);
              const multiplierText = stockTokenDecimal(asset.currentMultiplier);
              const pendingMultiplierText = stockTokenDecimal(asset.pendingMultiplier);
              assets.push({
                chainId: input.chainId,
                contractAddress,
                id: asset.id?.trim() || contractAddress,
                symbol,
                // A missing multiplier means one share per token, the launch state.
                multiplier: multiplier !== undefined && multiplier > 0 ? multiplier : 1,
                ...opt('pendingMultiplier', pending !== undefined && pending > 0 ? pending : undefined),
                ...opt('name', asset.tokenName?.trim() || undefined),
                ...opt('status', asset.status?.trim() || undefined),
                ...opt('logoUrl', cleanHttpUrl(asset.logoUrl)),
                ...opt('decimals', asset.tokenDecimals ?? undefined),
                ...opt('multiplierText', multiplierText),
                ...opt('pendingMultiplierText', pendingMultiplierText),
                ...opt('tradingCapabilities', tradingCapabilitiesOf(asset.tradingCapabilities)),
              });
            }
            return assets;
          },
        },
      );
    },
  };
}

export function createRobinhoodStockPriceAdapter(): SourceAdapter<
  StockTokenPriceInput,
  StockTokenQuote
> {
  return {
    name: 'robinhood-stock-price',

    canHandle(input) {
      return input.chainId > 0 && SYMBOL_PATTERN.test(input.symbol);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<StockTokenQuote>> {
      const base = (input.baseUrl ?? ROBINHOOD_STOCK_API_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/prices/${encodeURIComponent(input.symbol)}`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: priceResponseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: PRICE_CACHE_TTL_SECONDS,
          normalize: (raw): StockTokenQuote => {
            const quote = (raw.quotes ?? []).find(
              (entry) => entry.tokenSymbol?.trim().toUpperCase() === input.symbol,
            );
            const bid = toNumber(quote?.bid);
            const ask = toNumber(quote?.ask);
            if (!quote || bid === undefined || ask === undefined || bid <= 0 || ask <= 0) {
              // The endpoint answered for a symbol with no usable quote: that
              // is "no reading", surfaced as a schema error the caller skips.
              throw new Error(`no usable quote for ${input.symbol}`);
            }
            const generatedAt = quote.generatedAt ? new Date(quote.generatedAt) : undefined;
            return {
              chainId: input.chainId,
              symbol: input.symbol,
              bid,
              ask,
              mid: (bid + ask) / 2,
              currency: quote.currency?.trim().toUpperCase() || 'USD',
              tradingHalted: quote.isTradingHalt === true,
              sourceUrl: url,
              ...opt('contractAddress', deploymentOn(quote.deployments, input.chainId)),
              ...opt(
                'generatedAt',
                generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : undefined,
              ),
            };
          },
        },
      );
    },
  };
}

/**
 * The USD price of one token: the underlying share price times the shares a
 * token represents. Only USD quotes are converted; anything else is unknown.
 */
export function stockTokenPriceUsd(
  quote: Pick<StockTokenQuote, 'mid' | 'currency'>,
  asset: Pick<StockTokenAsset, 'multiplier'>,
): number | undefined {
  if (quote.currency !== 'USD') return undefined;
  const price = quote.mid * asset.multiplier;
  return Number.isFinite(price) && price > 0 ? price : undefined;
}
