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
 *
 * hbm-v8 (2026-09-18): a project's `CODE_ACTIVITY` counts once per UTC ISO
 * week, not once per UTC day (`collapseSameWeekCodeActivity`). Ingestion has
 * written one commit summary per repository per ISO week since 2026-09-15,
 * each dated that repository's last commit, so a project with four
 * repositories committing on four days of one week held four rows on four
 * days and the per-day collapse of hbm-v3 let every one of them through —
 * repository count was raising recency, significance and the "two meaningful
 * updates" activity rule again. Weights and thresholds are unchanged; only
 * multi-repository projects move, downward. Two further rules changed the
 * same day without touching a weight and are recorded here: Still Building
 * refuses a project whose newest market reading is older than a day
 * (`marketDataFresh`, as Under the Radar already did) and measures against
 * the daily-close history whenever one exists rather than against whichever
 * of that and a raw spot snapshot was greater; and token market status only
 * calls liquidity "removed" on a peak-relative fall when what is left is
 * under `TOKEN_MARKET.removedMaxAbsoluteUsd`.
 */
/*
 * hbm-v9 (2026-09-24): Under the Radar refuses a token whose market is dead
 * (`marketIsLive`: no liquidity, liquidity removed, abandoned, or a launch
 * pool never traded), as Still Building has since 2026-09-11. No weight,
 * threshold or Build Momentum figure moves; only the badge, and only for
 * those tokens.
 */
/*
 * hbm-v10 (2026-09-24): a GitHub organisation source is no longer coverage.
 * The source refresh reads repositories, feeds and changelogs — never an
 * organisation page — yet an organisation source was stamped "last checked"
 * when it was created and counted as a source HEY had looked at, so a project
 * whose only GitHub link was its organisation could be called DORMANT ("we
 * looked and saw nothing") when HEY had never looked. In production 30
 * published projects were DORMANT and 3 QUIET on that basis; they read
 * UNKNOWN until a repository, feed or changelog is found. A disputed or
 * retracted source is not coverage either (no production outcome moves: each
 * is also context-only today). No weight, threshold or Build Momentum figure
 * changes.
 */
/*
 * hbm-v11 (2026-09-25, founder's rule): a GitHub prerelease counts at most
 * once per project per UTC ISO week, the same collapse as code activity
 * (`collapseSameWeekCodeActivity`, and `buildingEvidenceSql` for every SQL
 * count). A full release is never collapsed. In production 62 projects held
 * 492 prereleases — one carried sixty in thirty days — each counted as a
 * release. No weight or threshold changes; only projects publishing more than
 * one prerelease in a week move, downward.
 */
/*
 * hbm-v12 (2026-09-25, 10-agent audit): two repairs, no weight or threshold
 * change. (1) hbm-v11's weekly prerelease rule now reaches the score: the
 * scorer selected the prerelease flag but never passed it on, so every row
 * stamped hbm-v11 was computed without it (26 projects, 227 extra same-week
 * prereleases in production). (2) The Still Building decline is measured on
 * one basis: the history high was FDV while the current value was market cap
 * first, which overstated every decline where circulating supply is below
 * total supply (giga: 98.4% printed, 71.9% by price). The decline now reads
 * the price, scaled into the current reading's valuation basis.
 */
export const SCORING_VERSION = 'hbm-v12' as const;
/** Every version a stored snapshot may carry; each has a note above. */
export const SCORING_VERSIONS = ['hbm-v1', 'hbm-v2', 'hbm-v3', 'hbm-v4', 'hbm-v5', 'hbm-v6', 'hbm-v7', 'hbm-v8', 'hbm-v9', 'hbm-v10', 'hbm-v11', 'hbm-v12'] as const;
export type ScoringVersion = (typeof SCORING_VERSIONS)[number];
