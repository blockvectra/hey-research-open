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
 * hbm-v1: the M5 implementation of PRD V4 §11 — the five HBM components and
 * their weights, the activity thresholds, the first Discovery Gap. No note was
 * written at the time; 11,572 history rows carry it.
 *
 * hbm-v4 (2026-09-11): the tag live at the repository's fresh-history squash.
 * Its rule set is the v3 set with the 2026-09-06 change that a bare
 * `CONTRACT_DEPLOY` is a launch rather than building (`significance.ts`).
 * Recorded after the fact from the audit trail (2026-09-18).
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
 *
 * hbm-v7 (2026-09-18), five changes, two of which landed on 2026-09-17 without
 * a bump and are recorded here: Still Building measures against the daily
 * close and refuses a high younger than `STILL_BUILDING.minDrawdownAgeDays`;
 * the Discovery Gap's two percentiles are taken over one cohort — every
 * project with a market reading — and both are persisted with the gap; consistency buckets are UTC ISO weeks rather than seven-day
 * spans from the rescore clock; a comeback is measured from the whole
 * comeback cluster to the last event before it; and a page with no observable
 * source reads UNKNOWN rather than QUIET.
 */
export const SCORING_VERSION = 'hbm-v7' as const;
/** Every version a stored snapshot may carry; each has a note above. */
export const SCORING_VERSIONS = ['hbm-v1', 'hbm-v2', 'hbm-v3', 'hbm-v4', 'hbm-v5', 'hbm-v6', 'hbm-v7'] as const;
export type ScoringVersion = (typeof SCORING_VERSIONS)[number];
