# MCP server (2026-09-05)

HEY answers one question: **which projects on Robinhood Chain are still building, what have
they shipped, and which of them is nobody looking at?** That is the shape of a question
someone asks an assistant, so HEY is available as an MCP server — thirteen tools an assistant
can call while answering.

It runs **beside the assistant**, not on HEY's servers. It holds no database and no
credentials: it reads the same [public API](PUBLIC_API.md) anyone can `curl`. That is why
the API came first — the catalogue's rules live in one place, and this is a thin client over
them.

## Install

There is no hosted MCP endpoint and no URL to paste. The server is a small program that
runs on your machine and calls the public API (Node 20 or newer).

**It is not on npm yet** (checked 2026-09-19): the `@hey-research` scope has not been created,
so `npx -y @hey-research/mcp` does not resolve. Build it from source — this is the working
path today.

```bash
# in a clone of HEY's public repository
pnpm install && pnpm --filter @hey-research/mcp build
```

Then point a client at the built entrypoint, `apps/mcp/dist/index.js`:

```bash
claude mcp add hey-research -- node /absolute/path/to/hey-research/apps/mcp/dist/index.js
```

**Claude Desktop** — in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hey-research": {
      "command": "node",
      "args": ["/absolute/path/to/hey-research/apps/mcp/dist/index.js"]
    }
  }
}
```

**Once the package is published**, the same server starts with `npx` and nothing needs
cloning — `claude mcp add hey-research -- npx -y @hey-research/mcp`, or `"command": "npx"`
with `"args": ["-y", "@hey-research/mcp"]`. Releases will be tagged `mcp-v*` and published
from the private repository; the public repository mirrors the source.

Set `HEY_API_URL` to read a different instance (`http://localhost:3000` while developing). Set `HEY_API_KEY`
to read with your key's allowance (M13-E); the server never prints the key.
It defaults to `https://heyresearch.xyz`.

## The thirteen tools

| Tool | The question it answers |
|---|---|
| `search_projects` | "What is *AgentOS*?" · "Whose token is `0xa000…`?" |
| `list_projects` | "What is still being built?" · "What launched on Pons?" · "Which infra projects are active?" |
| `get_project` | "Tell me everything about this project." |
| `lookup_token` | One project by the contract address someone pasted: activity status in HEY's words, ships in the last 30 days, the last ship with its source. An address HEY publishes no page for answers plainly, with a scan link. |
| `list_ships` | "What shipped this week?" · "Is this project alive?" |
| `this_week` | "What happened on Robinhood Chain this week?" |
| `list_bounties` | "Which research bounties are open, what do they pay, is this one claimed?" (read-only; claiming is a wallet sign-in on the site) |
| `get_token_market` | "Does this token still trade? How has its liquidity moved? What did HEY check on the contract?" — HEY's own daily index (price, liquidity, volume, trades by day), the lifecycle, the checks, contract events and value locked (2026-09-13) |
| `list_signals` | "What changed on the chain this week? Any news on X?" — HEY Signal with figures before and after, source and confidence (2026-09-13) |
| `list_builders` | "Who are the top builders? Most improved? Who is building on Pons?" — the Builder Radar, never ranked by price (2026-09-13) |
| `weekly_report` | "What happened on Robinhood Chain in week 37?" — the archived weekly report (2026-09-13) |
| `project_intelligence` | "Is X accelerating? How often does it ship? What changed on X this month?" — build velocity, release cadence, consistency, how fast HEY saw its ships, market attention as context, and 30-day changes; every line tagged FACT, DERIVED or UNKNOWN (2026-09-24) |
| `chain_activity` | "How active is Robinhood Chain?" — DEX trades, volume, tokens and pools traded, transactions, launches recorded, projects published and ships, day by day (2026-09-13) |

`list_projects` takes HEY's own discovery surfaces as `surface`:

- `still-building` — kept shipping through a market drawdown HEY tracked
- `under-the-radar` — real activity, little market attention
- `building-with-token` — verified building this month and a token with a live market read this week (2026-09-13; Radar's default)
- `shipping-now`, `most-active`, `new-builders`, `back-from-dormancy`, `utility`, `memes`

plus `kind`, `status`, `narrative`, `launchpad`, `has` (now including `liveMarket`, `verifiedToken`,
`trading` and `github`), `stage` (`curve`, `graduated`, `dex`), `minLiquidity`, `minMarketCap`, `maxMarketCap` and `sort` (`liquidity` and
`volume24h` joined the orders on 2026-09-12). A market order is context the caller asked for; the
rendering says how many of the matching projects carry the figure and that the rest follow in
activity order, and each line names the launch stage and the provider behind every figure. A project with no repository, changelog or feed reads "no builder signal yet" instead of "unknown" (2026-09-13), and a line ends with "trades on Uniswap v4" when the reading names its pool.

## What the server will not let an assistant say

The tool descriptions and the rendering are part of the product, not packaging: they are
what a model reads before deciding whether HEY can answer, and what it quotes afterwards.

- **No tool ranks by price, values a token, or recommends anything**, because HEY does not.
  `server.test.ts` fails if a description ever picks up the words *buy*, *invest*,
  *undervalued*, *price target* or *predict*.
- **"Still Building" never appears without its meaning.** Every rendering that shows the
  badge carries: *verified activity continuing through a market drawdown HEY tracked — a
  record of what happened, not a prediction and not a buy signal.* When the API sends the
  claim's evidence (`stillBuildingEvidence`, since 2026-09-17) the line carries it too, as
  two facts and no verdict: *down 62% from the HEY-tracked high, 5 verified ships since*
  (2026-09-18).
- **Absent stays absent.** A project with no market reading gets no market line — never a
  zero, a dash or an "n/a" an assistant might average or compare. A project HEY has not
  measured says so, in words, because that is a different answer from measuring and finding
  nothing.
- **A market figure never travels without its provider**, and the text says outright that
  market data is context and that HEY never orders projects by price.
- **Every ship carries how it is backed and where it came from**, so an assistant cites
  rather than asserts, and a self-reported update can never read like a verified one.
- **Unresearched is not a finding.** An `INDEXED` record renders as *"activity not
  researched yet"*, never as its raw `UNKNOWN` status.
- **Failure is not an empty answer.** An unreachable HEY, a rate limit or a missing slug
  each come back as `isError` with a sentence saying what happened — never as "no results",
  which an assistant would summarise as "there are no such projects".

The server's `instructions`, which a client shows the model before any call, state that HEY
holds no wallet, holder or trading data and that none of this is investment advice.

## How it is built

| Piece | Where |
|---|---|
| stdio entry point | `apps/mcp/src/index.ts` |
| Tool definitions and descriptions | `apps/mcp/src/server.ts` |
| HTTP client for the public API | `packages/sdk` (`@hey-research/sdk`, bundled into the server at build time; since 2026-09-19) |
| Rendering (pure, unit-tested) | `apps/mcp/src/render.ts` |
| Contract tests over a real MCP client | `apps/mcp/src/server.test.ts` |

`server.test.ts` drives the server through an actual `Client` over the in-memory transport,
so what is tested is the contract a client gets — the tool list, the argument schemas and
the text that comes back, including on failure.

## What is deliberately not here

- **No write tools.** Submitting a project, claiming ownership and posting an update are
  things a person does on the site, signed in, with an audit trail. An agent must not do
  them on someone's behalf.
- **No HTTP transport yet.** stdio needs no hosting and adds no load to HEY's box. A remote
  transport is worth building when someone actually wants to run this without a checkout.
