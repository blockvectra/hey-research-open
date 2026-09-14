# HEY Research Lab — open source

The published part of [HEY Research Lab](https://heyresearch.xyz), the builder-discovery
layer for Robinhood Chain. HEY answers one question: **which projects are still building,
what have they shipped, and which of them is nobody looking at?**

This repository holds the parts of HEY that are useful on their own and safe to read:

| Path | What it is |
| --- | --- |
| `packages/sources` | Every public-data adapter HEY reads (GitHub, Blockscout, DEX Screener, GeckoTerminal, CoinGecko, launchpads, feeds), each with saved fixtures and contract tests. No network in tests. |
| `packages/scoring` | The deterministic activity status, Build Momentum, Still Building and Under the Radar rules, versioned. Scores never read price or holdings. |
| `packages/config` | Environment schema and chain constants. |
| `packages/ui` | The presentation components (cards, chips, formatting). |
| `apps/mcp` | The MCP server: five tools an assistant can call, over the public API. |
| `docs/` | The public API, the MCP server, the source registry, and every data source HEY reads with what it refuses and why. |

The ingestion pipeline, the quality gate, the database schema, the web app and the operations
tooling stay in the private repository. Nothing here contacts a provider: the adapters take an
injected `fetch`, and the tests fail on any real network call.

## What HEY looks like

Captured from [heyresearch.xyz](https://heyresearch.xyz) on 11 September 2026.

| Home | Project |
| --- | --- |
| ![Home](docs/screenshots/home.png) | ![Project](docs/screenshots/project.png) |

| Radar | Scout |
| --- | --- |
| ![Radar](docs/screenshots/radar.png) | ![Scout](docs/screenshots/scout.png) |

| Developers | Mobile |
| --- | --- |
| ![Developers](docs/screenshots/developers.png) | <img src="docs/screenshots/mobile-home.png" alt="Home on a phone" width="220"> |

A project page shows three facts apart: development (from the project's own sources), the
token's market status (active, low or no liquidity, trading inactive, liquidity removed, or
insufficient data) and whether the token is verified as the project's own. Scores read the
first and never the other two.

Explore has two views (2026-09-12): **Projects**, everything HEY tracks, and **With a token**, only the projects with a token, with a Market Lens — live market, verified token, launch stage (on the curve, graduated, in a DEX pool), a liquidity floor, liquidity and 24 h volume orders — and one line under every market sort saying how many rows actually carry the figure. Market figures stay context; nothing ranks by them, and tokenless builders are never hidden from the first view. A token card HEY cannot read building from says "No builder signal yet" and prints what HEY does know — traded today, on-chain events, the pool it trades in — as context (2026-09-13); trading is not building. Since 2026-09-13 HEY keeps its own daily index (`token_market_days`, `chain_activity_days`): every token project has a market page (`/project/{slug}/market`, `/api/projects/{slug}/market`) with price, liquidity, trades and volume day by day, the lifecycle and what HEY checked on the contract, and Pulse shows Robinhood Chain day by day (`/api/chain`). Counts, never accounts — until 2026-09-14, when that changed for one thing only; see **What HEY does not do** below. Nothing in scoring reads any of it. HEY Signal (`/signals`) turns measured changes into a feed with before/after figures and sources; the Builder Radar (`/builders`) ranks builders by verified development, on-chain use and research standing, never by price; weekly reports are archived at `/reports/weekly` (2026-09-13). Since 2026-09-14 a market page also carries **token distribution**: a bubble map of the largest balances drawn to scale, with pools, launchpad lockers and burned supply named and kept out of the concentration figure, and circles that moved the token between each other coloured as a group. Every circle links to that address on the block explorer. The same day, contract usage moved to a batched read — calls, transactions, and how many different method names and event names a contract saw — so a token that is only being traded (three or four methods) reads differently from a contract people call.

## What HEY does not do

For its first year HEY stored nothing about who holds a token. Product rule 1 forbade holder
tracking outright and a schema test failed the build if a table or column so much as contained
the word.

**That boundary moved on 2026-09-14**, by the founder's decision, for one shape and no further:
a bubble map of a single token's largest balances, on the market page, behind the builder story,
so a reader can see five hands holding most of a supply before deciding anything. An address
there is a point on a chart of one token's supply. It is never a person, never scored, never
ranked across tokens, never followed, and never an input to activity status, Build Momentum, the
Discovery Gap or the Builder Radar.

Everything else the rule forbade, it still forbids, and the schema guard still enforces it:
no wallet PnL, no smart-money labels, no whale labels, no wallet profiles, no wallet clustering
presented as a claim about people, no copy-trading. The word `holder` is permitted on exactly
three tables and nowhere else; `wallet`, `pnl`, `smart_money`, `whale` and `copy_trade` still
fail the build anywhere, in the schema, in the migration SQL and against a live database.

A cluster on that map means one thing and says only that: these addresses moved this token
between each other in the last few days. It is a fact about transfers inside a window HEY can
see. It is not a claim that anyone is the same person, and HEY does not decide what it means.

HEY also still publishes no verdicts. A project page states findings and where each came from,
and the words *rug* and *scam* appear nowhere in the product — an end-to-end test asserts it.

## The token, briefly

`$HEY` (contract `0xB33eb16782776b4D738c0Fd643577cb0284Db610` on Robinhood Chain) pays for
evidence. Bounties are set in dollars ($10 / $25 / $50 by tier) and paid in HEY at a figure
quoted once from HEY's own price reading, half at approval and half ninety days later if the
evidence still stands; a new bounty opens to holders first for 24 hours. Holding changes what a
reader pays, when they read new research and how much the API serves them. It never changes a
ranking, a status or a score: the rules in `packages/scoring` read no price and no balance, and
that is tested. Nothing on HEY is a buy signal.

## Use

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @hey/mcp build   # apps/mcp/dist/index.js, the MCP server
```

The MCP server runs on your machine and reads `https://heyresearch.xyz/api`; see
[docs/MCP.md](docs/MCP.md). The API itself is documented in
[docs/PUBLIC_API.md](docs/PUBLIC_API.md).

## How this repository is produced

It is exported from the private repository by a script that copies the listed paths, generates
a types-only `@hey/db`, and refuses to publish anything that must not leave: each sync is one
commit. Issues and pull requests are welcome here; a change accepted here is applied in the
private repository and comes back in the next sync.

HEY reports what teams ship and whether a tracked token still has a market. It does not
predict prices, and nothing in it is investment advice.

MIT licence.
