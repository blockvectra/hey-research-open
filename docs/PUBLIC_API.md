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
| No wallet data, and one narrow holder snapshot | HEY builds no wallet analytics, no PnL, no smart-money labels and no cross-token holder history. Since the founder's 2026-09-14 amendment it does keep one narrow thing: a daily snapshot of a **single token's** fifty largest balances, which draws the distribution bubble map on `/project/{slug}/market`. **No payload here carries a balance or a holder's address** — `/market` sends only a summary of the snapshot (shares, a holder count, the day), and the one address it names is the contract's *deployer*, a fact about the contract read from the chain (2026-09-25) — and the snapshot is never an input to activity status, Build Momentum, the Discovery Gap or the Builder Radar. It is not sealed off from everything: `/api/signals` publishes a `concentration_rose` signal derived from it (2026-09-15) — a Nakamoto count with its before and after, carrying an `importance` like every other signal, which `order=importance` sorts the *feed* by. That feed is a record of measured changes, not a ranking of projects. |
| Market data is context | It never ranks anything here, and the default order is activity. |
| Paid placement is not in the data | The labelled *Sponsored* row on the home page is advertising. It has no field here, no feed entry, and no effect on any order, score or status. |
| The caveat travels too | Every data response carries `disclaimer`. `/api/status` is the exception: it reports HEY's own freshness and health, claims nothing about a project, and carries no `disclaimer` (2026-09-19). |
| A claim travels with its evidence | `stillBuilding: true` is accompanied by `stillBuildingEvidence` — the market drawdown HEY tracked and the meaningful ships recorded since it began (2026-09-17). Absent together when no drawdown was recorded, which is every project the claim is not being made about. |
| Show the link you were given | Anything rendered from a HEY fact carries the `url` back to the project page it came from. It is a condition of use, not a technical gate: a reader who sees a HEY line should always be one tap from the evidence behind it. |
| The strict states carry their denominator | `GET /api/projects` carries `catalogue`: how many verified builders HEY has and how many meet Still Building and Under the Radar right now (2026-09-11). A handful out of thousands is the rule working, not the data failing. |

Dates are ISO 8601 in UTC. Responses are cached for 60 seconds, allow cross-origin reads
(`access-control-allow-origin: *`), and are rate limited to 120 requests a minute per client without a key.

**API keys.** Any signed-in reader can create a key on `/account` while keys are open on the
deployment; one active key per account. Send it as `authorization: Bearer hey_…` (or `x-api-key`).
Every public read route takes one: one gate guards them all, and each belongs to one of the route
groups listed under partner keys below. A key reads exactly the same data; it carries the account's holder tier
(set from the wallet linked to the account, Free without one), which sets a monthly allowance and a
per-minute limit (`x-hey-tier`, `x-hey-monthly-remaining` on every keyed answer). A key with no holder tier has a monthly ceiling too; the figure is a setting the lab
edits on its console (since 2026-09-18), and the holder tiers sit above it. Keyed answers are `private, no-store`. A bad, revoked or expired key is `401 unauthorized`; a
key the lab has suspended, or an account it has blocked, is `403 forbidden` with a `reason` (`key_suspended`,
`account_suspended`, `account_blocked`) and a sentence saying whom to write to; a spent allowance is `429 quota`
with `retry-after`. The allowance is checked before a request is counted. A keyed request draws on its tier's
per-minute bucket from one address (since 2026-09-18; it used to be capped at the anonymous limit). The routes
answer `OPTIONS` with the allowed headers.

**Partner keys (2026-09-30).** A platform partner the lab records by hand gets its own key,
`authorization: Bearer heyp_…`. It reads exactly the same public data as no key, but carries the
partner's own monthly quota and per-minute limit (one bucket across its keys) and only the **route
groups** the lab granted it: `research`, `changes`, `contracts`, `partner_cards`, `mcp`, `a2a`. A route
outside them is `403 forbidden` with `reason: "route_not_permitted"` and the `group`; an account's own
routes (`/api/webhooks`, `/api/alerts`, `/api/boards`) are in no group a partner can hold. The hosted MCP
server's reads need `mcp` as well as the group they read. A partner key rotates with an overlap: the new
key and the old one both work until the grace the lab chose ends. Answers are `private, no-store` with
`x-hey-entitlement` (`partner`, `paid`, `internal`; account keys say `free`) and
`x-hey-monthly-remaining`. A held partner is `403` with `reason` `partner_suspended`, `partner_blocked`
or `key_suspended`; a revoked or expired partner key is `401`. No price or billing is attached to any
class. Ask hi@heyresearch.xyz for one.

A bulk route (2026-09-26: `/api/snapshots`, `/api/token/{chainId}?addresses=`, `/api/v1/scan?tokens=`)
answers keyed requests only (`401 key_required` without one), privately, and charges **one request per
item** against both the per-minute bucket and the monthly allowance — all or nothing, so a batch that
would cross either is refused whole rather than half-answered. Anonymous per-minute buckets key an IPv6
address by its `/64` (2026-09-26).

### Errors (2026-09-26)

Every public read route answers an error in one envelope:

```json
{ "error": "rate_limited", "message": "Too many requests. Try again in 12 seconds.", "requestId": "…", "retryable": true, "retryAfterSeconds": 12 }
```

`error` is a stable code to switch on — its wording never changes; `message` is for a person;
`requestId` is the same id as the `x-request-id` header, to quote when you write to HEY;
`retryable` says whether the same request can succeed later unchanged. Some errors add a field
(`reason` on a 403, `max`/`requested` on `batch_too_large`, `ignoredSlugs` on compare).

| Status | `error` | Retryable | When |
|---|---|---|---|
| 400 | `bad_request`, `invalid_parameter`, `invalid_address`, `batch_too_large` | no | the request is malformed as sent |
| 401 | `unauthorized` | no | the key is not valid |
| 401 | `key_required` | no | a keyed-only (bulk) route was called without a key |
| 403 | `forbidden` | no | the key or account is held, or a partner key is not granted the route's group; `reason` says which |
| 404 | `not_found` | no | no published record, or no such route |
| 413 | `payload_too_large` | no | a bulk answer would exceed 256 KB; ask for fewer |
| 429 | `rate_limited` | yes | the per-minute bucket is spent; `retryAfterSeconds` and `retry-after` say when |
| 429 | `quota` | yes | the monthly allowance is spent (or a bulk request would cross it) |
| 500 | `internal_error` | yes | HEY failed; quote the `requestId` |
| 503 | `service_unavailable` | yes | the database was busy for a moment (a timeout or a held lock); `retryAfterSeconds` and `retry-after` say when to ask again (2026-09-30) |

Every answer, success or error, is readable cross-origin and exposes `retry-after`,
`x-request-id`, `x-hey-tier`, `x-hey-monthly-remaining`, `x-hey-entitlement` and `x-hey-api-version` to a
browser caller. A `message` is one line of at most 300 characters with no control, bidirectional or
zero-width characters, even where it quotes what the caller asked for (2026-09-30). The 500 and the
404 for an unknown path carry the same headers (they used to carry none). Before 2026-09-26 a few
routes put a sentence in `error` (the per-minute 429, `compare`, `ask`); that sentence is now the
`message`, and `error` is the code.

### Versioning

`/api/*` is version `1` and changes **additively**: a field is added, never renamed, removed or
given a new meaning. Every public read answer names the version it was written under in
`x-hey-api-version: 1` (2026-09-30), the same figure as `/openapi.json`'s `info.version`; it identifies,
it does not select — a caller sends nothing. A change that would alter an existing field's
meaning would ship under a new path with at least 90 days of overlap and a migration note.
`/api/v1/*` is the partner namespace (snake_case cards built for one integration each), not an API
version; its field meanings are frozen the same way.

## SDK (`@hey-research-lab/sdk`)

Since 2026-09-19 the same API is also a typed client, so nobody has to retype the shapes on
this page. It is a thin fetch wrapper with no dependencies, ESM and CJS, Node 18 or a browser;
it holds no data and no credential beyond the key you hand it.

It is on npm since 2026-09-27:

```bash
npm i @hey-research-lab/sdk
```

```ts
import { HeyClient, HeyApiError } from '@hey-research-lab/sdk';

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
- **It cannot drift from the API.** The `apps/web/src/lib/public-api-contract.*.test.ts` files
  (private repository, one per family since 2026-09-26) assert, at
  the type level and in both directions, that every response type the SDK exports is identical
  to the serialiser that produces it; `pnpm typecheck` fails on a field added to one side only.
- **The user-agent says who is calling.** Every request carries `hey-research-sdk/<version>`,
  which is how the lab's console counts SDK callers apart from the MCP and from `curl`.

- **Every route has a method** (2026-09-26): `projects.snapshot`, `coverage`, `explain`,
  `history`, `diff` and `contracts`; `evidence.get`; `contracts.get`; the keyed bulk reads
  `snapshots.bulk`, `token.bulk` and `scanCards`; the partner `builderCard`; and
  `search.suggest`. The full table is in the SDK package's README.

The MCP server (`@hey-research-lab/mcp`, hosted at `/mcp` since 2026-09-26) is this client with tool
definitions around it; see the [MCP server](MCP.md). Releases of both are tagged `sdk-v*` /
`mcp-v*`.

## `GET /api/projects`

The catalogue, with the same filters and order the browse pages use.

| Parameter | Values | Default |
|---|---|---|
| `limit` | 1–48 | 24 |
| `offset` | 0–5000; a larger value is silently clamped to 5000 (`MAX_LISTING_OFFSET`), so a deep walk ends there rather than erroring | 0 |
| `sort` | `activity`, `shipped` (newest ship first), `shipped7d` / `shipped30d` (most meaningful ships in the last 7 / 30 days, the scorer's count), `marketCap`, `newest`, `liquidity`, `volume24h`; anything else is a 400 | `activity` |
| `tab` | `building-with-token`, `still-building`, `under-the-radar`, `shipping-now`, `most-active`, `new-builders`, `back-from-dormancy`, `utility`, `memes` | — |
| `kind` | `UTILITY`, `MEME`, `HYBRID`, `INFRASTRUCTURE`, `RWA`, `APPLICATION`, `OTHER` | — |
| `status` | `SHIPPING`, `ACTIVE`, `QUIET`, `DORMANT`, `RESUMED`, `UNKNOWN` | — |
| `narrative` | a narrative slug | — |
| `has` | any of `token`, `x`, `marketCap`, `launchpad`, `liveMarket` (no token, or a token whose market is not gone), `verifiedToken` (the project itself ties the contract to the project), `trading` (the token traded in the last day), `github` (a public repository HEY reads commits from), comma-separated; **all** must hold | — |
| `stage` | `curve`, `graduated`, `dex` — where the launch stands: still on its bonding curve, graduated off it, or trading in a DEX pool | — |
| `minLiquidity` | a positive dollar figure; only tokens whose card reading shows at least this much market liquidity. Unknown liquidity is excluded, never read as zero, and so is a launch pool's own supply (`liquidity.kind: "launch_inventory"`, 2026-09-25) | — |
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
observations, never a verdict on the team. Additive since 2026-10-03: `readingObservedAt` is when
the reading behind `liquidityUsd` and `volume24hUsd` was observed (`evaluatedAt` is when the status
rule last ran, which can be days later), and `figuresScope` is always `reading_pool` — those pool
figures describe the pool the status reading follows, while the project's `volume24h` is the card
reading's figure and may count every pool, so the two can differ without contradicting each other.

Every listed project with a token also carries `tokenMarket` (2026-09-25): `{ status, reason? }`,
the same state the card shows. It is why a listing sometimes has no `marketCap` — a dead market's
valuation (`NO_LIQUIDITY`, `LIQUIDITY_REMOVED`, `MARKET_ABANDONED`, or an untraded launch pool) is
withheld. The dossier's `tokenMarket` is the same object with more in it. Since 2026-09-28 a
listed project whose reading HEY holds but will not publish also carries **`valuationWithheld`**,
the reason code or status (`launch_pool_no_trades`, `readings_implausible`, `NO_LIQUIDITY`); it is
absent when HEY holds no reading at all, so a withheld figure and an unknown one never look alike.
Since round 4 (2026-09-30) `valuationWithheld` also carries the valuation gate's reason when the
reading's valuation is **not plausible from the readings HEY has**: `valuation_over_liquidity` (at
least 10,000× the liquidity measured in the same reading) or `unlisted_over_ceiling` (above $10B on
a Robinhood Chain token that no listing HEY reads carries; HEY reads CoinGecko, not CoinMarketCap).
Such a valuation is never sent as a figure and never enters `sort=marketCap`, `has=marketCap`,
`maxMarketCap` or a coverage count. The comparison (`/api/compare`) and the market detail's
`current` carry `valuationWithheld` too, additively.

`launchedVia` is present only when HEY observed the launch. "Unknown" and "Independent" are
how the *card* says provenance is missing; the API omits the field instead, so nothing reads
them as the names of launchpads.

### What a figure is, not just what it is worth (2026-09-25)

Additive: no field was removed or renamed, and every new one is absent where HEY does not know.

- **`liquidity.kind`** — `market`, or `launch_inventory` for a launch pool's own supply at its
  last price (any `launch_pool_*` reason), which the project page prints as "Not a market
  reading". `minLiquidity`, `sort=liquidity` and `catalogue.marketCoverage.liquidity` leave launch
  inventory out. The same kind is on the dossier's `market.liquidityKind` and
  `tokenMarket.liquidityKind`, the market and intelligence APIs' `current.liquidityKind`, and
  compare's `liquidityKind`.
- **`liquidity` is the figure the page prints.** When the current reading carries no liquidity
  — a reading decoded from on-chain trades has none — it is the token's last recorded depth, with
  its own `observedAt` and no `source`. It used to be absent while the page showed a figure.
- **Provenance on every market figure.** `liquidity`, `volume24h` and `trades24h` carry the
  reading's `source` and `observedAt` whether or not the reading has a valuation; they were keyed
  off the market cap and went out bare without one.
- **`tokenVerification`** (`{ status, reason? }`) on every listed project with a token, not only
  the dossier: `MISMATCH` means the project's own site names a different contract.
- **`tokenLock.nextUnlockAt` and `tokenLock.nextUnlockPct`** — the nearest unlock date and the
  share of total supply that opens that UTC day. `until` is unchanged and is when the *last* of
  the locked supply opens; it was being read as "all of it until then".
- **FDV is never called a market cap.** `/api/this-week` items carry `valuationKind` beside
  `marketCapUsd` (and no valuation for a dead market); market moves carry `valuationKind`; the
  timeline's `marketAround` days carry `marketCapKind` (and no valuation for a dead market); the
  market API's `days[]` carry `marketCapCloseKind`.

### One valuation rule, and withheld figures that say so (2026-09-26)

Additive, except where a figure the docs already promised to withhold was still being sent.

- **One rule decides FDV or market cap, everywhere.** A valuation is an FDV when the provider sent
  the same number as its market cap and its FDV (or sent only an FDV), or when it values at least
  98% of the token's total supply at the reading's price; otherwise it is a market cap. When HEY
  cannot tell — a stored daily close whose snapshot is gone, below the supply line — no kind is
  sent. The card, the daily series and the SQL filters all use this rule; they used to disagree on
  91 published tokens.
- **`valuationKind` beside every `marketCapUsd`**: the dossier's `market.valuationKind`, and the
  market and intelligence APIs' `current.valuationKind`. `marketCapUsd` was an FDV, unlabelled, on
  most tokens.
- **The dossier withholds a dead market's valuation, like the card.** `market.marketCapUsd` and
  `market.fdvUsd` are absent when the market is not live, and **`market.valuationWithheld`** carries
  the reason code instead.
- **The daily series withholds too.** On `/market` `days[]`, a market that is not live today sends
  no `marketCapCloseUsd`; **`marketCapCloseWithheld`** names the reason on each day that held one.
  A market whose figures HEY does not believe (`readings_implausible`) sends no daily liquidity
  either (**`liquidityCloseWithheld`**). **`liquidityCloseKind`** (`market` or `launch_inventory`)
  says what a day's liquidity is.
- **`has=marketCap`, `minMarketCap`, `maxMarketCap` and `catalogue.marketCoverage.marketCap`**
  count only the valuations the card prints (live markets): every item they return carries
  `marketCap`.
- **Liquidity HEY's own chain index finds unsellable is not believed.** A barely traded reading
  whose pools, per HEY's index, can absorb at most a hundred-thousandth of the claimed liquidity for
  a one per cent price move is `readings_implausible` (its liquidity and valuation withheld, as
  above). blorb claimed $13.8M with $6.20 of one-per-cent depth.
- **`/api/projects/{slug}/market-moves`** sends **`withheldDays`** and **`withheldReason`** when the
  market is not live: the days of index HEY holds and does not publish. `daysRead: 0` alone read as
  "no data".

## `GET /api/projects/{slug}`

One project in full: everything in the listing, plus the long description, every registered
source with how it was established, the market reading with its provider, and the momentum
figures with the scoring version that produced them.

A project HEY has not measured carries **no `score` key at all** — a zero would read as
"measured, nothing found", which is a different answer from "not measured".

`score.discoveryGap` is `null`, and `stillBuilding` / `underTheRadar` are `false`, for a project
outside the market cohort (scoring version `hbm-v15`, 2026-09-25): its token's market is not
live, or nothing the project publishes ties the token to it (token not verified and every site
and repository source context-only — a bridged copy of another chain's asset, for instance).
The rule is on `/methodology`.

A slug that is not published answers `404` with `{ "error": "not_found" }`. It looks
identical to a slug that never existed, which is what the pages do too.

### Why a Discovery Gap is absent: `score.discoveryGapWithheld` (2026-09-30, additive)

Since scoring version `hbm-v18` a Discovery Gap is measured only on an **active market**. A
project whose token's market status is `LOW_LIQUIDITY`, `TRADING_INACTIVE` or
`INSUFFICIENT_DATA`, or whose only market is its launch curve, has no `score.discoveryGap` and
is never Under the Radar. A thin market's attention percentile sits near the floor, so its gap
would measure the thinness, not the building. The project stays in the population the others
are compared against, so no other project's gap moves.

**A launch pool is not a measured market (`hbm-v22`, 2026-10-02).** A token whose market is
`ACTIVE_MARKET` only as `launch_pool_trading` — its "liquidity" is its own supply sitting in the
pool that launched it, at its last price — gets no Discovery Gap, no Under the Radar and no Still
Building, exactly as a launch curve does. It is withheld as `market_too_thin`, and every HEY
surface labels it "Launch pool only".

When the gap is absent, `score.discoveryGapWithheld` says why. The same field is on the
snapshot as `build.discoveryGapWithheld`, and the reason is never a zero:

| Value | Meaning |
|---|---|
| `market_too_thin` | Not measured — market too thin: the market is live but not active, only a launch curve, or active only as a launch pool ("Launch pool only", `hbm-v22`). |
| `market_not_live` | Not measured — no live market (no liquidity, removed, abandoned, an untraded launch pool). |
| `token_not_the_projects` | Not measured — nothing the project publishes ties it to the token. |
| `active_pool_not_read` | Not measured — the market is active only because another pool of the same token holds the liquidity, and HEY holds no current reading of that pool (`hbm-v21`). |
| `no_token` | Not measured — the project has no tracked token. |
| `no_market_reading` | Not measured — HEY holds no current market reading to place it. |
| `no_build_momentum` | Not measured — HEY has recorded no building to compare. |

**A rescued market (`hbm-v21`, 2026-10-01).** A token whose market is active only because
another pool of the same token holds the liquidity (market status reason
`liquidity_in_another_pool`) is measured on the reading of that pool — its valuation, liquidity
and volume — never on the thin pool the token's own reading describes. With no current reading of
that pool the gap is absent with `active_pool_not_read`. The card and the detail's `market` still
show the token's current reading; only what the scorer measures changes.

The list may grow; read an unknown value as "not measured". The field is absent beside a gap, and on a score written before `hbm-v18` (that absence is
unknown, not "measured"). SDK: `HeyDiscoveryGapWithheld`. OpenAPI:
`#/components/schemas/DiscoveryGapWithheld`. `explain?fact=discovery_gap` gives the same reason
as `NOT_MEASURED`.

### Why Still Building was not measured: `score.stillBuildingWithheld` (2026-09-30, additive)

Since scoring version `hbm-v19` Still Building's drawdown is measured on the same markets as the
Discovery Gap: an **active market** that is more than a launch curve — and, since `hbm-v22`, more
than a launch pool. On a `LOW_LIQUIDITY`, `TRADING_INACTIVE` or `INSUFFICIENT_DATA` market, a
launch curve or a launch pool, a "decline" measures the thin market, not a market that fell while the team kept building, so the badge is not measured.

`score.stillBuilding` keeps its meaning — `false` whenever the badge is not held — and
`score.stillBuildingWithheld` beside it says the `false` is "not measured", never "not met". The
same field is on the snapshot as `build.stillBuildingWithheld`:

| Value | Meaning |
|---|---|
| `market_too_thin` | Not measured — market too thin: the market is live but not active, only a launch curve, or active only as a launch pool ("Launch pool only", `hbm-v22`). |
| `market_not_live` | Not measured — no live market (no liquidity, removed, abandoned, an untraded launch pool). |
| `token_not_the_projects` | Not measured — nothing the project publishes ties it to the token. |
| `valuation_not_plausible` | Not measured — the valuation gate withheld the current valuation (`hbm-v20`). |
| `no_token` | Not measured — the project has no tracked token (`hbm-v21`). |
| `active_pool_not_read` | Not measured — the market is active only in another pool of the token, and HEY holds no current reading of it (`hbm-v21`). |
| `no_market_reading` | Not measured — HEY holds no market reading from the last day (`hbm-v21`). |
| `activity_unknown` | Not measured — HEY holds no builder source it can read, so whether the project kept building is not known (`hbm-v21`). |
| `not_scored` | Not measured — HEY has no score for the project under the current scoring version yet (`hbm-v21`; sent by the reader, never stored). |

The list may grow; read an unknown value as "not measured". The field is absent when the badge
was measured (held or not met). SDK: `HeyStillBuildingWithheld`. OpenAPI: `#/components/schemas/StillBuildingWithheld`.
`explain?fact=still_building` gives the same reason as `NOT_MEASURED` with a `null` value.

### Still Building as three states: `stillBuildingState` (2026-09-30, additive)

Wherever `stillBuilding` appears — every project card (`/api/projects`, the detail route),
`score.stillBuildingState` on the detail route and `build.stillBuildingState` on the snapshot —
`stillBuildingState` sits beside it:

| Value | Meaning |
|---|---|
| `HELD` | The badge is held (`stillBuilding: true`). |
| `NOT_HELD` | HEY measured it, and the badge is not held. |
| `NOT_MEASURED` | HEY did not measure it: no score under the current scoring version yet, or the scorer withheld it (`stillBuildingWithheld` says why). |

`stillBuilding` keeps its v1 meaning; a nullable `stillBuilding` is deferred to a future `/api/v2`.

**Corrected 2026-10-01 (`hbm-v21`, a bug fix).** For its first day the field read `NOT_HELD` for
about 2,800 published projects HEY had never measured: no tracked token, or building HEY cannot
read. They read `NOT_MEASURED` now, with `stillBuildingWithheld` `no_token` or
`activity_unknown`, as the state always meant. A score written under a superseded scoring
version — for about an hour after each version change, until the rescore reaches it — reads
`NOT_MEASURED` with `not_scored`: the badge it held has been withdrawn, and its `false` is not a
finding. `NOT_HELD` still means measured and not met.
SDK: `HeyStillBuildingState`. OpenAPI: `#/components/schemas/StillBuildingState`.
`explain?fact=still_building` lists it among its inputs.

### A repository's releases on one day count once (`hbm-v23`, 2026-10-03)

A repository's full GitHub releases published on one UTC day count as **one** release day in
activity status, Build Momentum, the shipping streak, velocity and cadence, and in every count of
building — the newest corroborated release stands for the day. Twenty-seven releases cut seconds
apart are one day of shipping, not twenty-seven. What did not change: prereleases keep their
weekly collapse, two repositories on one day still count as two, a release whose repository HEY
does not know is never folded, and no ship is deleted or retracted — every release stays on the
record with its provenance. Only the count changes. No field changed
shape; `scoringVersion` reads `hbm-v23` on a score written under this rule.

### A project's contract deployments in one second count once (`hbm-v24`, 2026-10-03)

A founder ruling. A project's follow-up contract deployments (`CONTRACT_DEPLOY_FOLLOWUP`) recorded
in the same UTC second count as **one** deployment in activity status, Build Momentum, the shipping
streak, velocity and cadence, and in every count of building — `meaningfulShips30d` and the
weekly counts included; the newest corroborated deploy stands for the second, and is the one
`latest_deployment` names. Four contracts a deployment script creates at once are one piece of work, not four. What
did not change: deploys a second apart count apart, a contract upgrade is never part of a batch,
and no ship is deleted or retracted — every deploy stays on the record with its creating
transaction, and `GET /api/ships` and the change ledger still list each one. No field changed
shape; `scoringVersion` reads `hbm-v24` on a score written under this rule.

### Resumed only on a gap HEY watched (`hbm-v25`, 2026-10-07)

A delegated ruling. `RESUMED` keeps its meaning — shipping again after 60 or more days without
observed activity — and is now claimed only where HEY was observing: every ship of the comeback
must come from a source HEY was already reading when the gap began (the earliest attachment of the
sources its evidence names, at or before the last update before the gap). A repository HEY began
reading during the gap, or a ship whose source HEY cannot name, is not a comeback: the project reads
`SHIPPING` or `ACTIVE` by the ordinary rule, so `GET /api/chain/comebacks` and `build.resumed` carry
fewer projects. `explain?fact=activity.status` lists the reason among its inputs as
`resumedWithheld` (`coverage_began_during_gap`, `coverage_unknown`) and its rule text says the gap
must be one HEY watched. No field changed shape; `scoringVersion` reads `hbm-v25` on a score written
under this rule.

### `$HEY`, HEY's own token: `heysOwnToken` (2026-09-30, additive)

HEY Research Lab issues `$HEY`, and HEY researches it by the same rules as every project: no
ranking bonus and no demotion. Its card carries `heysOwnToken: true` — on `/api/projects`, the
detail route, the snapshot's `identity`, `/api/builders` and `/api/this-week` — and every other
project leaves the field out (never `false`). Print "HEY’s own token — researched by the same
rules" beside it, as HEY's own cards do. The flag follows the one `$HEY` contract HEY's machine
identity names (`GET /api/hey/profile`); before launch no card carries it. It is set after a page is ordered and is never a filter, a sort or a count. OpenAPI:
`#/components/schemas/HeysOwnToken`.

### Which lockers `pairLocked` reads: `tokenLock.pairLockScope` (2026-09-30, additive)

`tokenLock.pairLocked` keeps its v1 meaning: HEY found a pair holding this token locked. HEY
reads one locker, HoodLock, so a `false` is a reading of HoodLock, not of every locker.
`tokenLock.pairLockScope` says so on every `tokenLock`: on the listing, the dossier and the
snapshot's `locks`. Today it is always `"hoodlock_only"`. If HEY reads another locker, that will
be a new value here, never a new meaning of `pairLocked`. `tokenLock` itself is still absent
when HEY found no lock. SDK: `HeyPairLockScope`. OpenAPI: `#/components/schemas/TokenLock`.

### When HEY first recorded it, and the outside date (2026-09-26)

- **`firstRecordedByHeyAt`** — when HEY first recorded the project: its row, or an earlier
  candidate record of its token. HEY's knowledge time, never an outside date.
- **`externalListedAt`** and **`externalListedSource`** — the date an outside registry or launchpad
  gives the project (`defillama`, `virtuals`, `pair_fund`, …). Absent when HEY holds none.
- **`firstSeenAt` is a deprecated alias.** On registry and launchpad pages it held the outside
  date, so uniswap-v3 read as "first seen by HEY" in 2022. It is kept unchanged so no caller breaks;
  read the two fields above instead. `sort=newest` now orders by `firstRecordedByHeyAt`.
- **`ships[]` items (and `/api/ships`) carry `precision`** — `EXACT`, `DATE` (a date-only
  publication), `WEEK` (a week of code activity) or `OBSERVED` (HEY's own scan clock) — and
  **`evidenceId`** (`ship:<uuid>`), which resolves at `GET /api/evidence/{id}`.
- **`/intelligence` no longer sends a measured-looking zero for a project HEY did not measure.**
  `development.activityMeasured` is false without a readable builder source or on an UNKNOWN
  status; `changes.buildMomentum.current` is then `null`, and a zero velocity, streak or comeback
  count is `null` (velocity `state: NOT_MEASURED`). A positive count is a record and stays.

### What a week of commits changed: `codeSubstance` (2026-09-27)

A week of code activity (`eventType: "CODE_ACTIVITY"`) carries `codeSubstance` on `ships[]`,
`/api/ships` and `/api/projects/{slug}/timeline` entries, once HEY has evaluated the week. It is
absent on every other ship and on a week never evaluated — never a zero. Additive; no field
changed meaning.

```json
"codeSubstance": {
  "verdict": "SUBSTANTIVE",
  "classifierVersion": "commit-substance-v1",
  "countsAsBuilding": true,
  "commitsListed": 14, "commitsRead": 3, "changedCode": 1,
  "documentationOrMaintenance": 2, "substanceUnknown": 0, "notRead": 11,
  "files": { "source": 2, "test": 1, "docs": 0, "readme": 2, "dependency": 0, "config": 0, "ci": 0,
             "generated": 0, "asset": 0, "whitespace": 0, "rename": 0, "data": 0, "unknown": 0 },
  "weekFullyListed": true,
  "summary": "3 commits read: 1 changed code, 2 documentation or maintenance only. 11 other commits were not needed to decide the week."
}
```

- The counts are **FACT**s about the human, non-merge commits HEY listed and read (`files` counts
  changed files by class over the commits read). `verdict` is **DERIVED** by `classifierVersion`.
- `SUBSTANTIVE`: at least one commit changed source code, tests, configuration or CI beyond
  whitespace. `LOW_INFORMATION`: HEY listed and read every commit of the week and each only changed
  documentation or the README, dependency lockfiles, generated files, assets, data files (JSON, CSV
  and the like outside configuration, since `commit-substance-v2` / `hbm-v17`), whitespace or pure
  renames — shown as "documentation or maintenance only", `countsAsBuilding: false`, and left out
  of activity status, Build Momentum, Still Building, Under the Radar and every count of ships
  (scoring version `hbm-v16`, founder ruling G1). `UNKNOWN`: not read in full yet; it counts
  exactly as before — the absence of HEY's reading never demotes a project.
- A `LOW_INFORMATION` week is not listed by `/api/ships` or a project's `ships[]` (they list
  building); the project's `/timeline` keeps it, with `countsAsBuilding: false`.
- `/api/changes` restates it on `build.code_activity` as flat facts: `codeSubstance`,
  `codeSubstanceVersion`, `commitsListed`, `commitsRead`, `commitsChangedCode`,
  `commitsDocumentationOrMaintenance`, `commitsSubstanceUnknown`, `commitsNotRead`.
- HEY does not store or return commit messages, authors or patches. Merge commits (more than one
  parent) and automated commits are not counted; a merged pull request alone is not a ship.

### What the dossier adds (2026-09-17)

- `ships` — the project's newest five ships, each as `GET /api/ships?project=` would list it. A bare
  contract deployment is a launch, not a ship, and appears on none of the ship surfaces; the project
  page's own timeline still shows it.
- `stillBuildingEvidence` — present whenever `stillBuilding` is true, on the dossier as on the listing.

### Everything the listing sends (2026-09-25)

The dossier used to send less than the listing for the same project: `officialX`, `marketCap`
(with `source`, `observedAt` and `kind`), `liquidity`, `volume24h`, `trades24h`,
`priceChange24hPct`, `venue`, `launchStage` and the listing's `tokenMarket` were missing, because
the profile keeps its reading in `market` and its token state apart. They are now filled from the
same reading, in the listing's shapes and under the same rules — a dead market's valuation is
withheld here too — and `market` is unchanged beside them.

### Mirroring the ship feed (2026-09-17)

`since` filters on `publishedAt` — the date the *project* shipped — because it names the window
you are reporting on. That is the wrong axis to mirror along. HEY polls sources on tiers, so a
release published on Monday is routinely recorded on Tuesday, and a consumer keeping the newest
`publishedAt` it has seen never sees anything ingested after that watermark moved past it. Not
late: never.

Every ship now carries **`detectedAt`** — when HEY observed it — and the feed accepts
**`?detectedSince=<ISO>`** and **`?sort=detected`**. Page along those:

```bash
curl "https://heyresearch.xyz/api/ships?sort=detected&detectedSince=2026-09-16T00:00:00Z&limit=48"
```

Keep the highest `detectedAt` you have seen and pass it back next time. `since` is unchanged and
still means what it meant.

**What a `detectedAt` watermark still misses (2026-09-26).** Paging this way catches everything
HEY records late, but three known paths still lose a ship. **To mirror, use
[`/api/changes`](#get-apichanges--the-change-ledger-2026-09-26)**, which closes all three; this
feed stays for browsing and reporting, and its parameters keep their meaning:

- **Late publication.** A ship recorded before its project was published appears in the feed
  when the project is published, carrying its original `detectedAt`. A watermark already past
  that instant never sees it.
- **`context_only` cleared later.** A ship first recorded as context, and later counted, joins
  the feed with its original `detectedAt`, behind the watermark in the same way.
- **Retractions.** A ship later retracted, disputed or removed in moderation simply leaves the
  feed. There is no tombstone, so a mirror keeps it.

`/api/changes?after=` is the one supported sync contract; a second contract for the same fact
would be two rules for one thing, so the ships feed gains no `updatedSince`.


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
    "tokenVerification": { "status": "VERIFIED" },
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
When the address is a token an issuer minted — a Robinhood stock token from Robinhood's factory,
such as NVDA — the unknown answer also carries `issuer` (`issuerName`, `kind`, `symbol` and the
one `sentence` every surface prints) (additive, 2026-10-02): it is never any project's token, so
an agent should not read it as "a project HEY has not found".

**Published records only.** An address HEY holds but has not reviewed answers `unknown`, the same
as one it has never seen. An unreviewed launch record is not a project to this API.

**The words travel with the enum.** `activityLabel` and `activityHelp` come from the table the
site itself renders from, so an integration does not have to invent a translation. Left to
themselves, integrators turn `DORMANT` into "dead" — which is the one thing HEY's activity model
refuses to say. Use the strings you are given.

**`shipsLast30Days` counts what the project's own page counts**, over the window the field names.
A number that contradicts the page it links to is worse than no number.

**`tokenVerification` says whose contract this is (2026-09-25).** The activity is the project's;
the verification is this address's. `MISMATCH` means the project's own site names a different
contract — print the activity as the project's, never as this token's. `activityAppliesToToken`
(2026-09-27, additive) is that rule as a boolean: `false` exactly on `MISMATCH`, `true` otherwise.

**There is no risk field, no score and no verdict**, here or anywhere. HEY answers whether anyone
is building; it says nothing about what a token might do next. An integration that wants a risk
reading should put one from a tool that does that work beside this line — HEY is built to sit
beside those tools rather than replace them.

`chainId` is in the path because identity here is `(chainId, contractAddress)` and never the
address alone. An address from another chain answers `400` rather than being resolved against
this one. So does a malformed address, and so do the burn and zero addresses — well-formed, and
nobody's project. (`/api/v1/scan` answers the zero address `200` with `reason: "not_a_token"` since
2026-09-27; this route keeps its 400.)

This route is a database read and makes no provider call, which is why it sits on the ordinary
120-a-minute allowance. **`POST /api/scan` is not the endpoint for an integration**: it reads the
chain, the explorer and whatever a token declares about itself, so it allows ten requests an
hour, is never cached, and spends a budget the scheduled pipeline needs.

## `GET /api/v1/scan?chain={chainId}&token={address}` (2026-09-18)

The by-contract lookup above in the shape a trading bot's card wants: `found`, `status` (HEY's six
states, lower-cased) with `status_label` and `status_help` in HEY's own words, `verified_builder`,
`activity` (`commits_30d` — absent when no repository is read, and a floor when `commits_30d_partial: true` says a commits page was cut inside the window; `releases_30d`, `ships_30d`,
`last_ship`), `token_verification` (`VERIFIED`, `UNVERIFIED` or `MISMATCH`, 2026-09-25: on
`MISMATCH` the project's own site names another contract, so do not print the activity as this
token's), `activity_applies_to_token` (2026-09-27: `false` exactly on `MISMATCH`), `project_url`,
`logo_url`, `badge_url`, a `cta` that points at the project page (absent when
`activity_applies_to_token` is `false`: nothing invites a reader from a disowned token to the
project), and the disclaimer. `found: false` is a 200 for an unpublished token, for a chain HEY does
not index (`reason: "chain"`) and, since 2026-09-27, for the zero address (`reason: "not_a_token"`,
not metered); a malformed `token`, and the burn address, are a 400. `chain` defaults to 4663. Same limits and cache as
`/api/token`; a database read only. Documented for bots in [Putting HEY in your bot](/developers/integrations).

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

**The shape is held** (2026-09-26): the route answers through a named serialiser that the SDK's
`HeyBuilderCard` and `builderCard(chain, token)` are held to by a contract test, and its key set is
frozen by an end-to-end test. Nothing about the answer changed.

## Partner additive fields (2026-09-26)

Additive only. No existing field changes meaning: `ships_30d`, `releases_30d`, `commits_30d` and
`shipsLast30Days` keep theirs, zeros included. The new fields say whether those zeros are
measurements.

| Route | Added | Meaning |
|---|---|---|
| `/api/v1/scan` | `research_level` | `INDEXED`, `RESEARCHED` or `VERIFIED_BUILDER` |
| | `activity_measured` | `false` when HEY holds no repository, changelog or feed it can read, or the status is unknown: then `ships_30d: 0` is not a finding |
| | `coverage` | `measured`, `no_source` or `not_researched`: why `activity_measured` is what it is |
| | `as_of` | when the project was last scored; absent when never |
| | `activity.meaningful_ships_30d` | ships by the rule behind the status: corroborated, and a week of prereleases or code-activity summaries counts once. Absent when unmeasured and none |
| | `activity.last_ship_url` | the last ship's public source |
| `/api/token/{chainId}/{address}` | `project.activityMeasured`, `project.meaningfulShipsLast30Days`, `project.asOf` | as above |
| `/api/v1/builder` | `research_level`, `activity_measured`, `as_of` | as above |
| | `last_code_activity.commits_30d`, `commits_30d_partial`, `window_start` | commits in the thirty days before `as_of`, by the same count as the card's `commits_30d`; absent when unknown. `commits` stays the newest weekly summary's own figure |

**The zero address on `/api/v1/scan`** answers `200 {"found": false, "reason": "not_a_token"}`
since 2026-09-27 (it was a `400`; Chit sends it for the native coin), and spends nothing: no monthly
allowance, no rate bucket, no demand record. In the bulk form each zero-address item is that same
answer, not charged; a batch of nothing else is still keyed and costs nothing. The burn address and
every malformed token keep their `400`, which also spends nothing.

## Partner additive fields (2026-09-27)

| Route | Added | Meaning |
|---|---|---|
| `/api/v1/scan` | `activity_applies_to_token` | `false` exactly when `token_verification` is `MISMATCH`; the card then carries no `cta`. Every other field keeps its value |
| | `reason: "not_a_token"` | on `found: false`, for the zero address |
| `/api/token/{chainId}/{address}` | `project.activityAppliesToToken` | as above; `project.url` is still sent |
| `/api/v1/builder` | `activity_applies_to_token` | as above; `hey_project_url` is still sent — do not link from the token to it when `false` |

## The Partner Card: additive fields (2026-09-30)

`/api/v1/builder` is the Partner Card (`/developers/partners`, `PartnerBuilderCard`
in `/openapi.json`). Additive only; no existing field changes meaning. Explicit `null` is unknown.

| Route | Added | Meaning |
|---|---|---|
| `/api/v1/builder` | `verified_builder` | the catalogue marks the project a verified builder (the scan card's `verified_builder`) |
| | `latest_meaningful_ship` | `{title, url, timestamp, kind, evidence_id, evidence_link}`: the newest counted ship dated no later than now; `evidence_link` (2026-10-05) is its reader receipt page with the card's attribution labels; `null` when none |
| | `meaningful_ships_30d` | the scan card's `meaningful_ships_30d`; `null` (never 0) when building is not measured and none is held |
| | `latest_change`, `latest_change_state` | the newest builder-story ledger event (`{id, type, summary, occurred_at, precision, detected_at, evidence_id, url}`); state `recorded`, `none_recorded` or `unavailable` (ledger not run or unreadable: unknown, not none). Market, usage, coverage-churn and narrative events are left out |
| | `latest_signal` | `{id, kind, label, headline, observed_at, evidence_id, url}`: the newest standing signal that is not a market-group kind, an address-day count or a new page; `null` when none |
| | `market_status` | `{status, observed_at}`: this token's market state, context only; `INSUFFICIENT_DATA` / `null` when not measured |
| | `badge_url` | `/badge/<slug>.svg` |
| | `project_link` | `hey_project_url` with `utm_source=<integration or hey_api>&utm_medium=partner_api&utm_campaign=builder_card` |
| `/api/v1/scan` | `project_link` | the same, `utm_campaign=scan_card` |

**Integration label (optional).** `x-hey-integration: name/version` or `?integration=name/version`
on any API call: lower-case letters, digits, `.`, `_`, `-`; anything else is ignored. Recorded as a
self-declaration (`api_requests.integration`) and used as `project_link`'s `utm_source`. An answer
shaped by the header is `private` with `vary: x-hey-integration`; the query form caches normally.
The header is allowed in CORS preflight.

## Project snapshot, coverage, explain and evidence (2026-09-26)

Four reads for an agent or a bot that needs one answer rather than four requests. Public, the
same 60-second cache and allowance as the rest of this API, HEY's own tables only: none calls a
provider. A slug that is not published answers `404`; a renamed one `308`s to its new path.

### `GET /api/projects/{slug}/snapshot`

The important state of one project in one read: `identity` (with `firstRecordedByHeyAt`),
`build` (activity status, `activityMeasured`, Build Momentum only where measured, Still Building
with its evidence, Discovery Gap, velocity, cadence), `market` (the card's own fields and gates,
with `valuationWithheld` for a market that is not live; absent without a token), `onchain`,
`contracts` (a link), `verification` (token verification, owner verified, source counts), `locks`
(`tokenLock` and its coverage, HoodLock only), `integrity` (`WITHHELD` while Market Integrity is
unpublished, `MEASURED` with its route once HEY publishes it), `latestChanges`, `freshness`, `coverage`, `evidenceSummary`, `links` to every detailed
endpoint, `asOf` and `scoringVersion`.

`latestChanges` is `{ available: true, items }` from the change ledger, or `{ available: false,
reason }` when the ledger cannot answer: never an empty list standing in for "unknown".

`summary` (2026-09-28, additive): the **Project Research Summary**, the answer the Terminal, the
project page and the MCP print first — `{ version: "summary-v1", lines[], computedAt }`, one line per
dimension that applies, in this order: `build`, `usage`, `market`, `contract`, `fundamentals`,
`security`, `latestChange`, `unknown`. Each line is `{ dimension, label, tag, text, evidence[],
detailUrl, observedAt?, freshness, reason? }`:

- `tag` — `FACT` (a record HEY holds), `DERIVED` (HEY's reading of records, such as an activity
  status or a withheld valuation) or `UNKNOWN` (HEY does not know; `reason` says why, e.g.
  `no_builder_source`, `indexed_only`, `no_day_read`, `coverage_unread`). An UNKNOWN line never
  carries a zero.
- `evidence[]` — `{ id, label, url?, receiptUrl }`: typed public ids (`ship:`, `abi:`, `impl:`, …)
  from the change ledger, each with its `GET /api/evidence/{id}` receipt; `url` is the record's own
  public source.
- `freshness` — `fresh`, `stale` (the reading is older than its limit: a market reading over 24 h,
  a usage rollup the `usage` section calls `STALE`, a registry day over 3 days), `unknown` or
  `not_applicable`.
- `detailUrl` — where the figures behind the line are on this API.

A dimension that does not apply has no line (no `fundamentals` without a matched protocol, no
`contract` for a tokenless project with no watched contract; `security` only when an OSV reading or a
registry audit link is stored). The market line names the valuation kind — an FDV is never called a
market cap — and says when a valuation is withheld; security is context, never a verdict. The
`usage` line restates this snapshot's own `usage` section (since 2026-09-28, the same object): its
figures, its state and its reason — `MEASURED`, `PARTIAL` and `STALE` with a figure are `FACT`
(a partial window says how many of its days HEY holds, the rest unknown, not zero), `NOT_WATCHED`
and `NOT_READ` are `UNKNOWN` with the usage reason (`contract_not_in_method_watch`,
`not_rolled_up_yet`, …), `NOT_APPLICABLE` says no contract is recorded; its evidence is the usage
object's `method:` facts and its `detailUrl` is `GET /api/projects/{slug}/usage`. It never speaks of
users, and distinct caller addresses (a per-day count) stay off the line. The lines restate the
sections below them; nothing in `summary` is computed a second way.

Two context blocks, added 2026-09-27 (additive; both absent when HEY holds nothing to say):

- `protocolEconomics` — for a project matched to a DefiLlama protocol: `protocols[]` (at most
  five, largest TVL first), each `{ protocol, protocolName, category?, tvlUsd, tvlDay, matchedBy,
  fees24h, revenue24h, dexVolume24h, economicsDay?, auditLinks[], methodologyUrl?, parentProtocol? }`,
  plus `source: "defillama"` and `contextOnly: true`. Each metric is `{ state: "MEASURED", valueUsd }`
  (a measured zero is `0`) or `{ state }` with `NOT_TRACKED` (DefiLlama publishes no figure for it on
  this chain), `SOURCE_UNAVAILABLE` (HEY's read of that overview failed that day) or `NOT_ENOUGH_YET`
  (not read yet) — never a zero standing in for any of them. Audit links and the methodology link
  are the registry's, verbatim: links, never verdicts.
- `market.promotion` — for a token HEY has seen promoted or taken over on DEX Screener:
  `{ entries[], total, contextOnly: true }`, the newest ten, each `{ kind, channel, providerAt?,
  firstObservedAt, lastObservedAt, source }`. `kind` is `MARKET_PROMOTION_OBSERVED` or
  `COMMUNITY_TAKEOVER_PROFILE_OBSERVED`; `providerAt` is the provider's own date and absent when it
  gave none (then only `firstObservedAt`, HEY's observation, dates it). No amount, spend or reach is
  ever sent.

Neither block is an input to activity status, Build Momentum, the Discovery Gap, the Radar or any
ordering, neither is a change event (they never appear in `latestChanges`, `/api/changes` or a
webhook), and neither names a wallet.

`developerFootprint` (2026-09-27; absent only when HEY could not read the project's coverage): the
developer footprint in four lines, each carrying the state and reason code of its coverage
dimension, and a count only where that state says it was measured:

- `repositories` — `{ state, reason, asOf?, official, metadataRead }` (`gitHost`): the official
  repositories HEY holds and how many it has read the declared metadata of.
- `productionDeployment` — `{ state: "MEASURED", at, environment, readAt? }` for the newest
  deployment an official repository records to an environment GitHub names production;
  `{ state: "NONE_FOUND", readAt? }` when GitHub answered and records none (other hosts are not
  read); `NOT_READ`, `ERROR` or `NOT_APPLICABLE` (no official repository). A dated record of an
  environment, never activity: never who deployed, never a commit here.
- `packages` — `{ state, reason, asOf?, accepted?, claimed? }` (`package`): packages an official
  source, attestation or module path ties to the project (`accepted`) and packages that rest only
  on what their publisher typed — naming an official repository, or a homepage on the official
  site (`claimed`, since 2026-09-27). No counts while the package index has not been asked. A
  package publication is never a ship.
- `advisories` — `{ state, reason, asOf?, current?, subject: "PUBLISHED_PACKAGE" }`
  (`securityContext`): current OSV advisories about accepted packages' published versions; `current`
  only once OSV was read. An advisory is about a published version, never a verdict on the project.

Plus `contextOnly: true` and `coverageUrl`. Package names, advisory ids and deployment commits are
not on the snapshot. Nothing here is a ship, a change event or an input to activity status, Build
Momentum, the Discovery Gap, the Radar or any ordering.

`usage` (2026-09-28, additive; absent only when the read failed) — product usage over seven days, as
`GET /api/projects/{slug}/usage` summarises it below, and `links.usage` to that route.

`security` (2026-09-28, additive; absent only when the read failed) — **security context: evidence,
never a verdict**. An audit shows an audit took place; it is not a
guarantee of safety. There is no score and no "safe". Each section carries a state — `MEASURED`,
`NONE_FOUND` (a reading of the indexes in `readFrom` only), `NOT_READ` or `NOT_APPLICABLE` with a
`reason` — and items only where something was found:

- `audits` — `{ state, readFrom, items: [{ id, url, authority, hostedOn, auditor, date: null, isPdf,
  foundBy: [{ foundVia, foundOnUrl, firstObservedAt, lastObservedAt }], observedAt }] }`. `authority`
  is `AUDITOR_PUBLISHED` (on an auditor's own host or report repository), `PROJECT_CLAIMED` (linked
  from the official site, not on an auditor's host) or `REGISTRY_LISTED` (DefiLlama's listing only;
  a multichain protocol's audits cover its core contracts, not necessarily this deployment).
  `auditor.basis` is `AUDITOR_HOST` or `URL_PATH` (a file name that names a firm). `date` is always
  null: HEY never reads a report. `readFrom` ⊆ `official_site`, `official_site_files`, `defillama`.
- `bugBounty` — the same shape; items `{ id, url, authority: PLATFORM_LISTED | PROJECT_CLAIMED,
  platform, foundBy, observedAt }`. DefiLlama is not a bounty index.
- `securityTxt` — `MEASURED` with `{ id, url, contacts (null until parsed), policyUrls, expiresAt,
  expired, firstObservedAt, readAt }`; `NONE_FOUND` with `reason: absent | not_a_security_txt`; or a
  reason why it was not read.
- `advisories` — OSV about the published versions of accepted packages: `MEASURED` with items
  (`advisoryId`, `aliases`, `packageName`, `version`, `fixedVersions`, `url` on osv.dev,
  `subject: PUBLISHED_PACKAGE`), or `NONE_FOUND` with `packagesRead` — a reading of OSV, not a
  statement about the code.
- `repositoryChecks` — deps.dev's OpenSSF Scorecard, check by check (`score` or null), per official
  repository; never summed.
- `incidents` — always `{ state: "NOT_READ", reason: "no_incident_source_read" }`.
- `linksOmitted` — links HEY holds but does not publish (not https, or failing the URL-safety
  checks); `meaning` — the audit sentence; `contextOnly: true`.

`coverage.securityContext` keeps its 2026-09-27 meaning (advisories and Scorecards); the new block
does not change it.

### `GET /api/projects/{slug}/usage?window=1|7|30` (2026-09-28)

Is what the project shipped being used? HEY's own daily rollup (`project_usage_days`) of the
calls-per-method read and the decoded usage read; no provider in the request path. `window` is 1, 7
(default) or 30 complete UTC days ending on the newest rolled-up day; anything else is a
`400 invalid_parameter`.

- `usage` — `{ dimension: "usage", state, reason, source: "decoded_calls", window?, collectedFrom?,
  collectedThrough?, observedAt?, watchedContracts, daysCovered?, activeContracts?, calls?,
  erc20Calls?, otherCalls?, functionsCalled?, callerAddresses?, events?, eventsReason?, basis?,
  topMethods[], names: "WITHHELD", methodEvents: { firstObserved, resumed, ids[] }, contextOnly: true,
  url }`.
  - `state`: `MEASURED`, `PARTIAL` (only some days of the window are held — `reason`
    `collection_started_in_window` or `days_missing_in_window`; figures cover `daysCovered`),
    `STALE`, `NOT_WATCHED` (a contract, none in HEY's method watch), `NOT_APPLICABLE` (no contract),
    `NOT_READ` (`rollup_not_run`, `no_day_in_window`). The figures are **absent** unless a day is
    covered — never a zero standing in for unknown. A covered quiet day is a measured `0`.
  - `callerAddresses` — `{ latestDay, peakDay, window: null, windowReason:
    "distinct_across_days_not_measured", daysWithoutCount, unit: "addresses" }`. Each day figure is
    `{ day, count, basis }`: distinct transaction-sender addresses whose transactions called the
    watched contracts that UTC day, a count the provider computed; HEY stores no address. `basis`
    `EXACT`, or `FLOOR` when several contracts took calls (the largest count; the true figure is at
    least that). A window-wide distinct figure is never published: days cannot be added.
    **Addresses, not people.**
  - `events` — decoded events in the window, or `null` with `eventsReason` when any covered day's
    count is unreadable.
  - `topMethods[]` — `{ rank, contract, bucket, calls }`, the five most-called methods across the
    watched contracts; function names stay on the Terminal (founder decision F3).
  - `methodEvents.ids` — the change ledger's `method:` ids for functions called for the first time,
    or again after thirty or more silent days, in the window (`GET /api/evidence/{id}`).
- `series[]` — up to thirty rolled-up days ending on the window's last day, oldest first: `{ day,
  watchedContracts, activeContracts, calls, erc20Calls, functionsCalled, callerAddresses,
  callerBasis, events, basis }`. `basis` is `observed` (read within four days of the day) or
  `reconstructed_from_chain` (filled later by the archive read). Days before the project's
  collection start are absent, never zero.
- `markers[]` — `{ kind: "release" | "deployment" | "implementation_change", day, evidenceId, label,
  relation: "context_only_not_a_cause" }`, dated beside the series. HEY never says one caused a
  change in use.
- `methodology` — the five rules above in words; `computedAt`; `disclaimer`.

Usage is its own dimension: it never feeds activity status, Build Momentum, the Discovery Gap, the
Radar or any ordering. SDK: `client.projects.usage(slug, { window })` → `HeyProjectUsage`.

### `GET /api/projects/{slug}/around/{eventId}` (2026-10-01, additive)

What HEY measured in the seven days before one of the project's build events, on its own UTC day
(its ISO week for a `WEEK`-precision event — never an invented hour), and in the seven days after.
The same canonical read (`aroundEvent`, rules `around-event-v1`) as the Terminal chart's event
panel and the project page's "Around the latest ship"; HEY's own tables only.

- `eventId` — a typed evidence id: `ship:<uuid>`, `impl:…` or `method:<uuid>`. Another family is a
  `400 invalid_parameter`; an id the project does not hold, a withdrawn ship, a superseded method
  fact or an event dated to no day or week is a `404`.
- `event` — `{ id, kind, title, at, precision, window: "DAY" | "WEEK", anchor: "source_date" |
  "observed_by_hey", sourceUrl, evidenceUrl }`. `spans` — `{ before, around, after }`, each
  `{ from, to, days }`; `closedThrough` — the last closed UTC day (the day in progress is never
  compared).
- `fields[]` — `price` (close-to-close move, `pct_move`, with `around` for the event's own day or
  week), `volume` (mean per day of the days read), `liquidity` and `valuation` (at the span's last
  day read), `calls` (mean per covered day), `activeContracts` (most on one day) and
  `callerAddresses` (the busiest day's count — never added across days; addresses, not people).
  Each has `state` (`MEASURED`, `PARTIAL`, `NOT_MEASURED`, `STALE`, `WITHHELD`), `reason`,
  `before`/`after` sides `{ state, reason?, value, daysCovered, fromDay?, toDay? }`, `changePct`
  (a level's after against before; null otherwise), `source`, `basis` and `collectedFrom`. A value
  is `null` whenever nothing was measured, never a zero.
- Withheld, with the reason as the code: `token_not_the_projects`, `active_pool_not_read` (a
  rescued market is read on its active pool, F1), `market_too_thin` and `market_not_live` (no price
  move or valuation), `readings_implausible` (liquidity), `valuation_not_plausible`.
- `answer` — the sentence the pages print first, absent when nothing after the event is measured;
  `caveat`; `relation: "observed_around_the_same_time_not_a_cause"`; `contextOnly: true`.

Never an input to activity status, Build Momentum, the Discovery Gap, Still Building or the Radar.

### `snapshot.peerContext` (2026-09-28, additive)

Peer context, rules `peers-v1`: some of the project's published
figures placed among comparable projects — same type (primary narrative × meme/product), same
metric definition, same window, measured figures only. `state` is `COMPUTED`, `NO_COHORT` (with
`reason`: `no_primary_narrative`, `narrative_not_a_type`, `kind_not_classified`) or
`NOT_COMPUTED`. Each of `dimensions[]` stands alone: `metric`, `label`, `unit`, `windowDays`,
`definition`, `state`/`reason`, `value`, `cohortSize`, `median` and `range: {p10, p90}` (null below
8 measured members, `statsReason: "not_enough_comparable_projects"`), `percentile` (null below 20,
`percentileReason`), `comparison` (`above_median` | `at_median` | `below_median` — a position, not
a judgement) and `line`. `minimums`, `computedAt`, `methodology`, and (2026-09-28, additive)
`freshness`: `{state: "CURRENT" | "STALE", asOf, staleAfterHours: 36}` — `STALE` when the daily
run has not replaced the context in 36 hours — or null when nothing was computed. A
`build_momentum` value read under a scoring version other than today's is `NOT_MEASURED` with
`reason: "recomputing_after_scoring_change"` until the next run. There is no overall figure, and
peer context is never an input to anything. Absent only when the read failed. SDK:
`HeyPeerContext`.

### `GET /api/projects/{slug}/relationships` (2026-09-28)

What is connected to one published project, and why HEY thinks so: first-degree `nodes` (project, token, contract,
implementation, repository, package, domain, docs, launchpad, protocol registry, corroborating
page — never an account) and `edges`, each `{ type, filter, from, to, label, state, evidence:
[{id, url}], links: [{label, url}], observedAt }`. `state` is `verified`, `official`, `claimed`,
`context_only` or `observed`; `evidence` ids resolve on `/api/evidence/{id}`. `counts[]` gives
records read of records held per family and `truncated` whether any was capped; `notHeld[]` names
the families HEY does not hold (contract-to-contract interaction, audits) with the reason — never
implied, never "none". There is no partnership edge. HEY's own tables only. SDK:
`client.projects.relationships(slug)` → `HeyProjectRelationships`.

### `GET /api/projects/{slug}/coverage`

What HEY knows about a project, dimension by dimension, as states and never a score:
`identity`, `builderEvidence`, `repositories`, `releases`, `marketCurrent`, `marketHistory`,
`contractDeployment`, `contractActivity`, `contractSource`, `contractInterface`, `distribution`,
`locks`, `marketIntegrity`, `timeline`, `officialDocs`, `apiDocs`, `sourceChanges`, `protocolEconomics`, `gitHost`, `package`, `securityContext` (2026-09-27). Each is
`{ state, since?, asOf?, reason?, detailUrl? }`.

The three site dimensions (2026-09-27, additive) describe the project's own site:

- `officialDocs`: `MEASURED` (`official_docs`) when HEY holds the project's own docs;
  `NO_SOURCE` with `no_docs_link_found` when HEY read the site and found no docs link (a page
  rendered by script can hold docs HEY cannot see, so this is not a zero), `context_only_docs`,
  or `no_official_site`; `NOT_ENOUGH_YET` (`site_not_read_yet`); `SOURCE_UNAVAILABLE`
  (`website_unreachable`, `site_disallows_reading` when robots.txt disallows HEY);
  `NOT_APPLICABLE` for a meme.
- `apiDocs`: `MEASURED` (`api_description_read`) when the site links an OpenAPI description HEY
  read; `NO_SOURCE` (`no_api_description_linked`, `site_not_corroborated`, `no_official_site`);
  `NOT_ENOUGH_YET` (`site_files_not_read_yet`); `SOURCE_UNAVAILABLE`
  (`api_description_disallowed`, `api_description_unreadable`, `site_unreachable`,
  `site_disallows_reading`); `NOT_APPLICABLE` for a meme or a launch with no repository and no
  docs (`no_developer_surface`).
- `sourceChanges`: material changes in what the official site declares (a new or removed
  repository, docs or feed link, a new sitemap section, changed llms.txt links or security
  contact, OpenAPI operations added or removed). `MEASURED` with `since` = HEY's first read of
  the site's files, which is a baseline and never a change (`changes_since_first_read` or
  `no_change_since_first_read`); `NOT_ENOUGH_YET` (`no_baseline_yet`); `STALE` after three
  missed weekly reads; `NO_SOURCE` / `SOURCE_UNAVAILABLE` as above. A source change is never a
  ship and never counts toward activity.

The developer footprint dimensions (2026-09-27, additive): `gitHost` (what the official
repositories declare and their newest production deployment; `NOT_APPLICABLE` with no own
repository), `package` (published packages tied to the project; `MEASURED` with
`accepted_package_links`, `NOT_ENOUGH_YET` with `claimed_package_links_only` when packages only name
the repository, `MEASURED` with `none_found_in_package_index` after the lookup found none,
`NOT_APPLICABLE` for a token project with no repository and no package) and `securityContext` (OSV
advisories about an accepted package's published version, or deps.dev's Scorecard checks;
`NOT_APPLICABLE` without either; never a verdict or a score).

| State | Meaning |
|---|---|
| `MEASURED` | HEY read it; figures elsewhere are measurements, zeros included |
| `NO_SOURCE` | HEY holds nothing to read it from; a zero or an absence is not a finding |
| `NOT_ENOUGH_YET` | HEY has not read enough of it yet |
| `STALE` | read, and older than its freshness limit |
| `SOURCE_UNAVAILABLE` | the source HEY holds no longer answers |
| `NOT_APPLICABLE` | it does not apply (no token; for the developer footprint, no own repository, or a token project with no repository and no package) |
| `NOT_RESEARCHED` | HEY indexed the record and did not research it |
| `ERROR` | HEY's last read failed; earlier figures stand |
| `WITHHELD` | measured, and deliberately not published here (Market Integrity; an implausible market) |

`contractSource` says whose code a verified token is (2026-09-27): `source_verified_template_token`
(a launchpad template, a name verified on five or more projects, or an immutable clone),
`source_verified_explorer_matched` (the explorer matched the bytecode to source published for
another contract), `source_verified_project_authored` (source published for this address, on the
explorer or on Sourcify), `source_verified_authorship_unconfirmed` (verified; how is not read yet),
or `source_not_verified`. Every verified reason starts `source_verified`, and a template is never
counted as the project's own. The dimension reads every watched contract of the project, not the
token alone (review repair, 2026-09-27): when the token is not project-authored but a declared or
follow-up contract is, the reason is `source_verified_project_authored_other_contract` with a
`detailUrl` to `/api/projects/{slug}/contracts`, and a tokenless project with such a contract is
`MEASURED` rather than `NOT_APPLICABLE`. `contractInterface` says
`changes_since_first_read_template_interface` for a template's interface.

`locks` reads HoodLock only: `hoodlock_only_none_found` is a reading of HoodLock, not of every
locker. `protocolEconomics` is `NOT_APPLICABLE` (`no_protocol_listing`) for a project no DefiLlama
protocol is matched to — never a deficiency; `NO_SOURCE` (`not_tracked_by_registry`) when the
registry tracks none of fees, revenue or volume for it; `SOURCE_UNAVAILABLE`, `STALE` (older than
three days) or `MEASURED` (`registry_context_only`) otherwise. `freshness[]` gives each source's last read and its limit. The answer also carries the
state meanings as `states`.

### `GET /api/projects/{slug}/explain?fact=<fact>`

Why HEY publishes a fact, from the one explanation engine the Terminal's Ask HEY also reads:
`value` (exactly what the API sends), `state` (`FACT`, `DERIVED` or `UNKNOWN`), `classification`,
`canonicalRule { id, version, text }`, `source`, `observedAt`, `freshness`, `inputs[]`,
`lineage[]` (source, sanitation, selection, derivation, public), `evidence[]` (typed ids with
their `/api/evidence` URL), `unknownInputs[]` and a one-sentence `reason`.

Facts: `market.valuation` (which reading, which kind, competing readings, what was refused, shown
or withheld), `market.status` (the classifier's inputs, including HEY's chain-index depth),
`activity.status`, `build.momentum`, `discovery_gap`, `still_building`, `research.level`,
`token.verification`, `source.counted` (with `&source=source:<uuid>`: whether that source counts
toward activity and why not), `market_integrity.state` (withheld while unpublished; once
published, the stored evaluation read back — the collapse level, the level the market held and
now, each with its day and source, and the ids of the events it stands behind; an exit-pattern
classification is never named here). Without
`fact` the route lists them. An unknown fact is `400 unknown_fact`; `source.counted` without a
source is `400 source_required`.

### `GET /api/evidence/{id}`

One published record by its typed id, the same ids the change feed and the timeline use:
`ship:<uuid>`, `signal:<uuid>`, `abi:<uuid>`, `lock:<chainId>:<lockId>`, `source:<uuid>`,
`claim:<uuid>`, `state:<projectUuid>:<key>:<transitionId>`, `impl:<chainId>:<address>:<block>:<logIndex>`
(an upgrade log), `impl:<chainId>:<address>:rpc:<uuid>` (an implementation change HEY saw between
two reads of the proxy, with no block to name), `narrative:<projectUuid>:<slug>` (a narrative HEY
assigned; `sourceType` says who set it: `project`, `hey_moderator` or `hey_rules`), `method:<uuid>`
(a contract's functions first called, or called again after 30+ days without a call, on one UTC
day: counts only, `sourceType: "decoded_calls"`; a fact later evidence contradicted is withdrawn as
`superseded`), `security:<projectUuid>:<audit|bounty|contact>:<16 hex>` (2026-09-28: one item of the
project's security context — `claimType` `AUDIT_REPORT_LINKED`, `BUG_BOUNTY_LINKED` or
`SECURITY_CONTACT_PUBLISHED`, `sourceUrl` the report, program or security.txt, `publishedAt: null`,
precision OBSERVED; an item HEY no longer holds resolves to 404, a hidden project's to `not_public`),
`sourcechange:<uuid>` (2026-09-27: a material change to what the project's official
site declares, against HEY's earlier reading — `claimType: "SOURCE_CHANGE_OBSERVED"`,
`sourceType: "official_site"`, `publishedAt: null`, precision OBSERVED, `metadata` with the kind and
the added/removed counts, never the site's text; a change against a source HEY no longer holds as
the project's own is withdrawn as `context_only`).

A receipt carries `project`, `domain`, `claimType`, `summary`, `sourceType`, `sourceUrl`,
`publishedAt` (null when only HEY's observation dates it), `detectedAt`, `precision`,
`verification`, `countsAsBuilding` (present and true only when it counts toward activity),
`recordedAt` and `metadata`; a ship also lists every evidence row behind it (`sources[]`, each
with its `evidenceRowId`).

A record HEY no longer stands behind answers `{ id, withdrawn: true, withdrawalReason }`
(`retracted`, `disputed`, `context_only`, `review_false_positive`, `announced_ship_withdrawn`,
`superseded`), with `project` when the project is public. A `context_only` follow-up deployment
also carries `contextReason` (2026-09-27): `held_by_another_project`, `shared_deployer`,
`serial_launcher_deployer` (the account that launched the token creates contracts for many
projects: 100 or more in 90 days), `token_mismatch` or `deployer_not_tied`. For a project that is not public the
reason is `not_public` and nothing else is said, not even the slug. A claim that was never
verified, a reviewer's note, a reviewer and a claimant are never published. A malformed id is
`400 invalid_evidence_id`; an unknown one `404`. `state:` and `impl:` ids resolve once the
transition ledger and the implementation history exist.

`integrity:<tokenUuid>:<key>` (2026-09-27) is one Market Integrity event, the same id the change
ledger and `/api/projects/{slug}/market-integrity` use. It resolves only while HEY publishes
Market Integrity (`404` otherwise), and an exit-pattern classification only where HEY names one.
The receipt's `domain` is `market_integrity`, `claimType` the event kind in lower case
(`liquidity_collapse`, `market_data_conflict`, …), `sourceType` `hey_market_index` (HEY's daily
index of pool readings and decoded on-chain trades) or `hoodlock`, and `metadata` carries the
reading days and the source of each figure (`levelSource`, `currentSource`) and the rules version.
A state HEY observed — a trading collapse, two sources disagreeing, a builder × market conflict —
has `publishedAt: null` and `precision: "OBSERVED"`. `verification` is `CONFIRMED` when a reviewer
confirmed it, null otherwise; an event the current evaluation no longer finds is withdrawn as
`superseded`, and one a reviewer marked a false positive as `review_false_positive`.

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
| `type` | a ship event type (`GITHUB_RELEASE`), a comma list (`GITHUB_RELEASE,APP_RELEASE`), or `releases` for every release type | — |
| `has` | the card facts, as above | — |
| `q` | the shipping project's name, ticker or contract prefix | — |
| `since` | an ISO 8601 date or instant — the window you are reporting on (filters `publishedAt`, inclusive) | — |
| `until` | an ISO 8601 date or instant — the window's end, **exclusive** (2026-10-02); must be after `since` | — |
| `detectedSince` | an ISO 8601 instant filtering `detectedAt`, the mirroring axis — see below | — |

**Unknown values are refused (2026-10-02).** A value a parameter does not read — `type=banana`,
`sort=byPrice`, `has=moon`, an unreadable date, an `until` not after `since` — answers `400`:

```json
{ "error": "invalid_parameter", "message": "type=banana is not a value this API reads. Allowed: …",
  "errors": [{ "parameter": "type", "value": "banana", "allowed": ["PRODUCT_LAUNCH", "…", "releases"], "message": "…" }] }
```

It used to be dropped, which handed a caller the unfiltered feed with a missing echo as the only
tell (`type=releases` returned every ship). `/api/projects` follows the same rule for `tab`, `kind`,
`status`, `launchpad`, `has`, `sort` (`sort=momentum` is a 400 listing the orders; the Builder
Radar, `/api/builders`, is HEY's ranking by builder signals), `stage`, `age`, `deployed` and the
dollar floors. `limit` and `offset` are still capped, not refused.

**A code week names its fixed week (2026-10-02).** A `CODE_ACTIVITY` ship carries `codeWeek`:
`isoWeek`, `start` (Monday 00:00 UTC) and `end` (the next Monday, exclusive), `repository`,
`commits` (human, non-merge commits in that week; `null` when HEY holds no count) with
`commitsAtLeast` when it is a floor, `commitsUrl` (that week's commits on GitHub), up to three
`highlights` (`subject`, `sha`, `committedAt`, `readAsCode`, `url` — the commits HEY read as
changing code first; never a bot's, a merge's or a documentation-only one) and `title`, the one
display title HEY prints. `title` on the ship itself is the same week's title without the count
("Code changes, week of 2026-09-28 – 2026-10-04", since 2026-10-03; it was the rolling measurement
"Active development: 100+ commits since …" before, which named spans two neighbouring weeks could
share). The field and its meaning — the ship's title — are unchanged; only its words are the week's.

## CSV exports (2026-10-02)

`GET /api/export/projects` — the current Explore result as CSV (the page's **Download CSV**
link writes its applied filters into the URL: `tab`, `kindGroup`, `kind`, `status`, `narrative`,
`level`, `ready`, `stage`, `minLiquidity`, `minVolume`, `minMarketCap`, `maxMarketCap`, `age`,
`deployed`, `has`, `launchpad`, `sort`, `q`). `GET /api/export/ships` — the ships feed for a
window (`since`, `until`, `type` incl. `releases`, `has`, `q`, `sort`, `project`). Both: at most
**1,000 rows** in the listing's own order (`x-hey-rows`, and `x-hey-truncated: true` when more
matched), UTF-8 with a BOM, dates in UTC, every row stamped `as_of_utc`; an empty cell is not
measured, never zero. An export costs 21 requests from the per-minute bucket (a 48-row page each),
so a keyless client can take about five a minute. Cells that a spreadsheet would run as a formula
are prefixed with `'`. A value not understood is the same `400 invalid_parameter`.

Project columns: identity, `kind`, `primary_narrative`, `activity_status` and its words,
`research_level`, `verified_builder`, the latest ship (title, type, date, evidence URL),
`meaningful_ships_7d` / `_30d` (the scorer's count; empty where activity is not measured),
the valuation with its kind or the reason it is withheld, `market_status`, and links. Ship
columns: `published_at`, `date_precision`, a code week's `week_start`/`week_end` and
`what_changed`, `event_type`, `title`, `verification`, `source_url`, `evidence_id`/`evidence_url`.

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
`volume24hUsd`, `marketCapCloseUsd` (the closing reading's valuation; `marketCapCloseKind` is
`fdv` when it equals price × total supply and `marketCap` when it is a circulating figure, absent
when HEY does not know the supply, and the close is withheld when it implies more than twice the
supply — 2026-09-25) and the `source` that won the day, rolled up from HEY's readings; and, where Bitquery decoded them, `trades`, `buys`, `sells`, `buyVolumeUsd`,
`sellVolumeUsd`, `tradeCloseUsd`, `transfers` (`tradesSource: "bitquery"`). `lifecycle` carries
when HEY recorded the launch, when the pool was created, the launch stage and since when, the
first and last indexed trade day (over the whole daily index HEY keeps, not the `days`
window — 2026-09-25), the highest liquidity HEY saw and how far below it liquidity
sits (`liquidityBelowPeakPct`), and the 7- and 30-day price moves from HEY's own closes.
`checks[]` is what HEY checked on the contract — on chain, upgradeable proxy, deployer (and how
many other projects' tokens it deployed), whether the project's own sources name the contract,
the launch record, liquidity against its high, trades on the latest day — each a `finding` in
words with `provenance` and a `tone` of `plain` or `noted`. Never a score, never "safe" or
"risky". `onchainDays[]` are the contract's events per day; `tvlDays[]` DefiLlama's value locked
per day. Absent means HEY holds no such figure. Counts of trades, transfers and events, never of
accounts. A project without a token is `404`.

Added 2026-09-25, all optional and absent when HEY holds nothing:

- `marketStatusReason` — the reason code behind `marketStatus` (`launch_pool_no_trades`,
  `no_volume_24h`, …). The market is not live when the status is `NO_LIQUIDITY`,
  `LIQUIDITY_REMOVED` or `MARKET_ABANDONED`, or the reason is `launch_pool_no_trades`,
  `launch_pool_volume_unknown`, `pool_readings_disagree`, `readings_implausible` or
  `removal_unconfirmed` whatever the status beside it. For those HEY sends no valuation.
  `LIQUIDITY_REMOVED` (since 2026-09-27) is a measured drain: one series of readings — a pool, or
  HEY's chain index across every pool — held at least $5,000 on two readings, then read at or
  below a tenth of that on two UTC days, with nothing read of any pool since above it.
  `removal_unconfirmed` (`INSUFFICIENT_DATA`) is dust where HEY saw a market held but has not
  measured the drain: it claims neither a live market nor a removal. `readings_implausible` (2026-09-25)
  means the reading claims a large pool that almost nothing traded in and that HEY's own chain
  index does not find; its liquidity and highest liquidity are withheld too, here, in the list and
  detail endpoints, and from `sort=liquidity`, `minLiquidity` and the market-cap filters.
  Since 2026-10-03 (token market rules `token-market-2026-10-03`): `not_a_fungible_token`
  (`INSUFFICIENT_DATA`) is a token that reads 0 decimals — an NFT collection — and is not live
  either, so no valuation is sent and no Discovery Gap, Under the Radar or Still Building is
  measured on it; NFT-marketplace sales (Seaport and the like) are never read as DEX trades.
  `reading_not_current` (`INSUFFICIENT_DATA`, live, not measured) means the newest reading is more
  than 36 hours old and no decoded trade record from the last day speaks for the market, so HEY
  claims neither "traded in the last day" nor "did not". A market active only in another pool
  (`liquidity_in_another_pool`) sends no valuation (`valuationWithheld: liquidity_in_another_pool`):
  the reading follows the thin pool, and founder ruling F1 never measures the market there.
- `contract` — `deployer`, `deployerShared` (that deployer launched other projects HEY tracks: a
  launch service, not one team), `creationTx`, `createdAt`. A fact about the contract, never a label
  on a person.
- `pools` — the latest pool reading from the chain: `day`, `observedAt`, `pools`, `liquidityUsd`
  and `depthOnePctUsd` (how much can be sold before the price moves 1%, added across the pools).
- `distribution` — a summary of HEY's snapshot of the token's largest balances: `day`,
  `observedAt`, `holdersTotal`, `top10SharePct`, `top50SharePct` (burned and pooled supply left
  out), `burnedSharePct`, `pooledSharePct`. No address and no balance.
- `distributionRead` (2026-09-25) — what HEY's latest attempt to read the distribution found:
  `outcome` (`mapped`, `no_balance_change_in_window`, `no_supply` or `read_failed`), `checkedAt`,
  and a plain-sentence `note` for every outcome but `mapped`. The holder source reports only
  balances that moved in about the last nine days, so a quiet token comes back empty:
  `no_balance_change_in_window` says exactly that — "No balance change in the provider's window",
  never "no holders" — and `distribution`, when present, is then the last map HEY did read, dated
  by its own `day`. Absent when HEY has never tried.
- `days[]` also names `distinctAddresses`, `distinctBuyers`, `distinctSellers` and `poolsTraded`,
  and `onchainDays[]` names `callers` — counts the route already sent and the types did not.

Added 2026-09-26, all optional and absent when HEY did not measure them:

- `contract.proxy` — what HEY measured about proxying: `status` (`PROXY`, `NOT_PROXY`, `ERROR`),
  `kind` — `EIP1967` (the implementation slot), `BEACON` (the beacon slot, and the implementation
  the beacon answers), `EXPLORER_REPORTED` (neither slot set; the explorer names an
  implementation) or `NONE_DETECTED` — plus `implementation`, `beacon`, `checkedAt`, `changedAt`.
  `kind` is absent on a contract not yet re-read since the kind was recorded. The `proxy` check
  in `checks[]` now names the reading that answered and never says "not a proxy": five published
  beacon-proxy tokens used to read "No — the contract is not a proxy". `contract.factory` and
  `contract.deployerOtherProjects` (a count) are fields now, not only prose.
- `pools` — where the liquidity sits, from per-pool rows HEY keeps **from 2026-09-26 on** (no
  earlier history exists): `livePoolCount`, `dominantPoolShare` (the largest pool's share of the
  day's measured liquidity, 0–100), `poolFirstSeenDay` (the first day HEY saw any of the token's
  pools — a lower bound, never the market's creation) and `structureCollectedFrom`. Facts about
  structure, never a "safe" or "best" pool.
- `lifecycle` — each milestone on its own clock: `deployedAt` (the creating block's time, exact),
  `launchpadLaunchAt` (`{at, source, basis: "launchpad_claim"}` — the launchpad's own claim),
  `tradeIndexFrom` and `firstTradeCensored` (true when the first trade falls on the index's first
  day: trading may have begun earlier), `launchStageObservedAt` (the same instant as
  `launchStageAt`, named for what it is: when HEY saw the stage, never the graduation),
  `firstBuildingShip` and `firstVerifiedRelease` (`publishedAt` and `detectedAt`),
  `verifiedBuilderAt` (knowledge time), and `durations` in whole days — given only between two
  event times HEY measured, never from a knowledge time and never across a censored first trade.
- `onchainDays[]` keeps `calls`, `methods`, `eventKinds`, `source` (`onchain` for the decoded
  reading, `rpc` for the node's own log count) and `window` (`utc_day` or `rolling_24h`). On a day
  the decoding source counted calls but could not index events for the contract, `events` is
  **`null`** and the calls stay — that day used to be dropped whole. `events` is therefore
  `number | null`.
- `onchainFreshness` — `{newestDay, observedAt, stale}`; `stale` when the newest on-chain day is
  more than three days behind: the series ends where HEY stopped reading, not where the contract
  went quiet.

A project's `onchainActivity` in `GET /api/projects/{slug}` gained four optional fields on
2026-09-14, present only on days a decoding source filled: `calls24h`, `transactions24h`,
`methods` and `eventKinds`. The last two are how many *different* method names were called and
event names emitted over the days read — the cheapest honest separation between an ERC-20 being
traded and a contract with functions people call. All four are counts and context, never an input
to any score. No address is named here — but "no accounts, anywhere", which this line used to
say, stopped being true on 2026-09-15: HEY's daily index counts how many different addresses
called a contract and traded a token, and `/api/signals` publishes those counts (2026-09-19).
They are figures the provider returns; nothing selects, stores or exposes an address.

## `GET /api/projects/{slug}/market-integrity` (2026-09-25; published 2026-09-27)

What happened to the project's tracked token market, beside — never inside — its builder
activity, and where the two stories disagree. `404` until HEY publishes Market Integrity
(fail closed). Read from HEY's stored evaluation (rules
`mi-v4`); no provider is called and nothing is scored.

- `builderActivity` — the activity status and last meaningful ship, as the project page says them.
- `marketIntegrity` — `state` (the token market status), `established`, `collapse` (`NONE`,
  `DECLINE`, `COLLAPSE`, `SEVERE`: liquidity under 25%, 10% or 5% of the level it held, on two
  consecutive daily readings; withdrawn while two sources disagree), `liquidityPeakUsd` /
  `liquidityPeakDay` / `liquidityPeakSource` (the highest level held on two consecutive days, and
  the source that won that day), `liquidityNowUsd` / `liquidityNowDay` / `liquidityNowSource`,
  `liquidityChangePct`, `deteriorationStartDay`, `collapseDay`, `lastTradeDay`, `migration`,
  `lockState`, `sourcesDisagree`; `exitPattern` only where HEY names one, always an evidence classification, never a finding about
  intent.
- `conflicts[]` — builder × market conflicts, each with one plain sentence.
- `events[]` — only what the current evaluation stands behind: `id` (`integrity:<tokenUuid>:<key>`,
  resolvable at `/api/evidence/{id}`), `kind`, `label`, `summary` (the reading dates and sources),
  `source`, `at` (null for a state HEY observed) with `precision` (`exact`, `day`, `window`,
  `observed`), `until`, `detectedAt` (the first time any rules version saw it), `confidence`,
  `facts`.

Sources are named as the rest of the API names them (`dexscreener`, `geckoterminal`,
`onchain` for decoded trades). The words never say "rug" or "scam".

## `GET /api/changes` — the change ledger (2026-09-26)

One canonical event per meaningful change HEY recorded, chain-wide or for one project, from
one append-only ledger. This is **the** mirroring contract: `/api/ships`, `/api/signals`, the
Terminal's "What changed", the Watchlist and both RSS feeds read the same events. Every event
points back at the record it indexes (`ship:<uuid>`, `signal:<uuid>`, `abi:<uuid>`,
`state:<projectUuid>:<key>:<id>`, `claim:<uuid>`, `source:<uuid>:added`,
`narrative:<projectUuid>:<slug>`, `lock:<chainId>:<lockId>:due`); the ledger is never a new
source of facts. Read from HEY's own tables; no provider is called.

### Sync (mirroring)

```bash
# Start from the beginning of the ledger, then keep nextCursor after applying each page.
curl "https://heyresearch.xyz/api/changes?after=c1.0&limit=100"
curl "https://heyresearch.xyz/api/changes?after=<nextCursor>&limit=100"
# Or start at an instant: the first event recorded at or after it.
curl "https://heyresearch.xyz/api/changes?detectedSince=2026-09-26T00:00:00Z"
```

- `after=<cursor>` returns events in ledger order (`seq`, ascending). `c1.0` is the start. The
  cursor is opaque; `seq` is unique, so there are no ties to break.
- `nextCursor` is always set in sync mode — to the last item, or back to your `after` on an empty
  page — so a poller keeps its place. `hasMore: false` means you have reached the head for now.
- Apply in order: an `upsert` replaces your copy of its `id` (keep the highest `revision`); a
  `retract` deletes it. Every revision is a row, so a mirror that applies them in order ends in
  HEY's current state.
- **Nothing is missed.** An event's position is when it entered the ledger *at its current
  visibility* (`recordedAt`), not when it happened. A ship recorded before its project was
  published, one whose context-only mark is cleared later, a release HEY read a week late — each
  gets a new position after your cursor. A retraction is a tombstone you will receive. These were
  the three loss paths of the `detectedAt` watermark on `/api/ships` (below).
- The projector runs every five minutes; polling `after=` every minute is as fresh as anything.
  There is no stream (SSE); webhooks will deliver the same events.

### Browse

No cursor, or `before=<cursor>`: newest first, `nextCursor` reads older (null at the end).

### Filters

| Parameter | Filters | Notes |
|---|---|---|
| `project` | a published project's slug | a hidden or unknown slug answers **404** |
| `contract` | `<chainId>:<address>` | events about that contract or token (lower-cased) |
| `domain` | comma list: `build`, `contract`, `market`, `token`, `research`, `lock` | |
| `type` | comma list of event types (below) | |
| `since`, `until` | the event's own time, `occurredAt` | events with no `occurredAt` are left out; tombstones always pass |
| `detectedSince` | starts a sync at the first event **recorded** at or after the instant | not combinable with a cursor |
| `after` / `before` | a cursor this API issued | anything else — a position past the end of the ledger included — is **400 `invalid_cursor`** |
| `limit` | 1–100, default 50 | |

A filter value HEY cannot read — an unknown `type` or `domain`, a malformed `project` or
`contract`, an unreadable date — is refused with **400 `invalid_parameter`**, naming each value
and, for a vocabulary, every value it accepts (`errors[].allowed`), as `/api/projects` and
`/api/ships` do (2026-10-03). It used to be dropped, which widened the answer to every change in
the ledger. A parameter name HEY does not know is still ignored.

### The event

```json
{
  "id": "ship:2ac87a66-…", "revision": 1, "op": "upsert",
  "type": "build.release", "domain": "build", "origin": "live",
  "project": {"slug": "arrow", "name": "Arrow", "url": "…"},
  "contract": {"chainId": 4663, "address": "0x…"},
  "occurredAt": "2026-09-20T10:30:00.000Z", "precision": "EXACT",
  "detectedAt": "2026-09-21T08:00:00.000Z", "recordedAt": "2026-09-21T08:05:00.000Z",
  "summary": "v1.2.0", "before": "SHIPPING", "after": "DORMANT",
  "evidence": [{"id": "ship:2ac87a66-…", "url": "https://github.com/…", "label": "GitHub"}],
  "source": "github", "countsAsBuilding": true,
  "annotations": {"signalIds": ["signal:…"]}, "facts": {"eventType": "GITHUB_RELEASE"},
  "links": {"project": "…", "evidence": "…/api/evidence/ship%3A…", "timeline": "…"}
}
```

A retraction is `{"id", "revision", "op": "retract", "recordedAt"}` and nothing else: it never
names a project, so a project that leaves the catalogue is not disclosed by its tombstones.

**Three times, never one.** `occurredAt` is set only when an external source dates the event (a
release's publication, a block, an unlock HoodLock scheduled); HEY's own reclassifications — a
status moving, an ABI diff HEY noticed — carry `occurredAt: null` and `precision: "OBSERVED"`.
`detectedAt` is when HEY first knew. `recordedAt` is when this revision entered the ledger.
HEY's own "what is new" windows — HEY Today, the Terminal's What changed, `/updates`, the email
digests, alerts — read when the event *first* reached HEY, which a later revision keeps (founder
ruling 2026-10-03): a revision is delivered here and to webhooks with a new position, so a mirror
receives the corrected content, but it is never new on those surfaces. A mirror that wants the
same reading takes the earliest `recordedAt` it holds for a `live` id (`detectedAt` for
`bootstrap` and `backfill` history).
`precision` is one vocabulary everywhere: `EXACT`, `DATE` (a day only), `WEEK` (a code-activity
week), `WINDOW` (inside `occurredAt`–`occurredUntil`, or ending at `occurredAt` for a HEY Signal's
comparison window), `OBSERVED`, `SCHEDULED` (a future time the source fixed).

`origin` is `live` for what the projector saw as it happened, `bootstrap` for history indexed at
the first run, `backfill` for history indexed later (a project published with months of ships).
A project that leaves the catalogue and returns gets its events back as new revisions past every
cursor, so a sync sees them: `live` only when the event was first seen live and is still recent,
otherwise `backfill`. A tombstone carries no fields, but a `contract=` or `token=` sync receives it.
`countsAsBuilding` is present only on events the activity status counts. `annotations.signalIds`
lists HEY Signals that restate the event — a release signal on its ship, a dormant signal on its
status move — so each change is one event, not two.

### Types

| Type | From | `occurredAt` |
|---|---|---|
| `build.release`, `build.ship`, `build.code_activity` | a ship (releases; other building types; a weekly code summary). A code summary carries its week's substance as facts since 2026-09-27 (`codeSubstance` and counts, see `/api/projects/{slug}`); a documentation-only week has no `countsAsBuilding` | the publication, EXACT/DATE/WEEK |
| `contract.deployed`, `contract.followup_deployed` | a deploy ship (the launch record; a later contract from the project's deployer) | the block time |
| `contract.implementation_changed` | the implementation history: an upgrade log (id `impl:<chainId>:<address>:<block>:<logIndex>`), or a change HEY saw between two reads (`impl:<chainId>:<address>:rpc:<uuid>`, with the upgrade ship as evidence, never a second event). An old log indexed late is `origin: "backfill"` | the block time, EXACT (log); null, OBSERVED (two reads) |
| `contract.source_verified`, `contract.source_unverified`, `contract.interface_changed` | an explorer ABI diff (counts only; the names stay in the Terminal) | null, OBSERVED |
| `contract.method_first_observed`, `contract.method_resumed` | the contract's calls per method (2026-09-27): named functions called for the first time since deployment (only where HEY read the contract back to its deployment, never its first day of use), or called again after 30+ days HEY read without a call. Id `method:<uuid>`; `facts.functions` counts them (the names stay in the Terminal), `facts.longestSilenceDays` on a resumption. A contract fact, never `countsAsBuilding`. An old day indexed by the archive backfill is `origin: "backfill"` | the UTC day of the calls, DATE |
| `build.status_changed`, `build.dormant`, `build.resumed` | an activity-status move | null, OBSERVED |
| `build.accelerating`, `build.slowing` | the development-window signals | the window's end, WINDOW |
| `market.status_changed` | a token-market-status move | null, OBSERVED |
| `market.liquidity_moved`, `market.volume_spike`, `market.distribution_changed`, `contract.usage_changed` | the market and usage signals (counts only, never an address) | WINDOW |
| `token.launch_stage_changed`, `token.verification_changed` | a launch-stage or token-verification move | null, OBSERVED |
| `research.published`, `research.builder_verified` | a project page published; a builder verified | null, OBSERVED |
| `research.owner_verified` | a verified ownership claim (how, never who) | the verification, EXACT |
| `research.source_added` | an official source registered after the project's first day | null, OBSERVED |
| `research.source_unavailable`, `research.source_restored` | a source that stopped answering, and came back (restores recorded from 2026-09-26) | null, OBSERVED |
| `research.source_changed` | a material change to what the official site declares (2026-09-27), against HEY's earlier reading: its declared links, sitemap sections, llms.txt links, security.txt, the linked API description's operations, or one of those files appearing or going away. Id `sourcechange:<uuid>`; `facts.kind` and `facts.added`/`facts.removed` are counts — the entries themselves, a security contact and the site's prose are never in the event. The first read of a file is a baseline, never an event. Never a ship and never `countsAsBuilding`; retracted when the source is no longer the project's own. A webhook type since 2026-09-27 (founder) | null, OBSERVED |
| `research.narrative_assigned` | a narrative assigned | the assignment, EXACT |
| `lock.unlock_due` | a HoodLock unlock entering its last seven days | the unlock, SCHEDULED |
| `lock.observed`, `lock.withdrawn` | the first sweep that read a HoodLock lock, and the first that read it withdrawn (forward-only from migration 0138; locks already there when collection began say nothing) | null, OBSERVED (the locker gives no times; `detectedAt` is HEY's) |
| `market_integrity.event` | a Market Integrity finding the current evaluation stands behind (only where HEY publishes Market Integrity; id `integrity:<tokenUuid>:<key>`) | a collapse, trading stop or lock event: its day or window, DATE/WINDOW/EXACT; a trading collapse, a source conflict or a builder × market conflict: null, OBSERVED |

**What the ledger cannot tell you.** State moves (status, market status, launch stage,
verification, publication) are recorded from the deploy of migration 0136 (`ledger.transitionsFrom`);
before it only the moves a HEY Signal announced exist, as `signal:` events. A bookkeeping move —
an `UNKNOWN` side, or a move in the same run as a scoring-version change — is recorded and never
announced.

**Market Integrity (`market_integrity.event`, domain `market_integrity`).** Terminal-only unless
HEY publishes Market Integrity; then one event per finding the current evaluation stands behind —
a liquidity collapse, a trading collapse or stop, a migration, a lock that expired or was
withdrawn, two sources disagreeing, a builder × market conflict — with its words, reading dates
and sources in `summary` and `facts`. A dated finding keeps its day or window; a state HEY
observed is `occurredAt: null`, `OBSERVED`. An exit-pattern classification is public only where
HEY names one; elsewhere it stays Terminal-only. When the operator publishes Market Integrity,
the events already recorded enter this feed as new upserts with new `seq`s, so any `after=`
cursor reaches them, but with the `origin` of their first emission — `bootstrap` stays
`bootstrap`, and one first seen on the Terminal as `live` enters as `backfill` — so publishing is
never news and webhooks never push it. A finding the next evaluation no longer makes is retracted.

`ledger` on every page: `collectionStart` (the first event recorded), `transitionsFrom`,
`newestRecordedAt`, `projectorRanAt`. `/api/status` reports the projector stale after 15 minutes.

## Webhooks: `/api/webhooks` (2026-09-26)

HEY can POST the change ledger's public events to an endpoint an API account registers: the same
event `/api/changes` serves, signed with HMAC-SHA256 over `<timestamp>.<raw body>`. Keyed only;
answers are `private, no-store`. The full contract — event types, payload, signature, retries,
the SSRF rules a callback URL must pass, and TypeScript/curl examples — is in
[Webhooks](WEBHOOKS.md).

| Route | What it does |
|---|---|
| `GET /api/webhooks` | the account's subscriptions, the subscribable types, the account's limit (5) |
| `POST /api/webhooks` | `{url, eventTypes, projects?, description?}` → `201 {subscription, secret, verification: "ping_queued"}`; the secret is shown this once |
| `GET`, `PATCH`, `DELETE /api/webhooks/{id}` | read, change (`url`, `eventTypes`, `projects`, `description`, `status: active\|disabled`), remove |
| `POST /api/webhooks/{id}/rotate` | a new secret, shown once; the old one keeps signing beside it for 24 h |
| `POST /api/webhooks/{id}/ping` | `202`: a signed ping is queued; a 2xx answer activates a pending subscription |
| `GET /api/webhooks/{id}/deliveries` | what was sent, newest first: status, attempts, next attempt, your status code, 256 characters of your answer |

Webhooks and cursor polling of `/api/changes?after=` are the supported ways to follow HEY. A
server-sent stream is not offered: the ledger is written every five minutes, so a stream could be
no fresher than polling (see [Webhooks](WEBHOOKS.md)).

## Research boards: `/api/boards` (2026-09-28)

A Terminal account's own saved boards: published projects in order,
panels from a fixed list, a window. An API key or the reader's own session (writes same-origin
only); the account must be admitted to the Terminal (else `403`). Answers are `private, no-store`;
another account's board is `404`.

| Route | What it does |
|---|---|
| `GET /api/boards` | the account's boards (`HeyBoardSummary`), the limits (20 boards, 25 projects, name 80, note 2,000), the panel names and windows |
| `POST /api/boards` | `{name, projects?, panels?, windowDays?, note?}` → `201 HeyBoard`, private |
| `GET`, `PATCH`, `DELETE /api/boards/{id}` | read; change `name`, `note`, `panels`, `windowDays`, `projects` (the whole ordered list); remove |

Errors: `invalid_parameter`, `unknown_projects` (unknown and unpublished alike), `project_limit`,
`board_limit` (409), `not_found`. Sharing is managed in the Terminal, where the link is shown once;
the API never returns a share token. No MCP tool.

## Research Desks: `/api/desks` (2026-09-30)

A Research Desk is the public view of a board its owner published.
Keyless, the public read budget, `no-store` (an unpublished desk is a `404` the moment it is taken
down). Never the board's note, the owner's account, watchlist or alerts.

| Route | What it answers |
|---|---|
| `GET /api/desks` | published desks, newest visible change first — `{desks: [{slug, url, api, title, description, curator, projects, updatedAt}], shown, limit: 60, order}`. A directory, never a ranking: no follower, view or clone count |
| `GET /api/desks/{slug}` | `{desk: {slug, url, title, description, curator, windowDays, panels, publishedAt, updatedAt, followers, projects: [{slug, name, url, api}], facts, image}}` |

`curator` is `{handle, verified: false}` or `null`: a handle the curator typed, which HEY does not
verify. `facts` counts the desk's projects over its window — `projects`, `shipped` (last
meaningful ship in the window), `developmentSpikes` (`build.accelerating` on the ledger),
`contractChanges` (the ledger's contract events) — with `definitions`; a fact HEY cannot state is
`null` with its reason in `unknown` (`projects_not_researched`, `change_ledger_not_run`), never 0.
The share image is `GET /og/desk/{slug}` (1200×630, never cached).

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

**`confidence` is a method statistic (2026-10-01, founder F3).** It says how much evidence the
rule had to go on — a fixed figure for a rule that reads a state change, or the share of its
window a rule read (days of volume history against seven, ships against a floor) — clamped to
0–1, and it scales `importance`, which orders `order=importance`. It is never a probability that
anything will happen, never a trading confidence and never a recommendation. The field stays, with
its meaning unchanged; HEY's own pages, the Terminal and the signal share images no longer print it,
because a percentage beside a market move reads as exactly what it is not. `/signals` itself now
groups rows of one kind on one UTC day into one row with its true count; the API is unchanged and
lists every signal.

**Two times, and the page's end (2026-09-26).** `observedAt` is the window's end or the event's
own time — for `release_published` and `contract_deployed` it is the ship's publication — and is
**not** when HEY recorded the signal. `detectedAt` is (the row's creation). A signal about a ship
carries `shipId`, the ship it announces. The page carries `nextOffset` until the last page. To
follow signals as they arrive, sync `/api/changes` (a release or deploy signal is an annotation
on its ship's event there, not a second event) rather than paging by `observedAt`. Release and
deploy signals are raised for what HEY recorded in the last seven days (published within 90), so
a release read late still gets one.

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
volume take no part. Ranks are recomputed daily and kept. On-chain use is **address-days of
calls** to the project's own contracts over 7 days: each UTC day's distinct caller count, added
across days and contracts, so an address calling on several days is counted again — never
distinct addresses and never people (the emitted-event count stands in where HEY has no caller
count). The `onchain` filter sorts by that sub-score.

## `GET /api/reports/weekly` and `GET /api/reports/weekly/{week}` (2026-09-13)

The archived weekly reports, one per ISO week (`2026-W37`): overview counts, chain totals,
most active builders, movers, top builders, new verified builders, back to shipping, Still
Building, Under the Radar, the week's signals. `final` is true once the week has closed.

## `GET /api/projects/{slug}/intelligence` (2026-09-13)

One project's intelligence in one answer: the card, its signals (90 days), its Builder Radar
rank and 30-day history, and — for a token project — the market summary with the contract checks.

Since 2026-09-24 it also carries `development`: derived builder intelligence under the rules
`rulesVersion` names (`intel-v3` today, the `INTELLIGENCE_RULES_VERSION` constant), computed from the same meaningful events as the activity status and
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

Since 2026-09-27 it also answers the free-data questions, each from its own section: "What changed
in its public API?", "Which code hosts does HEY hold for it?" (a GitLab question is answered with
what HEY holds, that it holds no GitLab link, and that it reads repositories on GitHub only), "What
functions became active recently?" (counts only), "What does DefiLlama track for this protocol?",
"What public packages does it publish?", "What security advisories are known for its official
packages?", "What did the official site and docs change?" and "Which of HEY's records are gaps?".
A line that restates a change-ledger event has `source` set to its evidence receipt
(`…/api/evidence/sourcechange:<uuid>`, `…/api/evidence/method:<uuid>`); a coverage state decides a
line's tag (measured or not applicable is `FACT`, anything else `UNKNOWN`), and "none found" is said
as a reading of the one index HEY asked. No section is stronger than the object the API publishes.

## `GET /api/chain/contract-changes?days=30` (2026-09-24)

Evidence-backed contract changes on published projects, newest first, `days`
1–90. Two shapes in `items[]`: `CONTRACT_UPGRADE` / `CONTRACT_DEPLOY_FOLLOWUP`
per project with `count` and the `latest` event and its source; and
`VERIFIED` / `UNVERIFIED` / `INTERFACE_CHANGED` per contract address with the
function and event signatures added and removed, `detectedAt` (when HEY saw
it, not when it happened) and the explorer `source`.

Since 2026-09-26 every item has an `id` — `ship:<uuid>` for the newest event of a project's row,
`abi:<uuid>` for an interface or verification change — and the answer carries `total` (rows the
window holds before the 100-per-family cap) and `truncated`. A contract first recognised as a
proxy resets its interface baseline without an `INTERFACE_CHANGED`, and one baseline reading
yields at most one change.

## The Terminal command centre (2026-09-24)

The same reads the Terminal's command centre uses, keyless and cached like the
rest of the API. Every list carries its `method` in words; none is ordered by
price, and none names a winner.

| Route | Answers |
|---|---|
| `GET /api/chain/silence` | projects building with comparatively little market attention (HEY's stored Under the Radar decision), each with `meaningfulShips30d` and `marketAttention` |
| `GET /api/chain/accelerating` | builders whose velocity is ACCELERATING by the project page's own rule (last 30 days ≥ 1.5× the 30 before and at least two more; watched 60 days or longer), each with `velocity` |
| `GET /api/chain/comebacks` | projects whose activity status is RESUMED |
| `GET /api/chain/unlocks?days=30` | HoodLock's own schedule: locks still holding that unlock within `days` (1–365), each `precision: SCHEDULED` with a `proof` link |
| `GET /api/v4-hooks?limit=100&under=` | Uniswap v4 hooks HEY ties to a published project (2026-10-04): attributed only (`PROJECT_DEPLOYER` while its follow-up ship stands, `PROJECT_DECLARED`), each with `id` (`v4hook:<chainId>:<address>`), `receipt`, `tie`, `deploymentEvidenceId`, `deployedAt` (absent when not read), `firstPoolInit`, `poolsOnTrackedTokens`, `permissions`, `capabilities` and the project's status and `marketContext` (with its kind, or why none is printed). Newest deployment first, never ordered by pools or market; `under` is a reader's filter (`filter.excludedNoFigure` counts projects with no printed figure); `shown`, `total`, `truncated`; every other hook only in `aggregate`. Additive (2026-10-04): `projects[]` — the same hooks grouped by published project, newest hook deployment first, each with `summary`, `hookCount`, `deployedCount`, `declaredCount`, `newestDeployedAt`, `tie` and `hookIds` (every project matching the filter, whatever `limit`); `aggregate.listedProjects`; `filter.excludedNoFigureProjects`; `items[].listing` — Uniswap's public hooklist entry (`words`, `name`, `url` to the file at `commit`, `readAt`, `authority: 'context'`, `verifiedSource`, `listedPermissions`, `properties`, and `disagreement` with both readings when its flags and the address differ); `hooklist` — coverage counts (`read`, `sentence`, `listed`, `seenByHey`, `notSeenByHey`, `commit`, `readAt`), `read: false` and no counts until HEY has read it |
| `GET /api/chain/build-market` | Build Momentum and market-attention percentile for researched projects, in slug order — a map, not a ranking |
| `GET /api/projects/{slug}/timeline?lens=&limit=&before=` | every kind of evidence on one axis, newest first, with `precision` (EXACT, DATE, WEEK, WINDOW, OBSERVED, SCHEDULED), `recordedAt`, `discoveryLagHours`, `countsAsBuilding`, `source` and `marketAround` (context, not cause). Lenses: everything, build, code, onchain, market, locks. Since 2026-09-26: `totals` per family (ships, contractSource, locks, resumed, marketIntegrity, verification) and `total` in the lens, `truncated`, and `nextCursor` to pass as `before` for older entries; `limit` 1–500, default 200 (it used to stop at 200 without saying so); a cursor it did not issue is 400 `invalid_cursor` |
| `GET /api/projects/{slug}/market-moves?days=90&min=25` | day-on-day moves of at least `min`% in HEY's recorded valuation close (consecutive days only; `valuationKind` says `fdv` or `marketCap` where HEY knows the supply; nothing for a market HEY records as gone), each with the corroborated building events published in the 7 days up to that close — a sequence, never a cause; `daysRead` says how much index there was |
| `GET /api/compare?slugs=a,b` | two to four projects side by side with the project page's gates; `missing` names slugs that are not published; `ignoredSlugs` (2026-09-26) names slugs that were malformed or past the fourth; `400 invalid_parameter` for fewer than two |

Since 2026-09-26 `silence`, `comebacks` and `unlocks` carry `total` (rows before the page's limit of
100) and `truncated`. Each unlock carries an `id` (`lock:<chainId>:<lockId>`) and the answer says
`scope: "hoodlock"`: coverage is the HoodLock locker only, so a token with no row has no HoodLock
lock — not "no lock".

## `GET /api/chain` (2026-09-13)

Robinhood Chain day by day, aggregates only. `days` (1–400, default 14). Each row: `dexTrades`,
`dexVolumeUsd` (trades against USDG, WETH and ETH only — unpriced pairs are left out rather than
guessed), `tokensTraded`, `poolsTraded`, `transactions`, `transfers` (from Bitquery, when the key
is set), and what HEY saw: `launches` recorded, `projectsPublished`, `ships`, `buildersShipping`,
and `buildersVerified` (2026-09-26: published projects HEY recorded as Verified Builders that day —
knowledge time; absent on days rolled up before it was counted).
`today` names the partial day in progress and `lastFullDay` the last complete one.

## `GET /api/contracts/{chainId}/{address}` (2026-09-26)

One contract as a research entity, from HEY's own tables. The chain is in the path, digits only;
the address is matched case-insensitively; a contract HEY holds no record of is `404`, and a
contract of a project HEY has not published answers with `associatedProject: null` and nothing
about that project.

| Field | What it says |
|---|---|
| `associatedProject`, `role`, `token`, `watched` | the published project that knows this contract and how — `token`, `declared` (a contract the project names) or `followup` (deployed later by the account that launched the token). `watched` is true for a token and a declared contract; a follow-up is watched from 2026-09-27 once its launcher has been measured as not creating contracts for many projects (fewer than 100 in 90 days) and HEY's proxy watch has read it, and is `false` until then. `null` when no published project claims it, or when more than one shares the strongest link (a follow-up two projects' deployer put up): HEY then names none rather than pick one. In `/api/projects/{slug}/contracts` a follow-up names the listing project and cites its own ship |
| `creation` | `tx`, `at`, `block`, `precision: "EXACT"`, and an `evidenceId` for a follow-up |
| `deployer` | the token's deployer — the only account this object ever names — with `sharedAcrossTrackedProjects` (HEY's stored shared-deployer flag, set once the account launched three tracked projects' tokens; the same flag `/market` publishes as `deployerShared`) and `otherProjectsCount` (a plain count of the other *published* projects this account launched, which may be above zero while the flag is false, and zero while it is true: the flag counts every tracked launch, and HEY never counts or names an unpublished record here — clarified 2026-09-28, meaning unchanged) |
| `factory` | the factory that created the token, when one did |
| `verifiedSource` | `state`, `verified`, `compiler`, `contractName`, `readFrom` (a proxy's implementation), `checkedAt`. Since 2026-09-27: `method` — how the explorer came to hold the source (`SOURCE_PUBLISHED` for this address, `BYTECODE_MATCH` to source published for another contract's identical bytecode, `SOURCIFY`, `VERIFIER_ALLIANCE`; absent until HEY has read the explorer's contract record, which is unknown and never "published"), `match` (`FULL` or `PARTIAL`), `verifiedAt`; `authorship` — `{ kind, reason }` by one rule: `TEMPLATE` (a launchpad template name, a name verified on five or more projects, or an immutable clone), `EXPLORER_MATCHED`, `PROJECT_AUTHORED` or `UNCONFIRMED` (present only when some verifier holds source; a fact about the code, never a score); and `sourcify` — `{ state, status?, match?, creationMatch?, runtimeMatch?, checkedAt? }`, Sourcify's independent answer (`MATCH` or `NOT_FOUND`), read only for watched contracts the explorer calls unverified and proxies: `NOT_READ` is never "not verified" |
| `proxy` | `state`, `status`, `kind` (`EIP1967`, `BEACON`, `EXPLORER_REPORTED`, `NONE_DETECTED`), `implementation`, `beacon`, `checkedAt`, `changedAt`, `clonedFrom` (2026-09-27: the contract an immutable minimal clone, EIP-1167, copies, as the explorer reports it — its code is that contract's and cannot change), and `history[]` — each change with an `id` (`impl:<chainId>:<address>:<block>:<logIndex>` for a chain log), `occurredAt` and `precision: "EXACT"` for a log, or `occurredAt: null` and `precision: "OBSERVED"` for a change HEY saw between two reads (`source: "hey_reads"`) |
| `interface` | `state`, `functionCount`, `eventCount`, `baselineSince` and `changes[]` (ids and counts) |
| `activity` | over the last seven days: `daysMeasured`, `calls7d` (null when no reading counted calls), `events7d` (null when any day was the decoding source's blind spot) |
| `activity.methods` (2026-09-27) | calls per method over the last seven complete UTC days HEY read (`source: "decoded_calls"`): `window` (`from`, `to`, `days`), `collectedFrom`/`collectedThrough` (the contiguous days HEY holds; a day outside them is unknown), `calls`, `buckets` (`erc20Standard` — the ERC-20 surface as one bucket, `named` — the contract's own named functions, named by the call decoder or, since 2026-09-27, by the contract's own verified ABI, `undecoded` — calls nothing names; a call to the contract's creation code is its deployment and is in no bucket and not in `calls`), `distinctFunctions` (named functions and undecoded selectors called, never the ERC-20 bucket) and `top[]` (the five most-called methods by `rank`, `bucket` and `calls`). Since 2026-09-27 also `namedFromAbi` (of `buckets.named`, calls the contract's own verified ABI names), `creationCalls` (calls to its creation code: the deployment, counted apart) and `undecodedWithCandidates` (undecoded selectors a signature database offers a candidate for — a count of guesses, never a name; the candidates stay in the Terminal, labelled as candidates). Each is absent rather than zero when there is none. `names: "WITHHELD"`: function names stay in the Terminal. `state: "NOT_READ"` carries no counts at all — never zero. Counts only: no caller is read or stored |
| `freshness`, `evidence` | when each part was read; the typed ids the object is built from |

Every section carries `state`: `MEASURED`, `NOT_READ` (HEY knows the contract but has not read it
that way — never "no"), `ERROR` or `NO_SOURCE`. Function and event **names** are not published
here: counts are. No partnership, no score, no verdict.

## `GET /api/projects/{slug}/contracts` (2026-09-26)

Every contract HEY knows a published project by — the token, contracts the project names in its own
sources, and follow-ups its deployer put up — each exactly as `/api/contracts/{chainId}/{address}`
serves it. At most 100: the token and named contracts first, then follow-ups newest first; `total`
and `truncated` say how many there are. Since 2026-09-27 a follow-up is read like a token — proxy,
verified source and interface, decoded activity — once the account that deployed it has been
measured as not creating contracts for many projects; `watched` says whether HEY has read it. The
explorer's share of those reads is paced at 100 a day, so the first reading of every follow-up takes
about nine days. A follow-up from an account that creates contracts for many projects (100 or more in
90 days) is not listed here: it is context, not the project's contract (its receipt says
`contextReason: "serial_launcher_deployer"`).

## `GET /api/projects/{slug}/history?series=&from=&to=` (2026-09-26)

The points HEY persisted for a project, day by day. `series` is a comma list of `status`,
`momentum`, `discoveryGap`, `rank`, `valuation`, `price`, `liquidity`, `volume`, `pools`, `onchain`,
`tvl`, `contractChanges`, `locks` (all when absent; unknown names come back in `ignoredSeries`).
`to` defaults to today, `from` to 30 days before it; at most 400 days.

- Every point has a `basis`: `knowledge` (what HEY's scorer concluded then, with its
  `scoringVersion`), `observed` (a figure HEY read at the time, or decoded trades read within three
  days of the day) or `reconstructed_from_chain` (decoded trades read later from the archive: the
  chain's record of that day, not what HEY knew on it).
- **A day with no point was not recorded.** Nothing is interpolated and nothing is zero-filled.
  `collectedFrom` is the first day the series exists for any project, read from the table itself;
  there is nothing before it.
- `momentum` is `null` with `reason: "activity not measured"` on a day the status was `UNKNOWN`.
- `valuation` carries `kind` (`marketCap` or `fdv`) where HEY knows the supply, and follows the
  market page's withholding.
- `contractChanges` and `locks` count ledger events by the day HEY recorded them; they are
  `state: "UNAVAILABLE"` on a deployment whose change ledger is not live yet. Market Integrity has
  no history series; its events are on `/api/changes` and its route once published.
- A series that cannot apply (a project with no token) is `state: "NOT_APPLICABLE"` with a reason.

## `GET /api/projects/{slug}/diff?from=YYYY-MM-DD&to=YYYY-MM-DD` (2026-09-26)

What changed between two days, at most 400 apart. `build.status`, `build.momentum`,
`market.valuation` and `market.liquidity` are `{then, now}`, each the nearest point HEY persisted
on or before the day, with that point's own `day` and `basis` — or `value: null` with a `reason`
when there is none. `build.releasesAdded` and `build.meaningfulShips` count ships by when their
source dates them (`clock: "published"`); `changes` counts the project's public ledger events by
when HEY recorded them (`clock: "recorded"`, the same events `/api/changes` serves, with its `url`),
or is `UNAVAILABLE` where the ledger is not live or the window ends before it began recording; a
window that starts before that carries `collectedFrom` and `partial: true`. Where HEY does not
measure the project's building (no readable source and no counted building evidence),
`releasesAdded` and `meaningfulShips` are null with `countsReason`, never a zero. Two facts in one
window are two facts: nothing here says a release moved a market.

## Bulk reads (2026-09-26)

For an integration that meets many projects or tokens at once. Keyed only, `private, no-store`,
one request per item against the minute and the month, and never more than the maximum.

| Route | Max | Each item |
|---|---|---|
| `GET /api/snapshots?slugs=a,b,…` | 10 | `{input, found, data?}` — `data` is the project dossier `/api/projects/{slug}` serves |
| `GET /api/token/{chainId}?addresses=0x…,0x…` | 30 | `{input, found, data?, error?}` — `data` is exactly what `/api/token/{chainId}/{address}` answers |
| `GET /api/v1/scan?chain=4663&tokens=0x…,0x…` | 30 | the partner card `token=` answers, with `input` added; an address that is not a token identity is `{input, found: false, error}`, except the zero address, which is the card's own `found: false, reason: "not_a_token"` and is not charged (2026-09-27) |

Input order is kept, duplicates included; an item that cannot be read fails on its own
(`error.code`), never the batch. One more than the maximum is `400 batch_too_large`; an answer over
256 KB is `413 payload_too_large`. The envelope is `{items, requested, found, disclaimer}`
(`found_count` on the snake_case partner route). Which addresses belong to a published project is
one statement for the whole batch. The single-item routes are unchanged.

## `POST /mcp` — hosted MCP (2026-09-26)

The same data for an AI assistant: HEY's fourteen MCP tools over the Model Context Protocol's
Streamable HTTP transport, stateless and read-only.

```bash
claude mcp add --transport http hey-research https://heyresearch.xyz/mcp
```

Each `POST` carries one JSON-RPC message (or a batch) and is answered as JSON; there is no session
and no event stream, and `GET`/`DELETE` answer `405`. The tools read this API — on the server's own
loopback address, as the caller — so every limit, key tier, quota and hold on this page applies to
them unchanged, and they can say nothing this API does not. An `Origin` outside the allowlist is
refused, the body is capped at 64 KB, and 60 JSON-RPC calls a minute per address bound handshake
spam. Every answer tags its lines FACT, DERIVED or UNKNOWN and links the JSON route it was rendered
from. The tools, resources and prompts are in the [MCP server](MCP.md) document.

## Agent discovery (2026-09-28)

For an autonomous agent that has never heard of HEY. Everything here is built from one machine
identity (name, domain, chain, `$HEY` contract, MCP endpoint, API URLs) and makes no provider or
model call. The walk-through is `/developers/agents` (Markdown at `/developers/agents.md`).

| Route | What it is |
| --- | --- |
| `GET /llms.txt` | llmstxt.org v2: what HEY is, what it will not do, every machine entry point, how to research one project. Pages point at it with `Link: </llms.txt>; rel="describedby"`. |
| `GET /.well-known/agent-card.json` | The A2A 1.0 Agent Card: one JSON-RPC interface, no auth, no streaming, no push, six skills. ETag and `cache-control: public, max-age=3600`; a matching `If-None-Match` answers 304. Not signed. |
| `POST /api/a2a` | The A2A JSON-RPC interface. Send `A2A-Version: 1.0` (an empty header means 0.3 and answers `-32009`). `SendMessage` runs one skill and answers with a Message (no task is stored): a text part with a one-line summary, a data part with this API's JSON for the same question, and `metadata.evidenceIds`. `GetTask`/`CancelTask` answer `-32001`, streaming and push `-32004`/`-32003`. 60 messages a minute per client, 32 KB per body. |
| `GET /openapi.json` | The OpenAPI 3.1 description of this API, the semantic traps in its descriptions. |
| `GET /api/hey/profile` | `$HEY` as research data (below). |
| `POST /api/receipts/validate` | Checks an AgentResearchReceipt (below). |
| `GET /schemas/agent-research-receipt.v1.json` | The receipt's JSON Schema (draft 2020-12). |

A2A skills, each one read this API already serves: `research_project` (the snapshot),
`compare_projects` (`/api/compare`), `what_changed` (`/api/changes`), `explain_fact` (`/explain`),
`check_project_coverage` (`/coverage`), `investigate_contract` (`/api/contracts/{chainId}/{address}`).
Ask with a data part `{"skill":"research_project","project":"<slug>"}` or a text part
`research_project <slug>`; nothing reads free text beyond that. Add `"contract":
"agent-intelligence-v1"` to a data part (2026-09-30, additive) and the skill answers with the
agent contract below instead — `research_project` → research_project, `what_changed` →
what_changed (`project?`, `days`, `types?`, `limit`), `explain_fact` → builder_status,
`investigate_contract` → verify_project (`project?`), `compare_projects` → compare_builders,
`check_project_coverage` → unknowns — with a text part of HEY's answer sentence only and
`metadata.contract`, `capability` and `evidenceIds`. Since 2026-09-30 the research skill's text part
names the project by its slug, not by the name a source gave it.

```bash
curl -s https://heyresearch.xyz/api/a2a -H 'content-type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"data":{"skill":"what_changed","limit":5}}]}}}'
```

### `GET /api/hey/profile`

`$HEY` researched like any other token (`schema: "hey.token-profile/v1"`):

- `subject` — ticker, chain, contract (null before launch, with `contractReason`), explorer link;
- `project` — HEY's own project and its snapshot URL, `sameRulesAsEveryProject: true`;
- `supply` — total supply HEY read from the chain, with `observedAt`, or null with a reason;
- `launch` — Pons version and factory from configuration, HEY's curve reading, and when HEY first
  recorded the token (knowledge time, not launch time);
- `market` — the snapshot's market block unchanged (valuation `kind` `marketCap` or `fdv`, provider,
  `observedAt`), with the market source's freshness state (`fresh`, `stale`, `unknown`); context only;
- `locks`, `builderEvidence`, `recentChanges`, `coverage` — the snapshot's own blocks;
- `treasury` — the configured address, balances read from the chain with block and time, the
  creator tax, and the documented policy: thirds allocation, **no buyback**, a monthly ledger;
- `holderTiers` — the console's tier table (thresholds in whole HEY, API allowance, discount, early
  access); a tier is never an input to ranking;
- `utility` — every documented use, each `LIVE`, `PLANNED`, `RETIRED` or `UNKNOWN` with a
  `statusReason`, the gate that decides it (`decidedBy`), an effective date only when HEY holds one
  as data, and a doc link. The status is computed from the same gates the product opens on
  (`isBountiesOpen`, `isApiKeysOpen`, the console settings …); a setting HEY could not read is
  `UNKNOWN`, never a default;
- `risksAndUnknowns` — what HEY does not know or holds only partly: a withheld or FDV valuation, a
  stale reading, every coverage gap, an unread supply or treasury.

Reads HEY's tables and configuration only. It is research data, not investment advice, and it
never says staking, deflationary or buyback as something `$HEY` does.

### `POST /api/receipts/validate`

Stateless and read-only: the body is an [AgentResearchReceipt](AGENT_RESEARCH_RECEIPTS.md), at
most 64 KB. The answer lists shape errors with their paths, the subject project's status, and each
cited HEY reference as `exists`, `revised` (a change event HEY has revised since the cited
revision), `project_exists` (a snapshot: the project is published; its `asOf` is not verified and
its `scoringVersion` is `matches_current`, `differs_from_current` or `not_given`), `withdrawn`,
`moved`, `not_found`, `invalid_id` or `not_checked` (at most 25 HEY ids are checked). A
`hey_agent_answer` reference (2026-09-30, additive) — the `citation` an agent-contract answer
carries — is checked for its capability, that its URL is that capability on HEY's own origin (else
`invalid_id`, `not_a_hey_agent_answer_url`), its project and its scoring version; HEY stores no
answers, so what it said at `asOf` is not verified (`answer_not_stored`).
`heyEvidenceStands` is `true` only when every HEY reference was checked and stands, `false` when a
checked one does not, `"partial"` when some were not checked, and `null` (`nothing_checked`) when
none was. Nothing is stored and nothing the receipt names is fetched; the answer carries
`stored: false` and `endorsement: false`. 30 checks a minute per client.

## The agent contract: `GET /api/agent/{capability}` (2026-09-30)

Six bounded questions an agent can ask about Robinhood Chain projects, each answered in one shape,
**AgentIntelligenceResponse v1** (`schema: "hey.agent-intelligence-response"`,
`schemaVersion: "1"`). It is not a new measurement: each capability restates the canonical reads
above (the snapshot and its Research Summary, the explain engine, the change ledger, coverage and
its gap list, peers, the token and contract reads) through pure composers in
`packages/agent-provider-core`. The same JSON is the MCP tool `research_answer` and the A2A skills'
`"contract": "agent-intelligence-v1"` option. `GET /api/agent` describes the contract itself.

| Capability | Question | Parameters |
| --- | --- | --- |
| `research_project` | What is HEY's current research view of this project? | `project` |
| `what_changed` | What changed with this project, or on Robinhood Chain, in the last N days? | `project?`, `days` 1–30 (default 7), `types?` (comma-separated change types), `limit` 1–50 (default 25) |
| `builder_status` | Is this project still building, and why does HEY say so? | `project` |
| `verify_project` | Does this contract or token appear to belong to this project? | `address`, `project?` |
| `compare_builders` | How do these projects' building records compare over 30 days? | `projects` (2–4, comma-separated) |
| `unknowns` | What does HEY not know about this project or token? | `project` or `address` |

Every answer carries:

- `answer` and `answerStatus` — the one-sentence answer first, tagged;
- `claims[]` — each `FACT` (recorded, with its source), `DERIVED` (a rule HEY applied) or
  `UNKNOWN` (not held, with a `reason`), with `value`, `source` and its type (`hey_rule`,
  `hey_record`, `builder_source`, `chain`, `market_provider`, `registry`, `project_site`),
  `observedAt` (when HEY read it), `occurredAt` (when the source dates it) at its `precision`
  (`EXACT`, `DATE`, `WEEK`, `WINDOW`, `OBSERVED`, `SCHEDULED`), `freshness`, typed evidence ids
  with receipt URLs, an `explainUrl` and `contextOnly: true` on market and usage context; and
  (round 4, additive) `evidenceKind`, what the claim rests on — `evidence_record`,
  `rule_output`, `ledger_count`, `coverage_state`, `market_reading`, `usage_reading`,
  `registry_record`, `canonical_read` or `not_held`. A typed id is cited only where a canonical
  record exists (for a rule's output, the ids the explain engine cites); a claim with none says
  here what it is, never with an invented id;
- `disclosures[]` (round 4, additive, present only when one applies) — `hey_own_token`, "HEY's
  own token — researched by the same rules", when HEY's own project or token is in the answer. It
  changes no figure, order or tag;
- `unknowns[]` — each `UNKNOWN`, `NOT_MEASURED`, `NOT_VERIFIED`, `STALE` or
  `INSUFFICIENT_EVIDENCE`, with the dimension, a reason code, what HEY lacks and `doNotConclude`:
  what an agent must not infer from the gap. A gap is never negative evidence;
- `freshness[]` — per data family (`builder_sources`, `activity_score`, `change_ledger`, `market`,
  `contracts`, `locks`, `usage`, `peers`, `protocol_economics`): `observedAt`, `dataAsOf`,
  `freshnessStatus` (`live` ≤15 min, `recent` ≤6 h, `daily` ≤36 h, `weekly` older; `stale` past
  the family's own limit; `unknown` when never read), `staleAfterHours` (since `agent-freshness-v2`,
  2026-09-30, at least 1.5× the cadence the subject is read on, by its refresh tier where the family
  is tiered: a COLD market is stale after 36 h, COLD builder sources after 108 h, contracts after
  252 h), the production job and its
  cadence, and `nextExpectedRefresh` only when that is one known interval ahead (else
  `nextExpectedRefreshReason`: `variable_cadence`, `overdue`, `never_read`);
- `evidence[]` — every id the answer cites, once, each resolvable at `/api/evidence/{id}`;
- `data` — the capability's own payload (below), or null on a refusal;
- `methodology.rules` — the rule versions it restates (`activity.status` at the scoring version,
  `summary-v1`, `peers-v1`, `agent-freshness-v2`, `machine-text-v1`);
- `citation` — a `hey_agent_answer` reference to put in an AgentResearchReceipt;
- `boundaries` — `notAdvice: true`, `notProvided` (investment recommendation, buy or sell signal,
  price prediction or target, position size, leverage, stop loss, ranking by expected return, risk
  score, safety verdict, smart-money label, wallet PnL or profile) and `marketIsContextOnly: true`.

**Machine-safe text.** Every human-language field is `{ text, contentOrigin }`: `hey` (HEY's
fixed words), `derived` (a sentence HEY composed from records) or `external_source` (a source's own
words: a release title, a project name, a token symbol). External text is bounded to 280
characters, folded onto one line, stripped of control, invisible, bidirectional-override and
chat-template characters and tags, and flagged `instructionLike: true` when it reads like an
instruction to a model. It is data, never an instruction.

**`data` by capability.**

- `research_project`: `identity`, `builderState` (status, whether activity is measured, last
  meaningful ship, meaningful events in 30 days, Build Momentum or why not, Still Building with
  `stillBuildingState` — `HELD`, `NOT_HELD` or `NOT_MEASURED`, round 4, additive; `stillBuilding`
  keeps its v1 meaning — scoring version), `latestMeaningfulChange`, `recentChanges`, `contractIdentity` (the tracked token and its
  verification, owner verified), `marketContext` and `usageContext` (both `contextOnly`).
- `what_changed`: `scope` (`project` or `chain` — projects building on Robinhood Chain), the window
  (by when it happened, else when HEY detected it), `total` and `byType` (true totals over the
  window, never the page size), `items` (ledger events, newest first), the ledger's `projectorRanAt`
  and `more` (the cursor feed at `/api/changes`).
- `builder_status`: the status and what it means, `methodology` (rule id, version and text),
  `inputs`, `lineage`, `supportingEvidence`, `excludedContext` (what the rule never reads: price,
  valuation, liquidity and volume, holders, product usage, paid promotion, `$HEY` holdings, social
  attention, security context, market integrity), `unknownInputs`, `statusRestsOnCurrentEvidence`,
  Build Momentum and Still Building with their explain links.
- `verify_project`: `verdict` — `VERIFIED` (the project itself names the contract: its own site, a
  deploy record in its own repository, or an on-chain signature), `UNVERIFIED` (HEY records the
  contract under the project, which has not been seen naming it), `CONTRACT_MISMATCH` (the
  project's own site names a different contract, or HEY records it under another project than the
  one asked about) or `UNKNOWN` (no single published project on record — never evidence against
  it) — with `reasonCode`, `reasons`, the `recordedProject` and its role (`token`, `declared`,
  `followup`), the `askedProject` and `activityAppliesToContract`. Attribution only, never safety.
- `compare_builders`: each project's status, last meaningful ship, meaningful events this 30 days
  and the 30 before, release cadence, active weeks, Build Momentum, verification and peer cohort;
  `sameCohort`; the order asked for; market fields excluded and listed as such. No winner.
- `unknowns`: `counts` by category, and the coverage dimensions `measured`, `notApplicable` and
  `withheld`.

**Errors.** A refusal is the same envelope with `status` (`not_found`, `invalid_request`,
`unavailable`) and `error` — HTTP 404, 400, 404. A renamed project answers 308 to the same
capability for its current slug. An unknown capability is a plain 404. Keyless, on `api.public`.

```bash
curl -s "https://heyresearch.xyz/api/agent/unknowns?project=agentos"
curl -s "https://heyresearch.xyz/api/agent/verify_project?address=0x…&project=agentos"
curl -s "https://heyresearch.xyz/api/agent/what_changed?days=1&types=build.release,build.ship"
```

The Robinhood Agent Apps adapter in `packages/agent-provider-core` is an interface only: *Adapter
pending official Robinhood Agent Apps provider specification.* No route serves it, and HEY is not an
official Robinhood Agent App.

## Feeds

The same material is also published as RSS, for a reader rather than a script:

```
/feed/ships.xml       every ship, in the order HEY recorded it (guid = ledger id, e.g. ship:<uuid>)
/feed/this-week.xml   the weekly rollup
/api/this-week        the weekly rollup as JSON
/api/status           HEY's own freshness and health
```

`/api/status`, additively (2026-10-03): a failing integrity audit makes `verdict` `critical`, and
`integrity.failing` lists the failing checks as `{ check, label }` (the check id and its plain
words). `catalog.indexed` keeps its meaning — the hidden launch records, approved rows HEY has not
published — and is not the catalogue's "indexed" (every approved row); `catalog.hidden` carries the
same figure under the catalogue's word, and `catalog.hiddenAsOf` is when the hourly summary counted
it. `catalog.asOf` dates only `published`, `verifiedBuilders` and `verifiedBuildersOnChain`.

## Implementation

Paths under `apps/web/` and `packages/domain/` are in HEY's **private** repository and are
named here so a reader of that repository can find them; they are not part of the public export
(2026-09-19). `packages/sdk`, `packages/sources`, `packages/scoring`, `packages/config`,
`packages/ui`, `packages/mcp-core` and `apps/mcp` are public.

- Routes: `apps/web/src/app/api/projects/`, `apps/web/src/app/api/ships/`
- Serialisers: `apps/web/src/lib/public-api-view.ts` (pure, unit-tested)
- Query vocabulary: `apps/web/src/lib/public-api-query.ts` (pure, unit-tested)
- Shared response rules and the error envelope: `apps/web/src/lib/public-api.ts`
- Contracts, history, diff and bulk (2026-09-26): `apps/web/src/lib/public-api-{contracts,history,bulk,market-extras}.ts`;
  the reads in `packages/domain/src/{contracts/read.ts, contracts/registry.ts, history/, diff/, tokens/lifecycle.ts}`
- Contract tests: `apps/web/e2e/public-api.spec.ts`
- The SDK: `packages/sdk` (published as `@hey-research-lab/sdk` once the npm organisation exists);
  the type-level contract between its response types and the serialisers:
  `apps/web/src/lib/public-api-contract.{projects,feeds,misc,changes,snapshot,contracts}.test.ts`
  (2026-09-19; split by family 2026-09-26)
- The hosted MCP (2026-09-26): `apps/web/src/app/mcp/route.ts` and `apps/web/src/lib/mcp-hosted.ts`
  over `packages/mcp-core`; `apps/web/src/lib/mcp-tool-schema.test.ts` holds the tool schemas to the
  parameters the parsers read

Every route here reads HEY's own database and makes no third-party call — with one deliberate
exception, `POST /api/scan`, which exists to
read an address HEY has never seen and says so in its own section above. Every filter goes
through the same query layer the pages use, so a count returned here and a count shown on a
page cannot disagree.
