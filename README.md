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

Price tells you what the market is doing. HEY tells you what the builder is doing.

Every answer on HEY is a fact with the source it came from. There is no score of a project's
worth, no grade, no verdict, and the words *rug* and *scam* appear nowhere in the product — an
end-to-end test asserts it.

A project page opens with its story: whether the builder is building (in plain words first),
the latest ship and why it matters as a build event, whether the product is used, the token
market as context, and what HEY does not know yet. Where HEY has nothing to read building from,
the page says so once and lists what it does know, what it cannot verify yet and what it is still
to read. A Research coverage block counts the dimensions HEY measured for that project — a count
of states, never a score. The badge and the story read one table of research-level words, so a
"Researched" page never says "Not researched yet", and a Verified Builder whose ships came from a
deployment reads "Verified builder · no shipping source HEY can read yet", never "not linked". A
latest change that is a market or lock event says so, and its link opens that event's own record.

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

Captured from production on 20 September 2026. Since 30 September 2026 the whole site wears the
Research Terminal's Luminous Glass material system — Lab Paper in light, graphite in dark, a glass
header, translucent cards, a search that opens as a palette — with the same simple, card-first
pages; the screenshots above predate it.

Since 1 October 2026 a first visit starts research-ready: Explore lists the projects HEY can
answer the builder question for (a measured activity status or a source-backed ship in the last
90 days), with every indexed project one press away; the homepage shows real project cards right
under the search; and a search that matches nothing says why and where to go next.

## In this repository

This is the published half of HEY: the parts that stand on their own and are safe to read.

| Path | What it is |
| --- | --- |
| [`packages/sources`](packages/sources) | Every public-data adapter HEY reads — GitHub, Blockscout, Sourcify (verification and its signature database), DEX Screener, GeckoTerminal, CoinGecko, launchpads, feeds, npm, deps.dev, OSV — each with saved fixtures and contract tests, plus the Telegram Bot API adapter HEY's alert bot sends through. The tests fail on a real network call. All of them go through one fetch guard (private-address and DNS-rebinding checks, redirect and credential rules, size, time and content-type limits) and bounded HTML and XML parsers, tested against hostile pages and feeds. |
| [`packages/scoring`](packages/scoring) | Activity status, Build Momentum, Still Building and Under the Radar, deterministic and versioned. They read no price and no balance, and that is tested. |
| [`packages/sdk`](packages/sdk) | `@hey-research-lab/sdk`, the typed client over the public API. No dependencies, ESM and CJS, Node 18 or a browser. |
| [`packages/mcp-core`](packages/mcp-core) | The MCP tools, renderers, resources and prompts with no transport: fifteen read-only tools, each answer tagged FACT, DERIVED or UNKNOWN. |
| [`packages/agent-provider-core`](packages/agent-provider-core) | The agent contract, AgentIntelligenceResponse v1: six bounded capabilities composed from the public API's own objects, the freshness contract, machine-safe text (`contentOrigin`), and thin REST, MCP and A2A adapters. The Robinhood Agent Apps adapter is an interface only, pending an official provider specification. |
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

## Which token, account and repository are a project's

An issuer's own token — a Robinhood stock token, read from the issuer factory's creation events
into `issuer_tokens` — is never a project's token, usage, valuation or market, and Scan says whose
it is. A site that only lists a contract among others does not verify it. A source copied from a
launch or market listing says so; Robinhood's own accounts are never a project's. Names that
borrow Robinhood's brand or a stock ticker carry a notice above every badge. Renamed GitHub
repositories are followed by GitHub's numeric id, and a pool is "Uniswap" only when the chain
confirms its factory.

A library or SDK repository, a test-data or fixture folder, a hand-kept deployments file deep in
the tree, a file that names another repository as its source, or an asset list never proves that a
token is a project's; a token a page took by a link that no longer holds gives that page no
verified-contract ship. A GitHub release counts once across pages by its numeric release id, even
after its repository was renamed. A description that claims a Robinhood partnership carries its
own notice. A QUIET or DORMANT status that lost the builder source it rests on is rescored first, to "No builder
source linked". Search lists an issuer's own token as its own row, above lookalikes.

A token a page took on a deploy record that no longer proves anything goes back to its own launch
record, logged and reversible.

A repository that only names a token is never that token's project and never verifies it
(2026-10-05). A tracker, radar, bot or dashboard names the tokens it watches in its code and prints
them on its site; neither is the token's word. A builder's repository pairs with a launch record only
when the launch record itself declared that repository or its owner, or a deploy record proves the
deployment — and an address file without the creating transaction proves nothing about a contract
twenty or more GitHub accounts name (a launchpad's token, a protocol's position manager, a platform
token used as collateral). Links made the old way go back to their launch record with its own site,
docs and X account, logged and reversible. When published projects share a name or a ticker on different
contracts, the project page, the Terminal, search and the type-ahead say so in one line, with what
each project's own site or deploy record names — never which one is "real". `/signals` lists
projects with Robinhood Chain evidence first within each group.

Whose repository it is, re-checked (2026-10-07). A repository HEY's GitHub search attached to a page
only because another repository by the same owner was already matched — before the ownership gate
existed — is scored again by today's gate: unless its homepage is on the project's own domain or the
project's own site links it, it stays on the page as context and its weeks stop counting
(`pnpm data:recheck-search-owners`, dry run by default). When two published pages carry one
repository, a page whose token the project's own site names (VERIFIED) holds it over a page whose
token it does not; otherwise the page HEY saw first, as before (`pnpm data:shared-repo-holders`).
Nothing is deleted; each change is logged.

A card's one line is a description, never a README (2026-10-03). Provider text — a listing, a
launchpad form, a repository's README — passes through one deterministic rule (`descriptionLine`):
Markdown, label headings, addresses, URLs and bot commands go; instructions, chat, relay
boilerplate and how-to sections are never the line; whole sentences are kept up to 200 characters.
Text with no description in it leaves the line empty rather than filling it with anything. A
project with no line takes its own site's meta description through the same rule, logged. Words an
owner typed are never rewritten.

Data correctness after a full audit (2026-10-03). The integrity audit no longer counts a Robinhood
stock token as an orphan (it belongs to no project by rule); a failing audit makes `/status`
critical and names the failing checks, and `/api/status` adds `integrity.failing`,
`catalog.hidden` and `catalog.hiddenAsOf` without changing any existing field. A verified
contract's timeline entry reads "Contract source verified", never "Contract deployed". A
description line keeps a dash before a closing emphasis mark, drops a mark left without its partner,
and is empty for text whose words run together. A repository that says it is a third-party profile
of someone else is never promoted into a project. Cards say "No token tracked" rather than "No
token".

Markets, the same day. A token that reads 0 decimals (an NFT collection) has no fungible market: no
valuation, Discovery Gap, Under the Radar or Still Building, and NFT marketplaces such as Seaport are
never read as a DEX. A market is never "Active" over a reading more than 36 hours old with no fresh
trade record ("No current reading"). A market active only in another pool prints no valuation from
the thin pool it follows. The Builder activity chart hatches weeks before HEY first read a project's
sources as "not yet read", never zero. Holder figures say what they leave out and which supply they
measure. A page under a publication hold says it is held and how the hold lifts, with no score,
badge or Terminal link.

One project, one page, and bounties HEY already answered (2026-10-03). A registry listing whose site
or official X account a published page already holds (tokenless, or with a verified token) joins
that page instead of opening a second one; an unverified token page, a "V2"/"V3" sibling or a
launchpad's shared site still gets its own. Registry pages opened before that are held by one
reviewed, reversible command (`pnpm data:duplicate-listings`, dry run by default) and their address
points to the project's page. An open research bounty whose fact HEY has since verified by other
evidence is no longer listed as open and cannot be claimed; the hourly sweep closes the
treasury-funded ones nobody handed in work for (logged, reversible, no money moves), and handed-in
work waiting more than seven days is flagged for review.

## Use the API

No key needed for the read API. 120 requests a minute anonymously, more with a key. Every answer names its
version in `x-hey-api-version`. A platform partner can ask for a partner key with its own quota and
route permissions; it reads the same public research, never anyone's account data (2026-09-30).

**Filters that say no, and exports (2026-10-02).** A value a parameter does not read is a `400
invalid_parameter` listing the allowed values, never the unfiltered list (`/api/ships?type=banana`,
`/api/projects?sort=momentum`). `/api/ships` reads `type=releases` (every release type), a comma
list of types, and `until` (exclusive) beside `since`; a code-activity ship carries `codeWeek`, its
fixed Monday–Sunday UTC week with that week's commit count and up to three commit subjects.
`/api/projects?sort=shipped7d|shipped30d` orders by meaningful ships in the window.
`/api/export/projects` and `/api/export/ships` return the same lists as CSV, at most 1,000 rows.

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
rather than guessing. Asking is still counted (2026-10-05): the partner card, the builder card,
`/api/token/…`, the agent contract's `verify_project` and `unknowns`, A2A's `investigate_contract`
and the MCP tools that read through them record the address once per caller a day (crawlers and
HEY's own traffic left out), and a scheduled, budgeted job reads DEX Screener's listing for asked
contracts that declare no website, so the site check and the quality gate have something to judge.
Asking never publishes.

A person asks the same question at [heyresearch.xyz/scan](https://heyresearch.xyz/scan), or inside
the Research Terminal at `/terminal/scan`, where the ⌘K palette offers it for any address HEY does
not track. One scan behind both, and the same boundary: who is building this, never what the token
might do next. It has one name (2026-10-01): the navigation says "Scan", and the page asks
"Is anyone building this?". A published project answers with its Research Summary and the doors
to follow it; anything unresearched says "Builder not established yet." and what HEY holds. What
readers keep asking about is summed per record (`research_demand`) and decides only what HEY
researches next — an hourly, capped sweep queues the canonical site, contract-source and
quality-gate jobs for the most-asked under-researched records — never a status, score or rank.
One contract is read live at most six times a UTC day, and a repeat scan within thirty minutes of
a live read answers from what that read recorded, dated, with when a fresh read is available.

The Research Terminal answers questions (2026-10-01). A reader previewing it is told what Terminal
access opens as questions about the project in view — full timeline, build evidence, usage history,
the market around releases, holders and locks, contract intelligence, Ask HEY in depth, watchlist
and alerts — filled from public identity only. Two ways in, said the same way everywhere and
explained at `/terminal/access` (2026-10-03): hold $HEY in a wallet you sign in with, or request
early access and an admin reviews it by hand. The same page's "Terminal vs free" table is built
from what the code actually gates, so the Terminal never claims to lock what the public site and
API already give away. The workspace Overview opens on the Research Brief, its lines led by
What changed? · Build · Usage · Market · Contracts · Evidence. Ask HEY never dead-ends: each answer
that cannot answer in full says why and offers next steps, including "Did you mean …" from the one
search matcher.

One project is fully open in the Research Terminal for every reader (2026-10-03): every tab, the
real data, no decoys — the console's choice, by default HEY's own project (since 2026-10-04, labelled
as such), else the published project with the most the Terminal can draw. Every other project's research stays behind the gate. HEY's own project's
row says "HEY’s own project — researched by the same rules" wherever it is listed. Each workspace
opens on a coverage strip (Build, Market, Usage, Intraday — states, never a score); HEY Today folds a
project's weeks of code into one line with "Show every row"; and, with the model layer on, the
Overview leads with a pre-answered Ask HEY brief for the most-opened projects, written ahead of time
from HEY's records, cached by their hash and held to half the day's AI budget.

The Research Terminal has a reader-facing guide at `/docs/terminal` (2026-10-04): what it is,
what stays free, how to get in, a tour of every view, the command palette and keyboard shortcuts,
how to read what it shows, and how to report a bug or ask for a feature. It is served only while
the Terminal resolves, and a test holds it to the access figures, the workspace's views, the keys
and the canonical sentences the code uses. Each step carries a real screenshot of the live
Terminal, taken signed out on the sample project (what a signed-out reader cannot open is shown
locked, as it is), drawn without layout shift and linked to the full-size picture. Since the same
day's redesign it reads as a guide rather than a document: the answer and one primary action
(open the sample project), three cards to start from, a table of contents, the access rules as
short rows, the tour as one card per view whose screenshot and fuller explanation open in an
accessible dialog, and the reading rules as definitions — about a quarter of its old length at
rest, with the words still in one markdown file.

Search, What changed and Compare say one thing (2026-10-01). The header type-ahead lists projects
first, labels an empty page that shares a researched project's name, and folds launch records of
one name into a single row that opens the search page (`emptyNamesake` and `moreLaunchRecords` on
`/api/search/suggest`, additive). A question typed into search is answered — a question about one
project with its latest ship and Research Summary lines, anything else with where Ask HEY answers
it — never "nothing matches". "What changed" is always `/updates`; HEY Signal is "Signals", and
each page says what its count counts. "Compare with…" sits on every project page and under search
results; `/api/compare?a=&b=` mirrors `/compare?a=&b=`, and each compared project carries
`valuation: { usd, kind, label }` beside `marketCapUsd`, which may be an FDV. Explore names its
sets in one line: published projects · research-ready · verified builders.

Round 3 (2026-10-01): "Evidence →" opens `/evidence/<id>`, the receipt in words — source, dates,
whether it counts toward building and what it does not establish — with `/api/evidence/<id>` as
"As data"; machine surfaces still cite the API. Section links are built from one list of the
project page's anchors and only to a section the page draws. The type-ahead says "Several" where
its read was cut, the project page holds one current liquidity figure (the rest, each named, are
the market page's), and the market page names each date by what it dates.

HEY Signal's `confidence` (0–1) is a method statistic — how much evidence a rule read, which
scales `importance` — never a probability or a trading confidence. The API keeps it; since
2026-10-01 no HEY page prints it, and `/signals` shows one row per kind per UTC day with its true
count, opening to the projects.

**Builder intelligence in your product, in one call** — the Partner Card (2026-09-30):

```bash
curl -H "x-hey-integration: my-bot/1.0.0" "https://heyresearch.xyz/api/v1/builder?chain=4663&token=0x…"
```

Builder status in HEY's words, verified builder, the latest meaningful ship with its evidence id,
meaningful ships in 30 days (`null`, never 0, when not measured), the latest builder-side change and
signal, the token's market state as context, a badge and `project_link` — the page to link, labelled
so HEY can count your click-through. Since 2026-10-05 the latest ship also carries `evidence_link`
(its receipt page, labelled the same way), and partner answers are `private, max-age=60`: every call
reaches HEY and is counted, never served from a shared cache. The fields, the rules of use and eight tested examples
(Telegram, Discord, a trading terminal, a DEX, a launchpad, an explorer, a directory, an AI agent)
are at [heyresearch.xyz/developers/partners](https://heyresearch.xyz/developers/partners) and in
[docs/PUBLIC_API.md](docs/PUBLIC_API.md).

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

The developers page opens on a fifteen-minute quickstart (2026-10-05): the curl against a live
contract, the typed `hey.builderCard(4663, token)` with `new HeyClient({ integration: 'my-product/1.0.0' })`,
and a small React panel that prints nothing when HEY has no answer — with how evidence ids resolve
(`GET /api/evidence/{id}`) and the rate limits the deployment enforces. HEY counts an integration as in
use when an identified caller (a key, or a declared `x-hey-integration` name) is answered on two or
more distinct days and five or more times within seven days; a name sent with no key is only
observed until then, and the example names in these docs (`my-product`, `your-product`) and `hey-`
names are never counted. That count is traffic, never an input to any project's status or rank.

A listed project with a token carries `tokenMarket` — the market state the card shows — and the
single-project route sends everything the listing does. `/api/projects/{slug}/market` adds the
contract's deployer, its pools and 1% depth, and a supply-concentration summary with no addresses
(2026-09-25).

A **Research Desk** is a reader's published board of projects: `GET /api/desks` lists them by last
change (never by popularity), and `GET /api/desks/{slug}` answers its projects, the curator's
self-declared handle and its facts over its window — projects, shipped, development spikes,
contract changes — with `null` and a reason for anything HEY cannot state (2026-09-30). Any
signed-in account may curate and publish one; readers can report a desk, and HEY's moderators can
take one down.

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
and is never retried for you, and an absent field means HEY does not know — never a zero. A keyed
account's monthly allowance is counted per UTC month; once it is spent every counted call answers
`429` with the reset date until the first of the next month, and HEY's operators see the account
as exhausted (from 80 % they see a warning) rather than learning it from the caller. A `503
service_unavailable` with `retry-after` means HEY's database was busy for a moment; ask again
(2026-09-30).

A value a listing cannot read is refused, never dropped into a wider answer: an unknown `type` or
`domain` on `/api/changes`, an unknown Radar `filter` on `/api/builders`, like an unknown `tab` or
`sort` on `/api/projects`, is a `400 invalid_parameter` naming the values it accepts, and a change
cursor past the end of the ledger is a `400 invalid_cursor`. Only an unknown parameter *name* is
ignored. The OpenAPI document states each of those vocabularies as an enum (2026-10-03).

**For an assistant** — fifteen read-only tools over the same API, hosted or on your machine, listed in the
Official MCP Registry as `io.github.hey-research-lab/hey-research`. The research profile at
`/mcp/research` is builder intelligence first: no market-move, Under the Radar or valuation tool,
while `research_answer` there still carries its agent contract's market context, labelled context
only:

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

## The open ecosystem

Ten more repositories sit beside the mirror, each independent,
MIT and Robinhood Chain only: [hey-project-manifest](https://github.com/hey-research-lab/hey-project-manifest)
(the `/.well-known/hey-project.json` declaration — declared, never verified),
[hey-ship-action](https://github.com/hey-research-lab/hey-ship-action) (ship evidence from a GitHub
workflow), [hey-agent-contract](https://github.com/hey-research-lab/hey-agent-contract) and
[hey-research-receipts](https://github.com/hey-research-lab/hey-research-receipts) (the public agent
and receipt contracts, byte-faithful with parity tests), [hey-cli](https://github.com/hey-research-lab/hey-cli),
[rhchain-registry](https://github.com/hey-research-lab/rhchain-registry) (sourced infrastructure
registry), [chainprint](https://github.com/hey-research-lab/chainprint) (offline Robinhood Chain marker
detector), [hey-embed](https://github.com/hey-research-lab/hey-embed),
[hey-telegram-bot](https://github.com/hey-research-lab/hey-telegram-bot) (read-only, public API only) and
[hey-data](https://github.com/hey-research-lab/hey-data) (snapshots of HEY's own facts, CC BY 4.0; no
market or provider data). None reads HEY's database; production does not consume any of them yet. HEY serves its own manifest at
[`/.well-known/hey-project.json`](https://heyresearch.xyz/.well-known/hey-project.json), derived from
the machine identity, as the working reference; `/developers#open-source` maps each package to its
job. An outside-in check on 2026-10-02 (fresh clones and npm installs as a builder, a developer and
an agent) led to 0.1.1 of nine of them.


## For autonomous agents

From the domain alone, with no JavaScript and no cookies:

| Entry point | What it is |
| --- | --- |
| `https://heyresearch.xyz/llms.txt` | What HEY is, what it will not do, every machine entry point (llms.txt v2) |
| `https://heyresearch.xyz/.well-known/agent-card.json` | A2A 1.0 Agent Card; JSON-RPC at `/api/a2a`, six read-only skills |
| `https://heyresearch.xyz/openapi.json` | OpenAPI 3.1 for the public API |
| `https://heyresearch.xyz/mcp` | Hosted MCP (Streamable HTTP); listed in the Official MCP Registry as `io.github.hey-research-lab/hey-research` ([`apps/mcp/server.json`](apps/mcp/server.json)). Every tool returns typed `structuredContent` with an `outputSchema` |
| `https://heyresearch.xyz/mcp/research` | The MCP research profile: builder intelligence only — `research_answer`, a project lookup by identity, the ledger without market events, timeline, explain, evidence, contracts; no market-move, Under the Radar or valuation tool |
| `https://heyresearch.xyz/api/hey/profile` | `$HEY` as research data: each utility LIVE, PLANNED, RETIRED or UNKNOWN |
| `https://heyresearch.xyz/developers/agents` | The guide (Markdown at `/developers/agents.md`) |
| `https://heyresearch.xyz/api/agent` | The agent contract: `research_project`, `what_changed`, `builder_status`, `verify_project`, `compare_builders`, `unknowns` — the same answer on REST, MCP (`research_answer`) and A2A |
| `https://heyresearch.xyz/developers/robinhood-agents` | HEY for Robinhood Agents: the questions, the four interfaces, the evidence model and privacy. Integration readiness; HEY Research Lab is not currently an official Robinhood Agent App. A demo that answers four questions from live data is at `/lab/robinhood-agent` |

**Start in one minute** — each of these was run against production before it was documented; no
key, no account, no install for the hosted doors:

```bash
claude mcp add --transport http hey-research https://heyresearch.xyz/mcp        # Claude Code, hosted
# any MCP client, hosted:  { "mcpServers": { "hey-research": { "type": "http", "url": "https://heyresearch.xyz/mcp" } } }
# any MCP client, local:   { "mcpServers": { "hey-research": { "command": "npx", "args": ["-y", "@hey-research-lab/mcp"] } } }

# REST end to end: find a project that shipped this week, read it, open the evidence behind it
BASE=https://heyresearch.xyz
SLUG=$(curl -s "$BASE/api/projects?tab=shipping-now&limit=1" | jq -r '.items[0].slug')
ID=$(curl -s "$BASE/api/projects/$SLUG/snapshot" | jq -r '[.summary.lines[].evidence[]?.id][0]')
curl -s "$BASE/api/evidence/$ID" | jq '{id, summary, sourceUrl, verification}'
```

The same flow in TypeScript, with A2A and a raw MCP call, is on
[`/developers/agents`](https://heyresearch.xyz/developers/agents). Name your software (an MCP
`clientInfo` name, or `x-hey-integration: <name>/<version>` on REST and A2A) so HEY can tell an
agent's use from a registry probe when it counts use — your own name, not the `my-agent` of the
examples, which HEY files as a test client; it changes no answer. The hosted endpoint
answers JSON to a client that accepts `application/json` alone (2026-10-05).

An agent that forms a thesis can record it as an
[AgentResearchReceipt](docs/AGENT_RESEARCH_RECEIPTS.md) — neutral, for any project, checked but
never stored or endorsed by HEY. HEY gives no trade instructions and runs no agents of its own.
HEY is not an official Robinhood Agent App.

The agent contract has a deterministic quality benchmark
([`packages/agent-provider-core/src/benchmark`](packages/agent-provider-core/src/benchmark)): 75
questions from "What has AgentOS shipped recently?" to "Which token should I buy?", each mapped to
one call by a checked-in table, judged on the schema, evidence, unknowns, freshness and the absence
of any trading output. Run it against a deployment, read-only and paced:
`pnpm --filter @hey/agent-provider-core bench -- --base-url https://heyresearch.xyz`.

An adversarial review from eight perspectives (a platform PM, an integration engineer,
compliance, security, an AI platform engineer, a builder on the chain, a trader and HEY's own
methodology) tightened the contract, additively: `what_changed` leads with what counts as building
and takes `building=only`; a comparison says when it did not happen; the 64 KB bound is held when
an answer is made; invisible Unicode tag characters are stripped and instruction detection reads
normalised text; a caller's text is never repeated back as HEY's words.

A design and data-wiring audit (2026-10-01) held the same rule on the answers: a null
`latestMeaningfulChange` now carries `latestMeaningfulChangeReason` — `not_in_recent_changes`
when HEY holds meaningful building that is not among the newest changes listed, so null is never
read as "none" — and the explain engine calls a project Under the Radar only on a positive gap,
as `/radar` does.

Every line of a project's Research Summary (`summary.lines` on the snapshot) carries a `basis`:
a FACT either cites typed evidence ids or names a basis no evidence id can cite — a market
reading, a usage reading, HEY's own registry record, a field of the canonical read, the change
ledger or a coverage state. A FACT with neither is never published as a FACT.

## What counts as shipping (2026-10-02)

Outside readers found automation leading the ship feeds. Since 2026-10-02 a commit from a bot
account (`*-bot`, bot e-mails) or from an automated stream — one templated message repeated on a
clock, or carrying its own changing timestamp or figures — is kept on the record and never counted;
a CI-only commit is maintenance; a week of 25 or more commits counts as building only when 3 of a
10-commit sample change code (`commit-substance-v3`). Date-stamped automated tags
(`data-2026-10-01`, `backend-202610010354-6802318`) are rolling tags; a sitemap, an oEmbed card,
a comments feed or (since 2026-10-07) any feed on HEY's own host is never a release feed, and a
reader's comment or a HEY page is never a ship. A launch pool is
"Launch pool only", never a measured market: no Discovery Gap, Under the Radar or Still Building.
A project with no repository, changelog or feed linked reads "No builder source linked", never
Dormant. Sources are read on their project's current tier, HOT first. `/ships`, `/this-week` and
"Recently shipped" put releases and launches above commit summaries within a day, show a
repository's releases of one day once and one GitHub release once. A repository that only lists
Robinhood Chain among many chains is no longer published as a Robinhood Chain project; the pages
published before the rule are held only by one reviewed command, `pnpm data:publication-holds`
(reversible, logged).

Since scoring `hbm-v23` (2026-10-03) a release burst is one ship: a repository's full GitHub
releases of one UTC day count once — the newest corroborated one stands for the day — in activity
status, Build Momentum and every count of building. Prereleases keep their weekly rule, two
repositories on one day count as two, a release whose ship id names no repository is never
collapsed, and every release stays on the timeline. Chain feeds show the burst as one line ("27
releases in owner/repo on 1 Oct") and `/signals` announces it once, by count.

Since scoring `hbm-v24` (founder ruling, 2026-10-03) a deploy batch is one ship: a project's
follow-up contract deployments recorded in the same UTC second count once — the newest
corroborated one stands for the batch — in activity status, Build Momentum and every count of
building. Deploys a second apart count apart, an upgrade is never part of a batch, and every
contract stays on the timeline with its creating transaction. Chain feeds show the batch as one
line ("4 contracts deployed by the project's deployer at 16:02:38 UTC on 30 Sep") and `/signals`
announces it once, by count.

Since scoring `hbm-v25` (2026-10-07) Resumed building is called only on a gap HEY watched: every
ship of the comeback must come from a source HEY was already reading when the gap began — the
earliest attachment of the sources its evidence names, at or before the last update before the
gap. A repository HEY began reading during the gap, or a ship whose source HEY cannot name, is not a
return: the project reads Shipping or Active by the ordinary rule, and the score says why
(`resumedWithheld`). The 14-day window and the 60-day gap are unchanged.

A week of code activity has one title everywhere (2026-10-03): "Code changes, week of 2026-09-28 –
2026-10-04", the fixed UTC week it is keyed on, on the ledger, the API, the partner card and every
page; pages that read the week add its own commit count. "Week of" always names the Monday. Every
count of meaningful events — the snapshot, the agent answers, the Terminal — is the scorer's: a
week HEY read as documentation only counts nowhere. Rows written before are rewritten by one logged,
reversible command, `pnpm data:code-week-titles`.

## Following and what changed

Follow a project and it joins your private watchlist; the project page then offers the alerts
that can fire for it — a release, a contract implementation change, building resuming, an
official docs or site change — as one press. In the Research Terminal, Follow carries one box,
ticked by default, that turns on alerts for every project you follow: a release, a contract
deploy, an implementation change, an unlock due within 7 days, a Market Integrity event or an
activity status change — never a price or trading alert. An empty watchlist is offered a starter
set of recently shipping projects to choose from (never read from your wallet), and a daily email
of what changed on the projects you follow is one switch away (off by default, to a confirmed
address only, nothing on a quiet day). `/updates` is the public "What changed": the
change ledger grouped by meaning, and, signed in, what changed on your projects since you were
last here first. Every row, alert email and Telegram alert opens the change on the project's
page, with its source. The HEY Telegram bot (2026-10-05) answers a lookup the way a card does:
a bold title with the status as text ("🟢 Shipping"), one canonical sentence, one short line per
fact, one "context, not a verdict" note, and buttons to the project, its evidence, a share and —
in your own linked chat — Watch. `/start` opens with a banner and a menu; groups get text and
public links only. Since 2026-10-05 the bot travels between chats: type `@HeyResearch_Bot $TOKEN`
in any chat for a selectable research card (inline mode), mention it in a chat it is not in
(Telegram's Guest Mode) — or reply "research this" to a message naming a contract or ticker —
and "Add HEY to a group" puts it in your own. In a group it stays quiet unless asked; its admins
can have it watch projects and send the group's meaningful builder changes (at most three
messages a day) or one daily digest. Never price, never a group's conversation, never anyone's
private watchlist. Since 2026-10-09 an address or ticker HEY has not published answers with
what HEY holds — its record, launch, the card's market reading, the links its listing declared
(as unverified text) and every token sharing the symbol, with a true count — and an explicit
request in a chat reads the address live through the same HEY Scan as the website, after the
bot has answered and within per-reader and per-group limits (never in inline mode or Guest Mode).
`/telegram` (2026-10-06) is a small page with one way in — Try HEY in
Telegram — the commands, inline mode, Guest Mode, the group watch and what HEY keeps; it exists
only while the bot is switched on. The HEY Mini App (2026-10-06) is the same research inside
Telegram: open it from the bot's menu button or a card's "Full research", search a project,
`$TICKER` or contract, and read its builder status first, then its latest ship and evidence, its
recent ships and the market's state as context; Share sends the bot's research card to a chat,
Watch opens the bot on that project. It is read-only, takes your Telegram theme, keeps nothing
about who opened it, and works as an ordinary page outside Telegram. HEY counts how the bot spreads as groups added, groups
activated by someone outside HEY's staff and groups that come back on two or more days — never
people, never a chat's messages — and keeps a link from one group's card to a new group (measured)
apart from a mere coincidence in time (estimated); neither is called a referral. An alert email's links carry `utm_medium=email&utm_campaign=alert`
(2026-10-05), so HEY can count that an alert brought a reader back — a count of returns, never
who returned.

Without an account (2026-10-02): `/feed/updates.xml` and `/project/<slug>/feed.xml` carry the
public change ledger, each item dated by the event's own date and keyed on its ledger id, and
every page with a feed declares it in its head. An email address alone subscribes to the weekly
digest, a daily digest or one project's changes — double opt-in, one-click unsubscribe that
deletes the address, nothing else stored. Data checks (two of HEY's own readings disagreeing)
fold under their own heading; "+N more" opens the kind's full list; "Today" is a UTC calendar
day. Telegram alerts are not available yet.

A correction is not news (2026-10-03): every "what is new" window — Today, What changed,
`/updates`, the email digests and alerts — dates a change by when it *first* reached HEY, and a
later revision (a repaired title, a return after a retraction) keeps that time, so history revised
later never comes back as new and never alerts twice. `/api/changes` and webhooks still deliver
each revision in ledger order, so a mirror receives the corrected content.

## For builders

`/builders/guide` is the one-screen checklist: get researched, get linked, read as shipping,
become a Verified Builder, claim (GitHub or a wallet), keep the page accurate, show the badge.
A contract your site links on the explorer becomes a declared contract HEY watches once the
chain confirms it holds code; a verified owner can add product contracts the same way. Every
surface prints one status label, and a share leads with the strongest true fact.

## Sharing a record

Any eligible record — a ship, a release, a deployment, a development spike, a builder resuming,
a verified builder, a contract implementation or interface change, a HoodLock lock or unlock, a
material change to a project's official site, a weekly report, an event window — can be shared
from its page as a ready-made post for X or Telegram, a short plain text, a link or its raw facts.
The words come from one deterministic template module keyed by change type: the project first,
only facts HEY holds (a sentence is dropped rather than filled when a fact is unknown), with its
evidence id and source, and never promotional language. `GET /api/share/<subject>` returns the
same composition as JSON.

## Where a shared link lands

A project page opened from a HEY badge, widget, partner card, shared link, the Telegram bot or an
agent's answer says so in one quiet line, in fixed words that never repeat what the link carried,
with HEY's thesis and a way to the Research Terminal's open sample project. The campaign labels the
link carried are counted once and then removed from the address bar, so a copied link does not
carry them on. Counts are per day-bound tab session; nothing joins two days or a visit to an account.

A project's whole research summary can be shared too ("Share this research", subject
`research:<slug>`): a post that carries the building lines and never a market figure, and a
citation that lists every summary line with its tag (Fact, Derived, Unknown), when HEY read it,
and each evidence id with its page and its receipt, ending in a link back labelled
`utm_source=cite`. A weekly builder recap (`recap:<slug>`) states the canonical 7-day count of
meaningful development events and the newest meaningful ship, and exists only for a measured week
with at least one. Usage resuming after a silence (`contract.method_resumed`) is shareable as usage,
never as building. `/researchers` walks the path: search, the summary, building beside the market,
the evidence, the citation. Nobody is paid, rewarded or ranked for sharing.

## Event research

`/events/<slug>` answers "What actually changed on Robinhood Chain during <event>?" from HEY's
change ledger inside the event's official window. Announcements made at the event are listed apart
with their official source and are never counted as shipped. The first is HOOD Summit '26
(`/events/hood-summit-26`).

## Around a ship

A project page shows what HEY observed in the week before and the week after the project's latest
ship — the token's price move, volume and liquidity, and its contracts' calls and distinct caller
addresses — each with its state and source, and only where it was measured. The Terminal chart
shows the same for any event a reader selects, and `GET /api/projects/<slug>/around/<eventId>`
returns it as JSON. Observed around the same time: HEY never claims a release caused a move.
Collection starts at the first price, liquidity or volume reading — not at a day that holds
back-filled trade counts alone — and a ship before it says when HEY began reading
(`market.collectedFrom`, `usage.collectedFrom`). For days HEY never read itself, the price and volume
come from the provider's daily archive of the same pool (GeckoTerminal's OHLCV, read once and kept
apart from HEY's own readings): every such row says "provider archive", with the source and when HEY
read it, and the archive never supplies a liquidity or a valuation. It is display context only — no
status, score, gap, badge, signal or order reads it.

HEY also runs this across its whole record, for its own use (rules `before-attention-v1`): every
meaningful ship it knew of at the time, set against quiet builders on the same days. T0 is when HEY
first held the work, never the source's date; work HEY read late or the change ledger took as
backfill is excluded and counted; every exclusion, every unmeasured window and both tails of the case
studies are shown. It is an analysis, never a forecast or a market signal, and nothing that decides a
status, a score or an order may read it.

## Uniswap on Robinhood Chain

HEY links a project's token to its page on the Uniswap web app when the chain shows it in a Uniswap
pool — liquidity in Uniswap v4's published PoolManager, or a pool Uniswap's published v2/v3 factory
created. A venue a data provider merely *names* "uniswap" is not enough, and forks are never called
Uniswap. Market activity never affects HEY's builder research. See
https://heyresearch.xyz/integrations/uniswap. Uniswap is a trademark of Uniswap Labs; HEY Research
Lab is not affiliated with or endorsed by Uniswap Labs.

HEY also records which Uniswap v4 hook contract each v4 pool on Robinhood Chain names, from the
PoolManager logs its pool scan already reads, and which hooks a launch protocol's own event names.
A hook is kept as a contract — never an account, a pool count or a volume. Since 2026-10-02 HEY
reads who created each hook from the explorer, compares the sender with the account that launched a
tracked project's token, and keeps only the outcome. A hook the project's own token deployer created
is recorded as an ordinary follow-up deployment, counting exactly like any other contract it
deploys; a hook a launch protocol or a factory created is context. Each attributed hook has an
evidence id, `v4hook:<chainId>:<address>`.

Since 2026-10-04 the hooks HEY ties to a published project are listed at
https://heyresearch.xyz/integrations/uniswap/hooks and as data at `GET /api/v4-hooks`: each with the
project's activity status, how it is tied and its receipt, when it was deployed and first used, the
callbacks its address declares, and market context labelled as context — newest deployment first,
never ranked. Every other hook is one aggregate count, never listed or grouped by who created it.
The deployment of a project's hook is one ledger event that says it is a hook (`facts.v4Hook`), and
a hook the project only declares gets its own canonical event; both reach What changed, alerts, RSS
and webhooks like any contract deployment.

The list shows one card per published project, its hooks inside, the project with the newest hook
deployment first (`GET /api/v4-hooks` adds the same grouping as `projects[]`). HEY also reads
Uniswap's public hooklist (github.com/Uniswap/hooklist) once a day, conditionally, as context: for a
listed hook it shows "Listed in Uniswap's hooklist as <name>", linked to the file at the commit it
read, and both readings when the listed flags and the address disagree. It keeps the name, flags,
properties, path and commit only — never the list's descriptions or deployer accounts — and a listing
never ties a hook to a project. Coverage is counts: how many listed hooks HEY has seen in a pool, and
why the rest are missing (HEY finds a hook when a pool is created with it).

The hooklist is also a source of leads for HEY's own attribution, never proof: a listed hook is read
ahead of unlisted ones in HEY's creation-read queue, first when the listing's claimed deployer equals
a published project's recorded token deployer (compared in memory; only the outcome is kept, never the
account). HEY's own read of the creator still decides every attribution. Listed names that match a
project's name — never on generic words such as launch, meme, token, swap or hook — are shown to
HEY's own moderators as leads, never publicly.

Since 2026-10-04 the list names every project shipping a hook that HEY can tie to it, each hook
labelled by what the tie rests on: "Proven on chain", "Listed by the project", "Made by the
project's factory" or "Confirmed by HEY's review". A hook a factory contract created is listed under
a project only when HEY ties the factory itself to it — the factory is the project's own follow-up
deployment, read from the chain, or the project's official contract listing names it — and then once
per project, as a count with a few examples: instances are the factory's product in use, never
counted as the project's shipping. A hook can also be confirmed by HEY's review: a person checks it
against the project's own material, the confirmation is audited and reversible, and it is labelled
apart from chain proof; it never counts as shipping, and HEY's own reading of the chain supersedes it.
Neither is a ledger event. Who created a hook or a factory is compared in memory and never stored.

Since 2026-10-04 the list is wider and fills faster. HEY reads 1,400 hook creation records a day,
leaving the other explorer work what its own record says it needs, and reads last the hooks whose
first pool was created through a launchpad's own factory (the chain's node says so; they are still
read). A hook one of a project's qualified linked addresses created — the deployer of its token or of
a contract it lists, the signer of its verified on-chain claim, a treasury it published, its launch
or liquidity manager — is listed as "Created by an address linked to the project", the relationship
named, never the address, and never counted as shipping. Builders' own submissions to Uniswap's
hooklist that name a project's official website are shown to HEY's moderators as leads to confirm by
review; HEY keeps only the hook address and the website host from them.

## Terms and privacy

What HEY records about a reader, what it never stores and for how long:
https://heyresearch.xyz/privacy. The terms of using the site, the API and the MCP server — research,
not advice; no trade execution; keys, allowances and limits; and Uniswap Labs' own terms for
quotes: https://heyresearch.xyz/terms.

Signed-in readers can download everything HEY holds about their account, or delete it, from their
account page; what deletion keeps (the treasury's record of a transfer, a closed vote's tally,
published research, the audit trail) stays with nothing linking it to them. Anyone signed in can
report an error on a project page; a moderator checks it against the page's sources, and a report
never changes a status, a score or a ranking by itself.

Who runs HEY, what it is not and how it is funded: https://heyresearch.xyz/about. What HEY's words
mean, in plain language: https://heyresearch.xyz/glossary. What HEY got wrong and fixed — accepted
error reports and the changes it withdrew from its own record, never naming a reader or a hidden
project: https://heyresearch.xyz/corrections.

## The badge

Any project HEY tracks can embed its own status. It updates itself, and it links back to the
evidence behind it.

[![HEY Research Lab on HEY](https://heyresearch.xyz/badge/hey-research-lab.svg)](https://heyresearch.xyz/project/hey-research-lab)

```markdown
[![My project on HEY](https://heyresearch.xyz/badge/<slug>.svg)](https://heyresearch.xyz/project/<slug>?utm_source=badge&utm_medium=readme)
```

The link's `utm_source=badge` lets HEY count a click from your README as the badge's, as a number
and nothing more.

`?theme=dark` and `?style=pill` are the other two looks. [docs/BADGES.md on the site](https://heyresearch.xyz/docs/badges).

### Share pack for builders

Every verified builder's page has a share pack at `https://heyresearch.xyz/project/<slug>/share`:
what HEY verified (status, latest ship and its evidence, the sources HEY reads as yours), the claim
link, a ready X post, a Telegram message, a plain text for a token page or social terminal, the
README badge, the website embed and the canonical links. Every sentence is generated from what HEY
recorded — no price, no forecast, and a figure HEY did not measure is left out, never shown as 0.
HEY posts nothing for you.

### The HEY GitHub App (optional)

When HEY's GitHub App is live, a builder can install it on the project's repository from the claim page or the
share pack. Installing it proves the HEY page is yours (for the HEY account that started the install, when your
own GitHub account installed it), and HEY re-reads the repository a minute after you publish a release or push to
your default branch — the same rules decide what counts as shipping; the app never counts anything by itself.
Read-only by default (Metadata and Contents read). An optional pull request adding the badge to your README is
opened only when you press for it, on a new branch, and never on your default branch. It never changes a status, a
score or an order.

### Live widgets (Embed Kit)

A live builder widget for any site — activity status, the latest ship, meaningful ships in 30
days, verified builder, or the latest changes — from HEY's own records, with no price, score or
rank. One script, one element; the configurator at
[heyresearch.xyz/developers/embeds](https://heyresearch.xyz/developers/embeds) also hands out a
React snippet and the API call.

```html
<script src="https://heyresearch.xyz/embed/hey-project.js" async></script>
<hey-project project="<slug>" variant="builder" theme="auto"></hey-project>
```

The script reads only its own attributes, sets no cookie and draws one sandboxed frame; HEY counts
that a widget was shown and the host's domain, never who saw it.

## Coverage of the chain

HEY reads every launchpad factory it has a verified entry for and, since 2026-09-30, the chain's
own Uniswap V2 and V3 factories, so every token that was launched or given a pool becomes a token
record. A token is not a project: a record becomes a public page only through the quality gate.
To find the builder behind a token, HEY asks GitHub which repositories name the token's contract
and links one only by a corroborating tie — the token itself declared the repository and it names
the contract back, or the repository's homepage is the token's own site. It also reads the deploy
records in each project's own official repository — a Foundry broadcast, a hardhat-deploy network
or a deployments file for chain 4663 — and a record that names a token HEY holds ties that token
to the project (a fork, a token list, a mock or a reference to someone else's asset never counts).
Explore's "With a token" view says how many token contracts HEY knows, how many reached a page and
how many of those carry the builder's repository, and how that repository is tied to the token;
for the rest, the builder is not found yet.

Decoded trades name what the factories miss. Two lanes read every token traded on the chain over
a rolling 120 days — a UTC day at a time at twenty distinct traders, and a UTC hour at a time at
two for a known launchpad's venue — and keep a ledger of the days and hours read to the end, so a
settled one is never asked again. A slice the provider's ten-page ceiling cuts short is halved
until it finishes. Bitquery meters in points, so each request books its measured cost and the day
stops at 85% of the plan's share; a backfill reads only while a third of the day's points remain.

## Counts

Every public count names its set, links to the list it counts and says when it was counted. The
verified builders on Robinhood Chain (the Verified builder badge plus chain evidence) and the badge
on every chain are two figures with two names; the strip's "shipping now" is the Shipping tab's own
count; `/methodology#counts` lists every figure with its scope; `/api/projects` returns the same
figures in `catalogue`, scoped and dated, beside the unchanged `verifiedBuilders`.

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
  A Discovery Gap is measured only on an active market (2026-09-30). On a thin market or a launch
  curve it reads "not measured — market too thin", and the API says why
  (`discoveryGapWithheld`). Still Building is measured on the same markets only: elsewhere it is
  "not measured", never "not met" (`stillBuildingWithheld`, scoring `hbm-v19`), and
  `stillBuildingState` (`HELD`, `NOT_HELD`, `NOT_MEASURED`) sits beside every `stillBuilding`.
  A market active only because another pool of the same token holds the liquidity is measured on
  that pool's reading, never on the thin pool, and not at all when HEY holds no reading of it; a
  project with no tracked token, or whose building HEY cannot read, is "not measured" too; and
  Under the Radar is stored only beside a positive gap (scoring `hbm-v21`).
- **A valuation must be plausible from the readings HEY has.** A market cap or FDV at least
  10,000× the liquidity in the same reading, or above $10B on a Robinhood Chain token no listing
  HEY reads carries, is never printed, never FACT and never a scoring input; it reads "Not
  plausible" with its reason (`valuationWithheld`, scoring `hbm-v20`).
- **HEY's own token is researched by the same rules.** `$HEY`'s card says "HEY’s own token —
  researched by the same rules", and the API marks it `heysOwnToken: true`. The flag is set after
  a list is ordered: no bonus, no demotion.
- **A borrowed brand is not an affiliation.** A project whose name or ticker uses Robinhood's name
  ("Robinhood", or "HOOD" as a word) is kept off the homepage, Under the Radar, the featured spots
  and the Builder Radar until HEY verifies a builder behind it — and a name that claims Robinhood's
  authority ("official", "team", "labs", "foundation", "inc" beside it) stays off even then; its
  page stays open and says HEY holds no evidence Robinhood is involved.
- **HEY's own project has no pinned place.** It takes its position on every list by the same
  rules as every project.
- **A site two projects declare is neither's.** Its host is read the same way everywhere (a query
  string or a port does not make a second site), and a platform's page — a launchpad listing every
  token it launched — never counts as a token's own site, even when it prints the contract.
- **A rolling tag is not a release.** A GitHub release cut from `latest*`, `nightly*`,
  `*-debug`, `edge`, `canary`, `dev` or `snapshot` is kept as context, never counted as a ship.
- **A day is a UTC day.** Every daily figure and window keys a UTC calendar day, whatever the
  clock of the machine that computed it.
- **Security is evidence, never a verdict.** An audit shows an audit took place; it is not a
  guarantee of safety. HEY says where a report is published and where it found the link — no
  score, no "safe", and "no advisory found" is a reading of one index, never a clean bill.
- **A model is never the source of truth.** AI-assisted interpretation is optional and off by
  default; when on, it reads only HEY's own evidence, cites it by id, is labelled as an
  interpretation, and never moves a status, a score or a rank. `AI_PROVIDER` accepts `disabled` or
  `anthropic` only.
- **Product analytics count research, not people.** HEY's first-party counts (2026-10-01) record
  that a reader opened evidence, followed, set an alert or got an answer — a fixed word each,
  never a question, an address or an account; staff and crawlers are not counted. A useful session
  is defined in code; usage never reaches a status, a score or a ranking.
- **Every claim carries its source.** And none of them is a buy signal.

The full rules, with the thresholds they use, are on [the methodology page](https://heyresearch.xyz/methodology).

## `$HEY`, briefly

`$HEY` (`0xB33eb16782776b4D738c0Fd643577cb0284Db610` on Robinhood Chain) pays for evidence:
research bounties set in dollars and paid in HEY, claim bonds, and priority on research requests.
Holding changes what a reader pays, when they see new research and how much API the lab serves
them; $HEY worth at least $500 at the time of HEY's daily balance check, valued at HEY's own
market reading, also opens the Research Terminal beta — kept while it stays at $450 or more, with
one day of grace and a warning below that. It never buys a rank, a status or a score.

The 2% creator tax paid to the treasury is spent in three equal parts: research bounties,
infrastructure and data, platform operations — never a buyback. HEY's ledger records the HEY its
research economy moves, with each transaction; the creator tax arrives in ETH and is not recorded
there yet, so no monthly statement has been published. The advisory research-funding vote runs in
rounds the founder opens by hand; none has been opened yet (2026-10-03).

## How this repository is produced

A script in the private repository copies the paths listed above, generates a types-only
`@hey/db`, refuses to publish anything that must not leave, and pushes one commit per sync. Issues
and pull requests are welcome here: a change accepted here is applied privately and comes back in
the next sync.

HEY reports what teams ship and whether a tracked token still has a market. It does not predict
prices, and nothing in it is investment advice.

MIT licence. See [CHANGELOG.md](CHANGELOG.md) for what has changed and when.
