# Changelog

All notable changes to `@hey-research-lab/sdk` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/).

## Unreleased

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
