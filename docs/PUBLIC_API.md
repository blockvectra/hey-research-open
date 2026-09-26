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
| 403 | `forbidden` | no | the key or account is held; `reason` says which |
| 404 | `not_found` | no | no published record, or no such route |
| 413 | `payload_too_large` | no | a bulk answer would exceed 256 KB; ask for fewer |
| 429 | `rate_limited` | yes | the per-minute bucket is spent; `retryAfterSeconds` and `retry-after` say when |
| 429 | `quota` | yes | the monthly allowance is spent (or a bulk request would cross it) |
| 500 | `internal_error` | yes | HEY failed; quote the `requestId` |

Every answer, success or error, is readable cross-origin and exposes `retry-after`,
`x-request-id`, `x-hey-tier` and `x-hey-monthly-remaining` to a browser caller. The 500 and the
404 for an unknown path carry the same headers (they used to carry none). Before 2026-09-26 a few
routes put a sentence in `error` (the per-minute 429, `compare`, `ask`); that sentence is now the
`message`, and `error` is the code.

### Versioning

`/api/*` has no version and changes **additively**: a field is added, never renamed, removed or
given a new meaning. There is no version header. A change that would alter an existing field's
meaning would ship under a new path with at least 90 days of overlap and a migration note.
`/api/v1/*` is the partner namespace (snake_case cards built for one integration each), not an API
version; its field meanings are frozen the same way.

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
- **It cannot drift from the API.** The `apps/web/src/lib/public-api-contract.*.test.ts` files
  (private repository, one per family since 2026-09-26) assert, at
  the type level and in both directions, that every response type the SDK exports is identical
  to the serialiser that produces it; `pnpm typecheck` fails on a field added to one side only.
- **The user-agent says who is calling.** Every request carries `hey-research-sdk/<version>`,
  which is how the lab's console counts SDK callers apart from the MCP and from `curl`.

- **Every route has a method** (2026-09-26): `projects.snapshot`, `coverage`, `explain`,
  `history`, `diff` and `contracts`; `evidence.get`; `contracts.get`; the keyed bulk reads
  `snapshots.bulk`, `token.bulk` and `scanCards`; the partner `builderCard`; and
  `search.suggest`. The full table is in `packages/sdk/README.md`.

The MCP server (`@hey-research/mcp`, hosted at `/mcp` since 2026-09-26) is this client with tool
definitions around it; see `docs/MCP.md`. Releases of both come from the private repository,
tagged `sdk-v*` / `mcp-v*`.

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
observations, never a verdict on the team.

Every listed project with a token also carries `tokenMarket` (2026-09-25): `{ status, reason? }`,
the same state the card shows. It is why a listing sometimes has no `marketCap` — a dead market's
valuation (`NO_LIQUIDITY`, `LIQUIDITY_REMOVED`, `MARKET_ABANDONED`, or an untraded launch pool) is
withheld. The dossier's `tokenMarket` is the same object with more in it.

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
contract — print the activity as the project's, never as this token's.

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
`last_ship`), `token_verification` (`VERIFIED`, `UNVERIFIED` or `MISMATCH`, 2026-09-25: on
`MISMATCH` the project's own site names another contract, so do not print the activity as this
token's), `project_url`, `logo_url`, `badge_url`, a `cta` that points at the project page, and
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

**The zero address on `/api/v1/scan`** (and the other well-formed non-identities) still answers
`400`, and no longer spends anything: no monthly allowance, no rate bucket, no demand record.

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
unpublished), `latestChanges`, `freshness`, `coverage`, `evidenceSummary`, `links` to every detailed
endpoint, `asOf` and `scoringVersion`.

`latestChanges` is `{ available: true, items }` from the change ledger, or `{ available: false,
reason }` when the ledger cannot answer: never an empty list standing in for "unknown".

### `GET /api/projects/{slug}/coverage`

What HEY knows about a project, dimension by dimension, as states and never a score:
`identity`, `builderEvidence`, `repositories`, `releases`, `marketCurrent`, `marketHistory`,
`contractDeployment`, `contractActivity`, `contractSource`, `contractInterface`, `distribution`,
`locks`, `marketIntegrity`, `timeline`. Each is `{ state, since?, asOf?, reason?, detailUrl? }`.

| State | Meaning |
|---|---|
| `MEASURED` | HEY read it; figures elsewhere are measurements, zeros included |
| `NO_SOURCE` | HEY holds nothing to read it from; a zero or an absence is not a finding |
| `NOT_ENOUGH_YET` | HEY has not read enough of it yet |
| `STALE` | read, and older than its freshness limit |
| `SOURCE_UNAVAILABLE` | the source HEY holds no longer answers |
| `NOT_APPLICABLE` | it does not apply (no token) |
| `NOT_RESEARCHED` | HEY indexed the record and did not research it |
| `ERROR` | HEY's last read failed; earlier figures stand |
| `WITHHELD` | measured, and deliberately not published here (Market Integrity; an implausible market) |

`locks` reads HoodLock only: `hoodlock_only_none_found` is a reading of HoodLock, not of every
locker. `freshness[]` gives each source's last read and its limit. The answer also carries the
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
toward activity and why not), `market_integrity.state` (withheld while unpublished). Without
`fact` the route lists them. An unknown fact is `400 unknown_fact`; `source.counted` without a
source is `400 source_required`.

### `GET /api/evidence/{id}`

One published record by its typed id, the same ids the change feed and the timeline use:
`ship:<uuid>`, `signal:<uuid>`, `abi:<uuid>`, `lock:<chainId>:<lockId>`, `source:<uuid>`,
`claim:<uuid>`, `state:<projectUuid>:<key>:<transitionId>`, `impl:<chainId>:<address>:<block>:<logIndex>`
(an upgrade log), `impl:<chainId>:<address>:rpc:<uuid>` (an implementation change HEY saw between
two reads of the proxy, with no block to name), `narrative:<projectUuid>:<slug>` (a narrative HEY
assigned; `sourceType` says who set it: `project`, `hey_moderator` or `hey_rules`).

A receipt carries `project`, `domain`, `claimType`, `summary`, `sourceType`, `sourceUrl`,
`publishedAt` (null when only HEY's observation dates it), `detectedAt`, `precision`,
`verification`, `countsAsBuilding` (present and true only when it counts toward activity),
`recordedAt` and `metadata`; a ship also lists every evidence row behind it (`sources[]`, each
with its `evidenceRowId`).

A record HEY no longer stands behind answers `{ id, withdrawn: true, withdrawalReason }`
(`retracted`, `disputed`, `context_only`, `review_false_positive`, `announced_ship_withdrawn`,
`superseded`), with `project` when the project is public. For a project that is not public the
reason is `not_public` and nothing else is said, not even the slug. A claim that was never
verified, a reviewer's note, a reviewer and a claimant are never published. A malformed id is
`400 invalid_evidence_id`; an unknown one `404`. `integrity:` ids are not public while Market
Integrity is unpublished; `state:` and `impl:` ids resolve once the transition ledger and the
implementation history exist.

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
  `launch_pool_volume_unknown`, `pool_readings_disagree` or `readings_implausible` whatever the
  status beside it. For those HEY sends no valuation. `readings_implausible` (2026-09-25)
  means the reading claims a large pool that almost nothing traded in and that HEY's own chain
  index does not find; its liquidity and highest liquidity are withheld too, here, in the list and
  detail endpoints, and from `sort=liquidity`, `minLiquidity` and the market-cap filters.
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
| `after` / `before` | a cursor this API issued | anything else is **400 `invalid_cursor`** |
| `limit` | 1–100, default 50 | |

An unknown filter value is dropped and the `query` echo leaves it out, like every listing.

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
| `build.release`, `build.ship`, `build.code_activity` | a ship (releases; other building types; a weekly code summary) | the publication, EXACT/DATE/WEEK |
| `contract.deployed`, `contract.followup_deployed` | a deploy ship (the launch record; a later contract from the project's deployer) | the block time |
| `contract.implementation_changed` | the implementation history: an upgrade log (id `impl:<chainId>:<address>:<block>:<logIndex>`), or a change HEY saw between two reads (`impl:<chainId>:<address>:rpc:<uuid>`, with the upgrade ship as evidence, never a second event). An old log indexed late is `origin: "backfill"` | the block time, EXACT (log); null, OBSERVED (two reads) |
| `contract.source_verified`, `contract.source_unverified`, `contract.interface_changed` | an explorer ABI diff (counts only; the names stay in the Terminal) | null, OBSERVED |
| `build.status_changed`, `build.dormant`, `build.resumed` | an activity-status move | null, OBSERVED |
| `build.accelerating`, `build.slowing` | the development-window signals | the window's end, WINDOW |
| `market.status_changed` | a token-market-status move | null, OBSERVED |
| `market.liquidity_moved`, `market.volume_spike`, `market.distribution_changed`, `contract.usage_changed` | the market and usage signals (counts only, never an address) | WINDOW |
| `token.launch_stage_changed`, `token.verification_changed` | a launch-stage or token-verification move | null, OBSERVED |
| `research.published`, `research.builder_verified` | a project page published; a builder verified | null, OBSERVED |
| `research.owner_verified` | a verified ownership claim (how, never who) | the verification, EXACT |
| `research.source_added` | an official source registered after the project's first day | null, OBSERVED |
| `research.source_unavailable`, `research.source_restored` | a source that stopped answering, and came back (restores recorded from 2026-09-26) | null, OBSERVED |
| `research.narrative_assigned` | a narrative assigned | the assignment, EXACT |
| `lock.unlock_due` | a HoodLock unlock entering its last seven days | the unlock, SCHEDULED |
| `lock.observed`, `lock.withdrawn` | the first sweep that read a HoodLock lock, and the first that read it withdrawn (forward-only from migration 0138; locks already there when collection began say nothing) | null, OBSERVED (the locker gives no times; `detectedAt` is HEY's) |

**What the ledger cannot tell you.** State moves (status, market status, launch stage,
verification, publication) are recorded from the deploy of migration 0136 (`ledger.transitionsFrom`);
before it only the moves a HEY Signal announced exist, as `signal:` events. A bookkeeping move —
an `UNKNOWN` side, or a move in the same run as a scoring-version change — is recorded and never
announced. Market Integrity events are Terminal-only and never appear here.

`ledger` on every page: `collectionStart` (the first event recorded), `transitionsFrom`,
`newestRecordedAt`, `projectorRanAt`. `/api/status` reports the projector stale after 15 minutes.

## Webhooks: `/api/webhooks` (2026-09-26)

HEY can POST the change ledger's public events to an endpoint an API account registers: the same
event `/api/changes` serves, signed with HMAC-SHA256 over `<timestamp>.<raw body>`. Keyed only;
answers are `private, no-store`. The full contract — event types, payload, signature, retries,
the SSRF rules a callback URL must pass, and TypeScript/curl examples — is in
[`docs/WEBHOOKS.md`](WEBHOOKS.md).

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
no fresher than polling (see `docs/WEBHOOKS.md`).

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
volume take no part. Ranks are recomputed daily and kept.

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
| `associatedProject`, `role`, `token`, `watched` | the published project that knows this contract and how — `token`, `declared` (a contract the project names) or `followup` (deployed later by the account that launched the token; listed, **not yet watched**). `null` when no published project claims it, or when more than one shares the strongest link (a follow-up two projects' deployer put up): HEY then names none rather than pick one. In `/api/projects/{slug}/contracts` a follow-up names the listing project and cites its own ship |
| `creation` | `tx`, `at`, `block`, `precision: "EXACT"`, and an `evidenceId` for a follow-up |
| `deployer` | the token's deployer — the only account this object ever names — with `sharedAcrossTrackedProjects` (HEY's stored shared-deployer flag, set once the account launched three tracked projects' tokens; the same flag `/market` publishes as `deployerShared`) and `otherProjectsCount` (a plain count, which may be above zero while the flag is false) |
| `factory` | the factory that created the token, when one did |
| `verifiedSource` | `state`, `verified`, `compiler`, `contractName`, `readFrom` (a proxy's implementation), `checkedAt` |
| `proxy` | `state`, `status`, `kind` (`EIP1967`, `BEACON`, `EXPLORER_REPORTED`, `NONE_DETECTED`), `implementation`, `beacon`, `checkedAt`, `changedAt`, and `history[]` — each change with an `id` (`impl:<chainId>:<address>:<block>:<logIndex>` for a chain log), `occurredAt` and `precision: "EXACT"` for a log, or `occurredAt: null` and `precision: "OBSERVED"` for a change HEY saw between two reads (`source: "hey_reads"`) |
| `interface` | `state`, `functionCount`, `eventCount`, `baselineSince` and `changes[]` (ids and counts) |
| `activity` | over the last seven days: `daysMeasured`, `calls7d` (null when no reading counted calls), `events7d` (null when any day was the decoding source's blind spot) |
| `freshness`, `evidence` | when each part was read; the typed ids the object is built from |

Every section carries `state`: `MEASURED`, `NOT_READ` (HEY knows the contract but has not read it
that way — never "no"), `ERROR` or `NO_SOURCE`. Function and event **names** are not published
here: counts are. No partnership, no score, no verdict.

## `GET /api/projects/{slug}/contracts` (2026-09-26)

Every contract HEY knows a published project by — the token, contracts the project names in its own
sources, and follow-ups its deployer put up — each exactly as `/api/contracts/{chainId}/{address}`
serves it. At most 100: the token and named contracts first, then follow-ups newest first; `total`
and `truncated` say how many there are. Follow-ups are listed with `watched: false`: HEY does not
read their proxy, source or activity yet.

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
  `state: "UNAVAILABLE"` on a deployment whose change ledger is not live yet. Market Integrity is
  never in this answer while it is flag-gated.
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
| `GET /api/v1/scan?chain=4663&tokens=0x…,0x…` | 30 | the partner card `token=` answers, with `input` added; an address that is not a token identity is `{input, found: false, error}` |

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
from. The tools, resources and prompts are in `docs/MCP.md`.

## Feeds

The same material is also published as RSS, for a reader rather than a script:

```
/feed/ships.xml       every ship, in the order HEY recorded it (guid = ledger id, e.g. ship:<uuid>)
/feed/this-week.xml   the weekly rollup
/api/this-week        the weekly rollup as JSON
/api/status           HEY's own freshness and health
```

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
- The SDK: `packages/sdk` (published as `@hey-research/sdk` once the npm organisation exists);
  the type-level contract between its response types and the serialisers:
  `apps/web/src/lib/public-api-contract.{projects,feeds,misc,changes,snapshot,contracts}.test.ts`
  (2026-09-19; split by family 2026-09-26)
- The hosted MCP (2026-09-26): `apps/web/src/app/mcp/route.ts` and `apps/web/src/lib/mcp-hosted.ts`
  over `packages/mcp-core`; `apps/web/src/lib/mcp-tool-schema.test.ts` holds the tool schemas to the
  parameters the parsers read

Every route here reads HEY's own database and makes no third-party call (CLAUDE.md
architecture rules 13–14) — with one deliberate exception, `POST /api/scan`, which exists to
read an address HEY has never seen and says so in its own section above. Every filter goes
through the same query layer the pages use, so a count returned here and a count shown on a
page cannot disagree.
