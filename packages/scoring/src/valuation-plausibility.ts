/**
 * Whether a valuation is plausible from the readings HEY holds (founder
 * decision, round 4, 2026-09-30): the one gate, with its thresholds.
 *
 * A valuation — a market cap or an FDV — is **not plausible** when
 *
 *  1. it is at least `maxLiquidityMultiple` (10,000×) the liquidity measured
 *     in the same reading (`valuation_over_liquidity`); or
 *  2. it exceeds `unlistedCeilingUsd` ($10B) on a Robinhood Chain token that
 *     no listing HEY reads carries (`unlisted_over_ceiling`).
 *
 * An implausible valuation is never labelled FACT and never used as an input
 * anywhere a valuation is used: the card, the project page, the Terminal,
 * search, the API, the snapshot, the agent contract, the explain engine, the
 * listing sorts and filters, the Discovery Gap's market percentile, Still
 * Building's drawdown and Under the Radar. It is printed as "valuation not
 * plausible from the readings HEY has", with its reason. The reading's
 * price, liquidity and volume are untouched: this gate objects to the
 * valuation alone.
 *
 * What is checked is the reading's *largest* valuation — its FDV when it
 * carries one, otherwise its market cap — and the verdict holds for both
 * figures of that reading: a reading whose FDV is not plausible does not get
 * to print its market cap as though the rest of it were sound.
 *
 * Unknown is never a trip wire. With no positive liquidity reading rule 1 is
 * silent (a missing figure is not a zero), and with the listing unknown —
 * HEY holds no CoinGecko quote for the token and no registry read to check
 * it against — rule 2 is silent. HEY reads CoinGecko (its registry of
 * Robinhood Chain coins, daily, and its quotes); it reads no CoinMarketCap
 * source, so a token listed only there is not seen as listed.
 *
 * Pure and dependency-free, like `valuationKindOf`, so `@hey/ui` can import
 * it. The SQL twin is `valuationImplausibleSql` in `@hey/domain`, generated
 * from the same constants; an integration test holds the two together.
 */
export const VALUATION_PLAUSIBILITY = {
  /** At or above this multiple of the same reading's liquidity, a valuation is not plausible. */
  maxLiquidityMultiple: 10_000,
  /** Above this, a Robinhood Chain token needs a listing HEY reads for its valuation to be plausible. */
  unlistedCeilingUsd: 10_000_000_000,
  /** The chain rule 2 is about: Robinhood Chain (`ROBINHOOD_CHAIN_ID` in `@hey/config`; a test holds the two). */
  chainId: 4663,
} as const;

/** The rules' version, carried by the explain engine's valuation rule. */
export const VALUATION_PLAUSIBILITY_VERSION = 'valuation-plausibility-2026-09-30' as const;

export const VALUATION_IMPLAUSIBLE_REASONS = [
  'valuation_over_liquidity',
  'unlisted_over_ceiling',
] as const;
export type ValuationImplausibleReason = (typeof VALUATION_IMPLAUSIBLE_REASONS)[number];

/** Whether a listing HEY reads carries the token: `unknown` when HEY cannot say. */
export type ValuationListing = 'listed' | 'not_listed' | 'unknown';

export type ValuationPlausibilityInput = {
  /** The reading's market cap. */
  marketCapUsd?: number | null | undefined;
  /** The reading's FDV. */
  fdvUsd?: number | null | undefined;
  /** The same reading's liquidity; absent or non-positive means not measured. */
  liquidityUsd?: number | null | undefined;
  /** The token's chain. */
  chainId?: number | null | undefined;
  /** Whether a listing HEY reads carries the token; omitted is `unknown`. */
  listing?: ValuationListing | null | undefined;
};

export type ValuationPlausibility =
  { plausible: true } | { plausible: false; reason: ValuationImplausibleReason };

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The figure the gate checks: the reading's largest positive valuation, or undefined when it carries none. */
export function valuationUnderTest(
  input: Pick<ValuationPlausibilityInput, 'marketCapUsd' | 'fdvUsd'>,
): number | undefined {
  const values = [input.marketCapUsd, input.fdvUsd].filter(positive);
  return values.length === 0 ? undefined : Math.max(...values);
}

export function valuationPlausibility(input: ValuationPlausibilityInput): ValuationPlausibility {
  const value = valuationUnderTest(input);
  if (value === undefined) return { plausible: true };
  if (
    positive(input.liquidityUsd) &&
    value >= input.liquidityUsd * VALUATION_PLAUSIBILITY.maxLiquidityMultiple
  ) {
    return { plausible: false, reason: 'valuation_over_liquidity' };
  }
  if (
    input.chainId === VALUATION_PLAUSIBILITY.chainId &&
    value > VALUATION_PLAUSIBILITY.unlistedCeilingUsd &&
    input.listing === 'not_listed'
  ) {
    return { plausible: false, reason: 'unlisted_over_ceiling' };
  }
  return { plausible: true };
}

/** A stored or transported reason read back: one of the list, or undefined for anything else. */
export function valuationImplausibleReason(value: unknown): ValuationImplausibleReason | undefined {
  return typeof value === 'string' &&
    (VALUATION_IMPLAUSIBLE_REASONS as readonly string[]).includes(value)
    ? (value as ValuationImplausibleReason)
    : undefined;
}

/** The one phrase every surface prints where an implausible valuation would be. */
export const VALUATION_NOT_PLAUSIBLE_WORDS =
  'Valuation not plausible from the readings HEY has' as const;

/** Each reason in words, after the phrase above. */
export const VALUATION_IMPLAUSIBLE_WORDS: Readonly<Record<ValuationImplausibleReason, string>> = {
  valuation_over_liquidity: `it is at least ${VALUATION_PLAUSIBILITY.maxLiquidityMultiple.toLocaleString('en-US')}× the liquidity measured in the same reading`,
  unlisted_over_ceiling: `it is above $${VALUATION_PLAUSIBILITY.unlistedCeilingUsd / 1_000_000_000}B on a Robinhood Chain token that no listing HEY reads carries (HEY reads CoinGecko)`,
};

/** "Valuation not plausible from the readings HEY has: <reason>." — one sentence, for tooltips, the API and agents. */
export function valuationNotPlausibleSentence(reason: ValuationImplausibleReason): string {
  return `${VALUATION_NOT_PLAUSIBLE_WORDS}: ${VALUATION_IMPLAUSIBLE_WORDS[reason]}. Context only; it never affects activity status or any score.`;
}
