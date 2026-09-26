# Data sources

Every third-party call in HEY goes through a `SourceAdapter` in `packages/sources`.
Adapters are the only place the product talks to an external provider, they are never
called from a page render path, and each one ships with saved fixtures so CI never
depends on a live API.

> **Where this name does and does not appear.** The product does not name its data suppliers: a
> reading on a page reads "From on-chain trades", and the public API publishes `onchain`, because
> what a reader needs is that the figure came from trades on the chain rather than from an
> aggregator's index. This document is the other half of that, and deliberately so — it exists to
> say exactly what HEY reads, what each source costs and what it refuses, and a source quietly
> missing from it would make the whole file worth less than nothing. Founder's decision,
> 2026-09-15; the split is intentional, not an oversight in either direction.


> **2026-09-22 — the archive is bought and was never asked.** The founder
> purchased the Robinhood Historical Trading Data add-on. Probed live for a
> window in early August: `dataset: realtime` returned nothing, `archive` and
> `combined` both returned real trades. Every Bitquery document in the codebase
> had been pinned to `realtime` since the 403 of 2026-09-12, and two adapter
> tests asserted it, so the add-on went unread. The queries now take a dataset,
> defaulting to `combined`; `data:trade-days-backfill` walks history with
> `archive`.

## Adapters

| Adapter | Purpose | Cache TTL | Notes |
| --- | --- | --- | --- |
| `dexscreener` | Primary market context | 5 min | Deepest-liquidity pair wins; figures are never merged across pairs |
| `geckoterminal` | Fallback market context | 5 min | Same normalized shape as DEX Screener |
| `blockscout` | Contract metadata, verification, deployment evidence | 1 h | Holder endpoints are deliberately not implemented |
| `rpc-contract` | `eth_getCode` existence check | 1 h | Lightweight verification only; HEY runs no node |
| `github-repo` | Repository activity window | 30 min | Stars are display context, never a score input |
| `github-releases` | Releases → `GITHUB_RELEASE` ShipEvents (M4) | 30 min | Drafts excluded; stable `externalId` for dedupe; budget 6,000 req/day |
| `github-commits` | Human commits in the window → one capped `CODE_ACTIVITY` ShipEvent per repository per ISO week | 30 min | Bots, dependency bumps and merge churn excluded; budget 6,000 req/day |
| `website` | Page metadata + feed discovery | 6 h | SSRF guarded, 2 MB cap, HTML content-type only, socket pinned to the checked address; `DISCOVER_SITE_FEEDS` sweeps registered WEBSITE and DOCS sources, ten a tick |
| `feed` | RSS/Atom/changelog entries | 2 h | Max 50 entries; summaries tag-stripped |
| `sourcify` | Verified contract source | 24 h | Optional — a miss is `missing`, never an error |
| `coingecko-markets` | Price, market cap, FDV, volume for up to 250 CoinGecko ids per call | 1 h | Matched to tokens by `(chain, address)` from the registry; a `0` figure is absent; source `coingecko` |
| `virtuals-market` | The launchpad's curve/pool valuation for a batch of 25 agents, in VIRTUAL | 1 h | Holder fields never leave the payload; converted with a same-run CoinGecko rate; source `virtuals` |
| `bitquery` | Decoded DEX and launchpad trades for up to 100 contracts per GraphQL request: last price, day's volume and trade count, venue (Market Lens, 2026-09-12) | 1 h |
| `bitquery-discovery` | The week's traded tokens network-wide, by volume, 1,000 token×venue rows a page: symbol, name, decimals, venue, trades, volume, distinct-trader count (2026-09-12) | 1 h | Paid (Pro plan, points-metered), `BITQUERY_API_KEY` on the worker only; `Holders` is queried for the token-distribution map rule 1 allows (2026-09-14), `Balances` is not; FDV = price × the ERC-20 supply stored on `tokens`; source `bitquery`; budget `bitquery` 4,000 req/day, paced at 60/min against the plan's documented 90 |
| `robinhood-stock-assets` / `robinhood-stock-price` | Tokenized-equity assets, multipliers and raw underlying bid/ask | 1 h / 60 s | Off by default (`HEY_STOCK_TOKEN_PRICES_ENABLED`); price only, no market cap; source `robinhood-stock-api` |
| launchpad | Interface + registry only | — | No provider ships until its access is public, documented and permitted |

### On-chain activity (RPC, 2026-09-12)

`rpc-logs` (`createRpcLogCountAdapter`, with `rpc-head` and `rpc-block` for the day's block
window) counts the events a published project's token contract emitted in the 24 hours before
HEY looked: one `eth_getLogs` call per contract per day, split into smaller windows when the
node refuses the whole day, HOT/WARM projects daily and the rest weekly, under the shared
`rpc-logs` budget. The count and its block window are stored (`contract_activity`); nothing
else is. It is shown on the project page, the public API and MCP as *context* — "the contract
is used" — and is never an input to activity status, Build Momentum or any ranking.

### Explorer reads through the Blockscout PRO API (2026-09-12)

The instance's API (`robinhoodchain.blockscout.com/api/*`) answers scripts with a bot challenge,
so explorer reads (the verified-contract sync, the on-chain claim's creator lookup) go to the
Blockscout PRO API (`api.blockscout.com`, its Etherscan-style `/v2/api?module=…&action=…` form —
`listcontracts` with a `verified_at_start_timestamp` floor, `getcontractcreation` — with `chain_id=4663`) when
`RH_BLOCKSCOUT_API_KEY` is set; the free starter plan (100K credits a day, 5 requests a second)
covers HEY's volume. Without a key the reads still target the instance and degrade honestly.
The key is only ever a query parameter on the request; every echoed URL is redacted.

### Follow-up deployments (Blockscout PRO API, 2026-09-12)

With a PRO key, HEY names the account that sent each published token's creating transaction
(`getcontractcreation`; the same authority the on-chain claim accepts a signature from) and
reads what that account sent afterwards (`txlist` from a block cursor). A contract it deployed
after the launch becomes a `CONTRACT_DEPLOY_FOLLOWUP` ship event: publicly verified, dated to
the block, the creating transaction as evidence, named when the contract is verified. An
account that launched three or more projects' tokens is a launch service and is marked
`shared`: nothing is attributed to it. Failed creations and contracts that are themselves some
project's token are skipped. Only direct deployments are visible; creations through a factory
are internal transactions the PRO API does not list for this chain. One address per project is
kept (`contract_deployers`) with a block cursor: no balances, no holdings, no history.

### DeFi TVL as context (DefiLlama, 2026-09-12)

The same DefiLlama registry read that feeds ecosystem discovery now also records, once a day,
each listed protocol's TVL on Robinhood Chain (`defi_tvl`, one row per protocol per day). A
protocol is matched to a project when the project was promoted from that listing, when its site
is the project's site, or when its X handle is the project's official X; the row says which, and
unmatched protocols keep their rows. Shown on the project page, the public API and MCP as
context — money in the contracts says the product is used — and never as an activity-status or
ranking input.

## Guarantees

Every adapter validates its payload with Zod, applies a timeout, retries transient
failures with exponential backoff and jitter, honours `Retry-After`, sends conditional
requests (`If-None-Match` / `If-Modified-Since`) and returns caching metadata.

Adapters never throw for upstream conditions. They return a `SourceResult` whose
`status` is one of `fresh`, `not_modified`, `missing`, `rate_limited` or `error`, with a
normalized `errorCode`. This is what makes degraded mode work: a provider outage is
structurally distinct from "the project stopped shipping", and callers use
`shouldRetainPreviousData()` to keep the last known value and mark the source stale.

## Cost and safety

Conditional requests plus content hashing mean an unchanged source costs one 304 and
does no downstream work. Response bodies are capped, content types are checked, and
URLs supplied by builders or users are screened against private, loopback, link-local
and IPv4-mapped-IPv6 destinations before any request is made.

Redirects are followed manually with a cap of 5 hops, and **every hop is re-validated**
against the same rules. Letting the runtime follow redirects would hide the intermediate
URLs, so a public address could redirect into a private one unchecked.

### Known limitations

- **DNS rebinding is not covered.** The guard validates the literal host; a hostname that
  *resolves* to a private address needs connection-time IP pinning. Tracked for M9.
- **`robots.txt` and terms-aware crawling are not implemented.** PRD V4 section 27 requires
  this for website/docs *ingestion*, which is M4. The M2 adapters fetch only URLs a builder
  or admin has explicitly registered, one page per call, never crawling.
- **Feed entries are capped at 50 per fetch**, newest-first as the provider orders them.
- **`redirect: 'manual'` relies on Node/undici semantics**, where the 3xx response and its
  `Location` header are readable. Adapters run in the worker, not in a browser context.

### Bitquery (2026-09-12)

Why: 772 of 2,308 published tokens had no reading from any aggregator and 1,046 more read as a
launch pool with no trades — Pons and Clanker launches still on their curves, and pools the
aggregators do not index. Bitquery decodes those venues on Robinhood Chain (chain 4663) into
one schema. Terms: a paid, points-metered subscription (Pro, $79/month billed yearly; Personal
excludes Robinhood); data is used for HEY's own display and API with provider attribution, never
resold. What is asked: `DEXTradeByTokens` only — price, volume, trade count, venue — in two windows per
request: the day (volume, trade count) and the week (the last trade's price for a token that
traded recently but not today). What is never
asked: holders, balances, wallets (CLAUDE.md product rule 1). Discovery (`DISCOVER_BITQUERY_TRADES`,
daily, up to 10 pages per 7-day slice over 30 days; the manual script defaults to 12): every token that traded this week with twenty or more traders becomes a named
`token_candidates` row and is chain-verified by the trade; promotion and the quality gate decide
what becomes a page, exactly as for every other source. The market job (`REFRESH_MARKET_BITQUERY`,
every 6 h, ≤ 5,000 tokens a run) targets tokens with no pool at the last check or a launch-pool
status, and is skipped entirely without the key. A trade reading carries no pool depth, so the
market status reads it as `trades_observed` / `no_trades_24h`, never as liquidity.

Since 2026-09-13 Bitquery also fills HEY's own daily index. The realtime dataset holds only four
or five days and the Pro plan charges a flat five points a cube on it, so HEY reads daily and keeps
what it reads: `REFRESH_TRADE_DAYS` (daily; every published token, a hundred a request, the last
four UTC days — trades by direction, USD volume, the day's last price, transfers; ~60 requests a
day) writes the trade columns of `token_market_days`, and `REFRESH_CHAIN_DAYS` (every 6 h) writes
the chain half of `chain_activity_days` (DEX trades, pools, tokens traded, volume against USDG /
WETH / ETH only, transactions, transfers). The budget is 4,000 requests a day and the steady state
is about a thousand, roughly 9,500 of the plan's ~33,000 daily points.

What is still never asked: balances across tokens, wallets, or anything that names an account.
Counts of distinct accounts **are** asked for and stored, from 2026-09-15: how many addresses
called a contract, and how many traded a token, bought or sold it, on a given day. They are
aggregates the provider computes and returns as numbers — `count(distinct: Transaction_From)` —
and no address reaches HEY. The adapter tests enforce the shape: the sender field may appear
inside a count and nowhere else. The columns are named `callers`, `distinct_addresses`,
`distinct_buyers` and `distinct_sellers`, because the schema guard forbids the word `trader` and
the neutral name is the more honest one anyway.

Since 2026-09-14 Bitquery also answers "is this contract being used", in batches.
`REFRESH_CONTRACT_ACTIVITY` (every 6 h, a no-op without the key) asks three cubes in one document
for up to a hundred published token contracts — `Calls`, `Events` and `Transactions` filtered to
those addresses — and writes one `contract_activity` row per (contract, UTC day): calls, events,
transactions, and how many different method names and event names appeared. The whole catalogue is
about 51 requests and 765 points. It replaces nothing: the RPC read (`CONTRACT_ACTIVITY_WATCH`)
stays, because it needs no third party and covers the days the realtime dataset has already
dropped, and `source` on each row records which read produced it so the two are never mixed. The
two "how many different" counts are the useful part: a token that is only being traded exposes
three or four method names and two event names, so a contract well above that has functions people
call. Still never asked: holders, balances, or any per-account figure — a unit test asserts the
document never names `Transaction_From`, `Call_From`, `Holder` or `Balance`.

Since 2026-09-27 (founder decision F9) Bitquery also answers "which functions", in the same
batches. `REFRESH_CONTRACT_METHODS` (daily, a no-op without the key) asks the `Calls` cube alone,
grouped by day, contract, decoded method name and 4-byte selector, for up to a hundred watched
contracts over the last three complete days, and writes `contract_method_days`: calls per method
per contract per UTC day, with the ERC-20 standard surface collapsed into one `erc20` bucket and an
undecoded call kept under its selector. It selects no account and no count of accounts (the unit
test forbids `From`, `Sender`, `Transaction`, `Holder` and `Balance` in the document). A
`contract_method_coverage` window per contract says which days were read, so a missing day is
"no call" only inside it. Its budget key is `bitquery-methods`, capped at 87 requests a day — under
5 % of the plan's million points a month at the measured 19 points a request — and a one-off
archive backfill (`data:contract-methods --backfill`, dry run first) reads the same document from
the `combined` dataset under `bitquery-methods-archive`. The public name of this evidence is
`decoded_calls`; function names stay on Terminal surfaces (founder decision F3).

What was checked on `network: robinhood` on 2026-09-14 and was *not* available then: `dataset: archive`
and `combined` are refused on this plan ("your plan only allows realtime"), and realtime's oldest
block that day was five days old, so there is no long history from this source at any price we
pay today. `TokenSupplyUpdates` does not exist on the schema. The prediction-market cubes exist but
answer "no data available yet" for this chain. `Holders`, `Balances` and `BalanceUpdates` all
answer and are not used, by product rule, not by availability.

Since 2026-09-14 Bitquery also answers "who holds this token", for the bubble map, under the
amendment the founder made to product rule 1 that day. `REFRESH_DISTRIBUTION` (daily, a no-op
without the key) asks three cubes in one document per token: `Holders` ordered by balance for the
top fifty, `uniq(of: Holder_Address)` for the total, and `Transfers` between those fifty for the
edges. Fifteen points a token, one token a request, so it walks the published catalogue with a live
market stalest-first rather than covering it in a run. What is asked: an address, a balance, when
that balance first and last changed, and how many times. What is still never asked: PnL, a label
for an account, anything across tokens, or anything at all about an address that does not hold this
one token.

`Holders` is documented as requiring the archive dataset, which this plan was refused on 2026-09-14; it answers on
`realtime` for `network: robinhood` regardless, verified 2026-09-14. Blockscout's holder endpoint
answers "Network not supported" on the PRO base for chain 4663, so Bitquery is the only source for
this. The realtime window reaches back about five days, which bounds the edges: a line on the map
means "moved recently", never "related".

Reviewed and not added (2026-09-12): DefiLlama token addresses (mainnet governance tokens, none
on chain 4663); CoinMarketCap (duplicates CoinGecko's role as corroboration); Exa and X (social
volume is not building activity); rh-scan.com (undocumented, unlicensed; founder decision).
Alchemy/QuickNode are a dedicated RPC endpoint (`RH_RPC_URL`), not a data source.

