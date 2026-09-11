# HEY Research — Public Source Registry

Every external source HEY reads, with what was actually observed when it was verified —
not what its documentation claims. A source is not integrated until it appears here.

**Scope lock:** Robinhood Chain only, `chain_id = 4663`. Aggregators are queried for
Robinhood Chain contracts and nothing else. No paid provider is present, and none may be
added without explicit founder approval.

**Verified:** 2026-09-01. Re-verify before trusting any row: endpoints change without notice,
and a stale registry is worse than none.

---

## Tier A — Robinhood Chain native / canonical

### Robinhood Chain public RPC

| | |
| --- | --- |
| Base URL | `https://rpc.mainnet.chain.robinhood.com` |
| Purpose | Canonical chain verification: does this contract exist on 4663, and is it an ERC-20 |
| Fields used | `eth_chainId`, `eth_getCode`, ERC-20 `name()` / `symbol()` / `decimals()` via `eth_call` |
| Auth | None |
| Free | Yes |
| Rate limit | Undocumented and shared. Treated as scarce: verification only, never bulk indexing |
| Cache policy | Contract existence is immutable once true — cached indefinitely |
| Reliability | **Authoritative.** Canonical source for chain identity and token symbol |
| Verified | `eth_chainId` → `0x1237` (4663). Confirms the configured chain id |
| Fallback | `RH_RPC_FALLBACK_URL` if configured; otherwise chain verification returns `UNKNOWN` and the candidate is not promoted |

Never used to index the chain from genesis (PRD V4 public-data rule 9, CLAUDE.md cost rule 2).

### PonsPad public API

| | |
| --- | --- |
| Base URL | `https://ponspad.app/api/v1` |
| Purpose | Robinhood Chain-native launchpad discovery, launch metadata, official project links |
| Endpoints | `/`, `/stats`, `/tokens?limit=`, `/tokens/:address`, `/tokens/:address/cycles` |
| Fields used | `tokenAddress`, `name`, `symbol`, `description`, `website`, `twitter`, `telegram`, `discord`, `farcaster`, `createdAt`, `feeStrategy`, `status` |
| Auth | None — documented as read-only public |
| Free | Yes |
| Rate limit | Undocumented. Polled at most once per bootstrap; the whole catalogue is one request |
| Cache policy | Launch metadata is long-lived; 12h |
| Reliability | **Authoritative** for launch facts and self-declared project links on tokens it launched |
| Verified | `/stats` → `tokenCount: 6`. `/tokens?limit=2` returns the documented shape |
| Fallback | Skipped entirely if unavailable; discovery continues from other sources |

Small catalogue (6 tokens), so this is a quality source rather than a volume source. Its
`website` field is self-declared by the launcher — recorded as launchpad-confidence
evidence, never as an authoritative GitHub mapping.

### hood.dev launchpad (Goldsky subgraph)

| | |
| --- | --- |
| Endpoint | `POST https://api.goldsky.com/api/public/project_cmg2x3lrvy37d01vq4bsnbtig/subgraphs/hooddev/prod/gn` (GraphQL) |
| Purpose | Robinhood Chain-native launchpad discovery: every launch with the creator's description, artwork and links |
| Entities | `tokenLaunches` (paged by `first`/`skip`, `orderBy: createdAt desc`), `launcherStats_collection { launchCount }` |
| Fields used | `token { id symbol name }`, `creator { id }`, `createdAt`, `image`, `description`, `socials`, `hasBonded`, `venue`, `pool` |
| Not used | `devBuyEth`, `currentMcapEth`, `bondedEth`, `bondTargetEth` — ETH-denominated curve figures; market context comes from the market adapters |
| Auth | None — Goldsky public subgraph |
| Free | Yes |
| Rate limit | Undocumented. One request per 100 launches, once a day |
| Cache policy | 1h |
| Reliability | **Authoritative** for launch facts; **self-declared** for links |
| Verified | 2026-09-03: `launchCount: 45`; `tokenLaunches(first: 100)` returned all 45. `socials` is a free string, empty or a JSON object such as `{"x":"@handle","website":"https://…"}` (`x` seen as a URL, an `@handle` and a bare handle). `image` was `https://arweave.net/…` (most), `ipfs://…` (one) or empty (one). 4 of 45 had bonded |
| Fallback | Skipped; the other listing sources continue |

Adapter: `packages/sources/src/adapters/hooddev.ts`. `socials` is parsed as JSON when it
is JSON, scanned for absolute URLs otherwise, and ignored when it is neither — nothing is
guessed. Job: `DISCOVER_LISTINGS`, source id `HOODDEV`, `discovered_via = 'hooddev'`,
`launchpad = 'hooddev'`.

### Robinhood Chain Blockscout

| | |
| --- | --- |
| Base URL | `https://robinhoodchain.blockscout.com` |
| Purpose | **Verified contracts, newest first** (2026-09-05): `GET /api/v2/smart-contracts`, paged by `next_page_params.smart_contract_id` (50 per page); contract metadata and creation for the per-address adapter |
| Fields used | `address.hash`, `address.name`, `address.is_verified`, `address.is_scam`, `address.proxy_type`, `address.implementations[].address_hash`, `language`, `license_type`, `compiler_version`, `verified_at` |
| Auth | None |
| Rate limit | Undocumented. One hourly `SYNC_VERIFIED_CONTRACTS` run reads at most 30 pages (1,500 contracts), metered under `blockscout` (2,000/day); a watermark on `verified_at` stops the walk at what the previous run saw, and a run cut short resumes from its cursor |
| Cache policy | 1h |
| Reliability | **Authoritative** for "published source matches this bytecode"; the contract *name* is the deployer's, and the list is ~90 % launcher templates |
| Verified | 2026-09-04: 914,828 verified contracts; the newest 400 spanned 16 minutes (`PonsV2LauncherToken` 289, `Token` 33, `PonsV2BondingCurve` 12, `LunchTokenPlain` 7, `BeaconProxy` 6, ~45 distinct one-off names). `GET /api/v2/smart-contracts` → 200 with `Mozilla/5.0 (compatible; HEYResearchBot/0.1; +https://heyresearch.xyz)`, 403 with the bare `HEYResearchBot/0.1 (+https://…)` string |
| Fallback | Skipped when `RH_BLOCKSCOUT_BASE_URL` is unset; Sourcify's daily list still marks candidates verified |

**On the agent string.** The explorer's CDN refuses any `User-Agent` that does not begin
with `Mozilla/5.0`, including HEY's own descriptive one. The adapter sends the
`Mozilla/5.0 (compatible; <bot>; +<contact>)` form every public crawler uses: it still
names HEY and a contact URL, so the operator can identify and limit the traffic, and it
is not an attempt to pass as a browser. Nothing else about the request changed.

What the verified list becomes (`packages/domain/src/ecosystem/ingest-verified.ts`):
a candidate HEY already holds by address is marked `chain_verification = VERIFIED`; a
contract whose address is a token on a HEY project gets a `CONTRACT_DEPLOY` ship event,
`PUBLICLY_VERIFIED`, with the explorer's contract page as evidence; an address HEY has
never seen becomes a hidden `token_candidates` row (`discovered_via = BLOCKSCOUT_VERIFIED`,
the contract name as its only identity, held at the identity gate until another source
supplies a ticker). Launcher templates — a fixed name list in
`packages/domain/src/ecosystem/verified-contracts.ts` plus any name that recurs five times
in one run — are counted and skipped. Job `SYNC_VERIFIED_CONTRACTS` hourly; CLI
`pnpm data:builders sync-verified [--max-pages=N]`; sync-state id `BLOCKSCOUT_VERIFIED`.

### Virtuals

| | |
| --- | --- |
| Base URL | `https://api.virtuals.io/api` |
| Purpose | Agent discovery — the largest Robinhood Chain launch source found |
| Endpoint | `/virtuals?filters[chain]=ROBINHOOD&pagination[pageSize]=100&pagination[page]=N` |
| Fields used | `uid`, `name`, `symbol`, `description`, `status`, `preToken`, `tokenAddress`, `createdAt` |
| Auth | None |
| Free | Yes |
| Rate limit | Undocumented; paced at 400ms between pages |
| Cache policy | 1h |
| Reliability | **Medium** for metadata, **High** for the chain filter |
| Verified | `filters[chain]=ROBINHOOD` → **25,253** agents against 82,401 globally. Sampled `preToken` addresses are real 45-byte EIP-1167 proxies on 4663 |
| Fallback | Skipped; other sources continue |

**Source type:** API. The chain filter is applied in the request, never after —
pulling the global ecosystem into a chain-locked product and filtering later is
not a safe pattern. An agent's `app.virtuals.io` page is recorded as provenance,
never as the project's own website.

#### Virtuals market figures (2026-09-04)

| | |
| --- | --- |
| Endpoint | the same `/virtuals` collection, filtered by address: `filters[$or][0][preToken][$in][i]=<addr>&filters[$or][1][tokenAddress][$in][i]=<addr>`, 25 addresses per request |
| Fields used | `preToken` / `tokenAddress` (identity), `mcapInVirtual`, `fdvInVirtual`, `liquidityUsd`, `id` (page URL) |
| **Dropped** | `holderCount`, `holderCountPercent24h`, `top10HolderPercentage`, `devHoldingPercentage` (present in every payload; not declared in the schema, never stored — CLAUDE.md product rule 1); `volume24h`, `virtualTokenValue`, `priceChangePercent*` (units undocumented) |
| Unit | **VIRTUAL.** Converted to USD only with a VIRTUAL/USD reading CoinGecko gave in the same run (`api_cache` key `coingecko:price:virtual-protocol`); no rate, no snapshot |
| Rate limit | Undocumented; ~90 requests per run, paced 400 ms, budget `virtuals-market` 1,200/day |
| Cache policy | 1h; one snapshot per token per run, none within 30 min of the last |
| Reliability | **Launchpad's own figure** — the bonding-curve / pool valuation, not a market print. Stored as source `virtuals`, ranked after every aggregator (see "Market source precedence") |
| Verified | 2026-09-03: address filters match case-insensitively; five published agents answered with `mcapInVirtual` 8.5k–19.9k, `liquidityUsd` 11.7k–17.8k. `fields[]` and `filters[status]` are ignored by the API. 2,158 of HEY's 2,214 published tokens are Virtuals agents |

Adapter: `packages/sources/src/adapters/virtuals-market.ts`; job `REFRESH_MARKET_VIRTUALS`
every 3 h; CLI `pnpm data:refresh-virtuals-markets`.

### Pons launch factories (on-chain)

| | |
| --- | --- |
| Source type | On-chain factory events via `eth_getLogs` |
| Pons V2 (current) | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` — **enabled**; topic `0x8d4aad49…` (read from live logs; the deployed factory's launch event hashes differently from the repository's declaration), token in `topics[1]` |
| Pons V2 (early) | `0x7E1EAbd52Ae29598e6483F72dCf1a70b14284dB8` — **enabled**; topic `0xbd886f85…`; history only, no launches after 2026-09 |
| Pons V1 (active, the ponsfamily.com v1 tab) | `0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75` — **enabled**; EIP-1967 proxy; topic `0xdb51ea9a…` (`TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)`), token in `topics[1]` |
| Pons V1 (published source) | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` — **enabled** for history; `launchEnabled()` false since 2026-08 |
| Pons V1 (legacy) | `0x0c37a24F5D23A486FA692d1500881d698B1F77a4` — **enabled** for history; `$PONS` itself launched here |
| Auth | None |
| Rate limit | Shared public RPC; adaptive chunking with backoff; the scheduled scan spends at most 60 requests per factory per hour and resumes from the last indexed block |
| Verified | 2026-09-03: all five addresses carry bytecode on 4663; the current V2 emits roughly forty launches per thousand blocks (127 in one 3,000-block window); tokens launched on the active V1 answer `launchFactory()` with its address and their position NFTs are owned by its locker (see `docs/HEY_PONS_V1_PRELAUNCH_AUDIT.md`) |
| Fallback | Sync state persists the last indexed block; a failed run resumes |

**Correction (2026-09-03).** The earlier registry looked for the V2 topic on the published
V1 address, concluded V1 emitted no launch event, and pointed V2 at the early deployment —
so the factory carrying essentially all current launches was never indexed. The deployment
list comes from the ponsfamily.com frontend bundle, which is the authority on which
addresses its own launch tabs use.

### Robinhood Stock Token API (tokenized equities)

| | |
| --- | --- |
| Base URL | `https://api.robinhood.com/rhj` (https://docs.robinhood.com/chain/stock-token-apis/) |
| Purpose | The issuer's own price for each tokenized equity on the chain |
| Endpoints | `GET /assets` (asset id, `tokenSymbol`, `tokenName`, `deployments[].{contractAddress,chainId}`, `currentMultiplier`, `pendingMultiplier`, `status`, `logoUrl`); `GET /prices/{symbol}` (`bid`, `ask`, `currency`, `isTradingHalt`, `generatedAt`, `dailyTradingVolume`); `GET /corporate-actions` (not read) |
| Fields used | assets: identity, deployment on 4663, `currentMultiplier`; prices: `bid`, `ask`, `currency`, `generatedAt` |
| Price rule | `/prices` is the **raw underlying-equity** bid/ask, not multiplier-adjusted; per-token USD = `mid(bid, ask) × currentMultiplier` ("18-dp shares-per-token"). No supply is published, so **no market cap** is derived |
| Auth | None |
| Free | Yes |
| Rate limit | Documented 60 req/s; HEY paces 200 ms and budgets `robinhood-stock-api` 600/day. `/prices` is cached 15 s upstream, `/corporate-actions` 1 h |
| Reliability | **Authoritative** for the issuer's price of its own token |
| Verified | 2026-09-03: `/assets` → 194 assets, all deployed on 4663; `/prices/AAPL` → `bid 324.81 / ask 324.88 USD`; `/prices/?symbols=AAPL` → 400 (path form only) |
| **Status** | **Implemented, tested, OFF.** `HEY_STOCK_TOKEN_PRICES_ENABLED=false` by default. Whether tokenized stocks are a HEY surface at all is undecided (see the CoinGecko note above); today none of the 153 `robinhood-stocks` candidates is a published project, so a run would write nothing |

Adapter: `packages/sources/src/adapters/robinhood-stock-tokens.ts`; job
`REFRESH_MARKET_STOCK_TOKENS` hourly when enabled; CLI `pnpm data:refresh-stock-token-prices`
(runs manually even while the flag is off; use `--dry-run` first). Source `robinhood-stock-api`.
### Launch factories added 2026-09-04 (on-chain)

Every launchpad below is indexed the way Pons is: `eth_getLogs` on a factory
address for one event topic, with the token read from an indexed topic (or, for
Flap, a data word) and the creator's name, ticker and metadata decoded from the
event data where the event carries them. Each address was found in the
launchpad's own app bundle or by tracing a known token's mint transaction, and
each topic was read from a live log — never computed from an ABI. The full
verification record, launch counts and the one-off backfill commands are in
`docs/audit-2026-09-04/launchpad-coverage.md`; the registry itself
(`packages/sources/src/factories/registry.ts`) carries the evidence per entry.

| Launchpad | Factory / launcher on 4663 | Launch topic | Token | Identity in event | Launches (2026-09-03) |
| --- | --- | --- | --- | --- | --- |
| **Pools** (pools.trade, Uniswap Labs) | `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0` LiquidityLauncher | `0x2e2b3f61…` | `topics[1]` | none — `name()`/`symbol()` from the token | ~50,700 since block 28.52M |
| **hood.fun** | `0x8c529f0a77c07ce0e6796f153d292501ee6f66f6` | `0x91de26bc…` | `topics[1]` | name, symbol, inline-JSON metadata (description, links) | 352 |
| **Robinlaunch** | 9 bonding factories (V4–V12) + 5 direct + boost, from its bundle | `0x463df9e0…` / `0x88401197…` | `topics[2]` | name, symbol, `ipfs://` metadata | ~75 |
| **PAIR** (pair.fund) | `0x8660A7F019C7943b0b0A91B8E39AFf3b6DB6Ae62` | `0x82a616e6…` | `topics[1]` | metadata URL only — identity from the `pairfund` adapter | 1,474 |
| **Clanker** v4 | `0xD3f2cC1731b7Fd17f28798835C2E02f0a1839A94` | `0x9299d1d1…` | `topics[1]` | image, name, symbol, JSON metadata (description, socials) | 14,898 |
| **Bankr** | `0x22e99278308b393ea1260859b181ad7e78f5eeed` | `0xadc6f1f7…` | `topics[1]` | symbol (name from the token) | ≥17,629 |
| **EasyA Kickstart** | `0x519fd71f5df8242fb8bccaa346ea5b20c336273e` | `0x7b3d31f5…` | `topics[1]` | name, symbol, `ipfs://` image | 227 |
| **Hoodit** | `0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb` | Pons V1 `0xdb51ea9a…` | `topics[1]` | none | 21,443 (blocks 61k–6.72M, dormant since) |
| **Robinpad** | 8 factories from its bundle (`RH4663`) | 5 creation topics | `topics[1]` | none | ~141 |
| **Flap** (flap.sh) | `0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09` | `0x504e7f36…` | data word 3 | name, symbol, IPFS CID | ~90,000 since before block 30M |

| | |
| --- | --- |
| Source type | On-chain factory events via `eth_getLogs`, plus `eth_call` `name()`/`symbol()` for the launchpads whose event carries no identity |
| Auth | None |
| Rate limit | Shared public RPC; one hourly `SYNC_LAUNCHPADS FACTORIES` run spends at most 360 requests across every factory (60 per factory, order rotating by the hour) and names at most 150 launches (300 `eth_call`s), all metered in `provider_usage` under `rpc-logs` and `erc20-metadata` with daily budgets of 12,000 and 8,000. The RPC answers `429 Too Many Requests` to parallel scans and `403` to Python's default User-Agent; the worker's fetch is fine |
| Reliability | **Authoritative** for launch facts; **self-declared** for names, links and artwork carried in the event |
| Fallback | Sync state persists the last indexed block per factory; a failed or budget-capped run resumes |

### pair.fund tokens endpoint

| | |
| --- | --- |
| Base URL | `https://pair.fund/api/tokens?limit=100&page=N` |
| Purpose | Identity and creator links for PAIR launches — the factory event carries only a metadata URL |
| Fields used | `address`, `name`, `symbol`, `description`, `website`, `twitter`, `telegram`, `discord`, `imageUrl` (a path on pair.fund), `creator`, `launchTxHash`, `launchedAt`, `graduated`, `hidden`, `flagged`, `quoteToken.symbol`, `pairs[0].poolId` |
| Not used | `marketCapUsd`, `priceUsd`, `holders`, curve and graduation figures — market context comes from the market adapters; holder counts are never read |
| Auth | None |
| Free | Yes |
| Rate limit | Undocumented; 8 pages an hour, wrapping to page 1, so the 15-page catalogue is re-read about every two hours; daily budget 400 (`pairfund`) |
| Cache policy | 1h; the endpoint sends a weak `ETag` |
| Reliability | **Authoritative** for launch facts; **self-declared** for links |
| Verified | 2026-09-03: `total: 1446`, newest first, 100 per page; `hidden`/`flagged` marks respected (those launches are not written) |
| Fallback | Skipped; the `PAIR_FUND` factory scan still records every launch, unnamed until the contract is read |

Adapter: `packages/sources/src/adapters/pairfund.ts`, `discovered_via = 'pairfund'`,
`launchpad = 'pairfund'`, `source_id = launchTxHash`. Job: `SYNC_LAUNCHPADS` with
`source: 'PAIRFUND'`, sync-state id `PAIRFUND`.

### Clanker API

**Verified, not integrated.** `https://www.clanker.world/api/tokens?chainId=4663`
is keyless (5,954 tokens listed, `limit` ≤ 20, `cursor` + `sort=asc`), but the
factory event already carries everything it would add — image, name, symbol and
the metadata JSON with description and social URLs — so the chain is read instead
(14,898 launches against the API's 5,954).

### launchpad.meme

**Not integrated.** `/api/tokens` returns HTTP 403 and no factory address is
published. The alternative would be creator API credentials, which HEY does not
request for public discovery.

### RobinPad

**Integrated 2026-09-04** through its eight chain-4663 factories, read from the
`RH4663` block of its app bundle (see the table above). There is still no public
read API; names come from the token contracts.

---

## Tier B — Public market aggregators (Robinhood Chain queries only)

### DEX Screener

| | |
| --- | --- |
| Base URL | `https://api.dexscreener.com` |
| Chain slug | **`robinhood`** — verified live, never assumed |
| Role | **Enrichment and reconciliation**, not chain enumeration |
| Purpose | Candidate discovery, market context, and the project links that gate promotion |
| Endpoints | `/latest/dex/search?q=`, `/tokens/v1/robinhood/{addresses}` (batch, ≤30 per call) |
| Fields used | `baseToken.{address,name,symbol}`, `marketCap`, `fdv`, `liquidity.usd`, `volume.h24`, `pairCreatedAt`, `info.websites[]`, `info.socials[]` |
| Auth | None |
| Free | Yes |
| Rate limit | Documented ~300 req/min on token endpoints, ~60 req/min elsewhere. HEY batches 30 addresses per request and stays far below both |
| Cache policy | Market data 5m–24h by refresh tier; `info` block 12h |
| Reliability | **Medium** (aggregator). Never overwrites a canonical on-chain symbol or an authoritative project link |
| Verified | `search?q=robinhood` → 30 pairs, 25 on `robinhood`; 12 of 25 carried `info.websites`/`socials`. Batch endpoint returned 3 pairs for 5 addresses |
| **Chain-key trap** | `tokens/v1/4663/…` returns **HTTP 200 with `[]`** — not an error. Assuming the numeric EVM chain id would silently mark every contract "not seen" rather than failing loudly. The key is the slug `robinhood`, confirmed by querying a known 4663 contract and reading back `chainId: "robinhood"` |
| Healthcheck | Query a known Robinhood Chain contract and assert the response carries `chainId === 'robinhood'` and at least one pair |

**Search is not enumeration** (Quality Gate V3 §24). DEX Screener's search
endpoint cannot list the chain, so HEY builds the candidate universe from chain
inventory and factory events, then reconciles each candidate against this
provider in batches.
| Fallback | GeckoTerminal for market context; discovery degrades to the other sources |

`ads` and paid `orders` are **not** read. Paid placement is not evidence of building,
and treating it as such would make ranking purchasable.

#### DEX Screener token profiles (and boost lists, for enumeration only)

| | |
| --- | --- |
| Endpoints | `/token-profiles/latest/v1`, `/token-boosts/latest/v1`, `/token-boosts/top/v1` |
| Purpose | Which tokens on the chain have a team-written profile: description, icon, website, docs, socials |
| Fields used | `chainId`, `tokenAddress`, `description`, `icon`, `links[].{label,type,url}`, `url`, `cto` |
| **Dropped** | `amount`, `totalAmount` (boost spend) — validated so the payload parses, never stored, never scored |
| Auth | None |
| Free | Yes |
| Rate limit | Documented ~60 req/min. Three requests per daily run |
| Cache policy | 15m — the lists roll over constantly |
| Reliability | **Medium** (self-declared to an aggregator). Rank 10 in the candidate store, so it fills gaps and never overwrites a launchpad's identity |
| Verified | 2026-09-03: each feed returned 30 records, cross-chain; **20 / 14 / 14** were `chainId: "robinhood"`. Profile `icon` is a CDN URL; boost `icon` is a bare CMS id (`_bNkrynaHAamIH5s`) and is not stored. Links came as `{label:"Website"|"Docs",url}`, `{type:"twitter"|"telegram"|"tiktok"|"instagram",url}` or plain `{url}` |
| Fallback | Each feed degrades on its own; one working feed is a successful run |

Adapter: `packages/sources/src/adapters/dexscreener-profiles.ts`; `discovered_via =
'dexscreener-profiles'`. The boost lists are read for *which* tokens carry a profile and
for nothing else — the chain-locked filter is applied on `chainId === 'robinhood'`, the
website is the first `Website`-labelled or unlabelled non-social link, social hosts are
recognised by hostname even when untyped, and the spend never leaves the adapter. This
is the one deliberate exception to "boosts are not read", and it does not touch ranking.

### GeckoTerminal

| | |
| --- | --- |
| Base URL | `https://api.geckoterminal.com/api/v2` |
| Network | `robinhood` |
| Purpose | Breadth of candidate discovery; secondary market context and cross-check |
| Endpoints | `/networks/robinhood/pools?page=`, `/networks/robinhood/new_pools?page=`, `/networks/robinhood/tokens/{address}` |
| Fields used | `relationships.base_token` (address), `name`, `pool_created_at`, `market_cap_usd`, `fdv_usd`, `reserve_in_usd` |
| Auth | None |
| Free | Yes |
| Rate limit | 30 calls/min on the free public API. HEY paces requests and caps pages |
| Cache policy | 15m for pool pages, per refresh tier for market data |
| Reliability | **Medium** (aggregator) |
| Verified | `/pools` returns 20 per page and **stops at page 10** (200 pools max); page 11 is empty. `new_pools` also returns 20. `/networks/robinhood` itself 404s — only the sub-resources exist |
| Fallback | DEX Screener |

The 200-pool ceiling is the real bound on HEY's discovery universe today — see
`docs/REAL_DATA_PIPELINE.md`.

### CoinGecko

| | |
| --- | --- |
| Base URL | `https://api.coingecko.com/api/v3` |
| Asset platform | **`robinhood`** (`chain_identifier: 4663`) |
| Purpose | Registry coverage of catalogued Robinhood Chain tokens; homepage, artwork, description, categories and Twitter for the ones CoinGecko has reviewed |
| Endpoints | `/coins/list?include_platform=true` (one ~3.4 MB body, cap raised to 16 MB); `/coins/{id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false` |
| Fields used | list: `id`, `symbol`, `name`, `platforms.robinhood`; detail: `links.homepage[0]`, `image.small`, `description.en`, `categories`, `links.twitter_screen_name`, `links.repos_url.github`, `platforms` |
| Auth | None (free public tier) |
| Free | Yes |
| Rate limit | Free tier ~10–30 req/min, undocumented precisely. The list is one request a day; details are **30 per run, 2.5 s apart**, rotating through the registry by id via `source_sync_state.cursor` (`COINGECKO`). A 429 stops the detail trickle for the run and leaves the cursor at the last success |
| Cache policy | List 24h; detail 7d |
| Reliability | **Medium** (curated registry). Rank 10 in the candidate store |
| Verified | 2026-09-03: **19,496** coins listed, **690** with a `platforms.robinhood` address, **148** of those with ids ending `-robinhood-token`. Sampled: `agentos` (homepage `useagentos.dev`, categories `AI`, `Robinhood Ecosystem`, empty description), `1inch` (ten platforms, GitHub org listed), `adobe-inc-robinhood-token` (categories include `Tokenized Stocks`, homepage `docs.robinhood.com/rhj`, Twitter `RobinhoodCrypto`) |
| Fallback | Skipped; the other listing sources continue. Absence from CoinGecko is not a negative signal |

Adapters: `packages/sources/src/adapters/coingecko.ts` (`coingecko-list`, `coingecko-coin`);
`discovered_via = 'coingecko'`, `source_id = <coingecko id>`. At 690 coins and 30 details a
run, a full pass of the detail trickle takes ~23 daily runs.

#### CoinGecko market figures (2026-09-04)

| | |
| --- | --- |
| Endpoint | `/coins/markets?vs_currency=usd&ids=<up to 250 ids>&per_page=250&page=1&sparkline=false&precision=full` |
| Fields used | `id`, `current_price`, `market_cap`, `fully_diluted_valuation`, `total_volume`, `last_updated`, `image` |
| **Not used** | `/simple/token_price/robinhood` — one address per free call; `market_cap_rank`, `ath*`, `price_change_*` — not context HEY shows |
| Mapping | registry `platforms.robinhood` address → HEY token by `(4663, lower(contract_address))`, never by symbol; the id → address map is kept in `api_cache` (`coingecko:platforms:robinhood`, 24h) so the 3.4 MB list is read once a day |
| Rate limit | Free tier ~5–15 req/min, shared with the detail trickle. Budget `coingecko` **200/day** through `ProviderTelemetry`; a 429 sets the shared cool-off (`withBudget`) and the job defers to it |
| Cache policy | Markets 1h; one snapshot per token per run, none within 30 min |
| Reliability | **Medium** (aggregator over exchanges and DEX pools). Source `coingecko`, ranked after the DEX aggregators |
| Verified | 2026-09-03: **701** coins carry a `robinhood` address (158 ids end `-robinhood-token`); `ids=pons,1inch,agentos,…` answered with `market_cap` (Pons 343 M, 1inch 122 M, AgentOS 441 k), `cache-control: max-age=30`, ETag. A `0` market cap means "unknown" and is stored as absent. **44 of 2,214 published HEY tokens** are among the 701 (74 of all 25,449 tokens; none of the stock tokens is published) |

Adapter: `packages/sources/src/adapters/coingecko-markets.ts`; job `REFRESH_MARKET_COINGECKO`
every 2 h; CLI `pnpm data:refresh-coingecko-markets`.

**Open product decision — Robinhood's tokenized equities.** 148 of the 690 are
Robinhood's own stock tokens (`Adobe Inc. • Robinhood Token`, category `Tokenized
Stocks`). They are real contracts on the chain but there is no team building a project
behind each one. The job files them with `launchpad = 'robinhood-stocks'`, keeps the
description CoinGecko wrote, and **does not record `docs.robinhood.com` as their
website** — it is the issuer's documentation, not the project's own site, and recording it
would hand the quality gate ~150 near-identical "projects with a website". Whether HEY
should show these at all (one issuer page? a filter? nothing?) is not decided; until it is,
they stay candidates and the gate must not publish them as projects.

### DefiLlama

| | |
| --- | --- |
| Base URL | `https://api.llama.fi` |
| Purpose | Protocol category and TVL for mature protocols only |
| Auth | None |
| **Status** | **NOT INTEGRATED in this bootstrap** |
| Rationale | Robinhood Chain has no listed protocols to enrich yet. Absence from DefiLlama is explicitly *not* a negative signal, so integrating it now would add requests and change nothing |

---

## Tier C — Public development and project sources

### GitHub

| | |
| --- | --- |
| Base URL | `https://api.github.com` |
| Purpose | Repository metadata, releases, contributor and commit activity; builder discovery (below) |
| Fields used | repo metadata, `/releases`, `/commits`, contributor counts |
| Auth | `GITHUB_PUBLIC_API_TOKEN` (set in production since 2026-09-03; 5,000 core requests/hour, 30 repository searches/minute, 10 code searches/minute) |
| Rate limit | 60 req/hour unauthenticated. Budgets: `github-repo` / `github-releases` / `github-commits` 2,000/day each, `github-search` 1,000, `github-code-search` 600, `github-contents` 3,000 |
| Cache policy | Conditional requests with ETag; repo metadata 6–24h, activity 1h–7d by status |
| Reliability | **Authoritative** for code facts — but only once the repository mapping itself is authoritative |
| Fallback | No token → repository search only, fewer projects enriched per run, never failure. Absent or private code is `NOT_MEASURABLE`, never zero |

**Repository mapping rule.** A repo is authoritative only when the project's own website or
docs link to it, or a verified submission supplies it, or the repository itself carries a
deployment marker (the chain id, the RPC or explorer host, a launch-factory address) and
was pushed to this quarter. A name or ticker match is never enough, and an unverified
mapping is stored as such and excluded from scoring.

**Repository lifecycle (2026-09-05).** A mapped repository that answers 404/410/451 twice
in a row is set aside: `project_sources.unavailable_since` is stamped, a `source_conflicts`
row (`field = build_evidence`, `resolved_value = unavailable`) records why, the source
stops counting as evidence and is read again only weekly; the ship events it produced keep
their verification. A 301 to a renamed or transferred repository is followed — the source
moves to the new URL and the old one is kept in a conflict row (`field = repository_url`).

#### GitHub code search (2026-09-05)

| | |
| --- | --- |
| Endpoint | `GET /search/code?q=<marker>&per_page=100&page=N` — token required |
| Purpose | Find repositories by what their **files** contain: the RPC host, the explorer host, `chainId: 4663` and its JSON / `chain_id` / `eip155:4663` forms, and every launch-factory address in the registry. Repository search never indexes these |
| Fields used | `total_count`, `items[].path`, `items[].html_url`, `items[].repository.{full_name,html_url,description,fork,owner.login}` |
| Rate limit | 10/minute; paced at one request per 7 s, at most 25 per hourly `DISCOVER_CODE_SEARCH` run, budget 600/day. At most 10 pages (1,000 files) per query |
| Cache policy | 1h |
| Reliability | A hit is a file; a fork carries the upstream's files and is dropped; a new repository costs one `/repos/{o}/{r}` read for its push date and archive/template flags |
| Verified | 2026-09-04 (authenticated): `rpc.mainnet.chain.robinhood.com` 2,132 files; `robinhoodchain.blockscout.com` 2,468; `"chainId: 4663"` 926; `"chainId":4663` 350; `eip155:4663` 590; Pons V2 factory `0x7eD598…` 60 files / 18 repositories. One hundred files collapse to 26–58 repositories |
| Fallback | Skipped without a token; the cursor (`source_sync_state.GITHUB_CODE_SEARCH`, marker index + page) resumes after a rate limit or a spent budget |

Adapter: `packages/sources/src/adapters/github-code-search.ts`; markers:
`CODE_SEARCH_MARKERS` + `factoryAddressMarkers()` in `packages/domain/src/builders/fingerprint.ts`;
discovery: `packages/domain/src/builders/discover-code.ts`; candidates carry
`discovered_via = github-code-search` and the marker as a STRONG fingerprint.

#### Repository files and account listings (2026-09-05)

| | |
| --- | --- |
| Endpoints | `GET /repos/{o}/{r}/readme` and `GET /repos/{o}/{r}/contents/{path}` with `Accept: application/vnd.github.raw+json` (≤ 256 KB); `GET /users/{login}/repos?type=owner&sort=pushed` (answers for organisations too) |
| Purpose | Re-judge weak candidates from their README, `package.json`, `foundry.toml`, `hardhat.config.*` (`REJUDGE_BUILDER_CANDIDATES`, hourly, ≤ 100 candidates, ≤ 5 files each, budget `github-contents` 3,000/day); sweep the accounts behind the chain's launchpads and SDKs (`madeonsol`, `nirholas`, the founder’s former account, `ponsdotdev`, `hooddev`; daily in `DISCOVER_ECOSYSTEM`, ≤ 3 pages each) |
| Verified | 2026-09-04: `/repos/nirholas/robinhood-chain-sdk/readme` raw → 200, 7,780 bytes; `/users/madeonsol` is an Organization with 18 public repositories, the founder’s former account a User with 21; `pair-fund` / `pairfund` → 404 (pair.fund publishes no GitHub account) |
| Reliability | A file naming the chain id or the RPC host is a deployment marker at the same strength as a description naming it; a bare `4663` in a file is **not** (port, issue, line count). A README describing a brokerage bot settles the candidate as REJECTED with the reason recorded; anything else stays PENDING and is not read again for 30 days |

### npm registry (2026-09-05)

| | |
| --- | --- |
| Base URL | `https://registry.npmjs.org` |
| Endpoints | `GET /-/v1/search?text=<term>&size=50`; `GET /<package>` (the package document, for `readme` and `repository`) |
| Purpose | Packages built for the chain — SDKs, CLIs, MCP servers — and the GitHub repositories they declare. The repository is the candidate; the package is provenance (`discovered_via = npm`, `discovery_query = npm:<name>`) |
| Fields used | search: `package.{name,description,keywords,date,links.repository,links.homepage}`; document: `readme`, `repository.url`, `homepage`, `keywords`. **Not used:** `downloads`, `score` — popularity is not building |
| Auth | None |
| Rate limit | Undocumented; five searches and one document per kept package per daily run, budget `npm` 200/day |
| Cache policy | 6h |
| Reliability | The package's own text decides whether it is about the chain (a `robinhood-api` trading wrapper is dropped by the same brokerage rule as on GitHub); the README is read for a deployment marker; the repository is then judged like any other candidate |
| Verified | 2026-09-04: `text=robinhood-chain` → 20 packages, 19 with a GitHub repository (`robinhood-chain-sdk`, `robinhood-chain-kit`, `robinhood-chain-x402`, `@madeonsol/plugin-robinhood-chain`, `mcp-server-robinhood-chain`, `ponscli`, `glory-mcp`, `@sinjoh/sdk`, `@cowlprotocol/cli`, `hoodgrow-mcp`, `hyde-mcp` …); `text=hood.dev` → 0; `text=pons robinhood` → 415 (fuzzy; the fingerprint filters). The `robinhood-chain-kit` document is 59 KB with a 31 KB README |
| Fallback | Skipped; the other intakes continue |

Adapter: `packages/sources/src/adapters/npm.ts`; discovery:
`packages/domain/src/builders/discover-npm.ts`; terms `NPM_DISCOVERY_TERMS`.

### Official project websites and docs

| | |
| --- | --- |
| Purpose | The strongest promotion evidence: does a real project exist behind this token |
| Fields used | `<title>`, description, canonical URL, outbound GitHub/docs links, RSS/Atom feed discovery |
| Auth | None |
| Rate limit | Self-imposed: one fetch per project per run, conditional on ETag/Last-Modified |
| Cache policy | 12–24h |
| Reliability | **Authoritative** for the project's own identity claims |
| Safety | http/https only; private, loopback and link-local addresses blocked; redirects revalidated per hop; response size capped; content-type allowlisted |
| Fallback | Unreachable site → the candidate keeps whatever evidence it already has and is judged on that |

Structured data is preferred over HTML in every case: RSS, Atom, JSON-LD and GitHub
releases before parsing a page. HTML metadata is read only from pages the project
publishes publicly.

---

## Market source precedence (2026-09-04)

Several sources can now hold a reading for one token. Every `market_snapshots` row
carries its `source`; the card, the Explore filter, the count and the project page all
read the same reading through `marketReadingOrder` (`packages/domain/src/market-sources.ts`):

1. among readings that carry a value (market cap, or FDV when there is no circulating figure),
2. readings younger than 24 h before older ones,
3. among fresh readings, the most direct source first: `dexscreener` → `geckoterminal` →
   `coingecko` → `virtuals` → `robinhood-stock-api`,
4. then the newest.

So a fresh DEX figure beats a fresh CoinGecko figure, and a fresh launchpad figure beats a
day-old DEX one. When nothing is fresh, the newest reading is shown whatever produced it.
The card exposes the source (`marketCapSource`) and shows it as a `title` ("via CoinGecko").
Still Building's tracked high is taken from the same source as the reading it compares
against, never across providers. None of this touches ranking (CLAUDE.md rules 3, 6).

## Sources deliberately not used

| Source | Why |
| --- | --- |
| Nansen, Arkham, Kaito, Birdeye, LunarCrush | Paid, and all are wallet/attention analytics HEY does not build |
| X / Twitter firehose | Paid; PRD V4 forbids a paid social dependency for MVP |
| DEX Screener ads / orders; boost **amounts** | Paid placement is not evidence of building. The boost *lists* are read only to learn which tokens have a profile; the spend is dropped in the adapter |
| Any holder or wallet endpoint on any provider | CLAUDE.md product rule 1 — enforced by a schema test, not by convention |
| Blockscout (currently) | Returns 403; working around it would mean bypassing an anti-bot control |
| Blockscout `/api/v2/tokens/{addr}` for market data | Answers 200 only with a browser-like User-Agent (which HEY will not send); its `exchange_rate` / `circulating_market_cap` are null for every token CoinGecko does not list — nothing additive (checked 2026-09-03) |
| Mobula | Needs an API key (429 without). Could be added behind an optional env key later; not required and not integrated |
| Bitquery | Paid |
| CoinGecko `/simple/token_price/{platform}` | One address per free call; `/coins/markets` prices 250 ids per call instead |

## Cost

**$0.** Every integrated source is a free public endpoint. No API key is required for any
of them; the one optional key (`GITHUB_PUBLIC_API_TOKEN`) is free to create and raises a
rate limit rather than unlocking data.
