import { describe, expect, it } from 'vitest';

import { FDV_IMPLIED_SUPPLY_SHARE, impliedSupplyShareOf, valuationKindOf } from './valuation-kind';

/**
 * One valuation-kind rule (2026-09-26, audit M1 G5). The card named a figure
 * by provider equality, the daily series by implied supply, and 91 published
 * tokens got opposite answers. These cases are the shapes behind them.
 */
describe('valuationKindOf: the one rule', () => {
  it('has no kind without a positive valuation', () => {
    expect(valuationKindOf({ valueUsd: undefined })).toBeNull();
    expect(valuationKindOf({ valueUsd: 0, fdvUsd: 0 })).toBeNull();
    expect(valuationKindOf({ valueUsd: Number.NaN })).toBeNull();
  });

  it('calls the same number sent as market cap and FDV an FDV (the founder rule, 2026-09-23)', () => {
    expect(valuationKindOf({ valueUsd: 6_081_071, fdvUsd: 6_081_071 })).toBe('fdv');
    // A reading with only an FDV prints it as the valuation: equal, so FDV.
    expect(valuationKindOf({ valueUsd: 1_050_000, fdvUsd: 1_050_000, impliedSupplyShare: 0.6 })).toBe('fdv');
  });

  // Audit §45 finding 24: the share decides only where the provider's fields are unknown, so a card
  // (which holds no supply) and the day's close (which does) cannot name one reading two ways.
  it('lets the provider’s known fields decide, whatever the supply share', () => {
    expect(valuationKindOf({ valueUsd: 990_000, fdvUsd: 1_000_000, impliedSupplyShare: 0.99 })).toBe('marketCap');
    expect(valuationKindOf({ valueUsd: 990_000, fdvUsd: 1_000_000, impliedSupplyShare: FDV_IMPLIED_SUPPLY_SHARE })).toBe(
      valuationKindOf({ valueUsd: 990_000, fdvUsd: 1_000_000 }),
    );
    expect(valuationKindOf({ valueUsd: 990_000, providerFieldsKnown: false, impliedSupplyShare: FDV_IMPLIED_SUPPLY_SHARE })).toBe('fdv');
  });

  it('calls a figure below the FDV, with the provider fields known, a market cap', () => {
    expect(valuationKindOf({ valueUsd: 400_000, fdvUsd: 1_000_000 })).toBe('marketCap');
    expect(valuationKindOf({ valueUsd: 400_000, fdvUsd: 1_000_000, impliedSupplyShare: 0.4 })).toBe('marketCap');
    expect(valuationKindOf({ valueUsd: 400_000, fdvUsd: null })).toBe('marketCap');
  });

  it('gives a stored close with unknown provider fields a kind only when the supply test decides it', () => {
    expect(valuationKindOf({ valueUsd: 1_000_000, providerFieldsKnown: false, impliedSupplyShare: 1 })).toBe('fdv');
    // aeva's shape: below the supply line, and HEY cannot see whether the provider sent one number twice.
    expect(valuationKindOf({ valueUsd: 1_000_000, providerFieldsKnown: false, impliedSupplyShare: 0.5 })).toBeNull();
    expect(valuationKindOf({ valueUsd: 1_000_000, providerFieldsKnown: false })).toBeNull();
    // With the closing reading's fields, the day agrees with the card.
    expect(valuationKindOf({ valueUsd: 1_050_000, fdvUsd: 1_050_000, impliedSupplyShare: 0.5 })).toBe('fdv');
  });

  it('computes the implied share only from positive figures', () => {
    expect(impliedSupplyShareOf(1_000, 1, 1_000)).toBe(1);
    expect(impliedSupplyShareOf(1_000, 0, 1_000)).toBeUndefined();
    expect(impliedSupplyShareOf(1_000, 1, undefined)).toBeUndefined();
    expect(impliedSupplyShareOf(undefined, 1, 1_000)).toBeUndefined();
  });
});
