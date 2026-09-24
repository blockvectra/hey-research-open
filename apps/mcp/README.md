# @hey-research/mcp

[HEY Research](https://heyresearch.xyz) as tools an assistant can call, over the
[Model Context Protocol](https://modelcontextprotocol.io). HEY is the
builder-discovery layer for Robinhood Chain; it answers one question — **which
projects are still building, what have they shipped, and which of them is
nobody looking at?** — from a public, source-backed record.

The server runs beside your assistant, holds no database and no credentials,
and reads the same public API anyone can `curl`.

```sh
npx -y @hey-research/mcp
```

Node 20 or newer — the floor `@modelcontextprotocol/sdk` brings with it.

## Install

**Claude Code**

```sh
claude mcp add hey-research -- npx -y @hey-research/mcp
```

**Claude Desktop** — in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hey-research": {
      "command": "npx",
      "args": ["-y", "@hey-research/mcp"]
    }
  }
}
```

Any other MCP client: run `npx -y @hey-research/mcp` over stdio.

### Environment

| Variable | Purpose |
|---|---|
| `HEY_API_URL` | Another HEY to read, e.g. `http://localhost:3000` when developing. Default `https://heyresearch.xyz`. |
| `HEY_API_KEY` | An API key from [heyresearch.xyz/account](https://heyresearch.xyz/account). Lifts the anonymous rate limit; nothing is gated behind it. Sent as a bearer token, never logged. |

## The tools

| Tool | What it answers |
|---|---|
| `search_projects` | Find a project by name, ticker, or contract address. |
| `list_projects` | Browse the catalogue by surface (`still-building`, `under-the-radar`, `shipping-now`, …), kind, status, narrative, launchpad, facts and launch stage. |
| `lookup_token` | One project by contract address: is anyone building it, ships in 30 days, the last ship and its source. `unknown` is an answer, not an error. |
| `get_project` | Everything HEY holds on one project: sources with provenance, token identity, market context with its provider, HEY's own measures. |
| `get_token_market` | One token's market in depth from HEY's daily index: price, liquidity, volume and trades by day, lifecycle, contract checks. |
| `project_intelligence` | How one project builds over time: velocity, release cadence, consistency, how fast HEY saw its ships, market attention as context, and 30-day changes — each line tagged FACT, DERIVED or UNKNOWN. |
| `chain_activity` | Robinhood Chain day by day — trades, volume, launches, projects published, ships. Aggregates only. |
| `list_signals` | HEY Signal: measured changes — development spikes and slowdowns, releases, deployments, liquidity moves — each with its figures and source. |
| `list_builders` | The Builder Radar: ranked by verified development, on-chain use and research standing, never by price. |
| `weekly_report` | The archived weekly report for an ISO week, or the latest. |
| `list_bounties` | Research bounties HEY pays in HEY, and whether one is claimed. Reading only; claiming is a wallet sign-in on the site. |
| `list_ships` | What projects shipped, each with the public source it was read from and how the claim is backed. |
| `this_week` | The weekly rollup: what shipped, new builders, who came back to shipping, what is still building. |

Every answer is rendered as text the model can quote, with the source beside
each fact. Nothing is rendered as zero or "n/a" where HEY has no figure.

## What it will not say

HEY records public building activity. It is not investment advice, it does not
predict or rank by price, and it holds no wallet data. No tool here returns
holder data of any kind. *Still Building* is a narrow claim — verified activity
continuing through a market drawdown HEY tracked — and the server never states
it without its meaning.

## From source

The server is `apps/mcp` in the [HEY Research repository](https://github.com/hey-research-lab/hey-research)
and is built on [`@hey-research/sdk`](https://www.npmjs.com/package/@hey-research/sdk),
the typed client for the same API.

```sh
pnpm --filter @hey-research/mcp build && node apps/mcp/dist/index.js
```

## Licence

MIT © HEY Research Lab
