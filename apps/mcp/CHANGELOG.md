# Changelog

All notable changes to `@hey-research/mcp` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/).

## Unreleased

### Changed

- **Fourteen tools replace twenty-two** (2026-09-26): `find_projects`,
  `lookup_token`, `get_project_snapshot`, `get_changes`,
  `get_project_timeline`, `get_project_coverage`, `explain_fact`,
  `get_evidence`, `get_token_market` (`include: ["moves"]`), `get_contract`,
  `project_diff`, `compare_projects`, `ask_hey` and `chain_overview`, plus
  `market_integrity` where published. The old names are gone, not aliased;
  `list_bounties` is dropped (bounties stay in the API and SDK).
- Every answer tags its lines FACT / DERIVED / UNKNOWN no stronger than the
  API's explain engine (activity status and Build Momentum are DERIVED), says
  shown-of-total and how to read on, names a valuation by its kind (an unknown
  kind is a "valuation", never a "market cap"), prints time at its precision,
  is capped at 24 KB with the cut disclosed, and links the canonical JSON.
- `under-the-radar` is described as the domain decides it (a positive
  Discovery Gap, not "little attention"), and `back-from-dormancy` says it is
  narrower than every RESUMED project.
- The tools, renderers, resources and prompts moved to `packages/mcp-core`;
  this package bundles them behind stdio. The same tools are hosted at
  `https://heyresearch.xyz/mcp`.

### Added

- Resources `hey://project/{slug}`, `…/timeline`, `…/coverage`,
  `hey://contract/{chainId}/{address}`, `hey://changes/latest`, and prompts
  `deep_research_project`, `what_changed_since`, `explain_metric`,
  `investigate_contract` (2026-09-26).

- `market_integrity` is offered only when the process is started with
  `HEY_MARKET_INTEGRITY=public`, the site's own flag: until then its route
  answers 404 (2026-09-25). Twenty-two tools by default.
- A launch pool's own supply is printed as such, never as liquidity; an FDV
  is named an FDV in `list_projects`, `compare_projects` (by the API's kind,
  not by comparing figures), `this_week` and `events_before_market_change`;
  `lookup_token` says when the address is `MISMATCH` or unverified; "no
  builder signal yet" is not printed beside a recorded ship (2026-09-25).

### Added

- API parity (2026-09-25): project lines say the token's market state in the
  site's words (`market: trading inactive`); `get_token_market` prints the
  status reason, who deployed the contract and when, the pools and how much
  can be sold before the price moves 1%, and a supply-concentration summary.
- `shipping_in_silence`, `builder_comebacks`, `upcoming_unlocks`,
  `project_timeline` and `compare_projects` (2026-09-24): the Terminal command
  centre over MCP.
- `ask_hey` and `contract_changes` (2026-09-24): Ask HEY's evidence answer to a
  free-text question, and evidence-backed contract changes including ABI
  interface changes.
- `project_intelligence`: one project's derived development intelligence
  (rules `intel-v1`) from `GET /api/projects/{slug}/intelligence` — build
  velocity, release cadence, consistency, discovery lag, market attention as
  context, and 30-day changes. Every line says whether it is a FACT, a DERIVED
  figure or UNKNOWN.

### Changed

- `HEY_API_URL` must be https, unless the host is localhost. The API key rides
  on every request, and a plaintext or foreign base URL sent it there in clear
  text with nothing said; the server now refuses to start and the ready line
  prints the resolved origin.
- `engines.node` is `>=20`: `@modelcontextprotocol/sdk` pulls
  `@hono/node-server`, which requires Node 20. Installing under Node 18 warned
  `EBADENGINE`, so the declared floor now matches the tree.

## 0.1.0 — 2026-09-19

### Added

- First published release. Twelve read-only tools over the HEY Research public
  API: `search_projects`, `list_projects`, `lookup_token`, `get_project`,
  `get_token_market`, `chain_activity`, `list_signals`, `list_builders`,
  `weekly_report`, `list_bounties`, `list_ships`, `this_week`.
- `HEY_API_URL` to point the server at another HEY, `HEY_API_KEY` to lift the
  anonymous rate limit.
- Built on `@hey-research/sdk`, bundled in; the server names itself
  `hey-research-mcp/<version>` so HEY's traffic console counts it as itself.
- A refused key says to check `HEY_API_KEY`; a rate limit says how long to wait.
