# MCP server (2026-09-05; reworked 2026-09-26)

HEY answers one question: **which projects on Robinhood Chain are still building, what have
they shipped, and which of them is nobody looking at?** That is the shape of a question
someone asks an assistant, so HEY is an MCP server — fourteen tools an assistant can call
while answering, hosted at `https://heyresearch.xyz/mcp` or run beside the assistant.

It holds no database and no credentials of its own: every tool reads the same
[public API](PUBLIC_API.md) anyone can `curl`, through the typed SDK. That is the rule the
whole server is built on — **the MCP can say nothing the API does not.**

## Connect

### Hosted (2026-09-26)

```bash
claude mcp add --transport http hey-research https://heyresearch.xyz/mcp
```

Any client that speaks MCP's **Streamable HTTP** transport works the same way: point it at
`https://heyresearch.xyz/mcp`. With an API key, add
`--header "Authorization: Bearer hey_…"`; the calls are then metered against the key's
allowance, exactly as they would be on the API.

What the hosted endpoint is:

- **Stateless and read-only.** Each `POST` is answered on its own, as JSON; there is no
  session id and no server-sent event stream. `GET` and `DELETE` answer `405`, which is also
  the liveness check; the site's health is `GET /api/health`.
- **Metered as you.** The tools read the public API on the server's own loopback address,
  forwarding your address and — only to that loopback address — your key. The API's
  per-minute limit (120 a minute per address, a key's tier otherwise), monthly quota and
  holds apply unchanged. On top of that, 60 JSON-RPC calls a minute per address bound
  `initialize` and `tools/list`.
- **Guarded.** A request whose `Origin` is not on the allowlist is refused (server-to-server
  clients send none and are allowed); the body is capped at 64 KB; cookies are ignored, so
  nothing here acts as a signed-in user.
- **Counted, not recorded.** HEY's request table records which tool a call served, whether
  it failed or was cut, how long it took and how large the answer was. Never the arguments,
  the question, or the answer's text.

Operator settings, both optional: `MCP_ALLOWED_ORIGINS` (comma-separated https origins,
default `https://claude.ai,https://heyresearch.xyz`) and `MCP_INTERNAL_API_URL` (the loopback
address the tools read, default `http://127.0.0.1:$PORT`; anything but plain http on a
loopback host is refused at start-up). `market_integrity` follows the site's own
`HEY_MARKET_INTEGRITY` flag.

### Local

**The npm package is not published yet** (the `@hey-research` scope has not been created),
so `npx -y @hey-research/mcp` does not resolve. Build it from source (Node 20 or newer):

```bash
# in a clone of HEY's public repository
pnpm install && pnpm --filter @hey-research/mcp build
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

Set `HEY_API_URL` to read a different instance (`http://localhost:3000` while developing;
anything else must be https, because the key rides on every request). Set `HEY_API_KEY` to
read with your key's allowance; the server never prints the key. Start it with
`HEY_MARKET_INTEGRITY=public` only where the site publishes Market Integrity.

## The fourteen tools

One tool per real question. The twenty-two tools before 2026-09-26 were replaced, not
aliased: nothing was published and the MCP had been called once.

| Tool | The question it answers | Replaces |
|---|---|---|
| `find_projects` | "What is *AgentOS*?" · "What is still being built?" · "Who is building quietly?" · "Who is shipping faster?" · "Top builders on Pons?" — a name, ticker or contract, or one of HEY's surfaces with the catalogue's filters. A pasted `0x…` address is answered as `lookup_token` would. | `search_projects`, `list_projects`, `shipping_in_silence`, `builder_comebacks`, `accelerating_builders`, `list_builders` |
| `lookup_token` | "Is anyone building this token?" — activity status in HEY's words, ship records and meaningful ships in 30 days, the last ship with its source, whether the project names the contract. On `MISMATCH` (the project's own site names another contract) it says the activity does not apply to this token and gives no link to the project (2026-09-27). | — |
| `get_project_snapshot` | "Tell me about X." — identity and when HEY first recorded it, build status and Build Momentum, market context with its valuation kind or why it is withheld, on-chain use, verification and sources, HoodLock locks, the latest changes, freshness, and what HEY does not know. | `get_project`, `project_intelligence` |
| `get_changes` | "What changed?" · "Anything new on X since Monday?" — the change ledger, one event per change, with its own time, precision, when HEY knew and its evidence; browse or sync with a cursor. | `list_ships`, `list_signals`, `contract_changes` |
| `get_project_timeline` | "Show me X's history." — every kind of evidence on one axis, paged with a cursor. | `project_timeline` |
| `get_project_coverage` | "What does HEY not know about X?" — a state per dimension, never a score. | — |
| `explain_fact` | "Why does HEY show this valuation / status / momentum?" — the rule, the source, the inputs, the lineage and the evidence ids. | — |
| `get_evidence` | "What backs this?" — one typed evidence id as a receipt. | — |
| `get_token_market` | "Does this token still trade? What did HEY check on the contract?" — HEY's daily index, lifecycle, pools, a supply-concentration summary (shares only), contract checks; `include: ["moves"]` adds each valuation move with what shipped before it. | `events_before_market_change` |
| `get_contract` | "What is this contract?" — creation, deployer, verified source, proxy kind and implementation history, interface counts and changes, activity and calls per method (counts by bucket, names withheld); by address, or every contract of a project. | — |
| `project_diff` | "What changed for X between two dates?" — then and now from persisted points, the changes recorded between. | — |
| `compare_projects` | "Compare A and B." — two to four projects, tagged lines, no winner. | — |
| `ask_hey` | A free-text question about one project (English or Malay), answered only from HEY's record. | — |
| `chain_overview` | "How active is Robinhood Chain?" — day by day, this week's rollup, an archived weekly report, scheduled HoodLock unlocks, or Build Momentum beside market attention. | `chain_activity`, `this_week`, `weekly_report`, `upcoming_unlocks` |

`market_integrity` is a fifteenth, offered only where the site publishes Market Integrity. It
lists every event HEY stands behind with its id, its time as precisely as HEY knows it, and its
words with the reading dates and sources; there, `get_changes` also accepts the
`market_integrity` domain and the `market_integrity.event` type (2026-09-27).
`list_bounties` was dropped: bounties are not research, and they stay in the API and the SDK.

### `find_projects` surfaces, one definition each

- `building-with-token` — verified shipping, active or resumed, with a token whose market is live.
- `still-building` — verified activity continuing through a market drawdown HEY tracked.
- `under-the-radar` — **eligible under HEY's Under the Radar rule** (status shipping, active
  or resumed; Build Momentum at least 30; at least 2 meaningful events in the last 30 days, one
  of them a ship rather than a commit summary; a fresh reading of a live market for the
  project's own token) **and a positive Discovery Gap**: the market-attention percentile is
  below the build percentile. A
  positive gap alone is not enough (`explain_fact` calls that one `POSITIVE`). It does not bound
  attention itself; an eligible project at the 90th attention percentile can be Under the Radar
  if it builds at the 99th.
- `shipping-now` (status SHIPPING), `most-active` (shipping, active or resumed, by Build Momentum),
  `new-builders` (recorded in the last 7 days), `utility`, `memes`.
- `back-from-dormancy` — status RESUMED, **narrowed to verified builders native to the chain**;
  `status: "RESUMED"` gives every resumed project.
- `shipping-in-silence` — eligible under the Under the Radar rule **and** below the 40th
  market-attention percentile (the gap itself is not required).
- `accelerating` — more meaningful events in the last 30 days than in the 30 before.
- `builder-radar` — the Builder Radar, with `radar` for its views, never ranked by price.

The catalogue filters are exactly the parameters `/api/projects` reads (`kind`, `status`,
`narrative`, `launchpad`, `has`, `stage`, `minLiquidity`, `minMarketCap`, `maxMarketCap`,
`minVolume`, `age`, `deployed`, `sort` including `shipped`, `limit`, `offset`); a test holds
the tool's schema to the parser in both directions.

## Resources and prompts

Resources, for clients that attach context rather than call tools — the same reads and the
same rendering:

- `hey://project/{slug}` — the snapshot
- `hey://project/{slug}/timeline` — the newest page of the timeline
- `hey://project/{slug}/coverage`
- `hey://contract/{chainId}/{address}`
- `hey://changes/latest` — the newest thirty events

Prompts: `deep_research_project`, `what_changed_since`, `explain_metric`,
`investigate_contract`. Each names the tools in the order that answers the question and the
rules the answer must keep. A prompt fetches nothing.

## What every answer does

- **Tags each line** FACT (a value HEY recorded, with its source), DERIVED (a rule HEY
  applied) or UNKNOWN (HEY does not hold it). The tag is never stronger than the API's own
  explain engine gives the same fact: activity status and Build Momentum are DERIVED, and so is
  every record HEY derived — a status or market-state transition, a signal over a window HEY
  measured, a market-integrity reading — in `get_changes`, `get_project_timeline`
  and `get_evidence`, one rule by the record's typed id. Still Building and Under the Radar
  counts are DERIVED wherever they appear.
- **Keeps the API's disclaimer** on every answer, the Builder Radar ranking and
  `chain_overview` included.
- **Says what it showed of the whole** — "Showing 20 of 412" — and the exact parameter or
  cursor that reads on.
- **Prints time at its precision** — "week of 2026-09-14" for a week of code activity, "HEY
  saw it 2026-09-20" when no source dates the event.
- **Names a valuation by its kind.** An FDV is an FDV; a valuation whose kind the API did not
  send is a "valuation", never a "market cap". A withheld valuation says it is withheld. In
  `project_diff` each end carries its own kind, and two ends of different kinds are said to be
  two measures, not one figure moving.
- **Counts only what HEY could read.** An on-chain event sum over a window with unreadable days
  says "over the N days HEY could read", and the rest are unknown, never zero.
- **Carries the source**, and ends with a `resource_link` to the JSON it was rendered from.
- **Is capped at 24 KB**, cut on a line, with how many lines were cut and where the whole
  answer is.
- **Fails as an error**, never as an empty answer: an unreachable HEY, a rate limit (with how
  long to wait) or a missing slug comes back as `isError` with a sentence.

And never:

- **ranks by price, values a token, or recommends anything** — the tests fail if a
  description picks up *undervalued*, *price target* or *predict*;
- **states a cause** — a change beside a market move is a sequence;
- **prints "Still Building" without its meaning** — *verified activity continuing through a
  market drawdown HEY tracked; a record of what happened, not a prediction and not a buy
  signal*;
- **turns unknown into zero** — a missing figure is absent or UNKNOWN, never 0, "none" or a dash;
- **names an account** other than a contract's deployer, and never a partnership from a call.
  `get_token_market` and `get_contract` name the deployer; `get_contract` adds how many other
  tracked projects' tokens the same account deployed — a count, never a profile — and calls it a
  launch service only on HEY's own shared-deployer flag (three projects), the rule `/market`
  reads;
- **returns Terminal-only data** — the public API does not, so the MCP cannot.

## How it is built

| Piece | Where |
|---|---|
| Tools, renderers, resources, prompts (no transport) | `packages/mcp-core` (`@hey/mcp-core`) |
| The tool list as data | `packages/mcp-core/src/tools.ts` — read by the server, `/developers`, and the tests |
| stdio entry point (bundles the core) | `apps/mcp/src/index.ts` |
| Hosted route | the web app's `POST /mcp` (Web-standard Streamable HTTP, stateless JSON) |
| HTTP client for the public API | `packages/sdk` (`@hey-research/sdk`) |
| Renderer tests, one per tool, on API-typed fixtures | `packages/mcp-core/src/render.test.ts`, `src/fixtures/api.ts` |
| Server tests over a real MCP client | `packages/mcp-core/src/server.test.ts` |

The server tests drive it through an actual `Client` over the in-memory transport: the tool
list (exactly fourteen, fifteen with the flag, every one titled and read-only, under the old
list's size), every tool end to end on its fixture, the resources, the prompts, and every
failure.

## What is deliberately not here

- **No write tools.** Submitting a project, claiming ownership and posting an update are
  things a person does on the site, signed in, with an audit trail.
- **No sessions and no stream.** The producer behind the change ledger runs every few
  minutes; polling `get_changes` with a cursor is as fresh as a stream would be, and a
  stateless endpoint survives every deploy.
- **No `outputSchema`.** Each result links the API's JSON instead; a second, hand-kept schema
  for every shape would be a second source of truth.
