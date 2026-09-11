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
