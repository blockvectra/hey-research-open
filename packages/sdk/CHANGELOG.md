# Changelog

All notable changes to `@hey-research-lab/sdk` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/).

## Unreleased

### Changed (2026-10-25)

- A request whose path holds a `.` or `..` segment (or either spelt with `%2e`) is refused with a `bad_request`
  `HeyApiError` before anything is sent. Every other value is still percent-encoded as one path segment.

### Added (2026-10-22, API truth repairs)

- `HeyPage.adjustedParameters?: HeyParameterAdjustment[]` (new type): a `limit` or `offset` capped to its bounds, or a
  single-value parameter sent twice, with what was sent, what was read and why. A repeated `has` or `type` is now
  read as one list.
- `HeyScanCard` (found) `activity.releases_measured: boolean`: false when HEY reads no source releases come from, or
  building is not measured — `releases_30d: 0` is then legacy, not a finding.
- `HeyProjectSnapshot.identity.officialX?: HeyOfficialX`, as the card and the detail carry it.
- `eventsDay?: string` on `HeyProjectDetail.onchainActivity` and `HeyProjectSnapshot.onchain`: the UTC day
  `events24h` counts.
- `HeyWeeklyReport.chain.tokensTradedBasis?: 'busiest_day'` and `tokensTradedDay?: string`: `tokensTraded` is the
  busiest day's distinct count, never a weekly total.

### Changed (2026-10-22, truth repairs)

- `has: ['liveMarket']` lists only projects whose tracked token has a live market, as its coverage count of the same
  name always counted; a project with no token no longer passes it.
- `HeyUsageSummary.methodEvents` is `… | null`: `null` where HEY holds no usage figures (no contract watched), never
  `{ firstObserved: 0, resumed: 0 }`. The key is always present; check for `null` before reading its counts.
- `activity_applies_to_token` (scan and builder cards) is also `false` when the token's verification reason is
  `site_disclaims_contract`: the project's own site disowns the contract.

### Added (2026-10-20, one change explained)

- `HeyExplainFact` gains `'build.change'`; `projects.explain(slug, 'build.change', { event })` takes an optional
  change-ledger id. `HeyExplainedFact.change` and `HeySummaryLine.change` (on the latest-change line) carry
  `HeyChangeExplanation`: the stage HEY observed, who reported it and what corroborates it, whether a release and a
  deployment are linked by an exact reference, activity on a contract tied to it (`success` always `not_measured`),
  the source's date apart from HEY's, standing and unknowns. New types `HeyChangeStage`, `HeyChangeReporter`,
  `HeyChangeActivityState`, `HeyPartnerChangeExplanation`; `HeyPartnerChange.explanation` (null when not read).

## 0.3.3 — 2026-10-18

Prepared in the repository; published to npm by hand. The API's own dated record is
[the public API changelog](https://heyresearch.xyz/developers/changelog).

### Changed (2026-10-17, a truth repair in the API)

- `tab: 'new-builders'` lists projects published on HEY in the last 7 days **with a builder source HEY
  reads and at least one counted ship**, newest first ship first. Before 2026-10-17 it listed every page
  published in the window (about 380 rows; 47 under the new rule). The old population is the new value
  `'new-on-hey'`. The type did not change; what the value returns did, and `HeyProjectSurface` now says
  what each value lists.
- The walks — `projects.pages()`/`items()`, `ships.*`, `signals.pages()`, `builders.pages()`,
  `changes.pages()`/`items()`/`sync()`, `projects.timelinePages()` — wait out a temporary rate limit by
  its `retry-after` (at most 3 times, never longer than 60 seconds a wait) and pace their pages by the
  budget the API states (`RateLimit-Limit`, `-Policy`, `-Remaining`; 500 ms at 120 a minute while a
  tenth of the bucket or less is left, or when none is stated). A monthly `quota` is never waited for,
  and a single call still throws at once. `rateLimit: { wait: 'walks' | 'always' | 'never',
  maxRetries, maxWaitSeconds }` changes it; `wait: 'never'` is 0.3.2's behaviour. `sleep` replaces the
  timer, for tests.
- The `HeyProjectsQuery` comment said unknown values are dropped; since 2026-10-02 the API answers
  400 `invalid_parameter`.

### Added

- `HeyApiError.apiCode`: the API's own code (`invalid_parameter`, `invalid_cursor`,
  `invalid_evidence_id`, `key_required`, `quota` …), and `HeyApiError.requestId`: the id HEY logged
  the request under (from the body, else `x-request-id`). Both were only inside `body`.
- `HeyRateLimitOptions`, `HeyClientOptions.rateLimit` and `HeyClientOptions.sleep`.
- 2026-10-17 types: `HeyProjectSurface` `'new-on-hey'`; `projects.builtOn(slug)` and
  `HeyProjectBuiltOn` (with the `PROJECT_CODE_NAMES_TOKEN` / `PROJECT_POOLS_ON_HOOK` relationship
  edges and `v4pool:` / `v4hook:` evidence); `HeyChangesQuery.cursor` and
  `HeyChangesPage.ignoredParameters`; `HeyPage.ignoredParameters`; the agent contract's
  `query.ignoredParameters`, `data.resume` (`what_changed`), `error.candidatesTotal` and the
  candidates' `symbol`, `activityStatus` and `catalogStatus`; `/api/chain/accelerating`'s `judged`,
  `notMeasured` and `reason`; `HeyUnderTheRadar` on the dossier's `score` and the snapshot's `build`.
- `HeyTokenProfile.identity.machineInterfaces.changelog` and `.changelogFeed` (2026-10-18).

## 0.3.2 — 2026-10-16

### Added (2026-10-16, additive)

- Ships and timeline entries: `displayTitle` (a running code week reads "this week (since Mon …)"; `title` is unchanged) and `codeWeek.complete`.
- Change upserts and evidence receipts: `summaryCurrent`, the stored summary in today's words. `HeyChangeUpsertRead` types what `changes.list` returns.
- Market detail: `distribution.figuresWithheld` (`partial_balances` or `coverage_not_measured`: a holder read that cannot account for the supply keeps no count or shares), `pools` (day, liquidity, depth at 1%, `indexMissesReadingPool`).
- Scores: `cohortEvaluatedAt`; Still Building withheld reason `no_tracked_high`.
- Lock evidence receipts: `detectedAt` is `null` with `detectedAtWithheld: 'predates_record'` when HEY holds no first sighting.
- `/api/chain` days: `partial` on the day in progress. `/api/chain/silence`: `underTheRadarHeld`. Weekly reports: `radarBoard`. Search suggestions: `moreProjects`. Usage markers: `repository`. Promotion entries: `channelLabel`.

## 0.3.1 — 2026-10-16

### Added (2026-10-16, additive)

- `HeyProject.tokenMarket.label` and the dossier's `tokenMarket.label`: the market status in HEY's own words ("Launch pool only", "Not a fungible token", "No current reading", else the status's label).
- `HeyTokenMarket.marketStatusLabel` (the same words), `distribution.stale` (a snapshot older than HEY's freshness window) and `tvlRead` (`MEASURED` / `STALE` with the newest row's day, or `NONE_HELD` — an empty `tvlDays` is unknown, never zero).
- `HeyAgentResponse` research `marketContext.tokenMarketLabel`.

### Changed (2026-10-16)

- `changes.list` without a cursor (or with `before`) is newest first by each event's first arrival, so a revised old event never leads; `after` and `detectedSince` keep ledger order.

## 0.3.0 — 2026-10-14

### Added (agent contract, 2026-10-14)

- `HeyAgentQuery.research_project`, `.builder_status` and `.unknowns` are `HeyAgentSubjectQuery`: `{ project }`, `{ q }` (a project name or `$TICKER`, resolved through HEY's project search) or `{ address }` — exactly one. One exact match answers with `subject.resolvedFrom` (`{ q }` or `{ address }`, additive); several answer `status: 'invalid_request'` with `error.code: 'ambiguous'` and `error.candidates: HeyAgentCandidate[]` (slug, name, token; HEY picks none); none answers `status: 'not_found'` with `error.code: 'not_published'`. `query.q` echoes what was asked.
- `citation.text`, additively: the citation as one sentence — "Source: HEY Research Lab, builder research for Robinhood Chain — <page>, as of <date>, rules <scoringVersion>" — the last line of every MCP text and A2A text part.
- `links.pageAttributed`, additively: the page with `utm_source=hey-agent&utm_medium=<the integration the caller declared>`, present only when the request carried `x-hey-integration`; `links.page` stays the clean canonical URL.

### Added ($HEY profile, 2026-10-10)

- `HeyTokenProfile.treasury.reconciliation: HeyTreasuryReconciliation`, additively: whether the treasury's daily balance reads reconcile with HEY's ledger, with the first, highest and latest read per asset, the ledger's confirmed rows in the same block window and what they do not explain — or `state: 'not_read'` with its reason. Computed, never typed; unknown is never 0.
- `HeyTokenProfile.liquidityLock: HeyLiquidityLock`, additively: the launch position the Pons V2 locker holds, the curve phase HEY read and the launch verification's `position_locked` check (`checkedAt: null`, `verification_printed_not_stored`). `locks.tokenLock.pairLocked` keeps its meaning: a reading of HoodLock alone.
- `HeyTokenProfile.receipts: HeyUtilityReceipts`, additively: one aggregate per row over HEY's own tables (research requests completed, notes approved, bounties by state, payouts, bonds, vote rounds, confirmed ledger in and out), each with `asOf` and its `source` table; a null value was not read, never zero. The schema stays `hey.token-profile/v1`.

### Added (v4 hooks in the weekly report and the Partner Card, 2026-10-11)

- `HeyWeeklyReport.uniswapV4Hooks?: HeyWeeklyV4Hooks`, additively (report version 4): the state of Robinhood Chain v4 hooks as counts — seen, new this week, on tracked tokens, listed by basis, new listed hooks (≤20 named, factory instances counted), creation-read progress, factories tied to projects, hooklist coverage and launch-protocol concentration (never a protocol's name). Totals are as of `asOf`; null with `notMeasured` before HEY decodes any hook. Absent on older reports.
- `HeyBuilderCard.uniswap_v4_hooks: HeyPartnerV4Hooks | null` and `uniswap_v4_hooks_state: 'listed' | 'none_listed' | 'not_read'`, additively: the project's publicly listed hooks (`listed`, `basis_counts`, ≤10 `items` with `page_url` and `v4hook:` `evidence_id`, `shown` of `total`, `list_url`). No existing field changes; the `token=` lookup is unchanged.

### Added (listed token only, 2026-10-12)

- `HeyCatalogueCounts.listedTokenOnly?: number` and `HeyStatus.catalog.listedTokenOnly?: number`, additively: the part of `published` that is a listed token with no builder evidence and no live market (activity Unknown, no ship of any kind, a token market that is inactive or gone). Counted in `published`, never subtracted; absent when not counted, never 0. `published` keeps its meaning.

## 0.2.0 — 2026-10-09

### Added (coverage detail, 2026-10-09)

- `HeyCoverageEntry.stateDetail?: HeyCoverageStateDetail`, additively: `PARTIAL` under `MEASURED` (part of the dimension measured; today `contractActivity` with `partial_events_unreadable_some_days`) and `MAPPING_BLOCKED` under `NO_SOURCE` (a candidate HEY holds — a declared site, docs or a repository — that nothing yet ties to the project; reasons `site_not_corroborated`, `context_only_docs`, `context_only_repositories`). `HeyCoverageState` keeps its nine values and their meaning; the finer state never replaces it.
- `HeyCoverageEntry.cause?: HeyCoverageCause` (`own_source_unreachable`, `provider_unavailable`, `budget_deferred`), additively: whose side a `SOURCE_UNAVAILABLE` or deferred `NOT_ENOUGH_YET` read is on. Every existing state and reason code keeps its meaning; treat a value you do not know as a gap.

### Added (market truth, 2026-10-09)

- Valuation withheld reasons (`valuationWithheld`, `valuationImplausible`) gain `chain_evidence_contradicts` (more than 10× away from HEY's own chain readings) and `sources_disagree` (another source's price within a day more than 10× away), additively; `fdvUsd` is absent beside them as before. Treat an unknown reason as a withheld valuation you have no words for.
- `sourcesDisagree?: { source, priceUsd, observedAt }` beside a published valuation, additively: another source within a day more than 2× away, so the figure is the shown reading's, not a settled fact.
- `HeyChainDay.dexVolumeWithheld?: 'implausible_vs_trailing_median'` and `HeyWeeklyReport.chain.dexVolumeWithheldDays?`, additively: a day's DEX volume more than 10× its 14-day median is withheld (`dexVolumeUsd` absent), never shown as a figure.
- `HeyPoolStructure.dominantPoolShare` is documented as a percentage (0–100, one decimal), as the API has always sent it; no value changed.

### Added (partner scan card, 2026-10-09)

- `/api/v1/scan`'s not-found answer gains `indexed?`, `research_state?` (`not_researched` | `not_published` | `not_indexed`) and `launched_via?`, additively, beside `found: false`. `ships_30d` and `releases_30d` keep their documented zeros, with `activity_measured` saying whether they are measurements.

### Added (alerts and search, 2026-10-09)

- `HeyAlertPresetId` gains `ship` and `code`, and `HeyAlertEventType` gains `build.code_activity` (a weekly code-activity change, shown in the inbox only; never e-mailed or sent to a webhook), additively.
- A search suggestion may carry `sameNameDifferentContract?: true`, additively: another page with the same name and a different contract.
- Evidence receipts' `contextReason` gains `launch_window` (a follow-up deployment sent within 24 hours of the token's own creation: launch provenance, never building), additively.

### Added (Partner Card evidence link, 2026-10-05)

- `HeyPartnerShip.evidence_link`, additively: the latest meaningful ship's reader receipt page (`/evidence/ship:<uuid>`) with the card's attribution labels, as `project_link` carries them — the card's one "Evidence" link. `evidence_id` and `url` keep their meaning.
- `/api/v1/builder` and `/api/v1/scan` answers are now `cache-control: private, max-age=60` (they were `public, s-maxage=60` without the integration header). No field changed; a client may still keep an answer a minute.

### Added (status, 2026-10-03)

- `HeyStatus.integrity.failing?: { check, label }[]`, additively: the checks the newest integrity audit failed, by id and plain words. A failing audit now makes `verdict` `critical` (it read `warn` beside a failing run); `integrity.verdict` keeps its meaning.
- `HeyStatus.catalog.hidden?` and `hiddenAsOf?`, additively. `catalog.indexed` keeps its meaning — the hidden launch records, approved rows HEY has not published, as `/status` has always labelled it; it is not the catalogue's "indexed" (every approved row). `hidden` is the same figure under the catalogue's word, and `hiddenAsOf` dates it by the hourly summary that counted it: `asOf` dates only `published`, `verifiedBuilders` and `verifiedBuildersOnChain`.

### Added (token market, 2026-10-03)

- `HeyProjectDetail.tokenMarket.readingObservedAt?` and `figuresScope?: 'reading_pool'`, additively. `readingObservedAt` dates the reading behind `liquidityUsd` and `volume24hUsd` (`evaluatedAt` is when the status rule last ran); `figuresScope` says those pool figures describe the pool the status reading follows, not the token's `volume24h`. New `tokenMarket.reason` values `not_a_fungible_token` (decimals 0: no fungible market, no valuation) and `reading_not_current` (the newest reading is over 36 hours old), and a rescued market's (`liquidity_in_another_pool`) valuation is withheld; treat an unknown reason as a code you have no words for.

### Added (follow → alerts, 2026-10-03)

- `HeyAlertPresetId` gains `deploy` (`contract.deployed`: a contract the project deployed, never a serial launcher's follow-up) and `status` (`build.status_changed`, `build.dormant` and `build.resumed`: an activity status move, measured from building), additively. `GET /api/alerts` lists them among `presets`. No existing id changes meaning; treat an unknown preset id as a label you do not have words for.

## 0.1.2 — 2026-10-02

### Added (outsider open-source check, 2026-10-02)

- `HeyTokenLookup.issuer?: { issuerName, kind, symbol, sentence }`, additively, with `status: 'unknown'`: the address is a token an issuer minted (a Robinhood stock token such as NVDA), never any project's token. `status` keeps its meaning.
- `package.json` `repository` and `bugs` point at the public source, `hey-research-lab/hey-research-open` (the private name was a 404).

### Added (search, compare, round 2, 2026-10-01)

- `HeySearchSuggestions.moreLaunchRecords?: boolean` and `emptyNamesake?: true` on a project suggestion, additively: whether HEY may hold more launch records matching `q` than the rows list (the search page lists them all), and a published page with no token, ship or builder signal that shares its name with a fuller suggestion (listed after the other projects). The `suggestions` array keeps its shape.
- `HeyCompare.projects[].valuation?: { usd, kind, label }`, additively: the figure `marketCapUsd` carries, with its kind and the words HEY prints it under ("Market cap" or "Fully diluted valuation"). `marketCapUsd` keeps its name and meaning — the valuation the page prints, which may be an FDV.
- `GET /api/compare?a=&b=` is the same request as `?slugs=a,b` (`slugs` wins when both are sent).

### Added (project story, 2026-10-01)

- `HeySummaryLine.answer?: string` and `HeySummaryLine.significance?: { text, about, receiptUrl }`, additively, on the snapshot's Research Summary build line: the human answer ("Shipping consistently", "Quiet for 34 days", "Builder source not linked yet") and why the newest counted building event matters as a build event ("First release after 18 quiet days."), with the typed evidence id it is about. Derived only from the stored ship dates and types; absent when the record supports no sentence. `text` is unchanged.
- The usage line's token-only wording is plainer: calls that all reached the ERC-20 functions now read as token transfers and approvals, which trading alone produces.

### Fixed (Still Building state and rescued markets, 2026-10-01, scoring hbm-v21)

- `stillBuildingState` reads `NOT_MEASURED`, never `NOT_HELD`, for a project with no tracked token, no current market reading, building HEY cannot read, or no score under the current rules yet — what the state always meant; it read `NOT_HELD` for these for one day. `stillBuilding` keeps its v1 meaning (false).
- `HeyStillBuildingWithheld` gains `no_token`, `active_pool_not_read`, `no_market_reading`, `activity_unknown` and `not_scored`, additively; `HeyDiscoveryGapWithheld` gains `active_pool_not_read`: a market active only because another pool of the same token holds the liquidity is measured on that pool's reading, and with no reading of that pool it is not measured. No existing code changes meaning; treat an unknown code as "not measured".
- `underTheRadar` (where the API sends it) is stored only beside a positive Discovery Gap; readers already applied the same test.

### Added (valuation plausibility, round 4, 2026-09-30)

- `valuationWithheld` carries two new codes, additively, wherever it is sent (`HeyProject`, the detail's `market`, the snapshot's `market`): `valuation_over_liquidity` (the valuation is at least 10,000× the liquidity measured in the same reading) and `unlisted_over_ceiling` (above $10B on a Robinhood Chain token that no listing HEY reads carries). Such a valuation is not plausible from the readings HEY has: it is never sent as a figure. No existing code changes meaning.
- `valuationWithheld?: string` on the comparison's projects (it was dropped there) and on the market detail's `current`.

### Added (agent contract, 2026-09-30)

- `client.agent.answer(capability, query)` for `GET /api/agent/{capability}` → `HeyAgentResponse` (AgentIntelligenceResponse v1): `research_project`, `what_changed`, `builder_status`, `verify_project`, `compare_builders`, `unknowns`. A refusal's envelope (400, 404) resolves with `status` and `error` instead of throwing; a rate limit or an unreachable HEY still throws. `client.agent.capabilities()` for `GET /api/agent`. Types: `HeyAgentCapability`, `HeyAgentText` (with `contentOrigin`), `HeyAgentClaim`, `HeyAgentUnknown`, `HeyAgentFreshness`, `HeyAgentChange` and each capability's data.
- `HeySnapshotChange.countsAsBuilding?: true` (additive): the ledger's own flag on the snapshot's latest changes.

### Added (partner card, 2026-09-30)

- `HeyBuilderCard` gains the partner card fields, all additive: `verified_builder`, `latest_meaningful_ship` (`HeyPartnerShip`, with its `ship:` evidence id), `meaningful_ships_30d` (null, never 0, when HEY did not measure building), `latest_change` (`HeyPartnerChange`) with `latest_change_state` (`recorded`, `none_recorded`, `unavailable`), `latest_signal` (`HeyPartnerSignal`), `market_status` (context only), `badge_url` and `project_link`. No existing field changes meaning.
- `HeyScanCard` gains `project_link`: `project_url` with HEY's attribution labels (`utm_medium=partner_api`).
- `HeyClientOptions.integration`: your integration's `name` or `name/version`, sent as `x-hey-integration`; the server shape-checks it and uses the name as `project_link`'s `utm_source`.

### Changed

- The npm description and keywords name what the API is: evidence-backed research on Robinhood Chain projects.
- `HeyCodeSubstance.files` gains a `data` count (classifier `commit-substance-v2`): data files outside configuration, which alone no longer count as building.

### Added

- `HeyPeerContext.freshness` (2026-09-28): `{ state: 'CURRENT' | 'STALE', asOf, staleAfterHours }` or null — `STALE` when the daily peer run has not replaced the context in 36 hours. A `build_momentum` dimension read under a scoring version other than today's is `NOT_MEASURED` with `reason: 'recomputing_after_scoring_change'`.
- `HeySecurityContext`, `HeySecurityLinks`, `HeySecurityAudit`, `HeySecurityBounty` and `HeySecurityFinding` (2026-09-28): `HeyProjectSnapshot.security`, the project's security context — audits by where they are published (`AUDITOR_PUBLISHED`, `PROJECT_CLAIMED`, `REGISTRY_LISTED`), bug-bounty programs, a published security.txt, OSV advisories and Scorecard checks, each in a state (`MEASURED`, `NONE_FOUND`, `NOT_READ`, `NOT_APPLICABLE`). Evidence, never a verdict; additive and optional.
- Relationships read the security context (2026-09-28): `HeyRelationshipEdge.type` may be `PROJECT_AUDIT_REPORT_LINKED` (named for what HEY holds — a linked audit report, never a claim that the project was audited; it was `PROJECT_AUDITED_BY` before any release) (an audit document, labelled by where it is published: the auditor's site `observed`, the project's link `claimed`, a DefiLlama listing `context_only`) or `PROJECT_HAS_BUG_BOUNTY`, with `security:` evidence ids, in the `security` filter; `HeyRelationshipNode.kind` gains `AUDITOR`, `AUDIT_REPORT` and `BUG_BOUNTY_PROGRAM`. `notHeld` no longer lists audits as a family HEY does not hold; it names `PROJECT_AUDIT_REPORT_LINKED` / `PROJECT_HAS_BUG_BOUNTY` only when none was found on the indexes HEY read, or they were not read. Evidence, never a verdict; additive.
- Relationships, peer context and research boards (2026-09-28): `client.projects.relationships(slug)` for `GET /api/projects/{slug}/relationships` → `HeyProjectRelationships` (`HeyRelationshipNode`, `HeyRelationshipEdge`, `HeyRelationshipState`, `HeyRelationshipFilter`) — first-degree, every edge with its state, typed evidence and `observedAt`, never an account and never a partnership edge; `peerContext?: HeyPeerContext` (`HeyPeerDimension`) on `HeyProjectSnapshot` — each figure among comparable projects, one dimension at a time, no combined score; `links.relationships` on the snapshot; and the shapes of `/api/boards` (`HeyBoard`, `HeyBoardSummary`, `HeyBoardList`, `HeyBoardPanel`), types only.
- `HeyAlertRule`, `HeyAlertList`, `HeyAlertPreset`, `HeyAlertConditions`, `HeyAlertEventType`, `HeyAlertPresetId`, `HeyAlertNotification`, `HeyAlertNotifications` and `HeyAlertsMarkedRead` (2026-09-28): the shapes of `/api/alerts`, `/api/alerts/{id}` and `/api/alerts/notifications` — an account's alert rules over the change ledger and the inbox of what they matched, each `event` a `HeyChangeUpsert` or null once withdrawn. Types only; call the routes with `client.get`.
- Product usage (2026-09-28): `client.projects.usage(slug, { window })` for `GET /api/projects/{slug}/usage` → `HeyProjectUsage` (`HeyUsageSummary`, `HeyUsageSeriesDay`, `HeyUsageMarker`, `HeyUsageCallerFigure`); `usage?: HeyUsageSummary` on `HeyProjectSnapshot`; `links.usage` on the snapshot. Its own dimension, never a ranking input. `callerAddresses` counts distinct transaction-sender addresses per day (addresses, not people); its `window` is always `null` because per-day counts cannot be added. Function names are withheld (`names: "WITHHELD"`).
- `summary` on `HeyProjectSnapshot` (2026-09-28): the Project Research Summary, typed as `HeyResearchSummary` — one `HeySummaryLine` per dimension that applies (`HeySummaryDimension`: build, usage, market, contract, fundamentals, security, latestChange, unknown), each with its `tag` (`HeySummaryTag`: FACT, DERIVED, UNKNOWN), `text`, typed `evidence` ids with a `receiptUrl`, a `detailUrl`, `observedAt`, `freshness` (`HeySummaryFreshness`) and a `reason` where HEY does not know. Additive; no existing field changes meaning.
- `heyProfile()` and `HeyTokenProfile` (2026-09-28): `GET /api/hey/profile`, `$HEY` as research data — each documented utility LIVE, PLANNED, RETIRED or UNKNOWN, market readings with valuation kind and freshness, and HEY's own project snapshot.
- `HeyCodeSubstance`, and `codeSubstance?` on `HeyShip` and `HeyTimelineEntry` (2026-09-27): what a week of code activity changed — the verdict (`SUBSTANTIVE`, `LOW_INFORMATION`, `UNKNOWN`, derived by `classifierVersion`), whether it counts as building, the commit counts, changed files by class and one plain sentence. Absent on every other ship and on a week HEY never evaluated.
- `research.source_changed` is a webhook event type (`HeyWebhookEventType`, `WEBHOOK_EVENT_TYPES`): HEY delivers it since 2026-09-27.

## 0.1.1 — 2026-09-27

### Changed

- The README on npm no longer says the package is unpublished; it opens with the `npm install` line. No code change from 0.1.0.

## 0.1.0 — 2026-09-27

The first release of `@hey-research-lab/sdk` on npm. A 0.1.0 was prepared on 2026-09-19 and never published; this release is that draft plus everything added since, both listed below.

### Added

- `HeyClient` with typed method groups for every public route: `projects`,
  `ships`, `signals`, `builders`, `token`, `bounties`, `reports.weekly`,
  `scanCard`, `chain`, `thisWeek`, `status`, and `get<T>` for anything else.
- `Hey*` response types held identical to the API's serialisers by a contract
  test in the HEY repository.
- Paging helpers: `nextOffsetPages` (projects, ships) and `totalPages` (signals,
  builders), plus `itemsOf`; exposed as `pages()` / `items()` on the client.
- `HeyApiError` with a `code` (`not_found`, `unauthorized`, `forbidden`, `quota`,
  `rate_limited`, `bad_request`, `unavailable`, `timeout`, `network`, `http`),
  `status`, `reason`, `retryAfterSeconds` and the parsed `body`. No retries.
- User-agent `hey-research-sdk/<version>`, prefixed by the caller's own name.

### Added and changed after the 2026-09-19 draft

#### Added

- The contract object's verification fields (2026-09-27), additive:
  `HeyContract.verifiedSource.method`, `.match`, `.verifiedAt`, `.authorship`
  (`TEMPLATE`, `EXPLORER_MATCHED`, `PROJECT_AUTHORED`, `UNCONFIRMED`) and
  `.sourcify` (`HeySourcifyEvidence`; `NOT_READ` is never "unverified"),
  `HeyContract.proxy.clonedFrom`, and on `HeyContractMethods` the counts
  `namedFromAbi`, `creationCalls` and `undecodedWithCandidates` — never a name.
- `HeyProjectSnapshot.developerFootprint` (`HeyDeveloperFootprint`, 2026-09-27):
  official repositories, the newest production deployment, accepted and claimed
  packages and current advisories, each with its coverage state and a count only
  where measured.
- `research.source_changed` in `HeyChangeType` (2026-09-27): a material change
  to what a project's official site declares, with a `sourcechange:<uuid>`
  receipt. Not a webhook type.
- Protocol economics and promotion context on the snapshot (2026-09-27),
  additive: `HeyProjectSnapshot.protocolEconomics` (`HeyProtocolEconomics`,
  each metric a `HeyEconomicsMetric` — `MEASURED` with `valueUsd`, or
  `NOT_TRACKED` / `SOURCE_UNAVAILABLE` / `NOT_ENOUGH_YET` with no number),
  `HeyProjectSnapshot.market.promotion` (`HeyMarketPromotion`, dated by the
  provider where it gives a date, never an amount), and the coverage dimension
  `protocolEconomics` in `HeyCoverageDimension`.
- A method for every machine-layer route (2026-09-26): `projects.snapshot`,
  `projects.coverage`, `projects.explain`, `projects.history`,
  `projects.diff`, `projects.contracts`, `evidence.get`, `contracts.get`,
  `snapshots.bulk`, `token.bulk`, `scanCards`, `builderCard` and
  `search.suggest`. `HeyBuilderCard` (the `/api/v1/builder` card, now held to
  the route by a contract test) and `HeySearchSuggestion(s)`.
- `HeyTokenMarket.distributionRead` and `HeyDistributionReadOutcome`
  (2026-09-25), optional: what HEY's latest attempt to read the distribution
  found. `no_balance_change_in_window` means no balance moved inside the holder
  source's ~9-day window — not "no holders" — and `distribution` is then the
  last map HEY did read, dated by its own `day`.
- What a figure is (2026-09-25), additive: `HeyLiquidityKind` and
  `HeyProject.liquidity.kind` (`market` or `launch_inventory`), with
  `liquidityKind` on the dossier's `market` and `tokenMarket`, on
  `HeyTokenMarket.current` and on `HeyCompare` rows;
  `HeyProject.tokenVerification` (moved up from the dossier, same shape);
  `tokenLock.nextUnlockAt` and `nextUnlockPct`;
  `HeyTokenLookupProject.tokenVerification` and `HeyScanCard.token_verification`;
  `valuationKind` on `HeyThisWeekProject` and `HeyMarketMoves` items;
  `marketCapKind` on timeline `marketAround` days; `marketCapCloseKind` on
  market days.
- API parity (2026-09-25), all optional: `HeyProject.tokenMarket`
  (`{ status, reason? }`, the card's market state); on `HeyTokenMarket`,
  `marketStatusReason`, `contract` (deployer, `deployerShared`, `creationTx`,
  `createdAt`), `pools` (`pools`, `liquidityUsd`, `depthOnePctUsd`) and a
  `distribution` summary (holder count and supply shares, no addresses). The
  day rows now name `distinctAddresses`, `distinctBuyers`, `distinctSellers`
  and `poolsTraded`, and `onchainDays` names `callers` — fields the API
  already sent.
- `silence()`, `comebacks()`, `unlocks()`, `buildMarket()`,
  `projects.timeline()` and `projects.compare()` (2026-09-24).
- `projects.ask(slug, question)` (`HeyAskAnswer`) and `contractChanges({ days })`
  (`HeyContractChanges`), 2026-09-24.
- `HeyProjectIntelligence.development` (`HeyDevelopmentIntelligence`): derived
  builder intelligence under rules `intel-v1` — velocity, release cadence,
  consistency, discovery lag, market attention and 30-day changes. Optional;
  every unmeasured figure is a stated `state` or `null`, never a zero.

#### Changed

- The client no longer follows redirects. `fetch` replays request headers across
  hops, so a base URL that forwarded handed the API key to whatever host the
  `Location` named; a 3xx is now a `HeyApiError` with code `http`, naming that
  host. Point `baseUrl` at the origin that answers directly.
