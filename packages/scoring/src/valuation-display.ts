import { DEAD_MARKET_STATUSES, marketIsLive, type TokenMarketStatusValue } from './token-market';
import { valuationKindOf, type ValuationKind } from './valuation-kind';

/**
 * Whether a valuation is printed, and under which name (data-correctness pass,
 * 2026-09-28): the one rule for the card, the project header, the project
 * page's Market context, the Terminal catalogue, search's launch-record rows
 * and the API's `publishedValuation`.
 *
 * Each surface used to decide the two halves on its own. The card derived its
 * label from a figure it then hid, and fell back on "Market cap" when it held
 * none, so one row of cards read "Valuation · No active market" and the next
 * "Market cap · No active market" — a kind printed over no value. The card
 * kept its own list of dead markets, and the launch-record rows kept none.
 *
 *   1. A market that is not live (`marketIsLive`) prints no figure. A dead
 *      status or a dead reason is `no_active_market`; readings that disagree
 *      or that HEY does not believe are `unconfirmed` — neither live nor dead.
 *   2. No positive reading is `no_reading`.
 *   3. Otherwise the figure is shown, named by `valuationKindOf` (a reading the
 *      rule cannot name is printed under the provider's own field, market cap).
 *
 * When nothing is shown there is no kind, and the label says "Valuation",
 * which claims neither measure.
 *
 * Pure and dependency-free, like `valuationKindOf`, so `@hey/ui` imports it.
 */
export type ValuationHidden = 'no_active_market' | 'unconfirmed' | 'no_reading';

export type ValuationDisplay =
  | { shown: true; usd: number; kind: ValuationKind }
  | { shown: false; state: ValuationHidden; reason: string };

/**
 * Reasons under which HEY claims neither a live market nor a dead one: a
 * subset of `DEAD_MARKET_REASONS` (they are not live), printed "Unconfirmed"
 * rather than "No active market".
 */
export const UNSETTLED_MARKET_REASONS = ['pool_readings_disagree', 'readings_implausible', 'removal_unconfirmed'] as const;

export type ValuationDisplayInput = {
  /** The reading's valuation: its market cap, or its FDV where it sent none. */
  valueUsd: number | null | undefined;
  fdvUsd?: number | null | undefined;
  marketStatus?: TokenMarketStatusValue | string | null | undefined;
  marketReason?: string | null | undefined;
};

const positive = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function valuationDisplay(input: ValuationDisplayInput): ValuationDisplay {
  const status = (input.marketStatus ?? null) as TokenMarketStatusValue | null;
  const reason = input.marketReason ?? null;
  if (!marketIsLive(status, reason)) {
    const deadStatus = status !== null && (DEAD_MARKET_STATUSES as readonly string[]).includes(status);
    const unsettled = !deadStatus && reason !== null && (UNSETTLED_MARKET_REASONS as readonly string[]).includes(reason);
    return { shown: false, state: unsettled ? 'unconfirmed' : 'no_active_market', reason: reason ?? status ?? 'market_not_live' };
  }
  if (!positive(input.valueUsd)) return { shown: false, state: 'no_reading', reason: 'no_reading' };
  return { shown: true, usd: input.valueUsd, kind: valuationKindOf({ valueUsd: input.valueUsd, fdvUsd: input.fdvUsd }) ?? 'marketCap' };
}

/**
 * The name a valuation is printed under, from the display:
 *  - `card` — the card's information budget has no FDV (PRD V4 16.0 D): an
 *    FDV is "Valuation" with the measure in its tooltip;
 *  - `long` — "Fully diluted valuation" / "Market cap";
 *  - `short` — "FDV" / "Market cap".
 * Nothing shown is always "Valuation".
 */
export function valuationDisplayLabel(display: ValuationDisplay, style: 'card' | 'long' | 'short' = 'long'): string {
  if (!display.shown) return 'Valuation';
  if (display.kind === 'marketCap') return 'Market cap';
  return style === 'card' ? 'Valuation' : style === 'short' ? 'FDV' : 'Fully diluted valuation';
}

/** The word printed where no figure is: one vocabulary for every surface. */
export const VALUATION_HIDDEN_WORDS: Readonly<Record<ValuationHidden, string>> = {
  no_active_market: 'No active market',
  unconfirmed: 'Unconfirmed',
  no_reading: 'Unavailable',
};

/** Why no figure is printed, for a tooltip. */
export const VALUATION_HIDDEN_HELP: Readonly<Record<ValuationHidden, string>> = {
  no_active_market: 'The tracked token has no active market. Context only; it never affects activity status.',
  unconfirmed: 'HEY’s market readings for this token do not agree, so no figure is shown. Context only; it never affects activity status.',
  no_reading: 'HEY holds no recent market reading for this token.',
};
