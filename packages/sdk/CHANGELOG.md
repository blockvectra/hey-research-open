# Changelog

All notable changes to `@hey-research-lab/sdk` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

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
