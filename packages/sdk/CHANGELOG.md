# Changelog

All notable changes to `@hey-research/sdk` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

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

### Changed

- The client no longer follows redirects. `fetch` replays request headers across
  hops, so a base URL that forwarded handed the API key to whatever host the
  `Location` named; a 3xx is now a `HeyApiError` with code `http`, naming that
  host. Point `baseUrl` at the origin that answers directly.

## 0.1.0 — 2026-09-19

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
