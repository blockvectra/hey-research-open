/**
 * Which measure a valuation is: the one rule (2026-09-26, audit M1 G5).
 *
 * Two rules used to decide it. Cards, lists and the map asked whether the
 * provider sent the same number as its market cap and its FDV (a provider
 * with no circulating supply does, and that number is an FDV — the founder's
 * 2026-09-23 rule). The daily series, which stores one valuation per day and
 * so cannot see the provider's two fields, asked whether the close implied at
 * least 98 % of the token's total supply. On 91 published tokens the two
 * disagreed: the list said "FDV" and the chart said "Market cap" for the same
 * figure.
 *
 * Now there is one rule, in order:
 *
 *  1. No positive valuation: no kind.
 *  2. The provider's FDV equals the valuation (or the reading carried no
 *     market cap, so the valuation *is* the FDV): `fdv`.
 *  3. The valuation implies at least `FDV_IMPLIED_SUPPLY_SHARE` of the total
 *     supply at the reading's price: `fdv` — a whole-supply valuation is an
 *     FDV whatever the provider named it.
 *  4. The provider's fields are known and differ: `marketCap`, a circulating
 *     figure.
 *  5. The provider's fields are unknown (a stored daily close whose snapshot
 *     is gone) and the supply test did not say `fdv`: no kind. An FDV is never
 *     called a market cap on a guess; unknown prints as "Valuation".
 *
 * Pure and dependency-free, so `@hey/ui` can import it from the browser. The
 * SQL twin is `marketValuationKindSql` in `@hey/domain`; a parity test holds
 * the two together.
 */
export type ValuationKind = 'marketCap' | 'fdv';

/** A close at or above this share of price × total supply values the whole supply. */
export const FDV_IMPLIED_SUPPLY_SHARE = 0.98;

export type ValuationKindInput = {
  /** The valuation printed: the reading's market cap, or its FDV where it has none. */
  valueUsd: number | null | undefined;
  /**
   * The same reading's FDV as the provider sent it; null or undefined when it
   * sent none. Ignored when `providerFieldsKnown` is false.
   */
  fdvUsd?: number | null | undefined;
  /**
   * False when the caller holds only the valuation and not the provider's two
   * fields (the daily index stores one column). Default true.
   */
  providerFieldsKnown?: boolean;
  /** `valueUsd / priceUsd / totalSupply`, where HEY knows the price and the supply. */
  impliedSupplyShare?: number | null | undefined;
};

const positive = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function valuationKindOf(input: ValuationKindInput): ValuationKind | null {
  const { valueUsd, fdvUsd, impliedSupplyShare } = input;
  const providerFieldsKnown = input.providerFieldsKnown ?? true;
  if (!positive(valueUsd)) return null;
  if (providerFieldsKnown && (!positive(fdvUsd) ? false : fdvUsd === valueUsd)) return 'fdv';
  if (typeof impliedSupplyShare === 'number' && Number.isFinite(impliedSupplyShare) && impliedSupplyShare >= FDV_IMPLIED_SUPPLY_SHARE) return 'fdv';
  return providerFieldsKnown ? 'marketCap' : null;
}

/**
 * `valueUsd / priceUsd / totalSupply` when all three are positive; undefined
 * otherwise. The share a valuation implies of the whole supply.
 */
export function impliedSupplyShareOf(
  valueUsd: number | null | undefined,
  priceUsd: number | null | undefined,
  totalSupply: number | null | undefined,
): number | undefined {
  if (!positive(valueUsd) || !positive(priceUsd) || !positive(totalSupply)) return undefined;
  return valueUsd / priceUsd / totalSupply;
}
