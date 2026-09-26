# @hey-research/mcp

> **Not yet published to npm; build from source.** Until the first release the
> `npx` lines below do not resolve. Clone the repository, run
> `pnpm install && pnpm --filter @hey-research/mcp build`, and point your
> assistant at `node /absolute/path/to/apps/mcp/dist/index.js` — or use the
> hosted endpoint, which needs nothing installed.

[HEY Research](https://heyresearch.xyz) as tools an assistant can call, over the
[Model Context Protocol](https://modelcontextprotocol.io). HEY is the
builder-discovery layer for Robinhood Chain; it answers one question — **which
projects are still building, what have they shipped, and which of them is
nobody looking at?** — from a public, source-backed record.

The tools read the same public API anyone can `curl`, so they can say nothing
the API does not.

## Hosted

```sh
claude mcp add --transport http hey-research https://heyresearch.xyz/mcp
```

Streamable HTTP, stateless and read-only. Add
`--header "Authorization: Bearer hey_…"` to read with your key's allowance.
See [docs/MCP.md](https://heyresearch.xyz/docs/mcp) for what the endpoint does
and does not do.

## Local (stdio)

```sh
npx -y @hey-research/mcp
```

Node 20 or newer — the floor `@modelcontextprotocol/sdk` brings with it.

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

### Environment

| Variable | Purpose |
|---|---|
| `HEY_API_URL` | Another HEY to read, e.g. `http://localhost:3000` when developing. Default `https://heyresearch.xyz`. Anything but https is refused except on localhost, because the key rides on every request. |
| `HEY_API_KEY` | An API key from [heyresearch.xyz/account](https://heyresearch.xyz/account). Lifts the anonymous rate limit; nothing is gated behind it. Sent as a bearer token, never logged. |
| `HEY_MARKET_INTEGRITY` | Set to `public` only when the HEY you read publishes Market Integrity; `market_integrity` is offered only then. Unset, the server offers fourteen tools. |

## The fourteen tools

| Tool | What it answers |
|---|---|
| `find_projects` | Find a project by name, ticker or contract, or browse a surface — `still-building`, `under-the-radar` (eligible under the Under the Radar rule, with a positive Discovery Gap), `back-from-dormancy`, `shipping-in-silence`, `accelerating`, `builder-radar`, … — with the catalogue's filters. |
| `lookup_token` | One project by contract address: is anyone building it, ship records and meaningful ships in 30 days, the last ship and its source. `unknown` is an answer, not an error. |
| `get_project_snapshot` | One project in one read: identity, build, market with its valuation kind or why it is withheld, on-chain, verification, locks, latest changes, freshness, and what HEY does not know. |
| `get_changes` | The change ledger: what changed chain-wide or on one project, one event per change with its own time and precision, when HEY knew, and its evidence; a cursor to follow along. |
| `get_project_timeline` | One project's evidence on one axis, paged with a cursor. |
| `get_project_coverage` | What HEY knows and does not, per dimension, as states — never a score. |
| `explain_fact` | Why HEY shows a figure: the rule, the source, the inputs, the lineage, the evidence ids. |
| `get_evidence` | One typed evidence id (`ship:`, `signal:`, `abi:`, `impl:`, `lock:`, `source:`, `claim:`, `state:`) as a receipt. |
| `get_token_market` | One token's market from HEY's daily index, lifecycle, pools, supply concentration (shares only), contract checks; `include: ["moves"]` adds the valuation moves with what shipped before each. |
| `get_contract` | A contract as a research entity — creation, deployer, verified source, proxy and implementation history, interface counts, activity. |
| `project_diff` | What changed for one project between two dates, never a cause. |
| `compare_projects` | Two to four projects side by side, no winner. |
| `ask_hey` | A free-text question about one project, answered only from HEY's record. |
| `chain_overview` | The chain day by day, this week, an archived weekly report, scheduled HoodLock unlocks, or Build Momentum beside market attention. |

Plus `market_integrity` where the site publishes it. Resources
(`hey://project/{slug}`, `hey://project/{slug}/timeline`,
`hey://project/{slug}/coverage`, `hey://contract/{chainId}/{address}`,
`hey://changes/latest`) and four prompts (`deep_research_project`,
`what_changed_since`, `explain_metric`, `investigate_contract`) come with them.

Every answer tags its lines FACT, DERIVED or UNKNOWN, says how many it showed
of how many and how to read on, names a valuation by its kind, carries the
source, and links the JSON it was rendered from. Nothing is rendered as zero or
"n/a" where HEY has no figure.

## What it will not say

HEY records public building activity. It is not investment advice, it does not
predict or rank by price, and it holds no wallet data. The only account any
tool names is a contract's deployer: `get_token_market` names it beside one
token's supply-concentration summary (shares only), and `get_contract` names it
with how many other tracked projects' tokens the same account deployed — a
count, never a profile, called a launch service only on HEY's own
shared-deployer rule. *Still Building* is a narrow claim — verified activity continuing
through a market drawdown HEY tracked — and the server never states it without
its meaning.

## From source

The tools live in `packages/mcp-core` of the
[HEY Research repository](https://github.com/hey-research-lab/hey-research);
this package is their stdio entry point and bundles them, with
[`@hey-research/sdk`](https://www.npmjs.com/package/@hey-research/sdk), into one file.

```sh
pnpm --filter @hey-research/mcp build && node apps/mcp/dist/index.js
```

## Licence

MIT © HEY Research Lab
