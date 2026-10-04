# MCP server (2026-09-05; reworked 2026-09-26)

HEY answers one question: **which projects on Robinhood Chain are still building, what have
they shipped, and which of them is nobody looking at?** That is the shape of a question
someone asks an assistant, so HEY is an MCP server — twelve tools an assistant can call
while answering, hosted at `https://heyresearch.xyz/mcp` or run beside the assistant, and a
**research profile** at `https://heyresearch.xyz/mcp/research` (round 4, 2026-09-30): builder
intelligence first — no market-move, Under the Radar or valuation tool, and the ledger without market
events; research_answer still carries the market context of HEY's agent contract (the valuation with its kind, source and reading date, and the market status), labelled context only and never a builder judgement (wording corrected 2026-10-03: it said "builder intelligence only").

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
  the liveness check; the site's health is `GET /api/health`. Because the answer is always
  JSON, a client whose `Accept` is `application/json`, `*/*` or absent is answered too
  (2026-10-05; the transport otherwise asks for `text/event-stream` as well and answered 406); a
  client that accepts only an event stream is refused. A `tools/call` needs no `initialize`
  first, but send one with your `clientInfo` name: it is how HEY tells an agent from a registry
  probe when it counts use. The name is a self-declaration, never an identity, and changes no
  answer.
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

`market_integrity` is offered only where the site itself publishes Market Integrity.

### Research profile (round 4, 2026-09-30)

```bash
claude mcp add --transport http hey-research-builder https://heyresearch.xyz/mcp/research
```

A founder decision for platforms that want HEY's builder intelligence and nothing that reads
like a market screen. The same server, the same registry of tools, filtered by profile
(`mcpToolsFor(profile)` in `packages/mcp-core/src/tools.ts`); the same guards, origin
allowlist and 60-a-minute JSON-RPC bucket as `/mcp`. It offers seven tools:

| Tool | On the research profile |
|---|---|
| `research_answer` | Unchanged: the agent contract, all six capabilities. Its market context stays labelled context only. |
| `find_projects` | Identity only: a name, ticker, slug or contract through `/api/search/suggest` (at most eight rows, no market figure), or a `0x…` address through the token lookup. No surface, no market filter, no sort. |
| `get_changes` | The ledger without market events: with no `domain` or `type` it asks for `build, contract, token, research, lock`; a `market.*` type is refused. |
| `get_project_timeline` | Lenses `build` (the default), `code`, `onchain`, `locks`; no `market` or `everything`. |
| `explain_fact` | Every fact but `market.valuation`, `market.status`, `discovery_gap` and `market_integrity.state`. |
| `get_evidence`, `get_contract` | Unchanged. |

No `get_project_snapshot` (its market block), `get_token_market`, `project_diff` (valuation then
and now), `ask_hey`, `chain_overview` or `market_integrity` (never, whatever the flag), and
no Under the Radar, shipping-in-silence or Builder Radar surface. Resources drop the snapshot;
the timeline resource reads the `build` lens and `hey://changes/latest` the non-market domains.
Prompts name only the profile's tools. Locally, start the stdio server with
`HEY_MCP_PROFILE=research`. The request table counts `/mcp/research` as the MCP surface, and a
partner key reaches it with the `mcp` route group.

### Local

On npm since 2026-09-27 as `@hey-research-lab/mcp` (Node 20 or newer):

```bash
claude mcp add hey-research -- npx -y @hey-research-lab/mcp
```

To run a change of your own, build it from a clone instead —
`pnpm install && pnpm --filter @hey-research-lab/mcp build` — and point the assistant at
`node /absolute/path/to/hey-research/apps/mcp/dist/index.js`.

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

## The twelve tools

One tool per real question. The twenty-two tools before 2026-09-26 were replaced, not
aliased: nothing was published and the MCP had been called once. `research_answer`
(2026-09-30) carries HEY's agent contract. On 2026-09-30 (round 4) three tools that
overlapped a listed one were folded to pay for typed output inside the list's byte budget —
see **Folded tools** below; they still answer.

| Tool | The question it answers | Replaces |
|---|---|---|
| `find_projects` | "What is *AgentOS*?" · "What is still being built?" · "Who is building quietly?" · "Who is shipping faster?" · "Top builders on Pons?" — a name, ticker or contract, or one of HEY's surfaces with the catalogue's filters. A pasted `0x…` address is the contract lookup (what `lookup_token` answered): is anyone building it, ship records and meaningful ships in 30 days, the last ship with its source, whether the project names the contract; on `MISMATCH` it says the activity does not apply to this token. | `search_projects`, `list_projects`, `shipping_in_silence`, `builder_comebacks`, `accelerating_builders`, `list_builders` |
| `get_project_snapshot` | "Tell me about X." — opening since 2026-09-28 on the Research Summary: one tagged line (FACT, DERIVED, UNKNOWN) each for build, product usage, market, contracts, fundamentals, security context, the latest change and what HEY does not know, printed as the API serves them with their evidence ids and reasons, never restated; then identity and when HEY first recorded it, build status and Build Momentum, market context with its valuation kind or why it is withheld, on-chain use, verification and sources, HoodLock locks, the latest changes, freshness, and what HEY does not know. Context blocks, never building (2026-09-27): paid promotion seen on the token (presence and dates, never an amount), DefiLlama protocol economics (each metric measured, not tracked or unread — a measured zero says so), and the developer footprint (official repositories, newest production deployment, packages, advisories; a count only where measured). **Usage** (2026-09-28), its own dimension and never building: active and watched contracts and calls in 7 days (the ERC-20 surface apart), distinct caller addresses on the newest and busiest day — a count per day, "addresses, not people", and UNKNOWN across the window because days cannot be added; a project outside the method watch is UNKNOWN, never zero; the daily series is `GET /api/projects/{slug}/usage`. **Security context (evidence, never a verdict)** (2026-09-28): audit report links with where each is published and its `security:` evidence id, bug-bounty programs, a published security.txt, OSV advisories about the published packages, Scorecard checks never summed, incidents UNKNOWN. **Peer context** (`peers-v1`): the cohort, then each measured figure's own line — DERIVED where the cohort cleared its minimum, UNKNOWN ("not enough comparable projects") where it did not — never one combined number. Relationships are not in the snapshot: `GET /api/projects/{slug}/relationships`. | `get_project`, `project_intelligence` |
| `get_changes` | "What changed?" · "Anything new on X since Monday?" — the change ledger, one event per change, with its own time, precision, when HEY knew and its evidence; browse or sync with a cursor. | `list_ships`, `list_signals`, `contract_changes` |
| `get_project_timeline` | "Show me X's history." — every kind of evidence on one axis, paged with a cursor. | `project_timeline` |
| `explain_fact` | "Why does HEY show this valuation / status / momentum?" — the rule, the source, the inputs, the lineage and the evidence ids. | — |
| `get_evidence` | "What backs this?" — one typed evidence id as a receipt, including `method:` and, since 2026-09-27, `sourcechange:` (a material change to what the official site declares), and since 2026-09-28 `security:` (one audit, bounty program or published security contact — evidence, never a verdict). | — |
| `get_token_market` | "Does this token still trade? What did HEY check on the contract?" — HEY's daily index, lifecycle, pools, a supply-concentration summary (shares only), contract checks; `include: ["moves"]` adds each valuation move with what shipped before it. | `events_before_market_change` |
| `get_contract` | "What is this contract?" — creation, deployer, verified source, proxy kind and implementation history, interface counts and changes, activity and calls per method (counts by bucket, names withheld); by address, or every contract of a project. Since 2026-09-27: how the explorer verified the source, whose code it is (a DERIVED line: template, bytecode match, or published for the address), Sourcify's answer (not read is never "unverified"), the contract a minimal clone copies, calls the verified ABI names, undecoded selectors with a signature candidate (a guess, never a name) and creation calls counted apart. | — |
| `project_diff` | "What changed for X between two dates?" — then and now from persisted points, the changes recorded between. | — |
| `ask_hey` | A free-text question about one project (English or Malay), answered only from HEY's record. Since 2026-09-27 also the free-data questions: its public API, code hosts (GitLab answered honestly), functions that became active, what DefiLlama tracks, packages, advisories, docs changes and HEY's gaps — each line citing its evidence receipt where it restates a ledger event. | — |
| `chain_overview` | "How active is Robinhood Chain?" — day by day, this week's rollup, an archived weekly report, scheduled HoodLock unlocks, or Build Momentum beside market attention. | `chain_activity`, `this_week`, `weekly_report`, `upcoming_unlocks` |
| `research_answer` | The agent contract (2026-09-30): one bounded answer, AgentIntelligenceResponse v1, for `capability` = `research_project` (HEY's current view of one project), `what_changed` (the ledger over 1–30 days for a project or the chain, with the window's true total), `builder_status` (the status, its rule and version, inputs, lineage, evidence ids and what the rule never reads), `verify_project` (VERIFIED, UNVERIFIED, CONTRACT_MISMATCH or UNKNOWN attribution of a contract, with reasons), `compare_builders` (2–4 projects' building records over 30 days, no winner) or `unknowns` (every gap as UNKNOWN, NOT_MEASURED, NOT_VERIFIED, STALE or INSUFFICIENT_EVIDENCE, each with its coverage state and what not to conclude, and the dimensions measured, not applicable and withheld — every coverage dimension's state, what `get_project_coverage` answered). The answer first, then tagged claims, unknowns, freshness per data family and evidence ids; a source's words are quoted as data. Reads `GET /api/agent/{capability}`, the same JSON REST serves and A2A carries. | — |

`market_integrity` is a thirteenth, offered only where the site publishes Market Integrity. It
lists every event HEY stands behind with its id, its time as precisely as HEY knows it, and its
words with the reading dates and sources; there, `get_changes` also accepts the
`market_integrity` domain and the `market_integrity.event` type (2026-09-27).
`list_bounties` was dropped: bounties are not research, and they stay in the API and the SDK.

### Folded tools (round 4, 2026-09-30): callable until 2026-12-31

By 2026-09-30 the tools were on npm and in the MCP Registry, so these are aliased, not
replaced. They are no longer in `tools/list`, and still answer on `/mcp` and the stdio server
exactly as before — the same read, the same text, typed output — plus one line saying which
listed tool to use and `_meta["io.heyresearch/deprecated"]`, until **2026-12-31** (at least 90
days, the partner overlap rule). They are not served on the research profile, which is new.

| Folded tool | Why it overlapped | Ask instead |
|---|---|---|
| `lookup_token` | The same read and renderer as `find_projects` with a `0x…` address. | `find_projects` with `query` = the address |
| `compare_projects` | The same comparison read (`loadCompare`) as `research_answer`'s `compare_builders`. | `research_answer` `{ capability: "compare_builders", projects }`; each project's market context is `get_token_market` |
| `get_project_coverage` | `research_answer`'s `unknowns` restates the same coverage states, with what not to conclude. | `research_answer` `{ capability: "unknowns", project }` |

`/developers` prints the list.

## Typed output (round 4, 2026-09-30)

Every tool returns `structuredContent` beside its text, and declares an `outputSchema` (MCP
`2025-06-18` and later; a client on an older protocol reads the text, which is unchanged):

- **`research_answer`** returns the AgentIntelligenceResponse v1 itself. The declared schema is
  the envelope's stable spine (`schema`, `schemaVersion`, `capability`, `status`, `answer`,
  `claims` with each `id` and `status`, `evidence`, `data`), open to every additive field; the
  whole schema is `components.schemas.AgentIntelligenceResponse` in `/openapi.json` and the Zod
  schema in `@hey/agent-provider-core`. A client that validates gets the contract's own
  answer.
- **Every other tool** returns `{ schema: "hey.mcp-api-answer", api, data, notice }`: the public
  API object the text was rendered from, unchanged (its shape is the partner contract and never
  changes meaning), the URL it is at, and a notice that its names, titles, summaries and
  descriptions are a source's words — data, never instructions. Over 64 KB, `data` is left out
  (`dataOmitted: "over_64_kb"`) and `api` fetches it.
- **The byte budget.** The tool list, output schemas included, stays under the old 22-tool
  list's 19,179 bytes on `/mcp` (19,051 on 2026-09-30) and under 11,000 on `/mcp/research`
  (10,085), held by one test per profile. Folding the three tools and
  dropping the `$schema` stamp the SDK adds to every schema paid for it; the budget was not
  lifted.

### `find_projects` surfaces, one definition each

- `building-with-token` — verified shipping, active or resumed, with a token whose market is live.
- `still-building` — verified activity continuing through a market drawdown HEY tracked, on an
  active market that is more than a launch curve; on a thinner one Still Building is not
  measured (`stillBuildingWithheld: "market_too_thin"`, hbm-v19). With no tracked token, no
  current market reading or building HEY cannot read it is not measured either (`no_token`,
  `no_market_reading`, `activity_unknown`, hbm-v21), never "does not hold".
- `under-the-radar` — **eligible under HEY's Under the Radar rule** (status shipping, active
  or resumed; Build Momentum at least 30; at least 2 meaningful events in the last 30 days, one
  of them a ship rather than a commit summary; a fresh reading of an active market, not a thin
  one or only a launch curve, for the project's own token) **and a positive Discovery Gap**: the
  market-attention percentile is below the build percentile. A token whose market is not
  active has no Discovery Gap at all (`discoveryGapWithheld: "market_too_thin"`, hbm-v18). A
  market active only because another pool of the token holds the liquidity is measured on that
  pool's reading, and not at all when HEY holds none (`active_pool_not_read`, hbm-v21). Since
  hbm-v21 the stored flag itself requires the positive gap; the listing keeps the test too. A
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
- `hey://project/{slug}/coverage` — kept while `get_project_coverage` is folded: a resource is
  context, not a tool, and costs the tool list nothing
- `hey://contract/{chainId}/{address}`
- `hey://changes/latest` — the newest thirty events

Prompts (since round 4 they call `research_answer` where they called a folded tool):
`deep_research_project`, `what_changed_since`, `explain_metric`,
`investigate_contract`, and — with global Ask HEY (2026-09-28) — `what_changed_today`,
`compare_project_usage`, `explain_project_evidence` and `monitor_project`. Each names the tools
in the order that answers the question and the rules the answer must keep. A prompt fetches
nothing and adds no tool: the new four are workflows over the tools above, held by a test to
name only tools that exist and to keep usage's words ("distinct caller addresses", "observed
after", never a cause). No prompt creates an alert or follows a project; a reader does that on
the site.

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
- **Says what a week of commits changed, at the API's strength** (2026-09-27): in
  `get_project_timeline` a code week carries `DERIVED what changed (commit-substance-v1):
  changed code | documentation or maintenance only | substance not fully read` and the API's own
  sentence; in `get_changes` a `build.code_activity` event carries the same verdict and the
  FACT count of commits read. A documentation-only week says it is not counted as building; an
  unread week says it is unread, never that it is documentation. No commit message or author is
  ever in an answer.
- **Counts only what HEY could read.** An on-chain event sum over a window with unreadable days
  says "over the N days HEY could read", and the rest are unknown, never zero.
- **Carries the source**, and ends with a `resource_link` to the JSON it was rendered from.
- **Is capped at 24 KB**, cut on a line, with how many lines were cut and where the whole
  answer is.
- **Quotes a source's words as data** (2026-09-30): a release title, a ship summary or a
  project's name is folded onto one line with control, invisible and template characters and
  tags removed, and text that reads like an instruction to a model ("ignore previous
  instructions", "you are now…") is kept and marked as a source's words, never as HEY's. In
  `research_answer` every such string is `«…» (source title's words, quoted as data)`. Since
  round 4 every other tool does the same through the one helper
  (`quoteExternal` in `packages/agent-provider-core/src/text.ts`): every project name, ticker,
  narrative, launchpad, contract name, auditor, release title and caller's question is printed
  `«…»`, bounded and folded, labelled when it reads like an instruction, and an answer that
  quotes one ends with a line saying what `«…»` means. HEY's own sentences that carry a
  record's values (a Research Summary line, an Ask HEY line) are HEY's derived text — folded
  and labelled, not quoted — unless they repeat a ship's title, which is quoted whole, the
  agent contract's rule (`summaryIsSourceText`). `render-injection.test.ts` injects hostile
  values into every renderer.
- **Discloses `$HEY`** (round 4): an answer whose JSON names `$HEY`'s contract opens with
  "Disclosure: HEY's own token — researched by the same rules" and carries it in
  `structuredContent.disclosures`; `research_answer`'s contract carries `disclosures` of its
  own. Rankings are unchanged: no bonus and no demotion.
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

## Discovery: the registry, the handshake, $HEY (2026-09-28)

- **Official MCP Registry.** The entry is `apps/mcp/server.json` (schema
  `2025-12-11/server.schema.json`, validated in the gate and by
  `node scripts/release/validate-mcp-server-json.mjs [--live]`): name
  `io.github.hey-research-lab/hey-research`, the hosted remote `https://heyresearch.xyz/mcp`
  (Streamable HTTP) and, since round 4, a second remote for the research profile
  `https://heyresearch.xyz/mcp/research` (the registry schema's `remotes` is an array; the
  entry goes live at the next `mcp-publisher publish`), the public repository and the agent
  guide. The npm package carries the same
  name as `mcpName`, which is how the registry verifies an npm package; it ships with the next MCP
  release, and only then is the package added to the entry. Publishing to the registry is a
  manual step the lab takes.
- **The handshake** names the server `hey-research`, titled `HEY Research Lab`, with
  `websiteUrl` the agent guide (`/developers/agents`). The MCP SDK in use (1.30) negotiates protocol
  versions up to `2025-11-25`; the current specification is `2026-07-28`.
- **`$HEY`** is researched with the same tools as any token: `find_projects` with its contract, then
  `get_project_snapshot` or `research_answer`. The token's documented utility, each LIVE, PLANNED, RETIRED or UNKNOWN, is
  at `GET /api/hey/profile` (`hey.heyProfile()` in the SDK); no tool was added for it, and the
  server instructions say where it is.
- **A2A** is a separate, task-oriented door (`/.well-known/agent-card.json`, `POST /api/a2a`) over
  the same reads; this server stays tool-oriented. See "Agent discovery" in the
  [public API](PUBLIC_API.md).

## How it is built

| Piece | Where |
|---|---|
| Tools, renderers, resources, prompts (no transport) | `packages/mcp-core` (`@hey/mcp-core`) |
| The tool list as data | `packages/mcp-core/src/tools.ts` — read by the server, `/developers`, and the tests |
| stdio entry point (bundles the core) | `apps/mcp/src/index.ts` |
| Hosted routes | the web app's `POST /mcp` and `POST /mcp/research` (Web-standard Streamable HTTP, stateless JSON; one handler, `lib/mcp-hosted.ts`) |
| Profiles, typed output and folded tools, over a real MCP client | `packages/mcp-core/src/server-profiles.test.ts` |
| Hostile text in every renderer | `packages/mcp-core/src/render-injection.test.ts` |
| HTTP client for the public API | `packages/sdk` (`@hey-research-lab/sdk`) |
| Renderer tests, one per tool, on API-typed fixtures | `packages/mcp-core/src/render.test.ts`, `src/fixtures/api.ts` |
| Server tests over a real MCP client | `packages/mcp-core/src/server.test.ts` |
| The agent contract behind `research_answer` (schema, composers, freshness, machine-safe text, adapters) | `packages/agent-provider-core` (`@hey/agent-provider-core`) |
| `research_answer` on API-typed fixtures | `packages/mcp-core/src/agent-contract.test.ts` |

The server tests drive it through an actual `Client` over the in-memory transport: the tool
list (exactly twelve, thirteen with the flag, every one titled and read-only, under the old
list's size with its output schemas), every tool end to end on its fixture, the resources, the prompts, and every
failure.

## What is deliberately not here

- **No write tools.** Submitting a project, claiming ownership and posting an update are
  things a person does on the site, signed in, with an audit trail.
- **No sessions and no stream.** The producer behind the change ledger runs every few
  minutes; polling `get_changes` with a cursor is as fresh as a stream would be, and a
  stateless endpoint survives every deploy.
- **No hand-kept schema per API shape.** Since round 4 every tool declares an `outputSchema`,
  but for the other tools it is the wrapper's spine, not the API object's every field: a
  second, hand-kept schema for every shape would be a second source of truth. The API objects
  are typed by the SDK and described by `/openapi.json`.
