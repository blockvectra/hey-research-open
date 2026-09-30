import { describe, expect, it } from 'vitest';

import { STILL_BUILDING_STATES, STILL_BUILDING_WITHHELD_REASONS, stillBuildingState } from './discovery-gap';

/**
 * `stillBuildingState` (round 4, 2026-09-30): the three states sent beside the
 * v1 boolean, derived only from what the scorer persisted.
 */
describe('stillBuildingState', () => {
  it('lists exactly three states', () => {
    expect(STILL_BUILDING_STATES).toEqual(['HELD', 'NOT_HELD', 'NOT_MEASURED']);
  });

  it('HELD when the badge is held, whatever a stale reason says', () => {
    expect(stillBuildingState(true, {})).toBe('HELD');
    expect(stillBuildingState(true, { stillBuildingWithheld: 'market_too_thin' })).toBe('HELD');
  });

  it('NOT_MEASURED when there is no score row', () => {
    expect(stillBuildingState(undefined, undefined)).toBe('NOT_MEASURED');
    expect(stillBuildingState(null, {})).toBe('NOT_MEASURED');
  });

  it('NOT_MEASURED beside every reason the scorer writes', () => {
    for (const reason of STILL_BUILDING_WITHHELD_REASONS) expect(stillBuildingState(false, { stillBuildingWithheld: reason })).toBe('NOT_MEASURED');
  });

  it('NOT_MEASURED when the valuation gate withheld the current valuation (hbm-v20, 2026-09-30)', () => {
    expect(STILL_BUILDING_WITHHELD_REASONS).toContain('valuation_not_plausible');
    expect(stillBuildingState(false, { stillBuildingWithheld: 'valuation_not_plausible', marketValuationWithheld: 'valuation_over_liquidity' })).toBe('NOT_MEASURED');
  });

  it('NOT_HELD when measured and not held, and for a score from before hbm-v19', () => {
    expect(stillBuildingState(false, { stillBuildingWithheld: null })).toBe('NOT_HELD');
    expect(stillBuildingState(false, {})).toBe('NOT_HELD');
    expect(stillBuildingState(false, null)).toBe('NOT_HELD');
    // A gap-only reason is not a Still Building reason.
    expect(stillBuildingState(false, { stillBuildingWithheld: 'no_token' })).toBe('NOT_HELD');
  });
});
