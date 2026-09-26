# Changelog

What changed, and when, for anyone reading the code or building on the API. Dates are the day the
change reached production. Older entries are condensed; the private repository keeps the full
record.

## 2026-09-26

- **A deployer's other projects are published projects.** `/api/contracts` `otherProjectsCount`
  and the market page's Deployer check no longer count unpublished records, and the market page
  calls an account a launch service only when HEY's shared-deployer rule says so.
- **The MCP's `project_diff` says UNKNOWN for build counts HEY does not measure**, and says when a
  change count covers only part of the window.
- **`GET /api/changes`: one canonical change event per meaningful change.** Releases, ships,
  status moves, contract deployments and interface changes, verification, publication, sources,
  narratives and scheduled unlocks, each with its own time and how precisely HEY knows it, when
  HEY first knew, and its evidence. `after=` syncs forward without missing a fact HEY published
  late, and a retraction arrives as a tombstone that names only its id. The SDK has
  `changes.sync(cursor)`, and the MCP a `get_changes` tool.
- **Signals say when HEY recorded them.** `/api/signals` items add `detectedAt` and, for release
  and deploy signals, `shipId`; the page adds `nextOffset`. A release HEY read late now gets its
  signal.
- **The timeline says what it left out.** `/api/projects/{slug}/timeline` adds `totals`, `total`,
  `truncated` and a `before=` cursor for older entries.
- **The SDK follows a renamed project's redirect** when it stays on HEY's own API, and never
  any other.
- **Webhooks.** An API account can register up to five HTTPS endpoints at `/api/webhooks` (or on
  the account page) and receive HEY's public changes as they are recorded: releases, status
  moves, deployments, contract upgrades, verification, market status and HoodLock locks, each
  exactly as `/api/changes` serves it and signed with a secret shown once. Failed deliveries are
  retried for about a day; redirects are never followed. See `docs/WEBHOOKS.md`.
- **Every evidence id in a change resolves.** `/api/evidence/narrative:<project>:<slug>` answers the
  narrative events the ledger cites, and says who set the narrative: the project itself, a
  moderator or HEY's rules (a project's own choice was mislabelled as a moderator's). A change's
  `links.evidence` now names its first typed evidence id; it named the change's own id, which
  answered 400 for suffixed ids such as `source:<uuid>:added`, and is absent when none resolves.
- **History and diff no longer fail for busy projects.** `/api/projects/{slug}/history`
  (`contractChanges`, `locks`) and `/diff` answered 500 for any project with more than a hundred
  change events in the window; they now read every page.
- **A diff says when HEY was not yet recording changes.** A window that ends before the change
  ledger began is `UNAVAILABLE` rather than a measured zero, and one that starts before it says
  `partial: true` with `collectedFrom`.
- **A diff no longer reports zero releases for a project HEY cannot read.** `releasesAdded` and
  `meaningfulShips` are `null` with `countsReason` when HEY holds no builder source it reads for
  the project, as `/coverage` already said.
- **Evidence receipts publish no more than the change ledger.** A `state:` receipt resolves only a
  move the ledger announces (a demotion it records but never announces is not found), and an
  `abi:` receipt gives the number of functions and events added and removed, not their names.
- **Syncing from `/api/changes` no longer misses a project hidden for a few minutes.** A project
  taken off the catalogue and put back between two ledger runs now has its events re-sent with new
  `seq` values, after tombstones, so a client that synced while it was hidden receives them.
- **A project returning to the catalogue does not replay its history through webhooks.** Its
  events come back as `origin: backfill` unless they were live news within the last seven days,
  and a subscription receives such a return only if it had received the event before.
- **`/api/changes?contract=` now receives retractions.** A tombstone matches the contract or token
  of the event it retracts; it still carries only the id.
- **The SDK verifies webhooks.** `verifyWebhookSignature`, `parseWebhookEvent` and `isReplay`.
- **Two more kinds of change.** `lock.observed` and `lock.withdrawn` (when HEY first read a
  HoodLock lock, and first read it withdrawn), and contract upgrades from the chain's own logs,
  dated by their block.
- **Stricter address checks.** HEY's fetchers now also refuse benchmarking, documentation and
  protocol ranges, and IPv6 forms that carry an IPv4 address (NAT64, 6to4, Teredo).
- **HEY's MCP server is hosted.** `claude mcp add --transport http hey-research
  https://heyresearch.xyz/mcp` — stateless Streamable HTTP, read-only, metered like the API. The
  tools read the same public API, so they can say nothing it does not.
- **Fourteen MCP tools replace twenty-two**, one per question: `find_projects`, `lookup_token`,
  `get_project_snapshot`, `get_changes`, `get_project_timeline`, `get_project_coverage`,
  `explain_fact`, `get_evidence`, `get_token_market`, `get_contract`, `project_diff`,
  `compare_projects`, `ask_hey` and `chain_overview`. Every answer tags each line FACT, DERIVED or
  UNKNOWN (activity status and Build Momentum are DERIVED), says how many it showed of how many
  and how to read on, never calls an FDV or an unknown kind a market cap, and links the JSON it
  came from. Resources and four research prompts come with them; the tools live in
  `packages/mcp-core`.
- **The SDK covers every route**: snapshot, coverage, explain, history, diff, contracts,
  evidence, the keyed bulk reads, the `/api/v1/builder` card (now a typed `HeyBuilderCard`) and
  search suggestions.
- **`/developers` rebuilt**: first calls, auth and limits, snapshot, changes, history, evidence,
  contracts, the rules every answer follows, the SDK, MCP hosted and local, status, and what HEY
  deliberately does not provide.

- **The Research Terminal, redesigned.** One header (Projects · What changed · Watchlist · search)
  and a search that is easy to find ("Search projects, tickers or contracts"), including on phones
  (`/terminal/search`). A project's workspace groups its eleven views into six (Overview,
  Timeline, Build, Market, On-chain, Research), and every old URL still opens. The Command Centre
  now answers "what changed on Robinhood Chain", and every item links to its exact record.
- **Market candles are green and red.** A measured up move is green and a down move is red; an
  unchanged day is neutral, and a missing or incomplete day gets no colour. Every direction also
  carries ▲/▼ or a sign, never colour alone. Builder state keeps its own labelled chip and never
  implies a market direction.
- **Fewer pages published on thin evidence.** "Contract verified" now means the explorer verified
  the project's own contract source. A token's own launch deploy is no longer a ship for
  publication. An X account several pages declare is not identity, except on protocols a curated
  ecosystem registry lists. A follow-up deployment from the deployer of a token nothing ties to
  the project counts only once a repository or a site ties them. The pages are hidden, not
  deleted, and remain searchable by contract as launch records.
- **Research Terminal search suggests while typing.** The header search and the search page list
  matching projects, contracts and Terminal views as the reader types, grouped the way the search
  page groups its results, with full keyboard and screen-reader support; without JavaScript the
  search is the same form as before. The suggestions come from a Terminal-only route that answers
  only readers the Terminal lets in (a preview reader gets nothing) and is never cached.
- **Faster first paint on phones.** Marks the site font does not carry (⋯, ◆, ●, ■, ↗ and the
  subscript in compact prices) are drawn instead of typed, so the first layout no longer waits for a
  fallback font. A compact price still copies as its full decimal (`$0.0000254`).
- **Wording that claimed more than HEY knows.** The MCP server and `llms.txt` describe Under the
  Radar as a positive Discovery Gap (verified activity with a market-attention percentile below
  its build percentile), and `shipping_in_silence` as Under the Radar and below the 40th
  market-attention percentile. The server's opening note says `get_token_market` returns one
  token's supply-concentration summary and names only its deployer. A project's date reads "First
  listed". On the market page and in the MCP, the launch stage reads "HEY first saw it on DEX on" a
  date instead of "since", and a contract that is not a proxy reads "No proxy pattern detected in
  the EIP-1967 implementation slot at the last check."
- **Snapshot, coverage, explain and evidence.** `GET /api/projects/{slug}/snapshot` answers a
  project's important state in one read; `/coverage` says what HEY knows, dimension by dimension,
  as states and never a score; `/explain?fact=` says why HEY publishes a figure (value, rule,
  inputs, lineage, evidence ids, what is unknown); `GET /api/evidence/{id}` resolves a typed id
  (`ship:…`, `signal:…`, `lock:4663:17`, …) to its receipt. Ships carry `precision` and
  `evidenceId`.
- **One rule for FDV or market cap.** Every `marketCapUsd` has a `valuationKind` beside it; the
  daily series names its closes by the same rule. A market that is not live has its valuation
  withheld on the dossier and in `/market` `days[]`, with the reason
  (`valuationWithheld`, `marketCapCloseWithheld`); `has=marketCap` and the market-cap filters count
  only valuations a card prints. Liquidity HEY's chain index measures as unsellable is not believed.
- **Knowledge time.** `/api/projects/{slug}` sends `firstRecordedByHeyAt` and, where an outside
  registry or launchpad dates the project, `externalListedAt` and `externalListedSource`.
  `firstSeenAt` is kept as a deprecated alias; `sort=newest` orders by knowledge time.
- **No measured-looking zero for an unmeasured project.** `/intelligence` sends `null` Build
  Momentum and velocity for a project HEY holds no readable builder source for, with
  `development.activityMeasured: false`.
- **Partner fields, additive.** `/api/v1/scan` adds `research_level`, `activity_measured`,
  `coverage`, `as_of`, `activity.meaningful_ships_30d` and `activity.last_ship_url`; the token
  lookup adds `activityMeasured`, `meaningfulShipsLast30Days` and `asOf`; `/api/v1/builder` adds
  `research_level`, `activity_measured`, `as_of` and a thirty-day `commits_30d` that agrees with the
  card. The zero address on `/api/v1/scan` is still a 400 and no longer counts against a key.
- **Beacon proxies are read as proxies.** Tokens behind a beacon (such as the bridged stock
  tokens) were reported as plain contracts. The proxy check now reads the implementation slot, the
  beacon and its implementation, and the explorer's own report, and says which one answered
  (`contract.proxy.kind` on `/api/projects/{slug}/market`). It never says "not a proxy" — only that
  no proxy pattern was detected.
- **Contracts as research entities.** `GET /api/contracts/{chainId}/{address}` and
  `GET /api/projects/{slug}/contracts`: creation, deployer, factory, verified source, proxy kind and
  implementation history, interface counts and changes, and seven-day use — each section saying
  whether HEY measured it. Counts, never function lists.
- **History and diff.** `GET /api/projects/{slug}/history` returns the points HEY recorded at the
  time, each labelled as what HEY concluded, what it observed, or what was reconstructed from the
  chain later, with each series' collection start; a day HEY did not record is absent, never zero.
  `GET /api/projects/{slug}/diff?from=&to=` compares two days and counts what happened between
  them, without claiming a cause.
- **Bulk reads, keyed.** `/api/snapshots?slugs=` (up to 10), `/api/token/{chainId}?addresses=` and
  `/api/v1/scan?tokens=` (up to 30): one request per item against the key's limits, input order
  kept, one bad item never failing the batch.
- **One error shape.** Every public route answers errors as
  `{error, message, requestId, retryable, retryAfterSeconds?}`, readable from a browser, including
  the 500 and an unknown path. Listings of contract changes, quiet builders, comebacks and unlocks
  say how many rows exist in all.
- **Market page additions.** Where the liquidity sits (pools holding it and the largest pool's
  share, collected from today on), launch milestones each on their own clock, and on-chain days
  that keep the measured calls when events could not be indexed.
- **A project shipping from the chain is measured.** Activity counts as measured when HEY's status
  rests on building it counted — a readable repository, changelog or feed, or at least one counted
  building event in the scorer's window, on-chain follow-up deployments included. The snapshot,
  the scan card, the intelligence route and the MCP no longer call such a project "UNKNOWN
  activity, no source"; its coverage says `onchain_building_evidence`.
- **One meaning of "counts as building".** The evidence receipt, the timeline and `/api/changes`
  count what the scorer counts: corroborated building events, a week of code activity or
  prereleases once. A self-reported update never counts.
- **The Discovery Gap explanation adds up.** `/explain?fact=discovery_gap` shows the two
  percentiles the gap was taken from, so the subtraction it prints holds, and shows no Build
  Momentum percentile where momentum is not published.
- **Explanations count what the scorer counts.** `/explain?fact=activity.status` counts only
  corroborated building events, sends a count HEY did not measure as null rather than 0, and, where
  a withdrawn ship leaves a published status with nothing under it, marks the status stale and says
  the next rescore replaces it.
- **A withdrawn ship moves the status at once.** When HEY withdraws a ship or source as not the
  project's own, the project is rescored straight away instead of up to twelve hours later.
- **The project page says why Build Momentum is missing.** "Not finished checking" only where
  HEY's research has not run; otherwise that HEY holds no repository, changelog or feed it can
  read.
- **One valuation-kind rule.** Where HEY holds the provider's market cap and FDV, they decide
  whether a figure is a market cap or an FDV on every surface, the daily chart included; the
  supply test names only a stored day whose reading HEY no longer holds.
- **A deployer is a launch service only by HEY's own rule.** `/api/contracts` said a token's
  deployer was shared as soon as one other tracked project used it, while `/market` said it was
  not. `sharedAcrossTrackedProjects` now follows the same three-project rule `/market` uses;
  `otherProjectsCount` is still the plain count.
- **A shared follow-up names the right project.** A contract two projects' deployer put up is
  listed under each project as that project's own, with its own evidence; the contract on its own
  names neither, rather than picking one by name.
- **MCP answers no stronger than the API.** Status and market-state moves, signals and
  market-integrity readings are tagged DERIVED in `get_evidence`, `get_changes` and the timeline;
  `project_diff` names each valuation end by its own kind; an on-chain event count over a window
  with unreadable days says so; the Builder Radar and chain overview keep the "not investment
  advice" disclaimer; and the server instructions now say that `get_contract` names the deployer
  with a count of other tracked projects.
- **Under the Radar, one definition.** The MCP guide, `llms.txt` and the docs now describe it as
  the surface lists it: eligible under the Under the Radar rule, with a positive Discovery Gap.
- **Docs name the current intelligence rules**, `intel-v3`.

## 2026-09-25

- **Research Terminal early access.** With the console's preview switch on, a reader the Terminal
  does not admit sees it in preview — project identities, with the research withheld on the server
  rather than hidden in the page — and can ask for early access with the wallet linked to their
  account. Requests are reviewed by hand; holding $HEY is context for the reviewer and never
  approves one. Every `/terminal` response is `private, no-store`.
- **Scoring `hbm-v15`.** A token whose market is not live gets no Discovery Gap and no market
  percentile, and is not in the population others are ranked against. Nor does a token HEY knows
  only from a market listing (no launch on this chain) that nothing the project publishes ties to
  it — a bridged copy of an outside asset. A daily-close high is dated to the end of its day, so a
  ship that same day is not "since the decline". Stored gaps and badges refill as projects are
  rescored.
- **`distributionRead`** on the market answer (`outcome`, `checkedAt`, `note`). When the latest
  holder read saw no balance change inside the provider's window, the answer says so and keeps the
  last good distribution with its date, instead of reading as "no holders".
- **Paid research is charged at the quoted price.** The wallet takes a quote before paying and sends
  exactly that amount; an expired quote covers only a transfer mined before it expired.

- **Renamed-project redirects point at the public site.** `GET /api/projects/{slug}` (and its
  `/market` and `/intelligence` routes) and `/api/badge/{slug}` answered an old slug with a
  `Location` on `https://0.0.0.0:3000`. They now redirect to `https://heyresearch.xyz/...` with
  `cache-control: no-store`.
- **`builderRadar.onCurrentBoard`** and **`builderRadar.rank7d`** on
  `GET /api/projects/{slug}/intelligence`. A project that dropped off the board keeps its last
  row; `onCurrentBoard: false` says that `rank` is a past standing. `rank7d` is the rank a week
  earlier recounted among today's board, as `/builders` measures movement.
- **`buildMomentum` is omitted for an UNKNOWN project with a score of 0.** That zero meant HEY found
  nothing it could read, not a measurement.
- **`liquidity.kind`** (`market` | `launch_inventory`) wherever a liquidity figure is returned: the
  list, the detail's `market` and `tokenMarket`, `/market` and `/intelligence` `current`, compare and
  the MCP. A launch pool's own token inventory is not a market, so `minLiquidity`, `sort=liquidity`
  and the coverage counts leave it out.
- **A new market status reason, `readings_implausible`** (status `INSUFFICIENT_DATA`): a provider's
  liquidity that its own volume and HEY's pool index cannot support. Its liquidity, valuation and
  stored high are withheld; price and volume stay. `pool_readings_disagree` and
  `readings_implausible` are not live markets.
- **Valuations name their kind** on `/api/this-week`, market `days[]`, market-moves and the timeline;
  a dead market's valuation is withheld there.
- **`tokenLock.nextUnlockAt`** and **`tokenLock.nextUnlockPct`** beside `until` (which is the last
  unlock).
- **Token verification** (`VERIFIED` / `UNVERIFIED` / `MISMATCH`) on the list, the token lookup,
  `/api/v1/scan` and `/api/v1/builder`.
- **First and last indexed trade** are read over the whole daily index, not the answer's window.
- **`kind=constructor`** and other inherited names are refused as signal kinds.
- The MCP offers `market_integrity` only when the server runs with `HEY_MARKET_INTEGRITY=public`, as
  the route is gated.
- **Search** treats a ticker's `$` as a sigil (`$HEY` finds HEY), and a whole contract address is
  matched exactly and quickly.

## 2026-09-20

- **`GET /api/v1/builder?chain=4663&token=0x…`** — builder activity for one contract, for a partner
  that already draws the chart. `status` (`active`/`stale`/`dormant`/`unknown`), `last_activity_at`,
  the corroborated `repo_url`, the latest release and post-launch deployment, and HEY's own status
  label to print. HEY's tables only, no provider call. `last_commit` is always `null` — HEY
  aggregates commits into weekly summaries and stores no SHA — and there is no `abandoned` status,
  because HEY sees silence rather than intent. An unpublished contract answers `404` with a
  `scan_url`.
- An **Open in RHTools** link on the project page, on a scan result and on the token's market page,
  wherever a reader already holds a contract. It is a reference in the existing link row, never a
  button, and absent when there is no contract.


- **A website a project declares is now screened.** The candidate site reader selected on the
  candidate's own URL, so a site that reached the project by any path other than the discovery feed
  was never fetched — which left the token unverified, the repository context-only, and the code
  activity unread on projects that had all three. It now falls back to the project's declared
  website and keeps the URL it read.

## 2026-09-19

- **`POST /api/scan` carries an evidence breakdown** (`scan-evidence-v1`): `identity`, `build`,
  `coverage` and `overall`, each either a 0–100 reading with a strength word or an explicit
  `insufficient` with the reason. It measures how much HEY could verify from public sources — not
  the project's quality, not risk, and nothing about what a token might do. A band HEY could not
  measure reports a sentence rather than a zero, `build` reuses the stored Build Momentum and is
  never recomputed, and a check HEY could not run is excluded from the total instead of counted
  against the project. `GET /api/v1/scan` is unchanged.

- **A refused API key now says how to carry on.** A `401` used to answer only "That API key is not
  valid."; every read endpoint answers the same call without a key at 120 requests a minute, and
  the message now says so and points at the page that issues one. Nothing about who is refused
  changed.
- **The edge's agent families read the `From` header first.** A crawler that spoofs a browser
  string still names itself there, so one that sends a plain `Chrome/130.0` is no longer filed as a
  suspected scraper. Only mailboxes matching a known crawler are read, because `From` may carry a
  person's own address, and neither the header nor the user agent is ever stored.
- **Two npm packages prepared.** `@hey-research/sdk` (`packages/sdk`) is the whole read API as one
  typed client: `new HeyClient().scanCard(4663, address)`, `projects.items({ tab: 'still-building' })`
  walks a listing, a `429` surfaces as `HeyApiError` with `retryAfterSeconds` and is never retried
  for you. `@hey-research/mcp` (`apps/mcp`) is the MCP server, unchanged in behaviour. Neither is
  published yet; build both from this tree.
- **A type-level contract test** in the private repository fails the gate when the API and the SDK
  disagree on a single field, in either direction.
- **Full-platform audit, eleven auditors, eighty-nine repairs.** For an integrator: commit summaries
  are no longer duplicated by an ISO-week key written in two casings; signals never announce a
  release the project page has withdrawn; the development signals count meaningful ships rather than
  bare contract deployments; a published project with no token redirects instead of answering 404 on
  its market page; `/api/signals` documents the four kinds that count addresses; and the API
  documentation states the single-token distribution boundary rather than denying it.
- `/badge/<slug>.svg?embed=1` renders only the badge, which the iframe snippet had always promised.

## 2026-09-18

- `GET /api/v1/scan?chain=4663&token=0x…` — the by-contract lookup in the shape a trading bot's
  card wants: `found`, status in HEY's own words, `verified_builder`, commits, releases and ships in
  thirty days, the project page and a CTA to it. `found: false` is a `200` for an unpublished token
  or another chain, so a bot prints nothing rather than guessing.
- `commits_30d` counts only summaries that carry their days, and is absent otherwise. It may carry
  `commits_30d_partial: true`, meaning HEY read a full page of a hundred commits inside the window
  and the figure is a floor — print `100+`, or drop it.
- A commit summary read from a cut page is titled "100+ commits since \<date\>" rather than an exact
  ninety-day count.
- Keys: a keyed request draws on its tier's per-minute bucket from one address; a suspended key or a
  blocked account answers `403` with a `reason`; a revoked or expired key answers `401`; the monthly
  allowance is checked before a request is counted; any request carrying a key header is answered
  `private, no-store`. The free tier's monthly ceiling is a console setting.
- `SCORING_VERSION` is `hbm-v8`: code activity counts once per ISO week however many repositories
  produced it, Still Building is measured against the daily close and needs a market reading under a
  week old, and a pool is "liquidity removed" only under an absolute ceiling.
- `/api/signals` echoes only a `slug` it actually applied and orders with a stable tiebreaker;
  `/api/projects/{slug}/intelligence` names the market source the way `/market` does; a `404` from
  `/api/badge` has the same `{error, message}` shape as every other route.
- A provider's `429` is honoured for exactly the `Retry-After` it names and never retried in place;
  a feed entry dated more than ten minutes ahead is skipped.
- `/api/health/deep` answers `503` when the worker has completed nothing for twenty minutes.
- An old project slug that now belongs to a withdrawn record is not-found on the API and a temporary
  redirect on the site; only a target still in the catalogue earns a permanent one.
- The lab's console gained an analytics section. It reads first-party rows and Google's own API,
  stores no IP, user agent or cross-day identifier, and none of it reaches a public figure or ranking.

## 2026-09-17

- `GET /api/token/{chainId}/{address}` answers for a bare contract address in one call: activity
  status in the site's own words, ships in thirty days, the last ship with its source, and a link
  back. An address with no published page answers `200` with `status: "unknown"`, not a 404. The
  address prefix is read in either case; the chain id is the plain integer `4663`.
- `GET /api/projects/{slug}` carries its newest five `ships` and, whenever it claims
  `stillBuilding`, the `stillBuildingEvidence` behind the claim.
- A bare contract deployment is a launch, not a ship, on every ship surface.
- `/api/projects` pages no longer overlap or drop rows inside ties, so a full walk by offset returns
  each project once; `/api/ships` never hands back an offset the cap will clamp.
- The per-client rate limit is consumed before any key is looked at.
- `GET /api/token` carries `researchLevel`; a record HEY has only indexed carries no ship count; the
  badge says "indexed", "checked" or "verified" by what HEY actually did.
- `tab=new-builders` is a seven-day window; a date that does not exist is refused rather than rolled
  forward.
- Site metadata consolidated: one builder for title, description, canonical and share card, and a
  public roadmap at [heyresearch.xyz/roadmap](https://heyresearch.xyz/roadmap).

## 2026-09-15

- **`/scan`** answers the builder question for a single contract address HEY has never seen: who
  built it, what is being built, and what HEY cannot see — with no score, no count of passed checks
  and no colour, because one number is all it takes for a reader to take a scan box as a safety
  rating. It reads no holders and no wallets.
- Two reads were added for it in `packages/sources`: the contract's creating call, which separates
  the factory that executed it from the account that sent it, and the contract's **method surface**,
  which for an address with no site and no repository is the only evidence there is.
- Each day also carries counts of the addresses behind the figures, and a token's concentration as a
  Gini and a Nakamoto coefficient. All are counts a provider returns; none selects, stores or names
  an address.

## 2026-09-14

- **Token distribution** on a token's market page: a bubble map of the largest balances drawn to
  scale, with pools, launchpad lockers and burned supply named and kept out of the concentration
  figure. This is the single exception to the no-holder-data rule, decided by the founder, and it is
  never scored, ranked across tokens, followed, or an input to any status or score.
- The denominator behind every share of supply is read from the token contract rather than a
  valuation; a token whose contract will not answer is skipped rather than mapped against a guess.
- Three guards now refuse a market reading before it is stored: a pool worth less than one whole
  token at the quoted price, a market cap above the same token's fully diluted valuation, and a
  supply that disagrees with the contract by more than a factor of two. Liquidity and volume are
  summed across a token's pools rather than taken from the deepest.

## 2026-09-13

- HEY keeps its own daily index: every token project has a market page with price, liquidity, trades
  and volume day by day, and Pulse shows Robinhood Chain day by day (`/api/chain`).
- **HEY Signal** (`/signals`) turns measured changes into a feed with before and after figures and
  their sources. The **Builder Radar** (`/builders`) ranks builders by verified development, on-chain
  use and research standing, never by price. Weekly reports are archived at `/reports/weekly`.
- A token card HEY cannot read building from says "No builder signal yet" and prints what HEY does
  know as context. Trading is not building.

## 2026-09-12

- Explore has two views: everything HEY tracks, and only the projects with a token, with a market
  lens (live market, verified token, launch stage, a liquidity floor, liquidity and volume orders).
  Every market sort says how many rows actually carry the figure. Tokenless builders are never
  hidden from the first view.

## Earlier

The catalogue, the project page, activity status, Build Momentum, the Discovery Gap, Still Building,
Under the Radar, the public API, the badge, Scout, bounties and `$HEY` shipped between July and
September 2026. [The methodology page](https://heyresearch.xyz/methodology) states every rule as it
runs today, and [docs/SOURCE_REGISTRY.md](docs/SOURCE_REGISTRY.md) lists every source with what was
actually observed when it was verified.
