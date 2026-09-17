/**
 * Scoring algorithms are deterministic and versioned; every persisted score
 * snapshot stores the version that produced it (CLAUDE.md engineering quality).
 *
 * The HBM / market-context / Discovery Gap implementations land in M5.
 */
/**
 * Bump whenever any weight, threshold or formula changes. The version is stored
 * with every score snapshot so history stays explainable.
 *
 * hbm-v2 (2026-09-04): the percentile cohort behind Discovery Gap is the
 * published catalogue rather than every scored row, and Under the Radar
 * eligibility is persisted with the snapshot. HBM weights are unchanged.
 *
 * hbm-v3 (2026-09-05): a project's `CODE_ACTIVITY` counts once per UTC day
 * however many repositories produced one (`meaningfulEvents`). Weights and
 * thresholds are unchanged; only projects with several repositories
 * committing on the same day score differently — lower recency and
 * significance credit, and one same-day multi-repository commit no longer
 * satisfies the "two meaningful updates" activity rule by itself. Nine
 * builder pages in production were affected on 2026-09-04.
 *
 * hbm-v5 (2026-09-13): Under the Radar's HBM floor moves from 45 to 30
 * (`UNDER_THE_RADAR.minHbm`). Weights, HBM and Discovery Gap formulas are
 * unchanged; only eligibility for the surface widens — measured on
 * production: 16 → 29 projects with a live market and verified building.
 *
 * hbm-v6 (2026-09-17): Under the Radar requires at least one meaningful event
 * in the window that is not a `CODE_ACTIVITY` summary
 * (`UNDER_THE_RADAR.requireShipBeyondCommits`). Two days of commits cleared the
 * floor while one feature release did not; the surface ranked committing above
 * shipping. Weights, HBM and Discovery Gap formulas are unchanged.
 */
export const SCORING_VERSION = 'hbm-v6' as const;
export type ScoringVersion = typeof SCORING_VERSION;
