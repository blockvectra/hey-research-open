# Public read API (2026-09-05)

HEY answers one question — **which projects are still building, what have they shipped, and
which of them are not yet getting much market attention?** Until now the only way to ask it
was to read the pages. These three endpoints are that answer as JSON.

Quote every URL in your shell: `?` and `&` are glob and job control in zsh and bash, so an unquoted
URL fails before curl runs.

No key, no account, no wallet. Browsing HEY has never required one, and reading it as JSON
does not either.

```
GET /api/projects        the catalogue
GET /api/projects/{slug} one project's dossier
GET /api/ships           what projects shipped
```

Base URL: `https://heyresearch.xyz`

## What every payload promises

| Rule | What it means in the JSON |
|---|---|
| Identity is `(chainId, contractAddress)` | `token` is the pair, never the ticker alone. `symbol` is shown, but it is not the identity. |
| Absent means unknown | A field HEY has no answer for is **left out**, never sent as `null` or `0`. Nothing downstream can average a fact that was never claimed. |
| Provenance travels with the fact | A ship carries `sourceUrl` and `verification`; a market figure carries the `source` that reported it. A market value with no provenance is not published at all. |
| Self-reported ≠ verified | `verification` distinguishes them, always. |
| Research depth is stated | `researchLevel` and `catalogStatus` say whether HEY merely indexed a record or actually researched it, so an `INDEXED` row is not read as a claim. |
| No wallet or holder data | HEY does not build it and does not store it. There is nothing to expose. |
| Market data is context | It never ranks anything here, and the default order is activity. |
| Paid placement is not in the data | The labelled *Sponsored* row on the home page is advertising. It has no field here, no feed entry, and no effect on any order, score or status. |
| The caveat travels too | Every response carries `disclaimer`. |
| The strict states carry their denominator | `GET /api/projects` carries `catalogue`: how many verified builders HEY has and how many meet Still Building and Under the Radar right now (2026-09-11). A handful out of thousands is the rule working, not the data failing. |

Dates are ISO 8601 in UTC. Responses are cached for 60 seconds, allow cross-origin reads
(`access-control-allow-origin: *`), and are rate limited to 120 requests a minute per client without a key.

**API keys (M13-E).** A signed-in reader with a linked wallet can create a key on `/account`. Send it as
`authorization: Bearer hey_…` (or `x-api-key`). A key reads exactly the same data; it carries the account's
holder tier, which sets a monthly allowance and a per-minute limit (`x-hey-tier`, `x-hey-monthly-remaining`
on every keyed answer). Keyed answers are `private, no-store`. A bad key is `401 unauthorized`; a spent
allowance is `429 quota` with `retry-after`. The routes answer `OPTIONS` with the allowed headers.

## `GET /api/projects`

The catalogue, with the same filters and order the browse pages use.

| Parameter | Values | Default |
|---|---|---|
| `limit` | 1–48 | 24 |
| `offset` | ≥ 0 | 0 |
| `sort` | `activity`, `marketCap`, `newest`, `liquidity`, `volume24h` | `activity` |
| `tab` | `building-with-token`, `still-building`, `under-the-radar`, `shipping-now`, `most-active`, `new-builders`, `back-from-dormancy`, `utility`, `memes` | — |
| `kind` | `UTILITY`, `MEME`, `HYBRID`, `INFRASTRUCTURE`, `RWA`, `APPLICATION`, `OTHER` | — |
| `status` | `SHIPPING`, `ACTIVE`, `QUIET`, `DORMANT`, `RESUMED`, `UNKNOWN` | — |
| `narrative` | a narrative slug | — |
| `has` | any of `token`, `x`, `marketCap`, `launchpad`, `liveMarket` (no token, or a token whose market is not gone), `verifiedToken` (the project itself ties the contract to the project), `trading` (the token traded in the last day), `github` (a public repository HEY reads commits from), comma-separated; **all** must hold | — |
| `stage` | `curve`, `graduated`, `dex` — where the launch stands: still on its bonding curve, graduated off it, or trading in a DEX pool | — |
| `minLiquidity` | a positive dollar figure; only tokens whose card reading shows at least this much liquidity. Unknown liquidity is excluded, never read as zero | — |
| `maxMarketCap` | a positive dollar figure; only tokens whose card reading shows a market cap at or under it | — |
| `minMarketCap` | a positive dollar figure; only tokens whose card reading shows a market cap at or above it (with `maxMarketCap`, a band) | — |
| `launchpad` | `pons`, `virtuals`, `hoodfun`, `clanker`, `pairfund`, `bankr`, `hooddev`, `poolstrade`, `easya-kickstart`, `hoodit`, … | — |
| `q` | free text — name, ticker or contract prefix; under two characters is no query | — |

**The Token Projects view, in API terms (2026-09-12).** Explore's `?view=tokens` is spelled here as
`has=token`. A market order (`sort=marketCap`, `liquidity`, `volume24h`) puts projects without that
reading *after* those with it, in activity order — it never ranks them, and it never invents a
figure. Whenever a request names a market field (a market sort, `stage`, `minLiquidity`,
`maxMarketCap`, or `has=marketCap|liveMarket|verifiedToken`) the response carries
`catalogue.marketCoverage`: `base` (rows under the non-market filters), and how many of them have a
`marketCap`, `liquidity`, `volume24h` reading, a `liveMarket` (market not gone), an `activeMarket`
(traded in the last day), a `verifiedToken`, and each launch `stage` — the denominators a sorted list needs to be read honestly. List items gain `liquidity` and
`volume24h` (`{usd, source, observedAt}`, from the same snapshot as `marketCap`) and `launchStage`
only when present. A token priced only by its launchpad's curve has no liquidity figure by design.
Two more fields since 2026-09-13: `venue`, the pool the current reading came from in words
("Uniswap v4", "Pons") — where the token trades, never where it launched, so `launchedVia` stays
absent for a token whose launch HEY did not observe — and `hasBuilderSource`, whether HEY holds
a repository, org, changelog or feed to read building from. `activityStatus: "UNKNOWN"` with
`hasBuilderSource: false` means there is nothing to read, not that HEY has not looked; trading
is not building.

**An unrecognised value is dropped, not refused.** A caller who invents a filter gets the
unfiltered listing rather than a 400 to handle — and the `query` object in every response
echoes the request *as it was understood*, which is how you find out a filter was ignored.

```json
{
  "query": { "limit": 24, "offset": 0, "sort": "activity", "launchpad": "pons" },
  "total": 382,
  "nextOffset": 24,
  "items": [
    {
      "slug": "agentos",
      "name": "AgentOS",
      "symbol": "AOS",
      "shortDescription": "Autonomous agent infrastructure for Robinhood Chain.",
      "projectKind": "UTILITY",
      "activityStatus": "SHIPPING",
      "researchLevel": "VERIFIED_BUILDER",
      "catalogStatus": "VERIFIED_BUILDER",
      "stillBuilding": false,
      "lastShippedAt": "2026-09-03T10:00:00.000Z",
      "primaryNarrative": { "slug": "ai-agents", "name": "AI Agents" },
      "token": { "chainId": 4663, "contractAddress": "0xa000…" },
      "launchedVia": { "name": "Pons", "url": "https://ponsfamily.com/launchpad/0xa000…" },
      "officialX": { "handle": "agentos", "url": "https://x.com/agentos" },
      "marketCap": { "usd": 24000, "source": "coingecko" },
      "url": "https://heyresearch.xyz/project/agentos"
    }
  ],
  "catalogue": { "verifiedBuilders": 1237, "stillBuilding": 3, "underTheRadar": 6 },
  "disclaimer": "Public, source-backed activity HEY recorded. …"
}
```

Paging: follow `nextOffset` until it is absent. It is absent at the end of a listing rather
than pointing past it.

Project detail (`/api/projects/<slug>`) also carries two facts about the tracked token, kept apart
from `activityStatus` (2026-09-11): `tokenVerification` (`status` VERIFIED, UNVERIFIED or MISMATCH,
with a `reason` key) says whether the project itself ties the contract to the project; `tokenMarket`
(`status` ACTIVE_MARKET, LOW_LIQUIDITY, NO_LIQUIDITY, TRADING_INACTIVE, LIQUIDITY_REMOVED,
MARKET_ABANDONED or INSUFFICIENT_DATA, with `liquidityUsd`, `volume24hUsd`, `peakLiquidityUsd`,
`pairCreatedAt`, `evaluatedAt`) describes the market HEY observed. Neither feeds a score; both are
observations, never a verdict on the team.

`launchedVia` is present only when HEY observed the launch. "Unknown" and "Independent" are
how the *card* says provenance is missing; the API omits the field instead, so nothing reads
them as the names of launchpads.

## `GET /api/projects/{slug}`

One project in full: everything in the listing, plus the long description, every registered
source with how it was established, the market reading with its provider, and the momentum
figures with the scoring version that produced them.

A project HEY has not measured carries **no `score` key at all** — a zero would read as
"measured, nothing found", which is a different answer from "not measured".

A slug that is not published answers `404` with `{ "error": "not_found" }`. It looks
identical to a slug that never existed, which is what the pages do too.

## `GET /api/ships`

A record of ships, not of projects: a project that shipped three times this week appears
three times, each with its own source.

| Parameter | Values | Default |
|---|---|---|
| `limit` / `offset` | 1–48 / ≥ 0 | 24 / 0 |
| `sort` | `latest`, `marketCap`, `activity` | `latest` |
| `project` | a project slug | — |
| `type` | a ship event type, e.g. `GITHUB_RELEASE`, `PRODUCT_LAUNCH` | — |
| `has` | the card facts, as above | — |
| `q` | the shipping project's name, ticker or contract prefix | — |
| `since` | an ISO 8601 instant — the window you are reporting on | — |

An unreadable `since` is treated as **no window** rather than a silently shifted one, and the
echo shows the instant it was actually read as.

## `GET /api/bounties` and `GET /api/bounties/{id}` (2026-09-13)

Open and awarded research bounties, read-only. `status=open|awarded|all`, `limit` ≤ 50. Each
item carries the title, kind, scope and the evidence a submission must show, the project it is
about, the reward (`hey`, `heyBaseUnits`, `tier`, `targetUsd`, and the `quote` it was fixed at),
and `claim` (`holdersOnlyUntil`, `openToAll`, `claimed`, `claimedBy`, `expiresAt`). The response also carries
`rules`: reading is open to anyone; claiming is a wallet sign-in and a click on the bounty page
(holders of a HEY tier first, then anyone); evidence is public links; a HEY moderator reviews; the
reward is paid to the claimant's linked wallet. **There is no claim, submit or pay endpoint**, on
purpose. When the research economy is closed the list answers `open: false` and no items.

## `GET /api/projects/{slug}/market` (2026-09-13)

One token's market in depth, from HEY's own daily index. `days` (1–400, default 30). `current` is
the same reading the card shows (price, market cap, liquidity, 24 h volume, `buys24h`/`sells24h`,
`priceChange24hPct`, `venue`, `pairAddress`, provider, observed time). `days[]` is one row per UTC
day: `priceOpenUsd`/`priceCloseUsd`/`priceHighUsd`/`priceLowUsd`, `liquidityCloseUsd`,
`volume24hUsd`, `marketCapCloseUsd` and the `source` that won the day, rolled up from HEY's
readings; and, where Bitquery decoded them, `trades`, `buys`, `sells`, `buyVolumeUsd`,
`sellVolumeUsd`, `tradeCloseUsd`, `transfers` (`tradesSource: "bitquery"`). `lifecycle` carries
when HEY recorded the launch, when the pool was created, the launch stage and since when, the
first and last indexed trade day, the highest liquidity HEY saw and how far below it liquidity
sits (`liquidityBelowPeakPct`), and the 7- and 30-day price moves from HEY's own closes.
`checks[]` is what HEY checked on the contract — on chain, upgradeable proxy, deployer (and how
many other projects' tokens it deployed), whether the project's own sources name the contract,
the launch record, liquidity against its high, trades on the latest day — each a `finding` in
words with `provenance` and a `tone` of `plain` or `noted`. Never a score, never "safe" or
"risky". `onchainDays[]` are the contract's events per day; `tvlDays[]` DefiLlama's value locked
per day. Absent means HEY holds no such figure. Counts of trades, transfers and events, never of
accounts. A project without a token is `404`.

## `GET /api/signals` and `GET /api/signals/{id}` (2026-09-13)

HEY Signal: measured changes about published projects. `group` (`development`, `contract`,
`market`, `launch`, `research`), `kind` (e.g. `development_spike`, `development_slowing`,
`development_dormant`, `development_resumed`, `release_published`, `contract_deployed`,
`contract_upgraded`, `liquidity_drop`, `liquidity_rise`, `liquidity_removed`, `market_active`,
`volume_spike`, `launch_graduated`, `project_published`, `builder_verified`, `token_verified`),
`slug`, `days` (default 30), `order=newest|importance`, `limit` ≤ 100, `offset`. The unfiltered feed leaves out
`project_published` (a launch record, thousands after a promotion pass); pass `group=launch`,
`kind=project_published` or `include=published` to see them. Each item carries
`before`, `after`, `changePct` and `unit` where the rule measured figures, `evidence[]` (labels and
URLs a reader can open), `source` (the HEY table the figures came from), `confidence` (0–1) and
`importance` (0–100). Every rule needs an absolute floor and a relative change, fires once per
project per window, and honours a cooldown; a moderator can mark a false positive, which leaves
the feed. Counts of trades, transfers and events only, never accounts. Never a verdict.

## `GET /api/builders` (2026-09-13)

The Builder Radar. `filter` (`all`, `pons`, `virtuals`, `other-launch`, `no-token`, `new`,
`established`, `most-improved`, `development`, `onchain`, `resumed`), `q`, `limit` ≤ 200,
`offset`. Each item carries today's `rank`, `rank7d`, `rank30d`, `scores` (`overall`,
`development`, `onchain`, `research`), `liquidityHealth` (context, never in the rank) and the
`inputs` the scores were read from. `method` states the formula: overall = 0.65 × development
(HEY Build Momentum) + 0.20 × on-chain use + 0.15 × research standing; market cap, price and
volume take no part. Ranks are recomputed daily and kept.

## `GET /api/reports/weekly` and `GET /api/reports/weekly/{week}` (2026-09-13)

The archived weekly reports, one per ISO week (`2026-W37`): overview counts, chain totals,
most active builders, movers, top builders, new verified builders, back to shipping, Still
Building, Under the Radar, the week's signals. `final` is true once the week has closed.

## `GET /api/projects/{slug}/intelligence` (2026-09-13)

One project's intelligence in one answer: the card, its signals (90 days), its Builder Radar
rank and 30-day history, and — for a token project — the market summary with the contract checks.

## `GET /api/chain` (2026-09-13)

Robinhood Chain day by day, aggregates only. `days` (1–400, default 14). Each row: `dexTrades`,
`dexVolumeUsd` (trades against USDG, WETH and ETH only — unpriced pairs are left out rather than
guessed), `tokensTraded`, `poolsTraded`, `transactions`, `transfers` (from Bitquery, when the key
is set), and what HEY saw: `launches` recorded, `projectsPublished`, `ships`, `buildersShipping`.
`today` names the partial day in progress and `lastFullDay` the last complete one.

## Feeds

The same material is also published as RSS, for a reader rather than a script:

```
/feed/ships.xml       every ship
/feed/this-week.xml   the weekly rollup
/api/this-week        the weekly rollup as JSON
/api/status           HEY's own freshness and health
```

## Implementation

- Routes: `apps/web/src/app/api/projects/`, `apps/web/src/app/api/ships/`
- Serialisers: `apps/web/src/lib/public-api-view.ts` (pure, unit-tested)
- Query vocabulary: `apps/web/src/lib/public-api-query.ts` (pure, unit-tested)
- Shared response rules: `apps/web/src/lib/public-api.ts`
- Contract tests: `apps/web/e2e/public-api.spec.ts`

Every route reads HEY's own database and makes no third-party call (CLAUDE.md architecture
rules 13–14), and every filter goes through the same query layer the pages use, so a count
returned here and a count shown on a page cannot disagree.
