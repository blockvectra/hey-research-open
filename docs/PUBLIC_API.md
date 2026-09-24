# Public read API (2026-09-05)

HEY answers one question — **which projects are still building, what have they shipped, and
which of them are not yet getting much market attention?** Until now the only way to ask it
was to read the pages. These endpoints are that answer as JSON.

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
| Provenance travels with the fact | A ship carries `sourceUrl` and `verification`; a market figure carries the `source` that reported it. One exception, and it is the roll-up rather than the record: `/api/this-week` prints a bare `marketCapUsd` on its list items, with no `source` and no `observedAt` — read it as the figure the project listing carries, and take the provenance from `/api/projects` (2026-09-19). |
| Self-reported ≠ verified | `verification` distinguishes them, always. |
| Research depth is stated | `researchLevel` and `catalogStatus` say whether HEY merely indexed a record or actually researched it, so an `INDEXED` row is not read as a claim. |
| No wallet data, and one narrow holder snapshot | HEY builds no wallet analytics, no PnL, no smart-money labels and no cross-token holder history. Since the founder's 2026-09-14 amendment it does keep one narrow thing: a daily snapshot of a **single token's** fifty largest balances, which draws the distribution bubble map on `/project/{slug}/market`. **No payload here carries a balance or an address**, and the snapshot is never an input to activity status, Build Momentum, the Discovery Gap or the Builder Radar. It is not sealed off from everything: `/api/signals` publishes a `concentration_rose` signal derived from it (2026-09-15) — a Nakamoto count with its before and after, carrying an `importance` like every other signal, which `order=importance` sorts the *feed* by. That feed is a record of measured changes, not a ranking of projects. |
| Market data is context | It never ranks anything here, and the default order is activity. |
| Paid placement is not in the data | The labelled *Sponsored* row on the home page is advertising. It has no field here, no feed entry, and no effect on any order, score or status. |
| The caveat travels too | Every data response carries `disclaimer`. `/api/status` is the exception: it reports HEY's own freshness and health, claims nothing about a project, and carries no `disclaimer` (2026-09-19). |
| A claim travels with its evidence | `stillBuilding: true` is accompanied by `stillBuildingEvidence` — the market drawdown HEY tracked and the meaningful ships recorded since it began (2026-09-17). Absent together when no drawdown was recorded, which is every project the claim is not being made about. |
| Show the link you were given | Anything rendered from a HEY fact carries the `url` back to the project page it came from. It is a condition of use, not a technical gate: a reader who sees a HEY line should always be one tap from the evidence behind it. |
| The strict states carry their denominator | `GET /api/projects` carries `catalogue`: how many verified builders HEY has and how many meet Still Building and Under the Radar right now (2026-09-11). A handful out of thousands is the rule working, not the data failing. |

Dates are ISO 8601 in UTC. Responses are cached for 60 seconds, allow cross-origin reads
(`access-control-allow-origin: *`), and are rate limited to 120 requests a minute per client without a key.

**API keys (M13-E).** A signed-in reader with a linked wallet can create a key on `/account`. Send it as
`authorization: Bearer hey_…` (or `x-api-key`). A key reads exactly the same data; it carries the account's
holder tier, which sets a monthly allowance and a per-minute limit (`x-hey-tier`, `x-hey-monthly-remaining`
on every keyed answer). A key with no holder tier has a monthly ceiling too; the figure is a setting the lab
edits on its console (since 2026-09-18), and the holder tiers sit above it. Keyed answers are `private, no-store`. A bad, revoked or expired key is `401 unauthorized`; a
key the lab has suspended, or an account it has blocked, is `403 forbidden` with a `reason` (`key_suspended`,
`account_suspended`, `account_blocked`) and a sentence saying whom to write to; a spent allowance is `429 quota`
with `retry-after`. The allowance is checked before a request is counted. A keyed request draws on its tier's
per-minute bucket from one address (since 2026-09-18; it used to be capped at the anonymous limit). The routes
answer `OPTIONS` with the allowed headers.

## SDK (`@hey-research/sdk`)

Since 2026-09-19 the same API is also a typed client, so nobody has to retype the shapes on
this page. It is a thin fetch wrapper with no dependencies, ESM and CJS, Node 18 or a browser;
it holds no data and no credential beyond the key you hand it.

**It is not on npm yet** (checked 2026-09-19): the `@hey-research` scope does not exist, so
`npm i @hey-research/sdk` does not resolve. Until the lab creates the organisation and the
publish token, build it from the repository:

```bash
pnpm install && pnpm --filter @hey-research/sdk build   # packages/sdk/dist
```

Once published, the install is `npm i @hey-research/sdk` and nothing else on this page changes.

```ts
import { HeyClient, HeyApiError } from '@hey-research/sdk';

const hey = new HeyClient(); // https://heyresearch.xyz; { baseUrl, apiKey, timeoutMs } are optional

const page = await hey.projects.list({ tab: 'still-building', limit: 24 });
console.log(page.total, page.items[0]?.activityStatus);

for await (const project of hey.projects.items({ tab: 'still-building' })) {
  console.log(project.slug, project.lastShippedAt ?? 'no ship recorded');
}

try {
  await hey.projects.get('no-such-slug');
} catch (error) {
  if (error instanceof HeyApiError) console.log(error.status, error.code, error.retryAfterSeconds);
}
```

- **Paging follows the API, not one convention.** `projects` and `ships` pages walk `nextOffset`
  until it is absent; `signals` and `builders` have no `nextOffset`, so the client steps `offset`
  by **the number of items the previous page actually returned** — not by the `limit` asked for —
  and stops when `offset` reaches `total` or a page comes back empty (`packages/sdk/src/paging.ts`).
  A route that clamps `limit` below what you asked for therefore still walks correctly.
  `pages()` yields one page at a time on all four; `items()` — one row at a time — exists on
  `projects` and `ships` only, because those are the two that carry `nextOffset`.
- **Absent means unknown, in the types too.** A field the API leaves out is an optional
  property, never `null`, so `project.marketCap?.usd` reads as it should and nothing downstream
  can average a fact that was never claimed. The only `null` is where the API itself sends one
  (`status()`).
- **No retries, by design.** A `429` surfaces as `HeyApiError` with `code: 'rate_limited'` or
  `'quota'` and `retryAfterSeconds` from the `retry-after` header; the caller decides. A network
  failure is `code: 'network'`, a timeout `'timeout'`, a missing record `'not_found'` with
  `status: 404`.
- **It cannot drift from the API.** `apps/web/src/lib/public-api-contract.test.ts` (private
  repository) asserts, at
  the type level and in both directions, that every response type the SDK exports is identical
  to the serialiser that produces it; `pnpm typecheck` fails on a field added to one side only.
- **The user-agent says who is calling.** Every request carries `hey-research-sdk/<version>`,
  which is how the lab's console counts SDK callers apart from the MCP and from `curl`.

The MCP server (`@hey-research/mcp`) is this client with tool definitions around it; see
`docs/MCP.md`. Releases of both come from the private repository, tagged `sdk-v*` / `mcp-v*`.

## `GET /api/projects`

The catalogue, with the same filters and order the browse pages use.

| Parameter | Values | Default |
|---|---|---|
| `limit` | 1–48 | 24 |
| `offset` | 0–5000; a larger value is silently clamped to 5000 (`MAX_LISTING_OFFSET`), so a deep walk ends there rather than erroring | 0 |
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
| `minVolume` | a positive dollar figure; only tokens whose card reading shows at least this much 24 h volume | — |
| `age` | `day`, `week`, `month`, `older` — how long ago the token's pool was created | — |
| `deployed` | `day`, `week`, `month`, `older` — how long ago the contract was deployed. Two dates, one vocabulary: a pool is opened when someone makes a market, a contract is deployed when the project puts it on chain, and they can be months apart | — |

**The Token Projects view, in API terms (2026-09-12).** Explore's `?view=tokens` is spelled here as
`has=token`. A market order (`sort=marketCap`, `liquidity`, `volume24h`) puts projects without that
reading *after* those with it, in activity order — it never ranks them, and it never invents a
figure. Whenever a request names a market field (a market sort, `stage`, `minLiquidity`,
`maxMarketCap`, or `has=marketCap|liveMarket|verifiedToken`) the response carries
`catalogue.marketCoverage`: `base` (rows under the non-market filters), and how many of them have a
`marketCap`, `liquidity`, `volume24h` reading, a `liveMarket` (market not gone), an `activeMarket`
(traded in the last day), a `verifiedToken`, each launch `stage`, and `github` — how many carry a
public repository HEY reads commits from, a builder fact kept in the same block because it narrows
the base the other denominators are counted over — the denominators a sorted list needs to be read honestly. List items gain `liquidity` and
`volume24h` (`{usd, source, observedAt}`, from the same snapshot as `marketCap`) and `launchStage`
only when present. A token priced only by its launchpad's curve has no liquidity figure by design.
Two more fields since 2026-09-13: `venue`, the pool the current reading came from in words
("Uniswap v4", "Pons") — where the token trades, never where it launched, so `launchedVia` stays
absent for a token whose launch HEY did not observe — and `hasBuilderSource`, whether HEY holds
a repository, org, changelog or feed to read building from. `activityStatus: "UNKNOWN"` with
`hasBuilderSource: false` means there is nothing to read, not that HEY has not looked; trading
is not building.

Four more list-item fields, present only when HEY holds them (documented 2026-09-19; they have
been served for longer): `websiteUrl`, the project's own site; `trades24h`
(`{buys, sells, source, observedAt}`), the day's buy and sell counts from the same market
snapshot; `priceChange24hPct`, a plain number; and `logoUrl`, an absolute image URL as HEY recorded it.

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
than pointing past it. Only `/api/projects` and `/api/ships` carry `nextOffset`; `/api/signals`
and `/api/builders` carry `total` alone, so a caller pages those by adding `limit` to `offset`
until `offset` reaches `total` (2026-09-18).

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

### What the dossier adds (2026-09-17)

- `ships` — the project's newest five ships, each as `GET /api/ships?project=` would list it. A bare
  contract deployment is a launch, not a ship, and appears on none of the ship surfaces; the project
  page's own timeline still shows it.
- `stillBuildingEvidence` — present whenever `stillBuilding` is true, on the dossier as on the listing.

### Mirroring the ship feed (2026-09-17)

`since` filters on `publishedAt` — the date the *project* shipped — because it names the window
you are reporting on. That is the wrong axis to mirror along. HEY polls sources on tiers, so a
release published on Monday is routinely recorded on Tuesday, and a consumer keeping the newest
`publishedAt` it has seen never sees anything ingested after that watermark moved past it. Not
late: never.

Every ship now carries **`detectedAt`** — when HEY observed it — and the feed accepts
**`?detectedSince=<ISO>`** and **`?sort=detected`**. Page along those and nothing is missed:

```bash
curl "https://heyresearch.xyz/api/ships?sort=detected&detectedSince=2026-09-16T00:00:00Z&limit=48"
```

Keep the highest `detectedAt` you have seen and pass it back next time. `since` is unchanged and
still means what it meant.

## `GET /api/token/{chainId}/{address}` (2026-09-16)

One project, by the identity a reader actually holds. Built for an integration that meets a
contract address rather than a slug — someone pastes a CA into a chat and the caller wants one
line about it — so the fields are the ones such a line needs and no more.

```
GET /api/token/4663/0xa0000000000000000000000000000000000000a1
```

```jsonc
{
  "chainId": 4663,
  "contractAddress": "0x…",
  "status": "published",
  "project": {
    "slug": "agentos",
    "name": "AgentOS",
    "symbol": "AOS",
    "url": "https://heyresearch.xyz/project/agentos",
    "activityStatus": "SHIPPING",
    "activityLabel": "Shipping",
    "activityHelp": "Shipped something meaningful in the last 7 days.",
    "shipsLast30Days": 4,
    "lastShipAt": "2026-09-14T15:54:25.322Z",
    "lastShip": { "title": "Agent SDK v0.4", "publishedAt": "…", "sourceUrl": "…" },
    "deployedAt": "2026-06-02T11:20:41Z",
    "badgeUrl": "https://heyresearch.xyz/badge/agentos.svg"
  },
  "scanUrl": "https://heyresearch.xyz/scan?address=0x…",
  "disclaimer": "…"
}
```

**One identity, one spelling (2026-09-17).** The chain id is the plain integer `4663` —
`4663.0`, `04663` and `4663e0` are refused with `400` rather than accepted as the same chain, so
a token has one URL for caches and crawlers to hold. The address prefix may be `0x` or `0X`
(some explorers print the latter); the answer's `contractAddress` is always the lowercase form.

**`status: "unknown"` answers `200`, not `404`.** Most addresses pasted anywhere are not
published projects, and a 404 would make the ordinary case an exception for every caller. That
answer carries `scanUrl` — somewhere to send the reader instead of a dead end — and no `project`.

**Published records only.** An address HEY holds but has not reviewed answers `unknown`, the same
as one it has never seen. An unreviewed launch record is not a project to this API.

**The words travel with the enum.** `activityLabel` and `activityHelp` come from the table the
site itself renders from, so an integration does not have to invent a translation. Left to
themselves, integrators turn `DORMANT` into "dead" — which is the one thing HEY's activity model
refuses to say. Use the strings you are given.

**`shipsLast30Days` counts what the project's own page counts**, over the window the field names.
A number that contradicts the page it links to is worse than no number.

**There is no risk field, no score and no verdict**, here or anywhere. HEY answers whether anyone
is building; it says nothing about what a token might do next. An integration that wants a risk
reading should put one from a tool that does that work beside this line — HEY is built to sit
beside those tools rather than replace them.

`chainId` is in the path because identity here is `(chainId, contractAddress)` and never the
address alone. An address from another chain answers `400` rather than being resolved against
this one. So does a malformed address, and so do the burn and zero addresses — well-formed, and
nobody's project.

This route is a database read and makes no provider call, which is why it sits on the ordinary
120-a-minute allowance. **`POST /api/scan` is not the endpoint for an integration**: it reads the
chain, the explorer and whatever a token declares about itself, so it allows ten requests an
hour, is never cached, and spends a budget the scheduled pipeline needs.

## `GET /api/v1/scan?chain={chainId}&token={address}` (2026-09-18)

The by-contract lookup above in the shape a trading bot's card wants: `found`, `status` (HEY's six
states, lower-cased) with `status_label` and `status_help` in HEY's own words, `verified_builder`,
`activity` (`commits_30d` — absent when no repository is read, and a floor when `commits_30d_partial: true` says a commits page was cut inside the window; `releases_30d`, `ships_30d`,
`last_ship`), `project_url`, `logo_url`, `badge_url`, a `cta` that points at the project page, and
the disclaimer. `found: false` is a 200 for an unpublished token and for a chain HEY does not index
(`reason: "chain"`); a malformed `token` is a 400. `chain` defaults to 4663. Same limits and cache as
`/api/token`; a database read only. Documented for bots in [INTEGRATIONS.md](INTEGRATIONS.md).

## `GET /api/v1/builder?chain={chainId}&token={address}` (2026-09-20)

Builder activity for one contract, for a surface that already draws the chart. Built with RHTools,
whose half of the collaboration is the chart, the pairs and the trading, and whose readers still need
to know whether anyone is building the thing. HEY's own tables only: no GitHub crawl, no chain read,
no provider call, so it is cacheable and costs nothing to call per token.

```
GET /api/v1/builder?chain=4663&token=0xa0000000000000000000000000000000000000a1
```

```jsonc
{
  "contract_address": "0x…",
  "chain_id": 4663,
  "last_activity_at": "2026-09-19T10:00:00.000Z",
  "status": "active",                       // active | stale | dormant | unknown
  "hey_status": "SHIPPING",
  "hey_status_label": "Shipping",
  "hey_status_help": "Shipped something meaningful in the last 7 days.",
  "hey_project_url": "https://heyresearch.xyz/project/agentos",
  "hey_project_name": "AgentOS",
  "repo_url": "https://github.com/…",       // only a repository HEY counts as this project's own
  "last_commit": null,                      // always: see below
  "last_code_activity": {
    "summary": "Active development: 20 commits in the last 90 days across 1 contributor",
    "commits": 20,
    "commits_partial": false,
    "active_days": 6,
    "contributors": 1,
    "repo_url": "https://github.com/…",
    "observed_at": "2026-09-19T10:00:00.000Z"
  },
  "latest_release": { "title": "v1.2.0", "version": "v1.2.0", "url": "…", "timestamp": "…" },
  "latest_deployment": { "title": "Deployed a new contract: 0x…", "environment": "robinhood-chain-4663", "url": "…", "timestamp": "…" },
  "disclaimer": "…"
}
```

**`last_commit` is always `null`, and that is the honest answer.** HEY reads a repository's commits,
drops the bots, and writes one summary per repository per ISO week. It never stores a SHA or a commit
message, so there is no commit to return. `last_code_activity` carries what HEY actually holds
instead, and `commits_partial: true` means a full page was read inside the window and `commits` is a
floor.

**`last_activity_at` is the project's freshest meaningful ship**, the same value the project page
uses — across commit summaries, releases and post-launch deploys. Meaningful means approved, not
withdrawn, not context-only, and of a building event type. A bare launch deploy is a launch, not a
ship, so it never sets this.

**`status` has no `abandoned`.** The activity enum says in as many words that there is deliberately no
`DEAD`, `RUGGED` or `ABANDONED` value, and HEY's own copy for dormant reads "Not the same as
abandoned." HEY can see that nothing has been published for a long time; it cannot see that anyone
stopped. The mapping is `SHIPPING`/`ACTIVE`/`RESUMED` → `active`, `QUIET` → `stale`, `DORMANT` →
`dormant`, `UNKNOWN` → `unknown`, and `unknown` means HEY has too few public sources to say either
way rather than that there was no activity.

**A contract HEY has not published answers `404`**, at the partner's request, with `scan_url` so the
caller can offer a live scan. Note this differs from `/api/v1/scan`, which answers `200` with
`found: false` for the same case.

**Optional fields are `null`, never invented.** No repository HEY counts as the project's own, no
release, no post-launch deploy: each is `null` on its own.

## `POST /api/scan` (2026-09-15)

The builder question for one address, read live. **Not the route for an integration** — see
`GET /api/token/{chainId}/{address}` above, which reads HEY's own tables and calls nobody.

```
POST /api/scan   { "address": "0x…" }
```

Ten requests an hour per client, never cached, and every call spends a provider budget the
scheduled pipeline needs first. It is the only route in HEY that makes outbound provider calls
on a reader's request, and it can answer `503` when that budget is spent for the day.

| `status` | HTTP | What it means |
|---|---|---|
| `published` | 200 | HEY publishes a page. Carries `slug`, `url` and `apiUrl`. |
| `known` | 200 | HEY holds the record and has not reviewed it. Carries `slug` and `url` and **no `apiUrl`**: `/api/projects/{slug}` answers 404 until the record is published, and the `message` says so. |
| `no_contract` | 200 | The address is well-formed and there is no contract at it. |
| `invalid` | 400 | Not a contract address on this chain. |
| `unavailable` | 503 | HEY has spent what it set aside for scans today. |
| `scanned` | 200 | A live read. Carries `report` with `groups` of findings, each with its `provenance`. |

A `report` carries an `evidence` breakdown (2026-09-19) and no verdict vocabulary.

```jsonc
"evidence": {
  "identity": { "kind": "measured", "score": 61, "strength": "partial", "readable": 96, "possible": 110,
                "factors": [{ "key": "site-names-contract", "label": "…", "state": "met", "weight": 24 }] },
  "build":    { "kind": "insufficient", "reason": "HEY has no recorded ship for this contract…" },
  "coverage": { "kind": "measured", "score": 62, "strength": "partial" },
  "overall":  { "kind": "measured", "score": 61, "strength": "partial" },
  "blindSpots": ["Code activity — no repository is declared and the site linked none."],
  "model": "scan-evidence-v1"
}
```

**It measures HEY's evidence, never the project.** `identity` is how firmly the contract is tied to a
named builder, `coverage` is how many of the places HEY looks actually answered, and `overall` is
`45/35/20` over the bands that could be measured. A low reading means HEY could verify little. It is
not a quality figure, not a risk figure, and nothing in it forecasts anything.

**A band HEY could not measure carries `kind: "insufficient"` and a `reason`, never a zero.** `build`
is the stored Build Momentum — the same number `/api/projects/{slug}` reports, never recomputed — and
a contract HEY holds no recorded ship for has none, which is the ordinary case for a live scan.

**A check HEY could not run leaves `possible` but not `readable`**, so a provider outage never scores
against a project. `factors[].state` is `met`, `unmet` or `unreadable`, and the third is the one that
means HEY could not look.

`GET /api/v1/scan` is unchanged: the bot card carries no evidence block. Findings are
facts with the place they were read from, and the absences are named as absences.

**Three refusals before any of that** (documented 2026-09-19). The route is same-origin and JSON
only: a request whose `origin` is not HEY's own is `403` with `{"error": "Cross-site request
refused."}`, and a body that is not `application/json` is `415` with `{"error": "Send JSON."}`;
a malformed or missing `address` is `400`. The `403` is the one to design around, because the
`OPTIONS` preflight succeeds first — it answers `204` with the allowed methods, as every route
here does — so a browser call from another origin clears the preflight and is then refused on
the POST itself. Use `GET /api/token/{chainId}/{address}` from a browser; it is cross-origin by
design.

## `GET /api/ships`

A record of ships, not of projects: a project that shipped three times this week appears
three times, each with its own source.

| Parameter | Values | Default |
|---|---|---|
| `limit` / `offset` | 1–48 / ≥ 0 | 24 / 0 |
| `sort` | `latest`, `marketCap`, `activity`, `detected` (by when HEY observed the ship) | `latest` |
| `project` | a project slug | — |
| `type` | a ship event type, e.g. `GITHUB_RELEASE`, `PRODUCT_LAUNCH` | — |
| `has` | the card facts, as above | — |
| `q` | the shipping project's name, ticker or contract prefix | — |
| `since` | an ISO 8601 instant — the window you are reporting on (filters `publishedAt`) | — |
| `detectedSince` | an ISO 8601 instant filtering `detectedAt`, the mirroring axis — see below | — |

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

A project's `onchainActivity` in `GET /api/projects/{slug}` gained four optional fields on
2026-09-14, present only on days a decoding source filled: `calls24h`, `transactions24h`,
`methods` and `eventKinds`. The last two are how many *different* method names were called and
event names emitted over the days read — the cheapest honest separation between an ERC-20 being
traded and a contract with functions people call. All four are counts and context, never an input
to any score. No address is named here — but "no accounts, anywhere", which this line used to
say, stopped being true on 2026-09-15: HEY's daily index counts how many different addresses
called a contract and traded a token, and `/api/signals` publishes those counts (2026-09-19).
They are figures the provider returns; nothing selects, stores or exposes an address.

## `GET /api/signals` and `GET /api/signals/{id}` (2026-09-13)

HEY Signal: measured changes about published projects. `group` (`development`, `contract`,
`market`, `launch`, `research`), `kind` — the full vocabulary is `development_spike`,
`development_slowing`, `development_dormant`, `development_resumed`, `release_published`,
`contract_deployed`, `contract_upgraded`, `liquidity_drop`, `liquidity_rise`,
`liquidity_removed`, `market_active`, `volume_spike`, `usage_broadened`, `usage_narrowed`,
`concentration_rose`, `trading_narrow`, `launch_graduated`, `project_published`,
`builder_verified` and `token_verified` (`packages/domain/src/signals/vocabulary.ts`, private
repository) —
`slug`, `days` (default 30), `order=newest|importance`, `limit` ≤ 100, `offset`. The unfiltered feed leaves out
`project_published` (a launch record, thousands after a promotion pass); pass `group=launch`,
`kind=project_published` or `include=published` to see them. Each item carries
`before`, `after`, `changePct` and `unit` where the rule measured figures, `evidence[]` (labels and
URLs a reader can open), `source` (the HEY table the figures came from), `confidence` (0–1) and
`importance` (0–100). Every rule needs an absolute floor and a relative change, fires once per
project per window, and honours a cooldown; a moderator can mark a false positive, which leaves
the feed.

**Four kinds count addresses, and say so** (2026-09-19; the page used to claim "never accounts",
which stopped being true when they shipped). `usage_broadened` and `usage_narrowed` report
`address-days` of contract calls week over week; `trading_narrow` reports how few addresses were
behind a day of heavy trading; `concentration_rose` reports a Nakamoto coefficient — how few
addresses hold half the supply, pools, lockers and burn addresses excluded from both the count
and the supply it is measured against. All four are figures a provider computes and returns;
none of them names, stores or exposes an address, and none of them is an input to activity
status, Build Momentum, the Discovery Gap or the Builder Radar. Never a verdict.

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

Since 2026-09-24 it also carries `development`: derived builder intelligence under rules
`intel-v1` (`rulesVersion`), computed from the same meaningful events as the activity status and
never from a price. Every figure is measured or carries a `state` that says why it is not.

| Field | Meaning | Unknown when |
|---|---|---|
| `velocity` | meaningful events in the last 30 days (`current`) against the 30 before (`previous`), `changePct`, `state` ACCELERATING / STABLE / SLOWING / NO_RECENT_ACTIVITY | `state: NEW` — HEY has watched the project under 60 days; `previous` and `changePct` are null. A zero denominator gives `changePct: null`, never infinity |
| `cadence` | median days between release days over 365 days (same-day releases count once), newer vs older half, `direction` FASTER / STEADY / SLOWER | `state: INSUFFICIENT_RELEASES` — fewer than three release days |
| `consistency` | active weeks of the last 12, current and longest streak (weeks), days since the last meaningful ship, longest silence (days), comebacks after 60+ quiet days | `activeWeeks: null` — watched under 12 weeks; day counts null with no meaningful event |
| `discoveryLag` | median and maximum hours from publication to HEY recording an event, over 90 days | `state: INSUFFICIENT_SAMPLES` — fewer than three events published while HEY was watching (backfilled history is excluded) |
| `marketAttention` | the market-context percentile the Discovery Gap uses, as VERY_LOW … HIGH. Context only; it feeds none of the above | `null` without a live market reading |
| `changes` | Build Momentum and liquidity now against the newest reading at least 30 days old; `sameRules` is false when the two carry different scoring versions | either side null when HEY holds no reading for it |

`observedSince` is when HEY began watching the project, the floor under every window.

## `GET /api/projects/{slug}/ask?q=` (2026-09-24)

Ask HEY's evidence answer: `q` (3–280 characters, English or Malay) matched to
the parts of HEY's record it is about. `sections[]` each carry a `question`
and `lines[]` of `{ tag: FACT | DERIVED | UNKNOWN, text, source? }`. `notice`
is present when the question asked for a price view or a buy/sell call, and
says HEY gives neither. `fallback: true` means HEY could not place the
question and answered with what changed and what it does not know. No model
is involved. `400` without `q`, `404` for an unpublished slug.

## `GET /api/chain/contract-changes?days=30` (2026-09-24)

Evidence-backed contract changes on published projects, newest first, `days`
1–90. Two shapes in `items[]`: `CONTRACT_UPGRADE` / `CONTRACT_DEPLOY_FOLLOWUP`
per project with `count` and the `latest` event and its source; and
`VERIFIED` / `UNVERIFIED` / `INTERFACE_CHANGED` per contract address with the
function and event signatures added and removed, `detectedAt` (when HEY saw
it, not when it happened) and the explorer `source`.

## The Terminal command centre (2026-09-24)

The same reads the Terminal's command centre uses, keyless and cached like the
rest of the API. Every list carries its `method` in words; none is ordered by
price, and none names a winner.

| Route | Answers |
|---|---|
| `GET /api/chain/silence` | projects building with comparatively little market attention (HEY's stored Under the Radar decision), each with `meaningfulShips30d` and `marketAttention` |
| `GET /api/chain/comebacks` | projects whose activity status is RESUMED |
| `GET /api/chain/unlocks?days=30` | HoodLock's own schedule: locks still holding that unlock within `days` (1–365), each `precision: SCHEDULED` with a `proof` link |
| `GET /api/chain/build-market` | Build Momentum and market-attention percentile for researched projects, in slug order — a map, not a ranking |
| `GET /api/projects/{slug}/timeline?lens=` | every kind of evidence on one axis with `precision` (EXACT, DATE, WEEK, OBSERVED, SCHEDULED), `recordedAt`, `discoveryLagHours`, `countsAsBuilding`, `source` and `marketAround` (context, not cause). Lenses: everything, build, code, onchain, market, locks |
| `GET /api/compare?slugs=a,b` | two to four projects side by side with the project page's gates; `missing` names slugs that are not published; `400` for fewer than two |

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

Paths under `apps/web/` and `packages/domain/` are in HEY's **private** repository and are
named here so a reader of that repository can find them; they are not part of the public export
(2026-09-19). `packages/sdk`, `packages/sources`, `packages/scoring`, `packages/config`,
`packages/ui` and `apps/mcp` are public.

- Routes: `apps/web/src/app/api/projects/`, `apps/web/src/app/api/ships/`
- Serialisers: `apps/web/src/lib/public-api-view.ts` (pure, unit-tested)
- Query vocabulary: `apps/web/src/lib/public-api-query.ts` (pure, unit-tested)
- Shared response rules: `apps/web/src/lib/public-api.ts`
- Contract tests: `apps/web/e2e/public-api.spec.ts`
- The SDK: `packages/sdk` (published as `@hey-research/sdk` once the npm organisation exists);
  the type-level contract between its response types and the serialisers:
  `apps/web/src/lib/public-api-contract.test.ts` (2026-09-19)

Every route here reads HEY's own database and makes no third-party call (CLAUDE.md
architecture rules 13–14) — with one deliberate exception, `POST /api/scan`, which exists to
read an address HEY has never seen and says so in its own section above. Every filter goes
through the same query layer the pages use, so a count returned here and a count shown on a
page cannot disagree.
