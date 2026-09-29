<div align="center">

# HEY Research Lab

**Find who's actually building on Robinhood Chain.**

[![CI](https://github.com/hey-research-lab/hey-research-open/actions/workflows/ci.yml/badge.svg)](https://github.com/hey-research-lab/hey-research-open/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-0a0d12)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-0a0d12)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-0a0d12)](https://www.typescriptlang.org)
[![Chain](https://img.shields.io/badge/Robinhood%20Chain-4663-c2fb03?labelColor=0a0d12)](https://heyresearch.xyz/pulse)
[![Site](https://img.shields.io/badge/heyresearch.xyz-live-0a0d12)](https://heyresearch.xyz)

[Site](https://heyresearch.xyz) · [Public API](docs/PUBLIC_API.md) · [MCP server](docs/MCP.md) · [Sources](docs/SOURCE_REGISTRY.md) · [Changelog](CHANGELOG.md)

![HEY Research Lab](docs/screenshots/home.png)

</div>

## The question

Not *which wallet bought* and not *which token is pumping*, but:

> **Which projects are still building, what have they shipped, and which of them is nobody looking at?**

Every answer on HEY is a fact with the source it came from. There is no score of a project's
worth, no grade, no verdict, and the words *rug* and *scam* appear nowhere in the product — an
end-to-end test asserts it.

## What it looks like

| Explore the catalogue | One project's evidence |
| --- | --- |
| ![Explore](docs/screenshots/explore.png) | ![Project page](docs/screenshots/project.png) |

| Builder Radar | HEY Signal |
| --- | --- |
| ![Builder Radar](docs/screenshots/builders.png) | ![Signals](docs/screenshots/signals.png) |

<details>
<summary>More surfaces: Pulse, Ships, Scout, Bounties, Developers, Methodology, mobile</summary>

| Pulse — the chain, day by day | Ships — what landed |
| --- | --- |
| ![Pulse](docs/screenshots/pulse.png) | ![Ships](docs/screenshots/ships.png) |

| Scout — earn by finding evidence | Bounties — set in dollars, paid in HEY |
| --- | --- |
| ![Scout](docs/screenshots/scout.png) | ![Bounties](docs/screenshots/bounties.png) |

| Developers | Methodology — every rule, stated |
| --- | --- |
| ![Developers](docs/screenshots/developers.png) | ![Methodology](docs/screenshots/methodology.png) |

| Home, 375px | A project, 375px |
| --- | --- |
| <img src="docs/screenshots/mobile-home.png" alt="Home on a phone" width="240"> | <img src="docs/screenshots/mobile-project.png" alt="A project on a phone" width="240"> |

</details>

Captured from production on 20 September 2026.

## In this repository

This is the published half of HEY: the parts that stand on their own and are safe to read.

| Path | What it is |
| --- | --- |
| [`packages/sources`](packages/sources) | Every public-data adapter HEY reads — GitHub, Blockscout, Sourcify (verification and its signature database), DEX Screener, GeckoTerminal, CoinGecko, launchpads, feeds, npm, deps.dev, OSV — each with saved fixtures and contract tests, plus the Telegram Bot API adapter HEY's alert bot sends through. The tests fail on a real network call. All of them go through one fetch guard (private-address and DNS-rebinding checks, redirect and credential rules, size, time and content-type limits) and bounded HTML and XML parsers, tested against hostile pages and feeds. |
| [`packages/scoring`](packages/scoring) | Activity status, Build Momentum, Still Building and Under the Radar, deterministic and versioned. They read no price and no balance, and that is tested. |
| [`packages/sdk`](packages/sdk) | `@hey-research-lab/sdk`, the typed client over the public API. No dependencies, ESM and CJS, Node 18 or a browser. |
| [`packages/mcp-core`](packages/mcp-core) | The MCP tools, renderers, resources and prompts with no transport: fourteen read-only tools, each answer tagged FACT, DERIVED or UNKNOWN. |
| [`apps/mcp`](apps/mcp) | `@hey-research-lab/mcp`, the stdio entry point that bundles them. Node 20. The same tools are hosted at `https://heyresearch.xyz/mcp`. |
| [`packages/config`](packages/config) | Environment schema and chain constants. |
| [`packages/ui`](packages/ui) | The presentation components — cards, chips, status, formatting, and the Terminal's candle chart (15m, 1H, 4H and 1D, with a code lane of commits, merged pull requests and exact-time releases), whose builder-event callouts are laid out from each event's time alone (`terminal-chart-annotations.ts`): never a price, never a cause. |
| [`docs/`](docs) | The public API, the MCP server, the source registry, and every data source with what it refuses and why. |

The ingestion pipeline, the quality gate, the database schema, the web app and the operations
tooling stay in the private repository.

## Quickstart

Use the packages from npm (published 27 September 2026):

```bash
npm i @hey-research-lab/sdk                                   # the typed client
claude mcp add hey-research -- npx -y @hey-research-lab/mcp   # the MCP server
```

Or build this tree:

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test     # 686 tests, no network
pnpm --filter @hey-research-lab/sdk build        # packages/sdk/dist
pnpm --filter @hey-research-lab/mcp build        # apps/mcp/dist/index.js
```

## Use the API

No key needed for the read API. 120 requests a minute anonymously, more with a key.

**One address, one line** — the call a trading bot makes:

```bash
curl "https://heyresearch.xyz/api/v1/scan?chain=4663&token=0xB33eb16782776b4D738c0Fd643577cb0284Db610"
```

```jsonc
{
  "found": true,
  "status": "shipping",
  "status_label": "Shipping",
  "verified_builder": true,
  "activity": { "commits_30d": 100, "releases_30d": 1, "ships_30d": 3, "last_ship": "2026-09-18" },
  "project_url": "https://heyresearch.xyz/project/hey-research-lab",
  "cta": { "label": "See the builder on HEY", "url": "…" }
}
```

A token HEY has no published page for answers `200` with `found: false`, so a bot prints nothing
rather than guessing.

A person asks the same question at [heyresearch.xyz/scan](https://heyresearch.xyz/scan), or inside
the Research Terminal at `/terminal/scan`, where the ⌘K palette offers it for any address HEY does
not track. One scan behind both, and the same boundary: who is building this, never what the token
might do next.

**The same thing, typed:**

```ts
import { HeyClient, HeyApiError } from '@hey-research-lab/sdk';

const hey = new HeyClient();
const card = await hey.scanCard(4663, address);
if (!card.found) return null;

for await (const project of hey.projects.items({ tab: 'still-building' })) {
  console.log(project.slug, project.lastShippedAt ?? 'no ship recorded');
}
```

A listed project with a token carries `tokenMarket` — the market state the card shows — and the
single-project route sends everything the listing does. `/api/projects/{slug}/market` adds the
contract's deployer, its pools and 1% depth, and a supply-concentration summary with no addresses
(2026-09-25).

A **Research Desk** is a reader's published board of projects: `GET /api/desks` lists them by last
change (never by popularity), and `GET /api/desks/{slug}` answers its projects, the curator's
self-declared handle and its facts over its window — projects, shipped, development spikes,
contract changes — with `null` and a reason for anything HEY cannot state (2026-09-30).

`/api/projects/{slug}/relationships` lists what a project is connected to and why HEY thinks so —
every edge with its standing and evidence, never an account and never a "partnership" — and the
snapshot's `peerContext` places some of its figures among comparable projects, one figure at a time,
never as a combined score (2026-09-28).

The snapshot (`/api/projects/{slug}/snapshot`) opens on `summary` — one answer-first line per
question (building, usage, market, contracts, security, the latest change, what HEY does not know),
each tagged `FACT`, `DERIVED` or `UNKNOWN` with its evidence ids — and carries `usage` (calls and
distinct caller addresses per day, never people, never summed into a window) and `security`
(audits, bounties, security.txt, advisories; context, never a verdict). `/api/projects/{slug}/usage`
adds the daily series (2026-09-28).

Paging follows the API's own cursor, a `429` arrives as `HeyApiError` with `retryAfterSeconds`
and is never retried for you, and an absent field means HEY does not know — never a zero.

**For an assistant** — fifteen read-only tools over the same API, hosted or on your machine, listed in the
Official MCP Registry as `io.github.hey-research-lab/hey-research`:

```bash
claude mcp add --transport http hey-research https://heyresearch.xyz/mcp

# or from npm
npx -y @hey-research-lab/mcp

# or from this repository
pnpm --filter @hey-research-lab/mcp build
claude mcp add hey-research -- node "$PWD/apps/mcp/dist/index.js"
```

Full reference: [docs/PUBLIC_API.md](docs/PUBLIC_API.md) · [docs/MCP.md](docs/MCP.md) ·
[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — the line to render, the three answers to handle,
and the four things not to do.

## For autonomous agents

From the domain alone, with no JavaScript and no cookies:

| Entry point | What it is |
| --- | --- |
| `https://heyresearch.xyz/llms.txt` | What HEY is, what it will not do, every machine entry point (llms.txt v2) |
| `https://heyresearch.xyz/.well-known/agent-card.json` | A2A 1.0 Agent Card; JSON-RPC at `/api/a2a`, six read-only skills |
| `https://heyresearch.xyz/openapi.json` | OpenAPI 3.1 for the public API |
| `https://heyresearch.xyz/mcp` | Hosted MCP (Streamable HTTP); listed in the Official MCP Registry as `io.github.hey-research-lab/hey-research` ([`apps/mcp/server.json`](apps/mcp/server.json)) |
| `https://heyresearch.xyz/api/hey/profile` | `$HEY` as research data: each utility LIVE, PLANNED, RETIRED or UNKNOWN |
| `https://heyresearch.xyz/developers/agents` | The guide (Markdown at `/developers/agents.md`) |

An agent that forms a thesis can record it as an
[AgentResearchReceipt](docs/AGENT_RESEARCH_RECEIPTS.md) — neutral, for any project, checked but
never stored or endorsed by HEY. HEY gives no trade instructions and runs no agents of its own.

## Sharing a record

Any eligible record — a ship, a release, a deployment, a development spike, a builder resuming,
a verified builder, a contract implementation or interface change, a HoodLock lock or unlock, a
material change to a project's official site, a weekly report, an event window — can be shared
from its page as a ready-made post for X or Telegram, a short plain text, a link or its raw facts.
The words come from one deterministic template module keyed by change type: the project first,
only facts HEY holds (a sentence is dropped rather than filled when a fact is unknown), with its
evidence id and source, and never promotional language. `GET /api/share/<subject>` returns the
same composition as JSON.

## Event research

`/events/<slug>` answers "What actually changed on Robinhood Chain during <event>?" from HEY's
change ledger inside the event's official window. Announcements made at the event are listed apart
with their official source and are never counted as shipped. The first is HOOD Summit '26
(`/events/hood-summit-26`).

## The badge

Any project HEY tracks can embed its own status. It updates itself, and it links back to the
evidence behind it.

[![HEY Research Lab on HEY](https://heyresearch.xyz/badge/hey-research-lab.svg)](https://heyresearch.xyz/project/hey-research-lab)

```markdown
[![My project on HEY](https://heyresearch.xyz/badge/<slug>.svg)](https://heyresearch.xyz/project/<slug>)
```

`?theme=dark` and `?style=pill` are the other two looks. [docs/BADGES.md on the site](https://heyresearch.xyz/docs/badges).

## Rules that do not move

- **Building is not price.** Market cap, liquidity and volume are context and filters. Nothing in
  `packages/scoring` reads a price or a balance; a neutrality test fails the build if it ever does.
- **Paying changes nothing organic.** Bounties, sponsorships, claims and `$HEY` holdings never move
  a rank, a status or a score.
- **No wallet analytics.** No PnL, no smart-money or whale labels, no wallet profiles, no clustering
  presented as a claim about people, no copy-trading. The schema guard fails the build on the words.
  One exception, decided on 2026-09-14: a bubble map of a **single token's** largest balances on that
  token's market page. An address there is a point on a chart of one supply — never a person, never
  scored, never ranked across tokens, never an input to any status or score.
- **Absent means unknown.** A figure HEY has not measured is omitted, never published as zero.
- **Security is evidence, never a verdict.** An audit shows an audit took place; it is not a
  guarantee of safety. HEY says where a report is published and where it found the link — no
  score, no "safe", and "no advisory found" is a reading of one index, never a clean bill.
- **A model is never the source of truth.** AI-assisted interpretation is optional and off by
  default; when on, it reads only HEY's own evidence, cites it by id, is labelled as an
  interpretation, and never moves a status, a score or a rank. `AI_PROVIDER` accepts `disabled` or
  `anthropic` only.
- **Every claim carries its source.** And none of them is a buy signal.

The full rules, with the thresholds they use, are on [the methodology page](https://heyresearch.xyz/methodology).

## `$HEY`, briefly

`$HEY` (`0xB33eb16782776b4D738c0Fd643577cb0284Db610` on Robinhood Chain) pays for evidence:
research bounties set in dollars and paid in HEY, claim bonds, and priority on research requests.
Holding changes what a reader pays, when they see new research and how much API the lab serves
them; $HEY worth at least $500 at the time of HEY's balance check, valued at HEY's own market
reading, also opens the Research Terminal beta. It never buys a rank, a status or a score.

## How this repository is produced

A script in the private repository copies the paths listed above, generates a types-only
`@hey/db`, refuses to publish anything that must not leave, and pushes one commit per sync. Issues
and pull requests are welcome here: a change accepted here is applied privately and comes back in
the next sync.

HEY reports what teams ship and whether a tracked token still has a market. It does not predict
prices, and nothing in it is investment advice.

MIT licence. See [CHANGELOG.md](CHANGELOG.md) for what has changed and when.
