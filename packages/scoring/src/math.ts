/**
 * Shared numeric helpers for deterministic scoring.
 *
 * Kept dependency-free and pure so score outputs are reproducible from inputs
 * alone. No market-return, wallet or holder input may ever reach these.
 */

/** Clamp a value into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Clamp into the 0..100 range used by every HEY score component. */
export function clampScore(value: number): number {
  return clamp(value, 0, 100);
}

/**
 * Renormalise weights when some inputs are missing (PRD V4 section 13.1).
 * Returns an empty array when no weight remains, so callers can report "unknown"
 * rather than fabricating a score.
 */
export function renormalizeWeights(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return [];
  return weights.map((weight) => weight / total);
}

/**
 * Percentile rank of `value` within `cohort`, 0..100.
 * Uses the midpoint of strictly-below and equal-to counts so ties are stable and
 * a cohort of identical values scores 50 rather than 0 or 100.
 */
export function percentileRank(value: number, cohort: readonly number[]): number {
  const finite = finiteOnly(cohort);
  if (finite.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const entry of finite) {
    if (entry < value) below += 1;
    else if (entry === value) equal += 1;
  }
  return clampScore(((below + equal / 2) / finite.length) * 100);
}

/**
 * A cohort member that is not a number ranks nobody. `NaN` compares false
 * both ways in the linear scan (so it only inflated the denominator) and is
 * placed unpredictably by `sort`, which broke the bisection for every other
 * value in the cohort (2026-09-17). Both rankers drop it.
 */
function finiteOnly(cohort: readonly number[]): number[] {
  return cohort.filter((entry) => Number.isFinite(entry));
}

/**
 * The same percentile rank as `percentileRank`, prepared once for a whole
 * cohort. Sorting once and bisecting turns a cohort rebuild from quadratic
 * into n log n, which matters at a few thousand projects and is free at ten.
 * Results are identical to `percentileRank` for every value, ties included.
 */
export function percentileRanker(cohort: readonly number[]): (value: number) => number {
  const sorted = finiteOnly(cohort).sort((a, b) => a - b);
  const size = sorted.length;
  if (size === 0) return () => 0;

  // First index whose entry is not below `value` (strictly-below count).
  const lowerBound = (value: number): number => {
    let low = 0;
    let high = size;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((sorted[mid] as number) < value) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  // First index whose entry is above `value` (below + equal count).
  const upperBound = (value: number): number => {
    let low = 0;
    let high = size;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((sorted[mid] as number) <= value) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  return (value: number) => {
    const below = lowerBound(value);
    const equal = upperBound(value) - below;
    return clampScore(((below + equal / 2) / size) * 100);
  };
}
