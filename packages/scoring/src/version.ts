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
/*
 * hbm-v13 (2026-09-25, reconciliation): no weight or threshold change.
 * (1) A repository whose activity HEY records under another project (the same
 * release or commit ids already held by an earlier page) is not coverage for
 * this one: with only held-elsewhere activity the answer is UNKNOWN, not
 * DORMANT — HEY saw the repo move, just not as this project's evidence.
 * (2) The build streak counts UTC ISO weeks, like consistency already did; a
 * week still in progress with no ship yet does not break it.
 */
/*
 * hbm-v14 (2026-09-25, GeckoTerminal pool selection): no weight or threshold
 * change. The current market value the Still Building decline is measured
 * against no longer comes from a dead pool's reading (liquidity at or under
 * $100) while an equally fresh reading of a pool with liquidity exists.
 * Priviet's DEX Screener pool held $1 and priced the token 4x under the pool
 * that trades.
 */
/*
 * hbm-v15 (2026-09-25, founder decisions F5 and A4-07): no weight or threshold
 * change. (1) The market cohort — the market-context percentile, the
 * Discovery Gap, Still Building and Under the Radar — holds only projects
 * with a live market (`marketIsLive`); 33 published dead-market pages had a
 * Discovery Gap averaging 63.9. (2) It also leaves out a project whose token
 * nothing it publishes ties to it: token not VERIFIED and every site, docs,
 * feed and repository source context-only (`marketNotTheProjectsSql`) —
 * `chainlink` on a $25 pool of bridged LINK. HEY stores no bridge marker, so
 * this is the conservative rule, not a bridge detector. (3) The Still
 * Building high from a daily close is dated to the end of its day and must be
 * strictly older than the seven-day floor; a same-day release no longer
 * counts as building "since the decline".
 */
/*
 * hbm-v16 (2026-09-27, founder rulings G1 and G2): no weight or threshold
 * change. (1) A week of code activity HEY read in full and found to be
 * documentation or maintenance only — README, docs, dependency lockfiles,
 * generated output, assets, whitespace or pure renames
 * (`commit-substance-v1`) — is not meaningful: it moves no activity status,
 * Build Momentum, badge, signal count or qualification count. A week HEY has
 * not read yet (null or UNKNOWN) counts exactly as before; the absence of
 * HEY's reading never demotes a project. (2) Still Building requires a
 * meaningful event beyond commit summaries in its 30-day window, as Under the
 * Radar has since hbm-v6. (3) Merge commits (more than one parent) are no
 * longer counted in commit summaries, beside the message rule.
 */
/*
 * hbm-v17 (2026-09-27, founder ruling "data tak kira"): no weight or
 * threshold change. The commit classifier moves to commit-substance-v2, in
 * which a commit that changes only data files (JSON, CSV and the like outside
 * configuration) is documentation or maintenance only, so such a week is no
 * longer meaningful. The classifier version is part of the rules digest from
 * this version on: a classifier change forces a scoring version.
 */
/*
 * hbm-v18 (2026-09-30, founder decision "Discovery Gap on thin markets"): no
 * weight, threshold or Build Momentum figure changes. A project whose tracked
 * token's market status is not ACTIVE_MARKET — LOW_LIQUIDITY,
 * TRADING_INACTIVE, INSUFFICIENT_DATA — or whose only market is its launch
 * curve (`DISCOVERY_GAP`) gets no Discovery Gap and no Under the Radar: its
 * attention percentile sits near the floor, so the gap measured the thinness
 * of the market, not the building. The gap is null with
 * `components.discoveryGapWithheld: 'market_too_thin'`, never zero; every
 * other null gap carries its reason too. The population the others are
 * ranked against, their percentiles and gaps, and Still Building are
 * unchanged. On production on the day: 9 gaps and 5 Under the Radar badges
 * withdrawn (see docs/FOUNDER_DECISIONS_2026_09_30.md).
 */
/*
 * hbm-v19 (2026-09-30, founder delegation "Still Building on thin markets"):
 * no weight, threshold or Build Momentum figure changes. Still Building's
 * drawdown is measured only on the markets hbm-v18 measures a Discovery Gap on
 * (`STILL_BUILDING.requireMeasuredMarket`): a project whose tracked token's
 * market status is not ACTIVE_MARKET, or whose only market is its launch
 * curve, is not Still Building, with `components.stillBuildingWithheld:
 * 'market_too_thin'` ("not measured — market too thin"). The existing
 * withholds on a dead market and on a token that is not the project's carry
 * their reason the same way (`market_not_live`, `token_not_the_projects`).
 * Nothing else about the badge, and nothing about the gap, Under the Radar or
 * the population, changes.
 */
/*
 * hbm-v20 (2026-09-30, founder decision "valuation plausibility", round 4):
 * no weight, threshold or Build Momentum figure changes. A valuation that is
 * not plausible from the readings HEY has (`valuationPlausibility`,
 * `VALUATION_PLAUSIBILITY`: at least 10,000× the liquidity measured in the
 * same reading, or above $10B on a Robinhood Chain token that no listing HEY
 * reads carries) is never an input: it leaves the Discovery Gap's market
 * percentile (the remaining market figures are renormalised, as for any
 * missing one), it is no current value and no tracked high for Still
 * Building's drawdown, and a snapshot carrying one is never the high. The
 * reason is persisted as `components.marketValuationWithheld`. Price,
 * liquidity and volume, the population, Under the Radar's own rules and
 * activity status are unchanged.
 */
/*
 * hbm-v21 (2026-10-01, founder rulings F1, F2 and F6 of the UI/UX and
 * data-wiring audit): no weight, threshold or Build Momentum figure changes.
 * (1) F1, rescued markets: a token that is ACTIVE_MARKET only because another
 * pool of the same token holds the liquidity (`liquidity_in_another_pool`) is
 * measured on that pool's reading — the one the market classifier chose,
 * recorded on the token beside its status — for the Discovery Gap, Under the
 * Radar, Still Building and the valuation gate, never on the token's own thin
 * pool. With no current reading of that pool (or when the deepest reading was
 * HEY's chain pool index, which is every pool together and no pool's reading)
 * they are not measured: `active_pool_not_read`. The pool used is persisted
 * as `components.marketActivePool`. (2) F6: the stored Under the Radar flag
 * holds only beside a positive Discovery Gap
 * (`UNDER_THE_RADAR.requirePositiveGap`); the read-side predicate stays as a
 * guard. (3) F2: Still Building is not measured, never "not met", for a
 * project with no tracked token (`no_token`), no current reading of its market
 * (`no_market_reading`) or building HEY cannot read (`activity_unknown`);
 * the badge stays false and only its state changes. On production on the day
 * (read-only dry run): 5 visible rescued markets (deepstate-1da24f's gap 90.7
 * on its $170 pool, 32.3 on the $6.7K pool that makes its market active; 3
 * rescued by the chain pool index, withheld), 1 stored Under the Radar flag on
 * a gap at or below zero (orbio-so, -1.5), and 2,780 of 4,691 published
 * states moving from NOT_HELD to NOT_MEASURED
 * (docs/FOUNDER_DECISIONS_2026_09_30.md).
 */
/*
 * hbm-v22 (2026-10-02, founder delegation 2026-10-02, outsider-audit
 * data-truth repair): no weight, threshold or Build Momentum formula changes.
 * (1) The commit classifier moves to commit-substance-v3: a commit that
 * changes only CI configuration is maintenance (`ci_only`); a burst week (25
 * or more human commits) is building only when 3 of a 10-commit sample change
 * code, and reads "mostly maintenance or automation" when the sample is read
 * and too few could; commits from bot accounts (now also `*-bot` names and
 * bot e-mails) and from automated streams — one templated message repeated on
 * a clock, or carrying a changing timestamp or figures — are never counted,
 * and a week of nothing else is `automated_only`. (2) A launch pool is not a
 * measured market: a token ACTIVE_MARKET only as `launch_pool_trading` gets no
 * Discovery Gap, no Under the Radar and no Still Building
 * (`DISCOVERY_GAP.unmeasuredReasonPrefixes`), withheld as `market_too_thin`
 * and labelled "Launch pool only". Measured on production before the change
 * (read-only): 690 published projects on such a market held 40 gaps, 15 of
 * the 26 Under the Radar badges and 4 Still Building; 783 burst weeks since
 * W36 were decided on their first commit; 85 commits were SUBSTANTIVE on CI
 * files alone. Ship-eligibility repairs recorded the same day without a
 * scoring rule (they change the evidence, not the rules): date-stamped
 * automated tags are rolling tags (101 ships, 39 counted, on 8 projects), a
 * reader's comment is not a ship, and a sitemap, oEmbed document or comments
 * feed is never a release feed nor coverage (docs/FOUNDER_DECISIONS_2026_09_30.md,
 * "2026-10-02 shipping-signal repair").
 */
/*
 * hbm-v23 (2026-10-03, founder delegation, outsider audit "a release burst is
 * one ship"): no weight, threshold or Build Momentum formula changes. A
 * repository's full GitHub releases of one UTC day count once — one release
 * day, the newest corroborated release standing for it — in activity status,
 * Build Momentum, the streak, velocity and cadence (`collapseRepeatedEvidence`,
 * `RELEASE_BURST`) and in every SQL count of building (`buildingEvidenceSql`'s
 * release-day keeper). The repository is the `owner/repo` of the ship's
 * external id (`github-release:<owner>/<repo>:<id>`); a release whose
 * repository is not known is never collapsed. What did not change:
 * prereleases keep their weekly collapse (hbm-v11), two repositories on one
 * day still count as two, and no ship is deleted or retracted — every release
 * stays on the timeline with its provenance; only the count changes. Measured
 * on production before the change (read-only, 2026-10-03): digitaldon
 * (bambini-tech/digitaldon-public) carried 27 PUBLICLY_VERIFIED releases
 * published three seconds apart on 2026-10-01; over 90 days, counted full
 * GitHub releases grouped by project, repository and UTC day were 1,374 groups
 * of 1, 342 of 2, 153 of 3, 109 of 4–5, 78 of 6–10 and 33 of 11 or more (537
 * ships on 16 projects).
 */
/*
 * hbm-v24 (founder ruling 2026-10-03, "kira sekali" — count it once): no
 * weight, threshold or Build Momentum formula changes. A project's follow-up
 * contract deployments (`CONTRACT_DEPLOY_FOLLOWUP`) recorded in the same UTC
 * second count once — one deploy batch, the newest corroborated deploy
 * standing for it — in activity status, Build Momentum, the streak, velocity
 * and cadence (`collapseRepeatedEvidence`, `DEPLOY_BATCH`) and in every SQL
 * count of building (`buildingEvidenceSql`'s deploy-batch keeper), exactly as
 * hbm-v23 collapsed a repository's release day. The key is the project and
 * the UTC second of the block time the ship is dated to. What did not change:
 * deploys a second apart count apart, an upgrade is never part of a batch, and
 * no ship is deleted or retracted — every deploy stays on the timeline with
 * its creating transaction; only the count changes. Measured on production
 * before the change (read-only, 2026-10-03): 461 standing follow-up deploys on
 * 72 projects; 14 same-second batches held 36 of them (at most 6 per batch) on
 * 9 projects. Every batch was one deployer's; no two deploys shared a creating
 * transaction (each contract is its own transaction, in one or two blocks), so
 * the transaction hash cannot be the key. Scripts also spill over neighbouring
 * seconds (53 consecutive deploys 2–5 s apart, 86 at 5–15 s); a wider window
 * would be a different ruling, not this one.
 */
/*
 * hbm-v25 (2026-10-07, founder delegation, production audit "Resumed only
 * inside HEY's coverage"): no weight, threshold or Build Momentum formula
 * changes. A comeback is RESUMED only when every ship in it was read from a
 * source HEY was already reading when the gap began (`RESUMED_COVERAGE`,
 * `comebackCoverageWithheld`): each ship's `coveredFrom` — the earliest
 * `project_sources.created_at` its evidence names — at or before the last
 * counted update before the gap. A source attached during the gap, or a ship
 * whose source HEY cannot name (an on-chain ship, evidence written before
 * 2026-09-25 carried its source id), withholds the comeback: the status falls
 * through to the ordinary recency rule (SHIPPING or ACTIVE) and
 * `components.resumedWithheld` says why (`coverage_began_during_gap`,
 * `coverage_unknown`). What did not change: the 14-day comeback window, the
 * 60-day gap, every other status and Build Momentum. Measured on production
 * (2026-10-07 audit): 11 of 16 RESUMED projects were false comebacks — the
 * "return" was the first code HEY ever recorded, within 8 days of the
 * repository being attached (agent-wormhole: "Resumed after 61 days" on a
 * repository with commits on 13 days in that gap, attached on 09-19; the
 * first read pages back only until the newest week is covered).
 */
/*
 * hbm-v26 (2026-10-09, founder delegation, category-defining run): no weight,
 * threshold or Build Momentum formula changes. The scorer's current valuation
 * passes the whole valuation gate every surface applies, rules 3 and 4
 * included: HEY's own chain evidence contradicting the reading by more than
 * 10× (`VALUATION_CHAIN_EVIDENCE`, `chain_evidence_contradicts`) and another
 * source's price more than 10× away within a day (`VALUATION_SOURCES_DISAGREE`,
 * `sources_disagree`). Before, those two withheld the valuation on the card,
 * the sorts, the API, the map and Pulse, but the Discovery Gap percentile and
 * Still Building still read it — USDB's $10.4B on about $10 a day of volume
 * sat in the population every other project's attention was ranked against.
 * A withheld valuation leaves the percentile (liquidity and volume
 * renormalised as for any missing figure) and is no current value for Still
 * Building (`NOT_MEASURED`, `valuation_not_plausible`), exactly as hbm-v20's
 * two rules. Unknown is never a trip wire: no chain reading and no other
 * source leave both rules silent. The gate only withholds, never awards, and
 * never reaches activity status or Build Momentum. Three index probes per
 * cohort project, read after the joins.
 */
/*
 * hbm-v27 (2026-10-12, audit INV-4, ruling under the founder's delegation): no
 * weight, threshold or Build Momentum formula changes. A project whose
 * activity status is UNKNOWN — building HEY cannot read — gets no Discovery
 * Gap (`DISCOVERY_GAP.withholdUnknownActivity`, `discoveryGapWithheld:
 * 'activity_unknown'`), exactly as its Still Building was already not measured
 * (hbm-v21, F2). Its Build Momentum there is evidence quality and source
 * breadth with no recent ship, so its gap read "building ahead of attention"
 * beside "Activity not measurable": chicken (HatchFi) carried a 94.6th
 * momentum percentile and a gap of 10.8 on 2026-10-11, the one such gap of 10
 * UNKNOWN projects with momentum. It stays in the population the others are
 * ranked against; with no gap it cannot be Under the Radar. The activity status
 * only withholds, never awards.
 */
/*
 * hbm-v28 (2026-10-12, audit RD-2, ruling under the founder's delegation): no
 * weight, threshold or Build Momentum formula changes. A deploy batch is a
 * run, not a UTC second: a project's follow-up deployments each at most 60
 * seconds after the one before (`DEPLOY_BATCH.maxGapSeconds`) count once —
 * the newest corroborated deploy standing for the run — in activity status,
 * Build Momentum, the streak, velocity and cadence (`collapseRepeatedEvidence`,
 * `deployRunStarts`) and in every SQL count of building
 * (`buildingEvidenceSql`'s deploy-run keeper, `deployRunStartSql`). What did
 * not change: an upgrade is never part of a run, deploys more than 60 seconds
 * apart count apart, and no ship is deleted or retracted — every deploy stays
 * on the timeline with its creating transaction; only the count changes.
 * Measured on production before the change (read-only, 2026-10-12): one
 * script (equalfilabs-statics-app) put up 40 contracts between 03:05:43 and
 * 03:08:11 UTC in 20 distinct seconds — 20 counted ships and 20 of the 24
 * lines on /ships. Over all 335 standing follow-up deploys, the gaps between a
 * project's consecutive deploys break cleanly: the largest under a minute is
 * 45 s and the smallest above it 84 s. 307 deploy seconds become 214 runs.
 */
/*
 * hbm-v29 (2026-10-15, founder ruling "buat commit-substance-v4 tu"): no
 * weight, threshold or Build Momentum formula changes. The commit classifier
 * moves to commit-substance-v4: a dependency manifest (package.json,
 * composer.json, Cargo.toml, go.mod, requirements*.txt / constraints.txt,
 * pyproject.toml, Gemfile) whose patch changes only dependency versions, the
 * package's own version or the toolchain's is the `dependency` class, like
 * its lockfile, and a commit of nothing else is `dependency_bump` —
 * "dependency or version updates only", LOW_INFORMATION. Before, the lockfile
 * was maintenance and the manifest beside it configuration, so a person
 * bumping versions by hand made a building week while a bot's identical bump
 * did not. A manifest with any other change, or whose patch GitHub did not
 * return, stays configuration and counts as before. Weeks already read under
 * v3 are re-read where it can matter: a commit SUBSTANTIVE on configuration
 * alone, in a week no other commit decides, goes back to the paced detail
 * sweep (`pnpm data:commit-substance --rejudge-config`); until it is re-read
 * the week keeps its v3 verdict. No ship is deleted or retracted: a week
 * re-read as maintenance stays on the timeline as context. Prompted by an
 * outside reader's question on X: "How strict are you on 'meaningful' when
 * commits are mostly dependency bumps?"
 */
/*
 * hbm-v30 (2026-10-16, founder delegation "kau buat semua sekali", the full
 * audit's rulings #26, #103 and #147): no weight, threshold or Build Momentum
 * formula changes. Three rules only withhold, never award:
 * - #26: a tracked token whose verification is UNVERIFIED while another
 *   published project's tracked token (a different contract) carries the same
 *   ticker, case-insensitive, gets no Discovery Gap — withheld as
 *   `token_not_the_projects` (`DISCOVERY_GAP.withholdContestedUnverifiedTicker`,
 *   `unverifiedTickerContestedSql`) — and so no Under the Radar. TeraWallet was
 *   Under the Radar on a $TERA its own page said HEY could not attribute. The
 *   market stays in the population, keeps its percentile and its Still
 *   Building.
 * - #103: Under the Radar holds only when the project's market attention is
 *   TYPICAL or lower — its market-context percentile below 60
 *   (`UNDER_THE_RADAR.maxMarketAttention`, `underTheRadarAttentionAllows`). All
 *   18 holders on 2026-10-16 sat at or above the 57th percentile, one at the
 *   98.9th, which the API named HIGH. The population is unchanged (hbm-v18).
 * - #147: the gap is withheld as `no_market_reading` when the reading it would
 *   use is older than a day (`DISCOVERY_GAP.requireFreshReading`), the
 *   freshness Under the Radar and Still Building already required; the market
 *   cohort still keeps readings up to seven days for the others' percentiles.
 */
/*
 * hbm-v31 (2026-10-18, founder delegation "repair semua sekali", persona
 * audit PA-17): no weight, threshold or Build Momentum formula changes. Three
 * rules only withhold, never award:
 * - a fresh market reading whose measured 24-hour volume is below $1,000
 *   (`DISCOVERY_GAP.minVolume24hUsd`, `marketVolumeTooThin`) is not a measured
 *   market: no Discovery Gap, no Under the Radar and no Still Building, each
 *   withheld as `market_too_thin`, as a market that is not ACTIVE_MARKET is
 *   (hbm-v18, hbm-v19). The volume read is the one on the reading the gap is
 *   taken from, persisted as `components.marketVolumeThin`; no volume figure
 *   is unknown and never trips it. The market stays in the population and
 *   keeps its percentile. Two of the three Under the Radar projects on
 *   2026-10-18 (verge-snowy-x402, $27.51 of volume; fable, $162) sat on
 *   graduated Pons pools ACTIVE_MARKET under the 2026-10-16 graduated-pool
 *   rule, their liquidity above their valuation, and both held Still
 *   Building.
 * - Still Building is not measured, never NOT_HELD, when the Discovery Gap is
 *   withheld as `token_not_the_projects` because the tracked token is
 *   UNVERIFIED and another published project's token carries its ticker
 *   (`STILL_BUILDING.withholdContestedUnverifiedTicker`; hbm-v30 withheld the
 *   gap only);
 * - and when every builder source of the project — each own repository,
 *   changelog and feed the refresh reads — is unavailable
 *   (`STILL_BUILDING.withholdUnavailableBuilderSources`,
 *   `builder_sources_unavailable`, `builderSourcesUnavailableSql`). zip-c00899
 *   held Still Building on 2026-10-18 with its one repository answering 404
 *   and its gap withheld as not the project's token.
 */
/*
 * hbm-v32 (2026-10-19, founder delegation "ok buat semua yang belum repair
 * tu", backend audit P3-2): no weight, threshold or Build Momentum formula
 * changes. One rule only withholds, never awards: a 24h volume one source
 * repeated beside the same price for more than
 * `TOKEN_MARKET.repeatedVolumeMaxHours` (36 h) — the volume the market
 * classifier has refused since token-market-2026-10-16 (#134) — is unknown on
 * the scorer's market reading too (`DISCOVERY_GAP.frozenVolumeIsUnknown`; one
 * SQL fragment, `frozenVolumeCtes`, decides it for both). It never trips the
 * hbm-v31 thin-market test, never counts as a measured volume in the
 * market-context percentile (renormalised as any missing figure) and is no
 * input to the valuation gate. Under hbm-v31 the scorer read the raw figure:
 * a frozen $213.66 made a market "too thin" that the classifier judged on
 * another reading, and a frozen $5,000 passed as a measured, traded market.
 */
export const SCORING_VERSION = 'hbm-v32' as const;
/** Every version a stored snapshot may carry; each has a note above. */
export const SCORING_VERSIONS = ['hbm-v1', 'hbm-v2', 'hbm-v3', 'hbm-v4', 'hbm-v5', 'hbm-v6', 'hbm-v7', 'hbm-v8', 'hbm-v9', 'hbm-v10', 'hbm-v11', 'hbm-v12', 'hbm-v13', 'hbm-v14', 'hbm-v15', 'hbm-v16', 'hbm-v17', 'hbm-v18', 'hbm-v19', 'hbm-v20', 'hbm-v21', 'hbm-v22', 'hbm-v23', 'hbm-v24', 'hbm-v25', 'hbm-v26', 'hbm-v27', 'hbm-v28', 'hbm-v29', 'hbm-v30', 'hbm-v31', 'hbm-v32'] as const;
export type ScoringVersion = (typeof SCORING_VERSIONS)[number];
