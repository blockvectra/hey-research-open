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
| `docs/` | The public API, the MCP server and the source registry. |

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

Explore has two views (2026-09-12): **Projects**, everything HEY tracks, and **With a token**, only the projects with a token, with a Market Lens — live market, verified token, launch stage (on the curve, graduated, in a DEX pool), a liquidity floor, liquidity and 24 h volume orders — and one line under every market sort saying how many rows actually carry the figure. Market figures stay context; nothing ranks by them, and tokenless builders are never hidden from the first view. A token card HEY cannot read building from says "No builder signal yet" and prints what HEY does know — traded today, on-chain events, the pool it trades in — as context (2026-09-13); trading is not building.

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
