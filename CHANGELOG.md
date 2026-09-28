# Changelog

What changed, and when, for anyone reading the code or building on the API. Dates are the day the
change reached production. Older entries are condensed; the private repository keeps the full
record.

## 2026-09-28

- **Security context: evidence, never a verdict.** Where a project's audit reports are published (on
  the auditor's own site, claimed by the project's official site, or listed by DefiLlama only), its
  bug-bounty program, a published security.txt contact, OSV advisories about its published packages
  and its repositories' Scorecard checks — each with where HEY found it and when, each in a state
  (found, none found in the indexes named, not read, not applicable). An audit shows an audit took
  place; it is not a guarantee of safety. No score and no "safe"; nothing here reaches a status, a
  score or a ranking. On the Terminal (Research › Sources › Security), one line on the project page
  when something was found, `snapshot.security` in the API, the SDK and the MCP snapshot; see
  `docs/SECURITY_CONTEXT.md`.
- **Ask HEY across the Terminal.** Ask a question from anywhere in the Research Terminal — press ⌘K
  and type "what changed today", "show verified builders that shipped this week", "compare two
  projects over 30 days", "what does HEY still not know about this project", in English or Malay —
  and get an answer at `/terminal/centre/ask` built only from HEY's records: each line marked fact,
  derived or unknown, citing its evidence and opening the exact record. Questions are read by a
  fixed router, not a model, so it works with no AI budget. Following a project or creating an
  alert is offered as a step you confirm; nothing happens on a link. HEY gives no view on price or
  trading. Four MCP prompts ask the same questions through the existing tools.
- **Relationships.** What is connected to a project, and why HEY thinks so: its token, contracts and
  where a proxy points, official repositories, domain and docs, packages (official or only claimed),
  where it launched, its DefiLlama listing, the readings that corroborate its identity, and verified
  relationships with other projects — each with its standing, its evidence and when HEY observed
  it. No account is ever shown and HEY draws no partnership. `GET /api/projects/{slug}/relationships`
  and the Terminal's On-chain › Relationships view.
- **Peer context.** Some of a project's figures placed among comparable projects of the same type —
  a median and range from eight measured projects, a percentile from twenty, otherwise "not enough
  comparable projects" — one figure at a time, never a combined score (`snapshot.peerContext`,
  `/methodology#peers`).
- **Research boards.** Save projects and the panels you read them by in the Terminal; private by
  default, shareable by a link that shows public data only. `/api/boards` with an API key.
- **Alerts.** Tell HEY what to watch — when a project ships a release, changes implementation, resumes
  building after a long quiet period, has an unlock due within seven days, or materially changes its
  official docs — for one project, your watchlist or any project, and see each match at
  `/account/alerts` with its evidence. Optionally by email (a confirmed address, at most one message an
  hour, one-click unsubscribe) or at one of your own webhook subscriptions. Every alert is an event
  from HEY's change ledger, told once per rule and withdrawn if the ledger withdraws it; HEY sends no
  price or trading alerts. Managed at `/api/alerts` with an API key; see `docs/ALERTS.md`.
## Unreleased (2026-09-28)

- **Review repairs: words that say what was measured.** The Builder Radar's on-chain score and its
  "Most address-days of calls" sort are worded as **address-days of calls** — each day's distinct
  caller addresses added across seven days and the project's contracts, so an address calling on
  several days is counted again; never distinct addresses and never people. The two usage signals
  are now "Contract calls broadened" and "Contract calls narrowed" in the same terms. The
  relationship edge for an audit document is `PROJECT_AUDIT_REPORT_LINKED` (a linked report, never
  a finding that the project was audited). Research boards give every project its own newest
  changes instead of one shared read in which a busy project hid the rest. The receipt validator's
  `heyEvidenceStands` is `null` when it checked nothing and `"partial"` when it checked only some; a
  snapshot reference answers `project_exists` (its `asOf` is not verified) with its scoring version
  compared, and a change event is checked against its cited revision. Peer context is dated and says
  when it is stale, and Build Momentum is not compared across a scoring change. Alerts no longer tell
  a reader again about a revised event after retention, alert email reaches every reader in turn
  and never mails the same rows twice, and global Ask HEY takes twenty questions a minute per
  address.
- **Clearer doors, and cards that say what shipped.** The site header now leads to the Research
  Terminal and your Watchlist as well as Explore, Builder Radar, Ships and Pulse; the phone menu and
  the footer group every page under Discover, Research, Monitor, Developers and `$HEY`. Project
  cards lead with the activity status and one line naming the latest meaningful ship and its age;
  a project page's actions are Follow, Create alert and Open in Terminal, and its usage, market and
  protocol-economics sections open with a one-line answer. Explore stays a card grid.
- **Product usage, its own dimension.** Is what a project shipped being used? A daily rollup per
  project (`project_usage_days`) derived from HEY's own calls-per-method and decoded usage reads — no
  new provider call — gives active contracts, calls (the ERC-20 surface apart), functions called,
  distinct caller addresses per day and events, each day inside a contract's read coverage only, so
  a quiet day is a measured zero and an unread one is absent. Distinct caller addresses are a count
  per day, never people, and never added across days; the table stores no address. Served as
  `snapshot.usage`, `GET /api/projects/{slug}/usage?window=1|7|30` (with up to thirty days and
  releases, deployments and upgrades dated beside them as context, never a cause), the SDK
  (`client.projects.usage`), the MCP snapshot, the Terminal's On-chain › Usage view and one line on
  the project page. Never an input to activity status, Build Momentum, the Discovery Gap or the
  Radar. The rollup runs every six hours (`ROLLUP_USAGE_DAYS`); `data:usage-rollup` backfills from
  the collection start, resumably, with `--dry-run`.
- **The summary's usage line is the usage section.** The research summary's product-usage line now
  restates the snapshot's own `usage` object — its calls, active contracts, state and reason — instead
  of a separate reading, so the two can no longer disagree; its detail link is
  `GET /api/projects/{slug}/usage`.
- **Every project opens on a research summary.** One line each for build, product usage, market,
  contracts, fundamentals, security context, the latest change and what HEY does not know yet — each
  tagged fact, derived or unknown, with its evidence and when HEY read it. The same lines lead the
  Terminal workspace, the project page (the builder-story lines, with a way into the Terminal), the
  snapshot API (`summary`) and the MCP snapshot. Unknown is said with a reason, never as zero; an FDV
  is never called a market cap; security is context, never a verdict.
- **HEY Today.** The Terminal's "What changed" opens on what reached HEY since your last visit — or
  today, in 24 hours, in 7 days — most meaningful first, the projects you follow first, every row
  opening its record. Readers in preview get "Today on Robinhood Chain", the same for everyone.
- **Agents can discover HEY from the domain alone.** llms.txt follows the v2 format with every machine
  entry point on its first screen; an A2A 1.0 Agent Card at `/.well-known/agent-card.json` declares a
  small read-only JSON-RPC interface at `/api/a2a`; `/openapi.json` describes the public API in OpenAPI
  3.1; `/developers/agents` (and `/developers/agents.md`) walks an agent through discovery, connection,
  verification and monitoring. All of them read one machine identity, and a test fails the build when
  any of them drifts.
- **`$HEY` as research data:** `GET /api/hey/profile` states the contract, supply and market readings
  with their dates and valuation kind, HEY's own project snapshot, and every documented utility as LIVE,
  PLANNED, RETIRED or UNKNOWN from the gates the product itself opens on. SDK: `hey.heyProfile()`.
- **AgentResearchReceipt v1:** a neutral, project-agnostic receipt for an agent's own research, with a
  JSON Schema and a stateless validator that checks cited HEY ids and stores nothing.
- **The MCP server is prepared for the Official MCP Registry** (`apps/mcp/server.json`,
  `io.github.hey-research-lab/hey-research`); its handshake now carries the title and the agent guide.
- **One answer per fact on every surface (data-correctness pass).** Cards, search, narrative pages,
  the project page, the Terminal, the API and the MCP now read one rule for each fact they share.
  A parity suite holds them together.
- **Why activity is unknown is said.** A Verified Builder with a ship on record and no repository,
  changelog or feed HEY can keep reading reads **"Activity not measurable"**, not "Activity unknown".
  "HEY holds a builder source" is the scorer's own rule: an organisation page, or a repository that
  is disputed or has never been read, no longer counts.
- **A hidden valuation names no measure.** When no figure is printed, the label is "Valuation", never
  "Market cap"; the empty state says "No active market", "Unconfirmed" or "Unavailable" on every
  surface. Launch-record search rows no longer print figures for dead pools. A reading older than a
  day shows its age on the card and the project page.
- **API: `valuationWithheld` on list items** (additive): the reason code when HEY holds a reading it
  will not publish; absent when it holds none.
- **Counts say which set they count.** The Builders figure is the rankable verified builders on
  Robinhood Chain, "N of the M published projects"; Explore says "published projects"; the Terminal's
  "token projects" carries its definition; `/methodology#counts` explains how they nest.
- **One latest ship.** The project page, the Terminal and the API pick the same latest meaningful ship
  (the one the "Last ship" date refers to), with ties in one order. The Terminal preview shows the
  latest ship, Build Momentum and recent signals the public page already shows.
- **Plain words.** Ship types read "New contract", "GitHub release" and so on; follow-up deploy
  summaries use the short address; a signal no longer repeats its label as its title; the page says
  "no repository" once and draws no weekly zeros HEY did not measure; header links say when a website
  or repository is held only as context; a contradicted contract carries "Contract mismatch" on cards.

## 2026-09-27

- **The roadmap says what shipped this week.** Webhooks, commit significance, the change ledger, the
  SDK and MCP on npm, and AI-assisted research are marked live; discovery's recovered windows are
  described; pull requests and release significance are a research item. `/docs/webhooks` and
  `/docs/ai-research` are published.
- **Ask HEY's interpretations answer the reader's language and stay off price.** A question in Malay is
  answered in Malay; a question about price or trading gets one fixed line, "HEY gives no view on price
  or trading."; the guard refuses intent and trading words in Malay too; unknowns and follow-ups read
  as plain sentences, with any stray reference shown as its label.
- **Ask HEY answers in one step and shows its progress.** With the research interpretation on, pressing
  Enter asks for it too; while it is written the page shows how long it has been working and fills in
  the answer by itself. A failed attempt offers "Try again". The model call now has 90 seconds, where it
  had the few seconds every other source gets and the first answer timed out.
- **A commit that only rewrites data files is not building (`hbm-v17`, classifier `commit-substance-v2`).**
  JSON, CSV and similar data files outside configuration are their own class, `data`; a week whose
  commits only changed data (with or without documentation) is "documentation or maintenance only".
  Before, such files were unclassified and the week counted. Code-substance `files` gain a `data` count.
- **Launch factory windows are no longer lost when the RPC fails.** The hourly factory scan used to
  step over a block window the RPC would not answer and never read it again; on 2026-09-25 that lost
  every launch between 17:05 and 18:07 UTC. A failing RPC now stops the scan where it last read, a
  window that cannot be read is recorded and re-read by later runs, and each run re-reads a small
  overlap. The missed windows are recovered with `data:rescan-launchpads`.
- **Launches are named far faster.** Names and tickers are read through Multicall3, a hundred tokens a
  request, so a launch from this hour gets a name within the hour.
- **New tokens that trade are found within the hour.** Bitquery discovery also reads the last three
  hours, hourly, beside the daily thirty-day sweep.
- **A new project is judged by the quality gate within the quarter hour,** not at the next daily sweep.
  The gate itself is unchanged.
- **Where a token was first seen is kept** (`first_seen_source`), separately from the source HEY
  trusts it by.

- **`AI_PROVIDER` accepts `disabled` or `anthropic` only.** `openai` used to be accepted and then did
  nothing; it is now a configuration error at boot. `AI_MODEL_PRICES` (JSON, USD per million tokens)
  overrides the price table the optional research interpretation is costed from.
- **A week of commits that only changed documentation is not building (scoring version `hbm-v16`).**
  HEY now reads what each commit changed, once per commit: a week in which every commit only touched
  documentation or the README, dependency lockfiles, generated files, assets or whitespace is shown as
  "documentation or maintenance only" and no longer counts toward activity status, Build Momentum,
  badges or ship counts. A week HEY has not read yet counts as before. Commit messages, authors and
  patches are not stored. Merge commits are no longer counted in a commit summary.
- **Still Building needs a ship beyond commits.** Like Under the Radar, at least one of the updates in
  its 30-day window must be something other than a weekly commit summary.
- **`codeSubstance` on ships and timeline entries.** A week of code activity carries its verdict (derived,
  with the classifier version) and the counts behind it; `/api/changes` restates it as facts on
  `build.code_activity`. The Terminal's Code tab says what each week changed and lists the commits HEY read.

- **A launchpad template's verified source is not the project's.** A verified-contract timeline item
  for a copy of a launchpad template (such as `PonsV2LauncherToken` or `HoodToken`), or for a bytecode
  match to source published for another contract, stays on the page as context. It no longer counts
  as a checked contract or as a ship, so pages with nothing else are no longer listed.
- **An old ship is not news.** A release or other dated ship that HEY first reads more than seven days
  after it was published is recorded as `backfill` in `/api/changes`, and webhooks no longer push it as
  live. A newly listed project's history used to arrive as fresh releases.
- **`research.source_changed` is a webhook event type.** A subscription that names it is sent material
  changes to what a project's official site declares. The event carries counts, never the site's entries.
- **The SDK and the MCP server are on npm.** `npm i @hey-research-lab/sdk` and
  `npx -y @hey-research-lab/mcp` (0.1.0, tags `sdk-v0.1.0` and `mcp-v0.1.0`). The scope is
  `@hey-research-lab`; the bin `hey-research-mcp` and the SDK's user agent are unchanged.
  0.1.1 of both changes only the README shown on npm.
- **A package is the project's own only on evidence its publisher cannot type.** A package whose
  homepage points at the project's website is now shown as a claim, like one that only names the
  project's repository: an official link, a verified build attestation or a Go module path is
  needed. Packages accepted the old way were reclassified, and their matches to releases were taken
  back. Claims are never checked for advisories.
- **A token verified only by the explorer matching its bytecode is not the project's own verified
  source.** No timeline item is recorded for it any more, and the two recorded before the fix stay
  on the page as context.
- **Coverage's `contractSource` reads every watched contract, not the token alone.** A project whose
  token is a launchpad template but which published source for another contract of its own now says
  `source_verified_project_authored_other_contract` and links its contracts.
- **"No repository held" is unknown, not "not applicable"** in the snapshot's `developerFootprint`
  and the MCP, matching coverage in the same payload.
- **Ask HEY treats what a site or index typed as quoted data.** API paths, version strings and
  advisory summaries are quoted and never stated as HEY's own fact.

- **Search understands more, and everywhere the same way.** One matcher now serves the homepage and
  `/search` suggestions, `/search` itself, the `?q=` box on every listing and the Research Terminal. It
  finds a project by name, ticker, `$ticker`, token contract (or its first characters), a contract the
  project deployed later, an old address of its page, its verified website (`uniswap.org` finds
  `app.uniswap.org`) or its GitHub repository, and forgives a typo (`uniswp` finds Uniswap). Results are
  ranked by how exactly they match — never by market cap, price or payment. `GET /api/search/suggest`
  keeps its shape; its order follows the new ranking, and its `project` items may now come from those
  new keys.
- **Pasting a contract into `/search` is fast again**: the result count took seconds for a whole
  address.
- **The Research Terminal's search works in preview.** Readers waiting for early access can search
  projects, tickers and contracts from the header (⌘K included), see suggestions and results by name,
  ticker and contract, and open a project's preview. Research stays behind early access. The list says
  "Searching…" and "No match — press Enter to search", remembers your last five searches in this
  browser, and shows the short contract when two projects share a ticker.
- **Sites on a shared host are told apart.** Two sites on the same hosting platform (two
  `*.vercel.app` sites, two `*.github.io` pages) are no longer treated as one site. A repository
  whose homepage is someone else's site on the same platform no longer counts as the project's
  own, and docs or feeds on another site there are not credited to the project. Repository matches
  made the old way are re-checked; the ones that no longer hold stay on the page as context.
- **Some real websites were refused as private addresses.** Sites whose names begin with `fc`,
  `fd` or `fe` (for example `fedoraproject.org`) were blocked by the address guard; they are read
  now. Private addresses are still refused.
- **Hostile pages and feeds cost nothing.** A page built to stall the reader, a character
  reference past the end of Unicode, or a feed full of recursive entities is read (or refused) in
  milliseconds instead of stalling or failing the read.

- **Three new coverage dimensions: `officialDocs`, `apiDocs`, `sourceChanges`** (additive) on
  `/api/projects/{slug}/coverage` and the snapshot. They say whether HEY holds a project's own
  docs, whether its site links an API description HEY read, and whether HEY watches its official
  site for material changes — as states, never scores. A meme is `NOT_APPLICABLE`, not deficient.
- **Builder sites are read for docs and feeds.** A project that already has a repository is now
  crawled for its docs and feeds too (never re-resolved for repositories), and every repository,
  docs and feed link a read finds is kept as candidate evidence, classified by rules from where
  the link points — never by what the page says about itself.
- **Official sites' well-known files.** HEY reads robots.txt first and honours it, then the
  sitemap, llms.txt, security.txt and an OpenAPI description only when the site links one —
  weekly, conditionally. A single-page app answering 200 for `/llms.txt` is recorded as absent.
  A changed API surface is a source change, never a release or a ship.
- **Source authority.** Every source HEY reads now has a written answer to "what may it prove":
  a DEX profile, a package registry and an MCP listing are context only; a model's reading is a
  candidate only.
- **One docs page is one source.** A project page no longer lists the same docs page twice
  (`/docs` and `/docs#quickstart`, a `www.` twin, a skip link such as `#content-area`), and an
  `llms.txt` file is no longer listed as docs. Duplicates already on pages were merged.
- **Docs of a site that is not the project's own are context.** When HEY holds a project's
  declared website as not its own (a copied token carrying a famous project's site), docs and
  feeds read from that site are shown as context, never as the project's official docs.
- **Official-site changes are withdrawn with the site.** A `research.source_changed` event in
  `/api/changes` is retracted, and its receipt answers withdrawn, once the site it describes stops
  being the project's own — for every kind of change, including sitemap, llms.txt and API
  description changes.
- **More of a contract's calls have names.** A call the decoder could not name is named when the
  contract's own verified source declares the function, so `activity.methods.buckets.named` on
  `/api/contracts/{chainId}/{address}` now includes those calls and `undecoded` shrinks to the few
  nothing names (99.7 % of them on 2026-09-27). The call that deployed a contract is no longer
  counted as an undecoded method. First-called and called-again facts can now include these
  functions.
- **Signature candidates are only candidates.** For the handful of selectors nothing names, the
  Terminal can show what a public signature database offers, labelled "signature candidate" —
  never as the method's name, and never in a count or a fact.
- **Verified source says whose code it is.** Coverage's `contractSource` separates a launchpad
  template token from source published for the contract itself and from a bytecode match to
  someone else's source; a contract's verified-source item on the timeline says "Source
  published" or "Source matched by explorer" accordingly.
- **Sourcify as a second opinion.** HEY records Sourcify's independent verification for watched
  contracts the explorer calls unverified, and for proxies.

- **Protocol economics.** For a project matched to a DefiLlama protocol, the snapshot
  (`/api/projects/{slug}/snapshot`) carries `protocolEconomics`: its TVL, and its fees, revenue and
  DEX volume on Robinhood Chain over the last day, each either a measurement (a zero included) or a
  plain reason there is none — `NOT_TRACKED`, `SOURCE_UNAVAILABLE`, `NOT_ENOUGH_YET` — never a zero
  standing in for unknown. Audit and methodology links come as the registry gives them. A new
  coverage dimension, `protocolEconomics`, says which applies. Context only: none of it touches
  activity status, Build Momentum, the Discovery Gap or the Radar.
- **Promotion and takeover context.** When DEX Screener shows a paid boost, ad or profile order, or
  a community takeover, for a token HEY holds, the snapshot's `market.promotion` lists it with the
  provider's own date where it gives one. Never an amount, never a ranking input, never a change
  event or webhook.
- **DEX Screener profiles hourly.** New and recently edited token profiles reach HEY's candidate
  review within the hour instead of once a day.
- **Duplicate pages from a registry's token.** When DefiLlama names a protocol's token and HEY holds
  that token on another record, a moderator is asked to review the pair; nothing is merged
  automatically.
- **Developer footprint.** HEY now reads what each official repository declares (topics, licence,
  language, owner type) and its newest deployment to an environment named production, notes what
  kind of files a GitHub release carries (desktop app, mobile build, command-line binary,
  checksums), records the published packages tied to a project — as the project's own only when an
  official link, a verified build attestation, a Go module path or the official domain says so, and
  as a claim otherwise — and keeps OSV advisories about those packages' published versions. All of
  it is context: never a ship, never scored, never a verdict. `/api/projects/{slug}/coverage` gains
  `gitHost`, `package` and `securityContext` (additive); a token project with no repository and no
  package is `NOT_APPLICABLE` there. A package version that matches a GitHub release is noted on
  that release, not counted twice.
- **The Research Terminal shows the new evidence, where each question lives.** Build › Code gains a
  developer footprint (official repositories' topics and licence, the newest production deployment,
  the kinds of files the latest release ships, packages — claims labelled as claims — and a
  published API description). On-chain gains calls per method (counts only; a signature database's
  offer shown beside an unnamed selector as "signature candidate … — unverified", never as its
  name), whose code a verified contract is, and its implementation history. Market gains protocol
  economics behind the chart (not tracked is never zero) and promotion sightings as neutral
  context. Research gains official-site changes and security context (context, never a verdict).
  The Overview adds one line per area and a closed "What HEY still doesn't know" list of coverage
  gaps. None of it is shown in preview, and none of it touches any status, score or ranking.
- **The homepage and listing search boxes say what they are doing**: "Searching…" when a lookup is
  slow, and "No match — press Enter to search" instead of a silent box.
- **Serial launchers.** An account that created 100 or more contracts in the last 90 days launches
  contracts for many projects, so the contracts it deploys after a token launch no longer count as
  that project's building. They stay on record as context; the market page's deployer check says
  so, and an evidence receipt for one carries `contextReason: "serial_launcher_deployer"`
  (additive). The flag is re-read weekly and a lower count restores them.
- **Follow-up contracts are watched.** Contracts a token's launcher deployed afterwards are now
  read like tokens — proxy, verified source and interface, activity — once the launcher is measured
  as not a serial launcher. `/api/projects/{slug}/contracts` and `/api/contracts/{chainId}/{address}`
  report `watched: true` for a follow-up HEY has read; first readings take a few days.
- **Market Integrity can be published** (it stays off until HEY switches it on). Then
  `/api/projects/{slug}/market-integrity` lists each event with its id, its reading dates and
  sources, and no event time for a state HEY only observed; `market_integrity.event` appears on
  `/api/changes` (already-recorded events as `backfill`, never as news), can be subscribed to by
  webhook, and resolves at `/api/evidence/integrity:…`; the MCP's `get_changes` accepts it; and the
  token's market page shows it after the lifecycle. An exit-pattern classification is named only
  where HEY separately allows it.
- **Market Integrity `mi-v4`.** A collapse two current readings disagree about is withdrawn and
  held for review; a pool migration needs a pool HEY read before the fall; a graduation needs a
  launch-curve reading near it; a state (a source conflict, a trading collapse, a builder × market
  conflict) keeps one event while it lasts instead of one a day or a month; and a finding the latest
  evaluation no longer makes is no longer served anywhere.
- **"Liquidity no longer detected" is a measured drain.** A token's market is called removed only
  when a pool (or HEY's chain index across every pool) held at least $5,000 on two readings and was
  then read at or below a tenth of that on two days, with nothing read since above it. A single low
  reading, a new pool's first reading, or a one-hour launch peak no longer does it; dust HEY cannot
  yet confirm reads `removal_unconfirmed` (`INSUFFICIENT_DATA`), which claims neither a live market
  nor a removal.
- **`/api/contracts/{chainId}/{address}` adds `activity.methods`:** calls per method over the last
  seven complete days HEY read — total calls, calls to the ERC-20 standard surface, to the
  contract's own named functions and to undecoded ones, how many of its own functions were called,
  and the five most-called methods by rank and count. Function names are withheld on the public
  API (`names: "WITHHELD"`); a contract HEY has not read this way says `NOT_READ` and carries no
  counts. In the SDK as `HeyContractMethods`, and in the MCP's `get_contract`.
- **Two new contract change types on `/api/changes`:** `contract.method_first_observed` (a
  contract's own functions called for the first time since it was deployed) and
  `contract.method_resumed` (called again after 30 or more days without a call). Dated to the UTC
  day of the calls, with how many functions — never which — and, for a resumption, the longest
  silence. Evidence id `method:<uuid>` resolves at `/api/evidence`. Contract facts only; they never
  count toward a project's activity status. Not delivered by webhooks.
- **`origin` on a revised change is the event's own.** A revision of history HEY indexed at the
  start (`bootstrap`) or later (`backfill`) keeps that origin; it was reported as `live`, so
  webhooks could have pushed old releases as news. 973 rows were corrected.
- **Terminal: Filters no longer cover the project table**, and sortable column headers show that
  they sort.
- **The partner card says when a project's activity is not this token's.** When the project's own
  site names a different contract, `/api/v1/scan` adds `activity_applies_to_token: false` and
  leaves out the `cta`; every other field is unchanged. `/api/token/{chainId}/{address}`
  (`activityAppliesToToken`), `/api/v1/builder` and the MCP lookup say the same, and the MCP gives
  no link to the project from that token.
- **`/api/v1/scan` answers the zero address `found: false, reason: "not_a_token"` (a 200, it was a
  400)**, and does not count it against your allowance, in the single and the bulk form. Partners
  (Chit) see this from 2026-09-27. The burn address and malformed addresses are still a 400.
- **A package published to a registry (npm, PyPI, NuGet, …) is never a ship on its own.** The
  repository's release is the ship; a registry copy is kept as context. Five NuGet copies of one
  project's GitHub releases stopped counting.
- **The contract object says whose code a verified contract is** (additive, on
  `/api/contracts/{chainId}/{address}` and `/api/projects/{slug}/contracts`): how the explorer came
  to hold the source (`verifiedSource.method`, `.match`, `.verifiedAt`), `authorship` (a launchpad
  template, a bytecode match to someone else's source, source published for this address, or not yet
  known), Sourcify's independent answer (`sourcify`; not read is never "unverified"), the contract a
  minimal clone copies (`proxy.clonedFrom`), and three more method counts: calls the contract's own
  verified ABI names, calls to its creation code, and undecoded selectors a signature database has a
  guess for — counts, never names. The SDK types carry them.
- **The snapshot has a `developerFootprint`** (additive): official repositories, the newest
  production deployment, accepted and claimed packages, and current advisories, each with its
  coverage state and a count only where measured. Context, never a ship.
- **A changed official site is in the change feed**: `research.source_changed`, one event per
  material change to what the site declares (its links, sitemap, llms.txt, security.txt, a linked
  API description), with a receipt at `/api/evidence/sourcechange:<id>`. Counts only, never building,
  never a ship; the first read of a site is a baseline. It is not a webhook type.
- **Ask HEY answers more questions**: what changed in a project's public API, whether it has a
  GitLab repository (HEY says what it holds and that it reads GitHub only), which functions became
  active, what DefiLlama tracks, which packages it publishes, known advisories, what its docs
  changed and what HEY still does not know — each line tagged and citing its evidence.
- **The MCP prints the new context** on the tools it already had (`get_project_snapshot`,
  `get_contract`, `get_project_coverage`, `ask_hey`), and explains coverage reasons an agent could
  misread — "none found in the package index" is a reading of that index, not "no package". Still
  fourteen tools.

- **Escape really closes the search list.** Pressing Escape while a search field said "Searching…"
  hid the list, and the answer arriving a moment later opened it again. Escape now cancels the
  lookup, on the homepage, `/search`, the listing boxes and in the Research Terminal.
- **Tickers print one `$`.** A token whose symbol is stored with its own sigil read `$$LOCK` in
  both search lists, on cards and on its page; it reads `$LOCK` everywhere now. What the API
  returns is unchanged.
- **The Research Terminal reads more plainly.** The Overview's evidence rows now restate the same
  coverage states as "What HEY still doesn't know" (one could say "Releases · Not enough yet" while
  the other, correctly, did not list releases); security context says "no open advisory" once for
  a project's clean packages instead of once per package; promotion sightings say "Boost", "Ad" or
  "Enhanced token profile" instead of a provider's channel code, and one boost seen twice on a day
  is one line; "Whose code" gives its answer first and once; Build › Code names each repository
  once, its declared facts under its activity row.

## 2026-09-26

- **A deployer's other projects are published projects.** `/api/contracts` `otherProjectsCount`
  and the market page's Deployer check no longer count unpublished records, and the market page
  calls an account a launch service only when HEY's shared-deployer rule says so.
- **The MCP's `project_diff` says UNKNOWN for build counts HEY does not measure**, and says when a
  change count covers only part of the window.
- **`GET /api/changes`: one canonical change event per meaningful change.** Releases, ships,
  status moves, contract deployments and interface changes, verification, publication, sources,
  narratives and scheduled unlocks, each with its own time and how precisely HEY knows it, when
  HEY first knew, and its evidence. `after=` syncs forward without missing a fact HEY published
  late, and a retraction arrives as a tombstone that names only its id. The SDK has
  `changes.sync(cursor)`, and the MCP a `get_changes` tool.
- **Signals say when HEY recorded them.** `/api/signals` items add `detectedAt` and, for release
  and deploy signals, `shipId`; the page adds `nextOffset`. A release HEY read late now gets its
  signal.
- **The timeline says what it left out.** `/api/projects/{slug}/timeline` adds `totals`, `total`,
  `truncated` and a `before=` cursor for older entries.
- **The SDK follows a renamed project's redirect** when it stays on HEY's own API, and never
  any other.
- **Webhooks.** An API account can register up to five HTTPS endpoints at `/api/webhooks` (or on
  the account page) and receive HEY's public changes as they are recorded: releases, status
  moves, deployments, contract upgrades, verification, market status and HoodLock locks, each
  exactly as `/api/changes` serves it and signed with a secret shown once. Failed deliveries are
  retried for about a day; redirects are never followed. See `docs/WEBHOOKS.md`.
- **Every evidence id in a change resolves.** `/api/evidence/narrative:<project>:<slug>` answers the
  narrative events the ledger cites, and says who set the narrative: the project itself, a
  moderator or HEY's rules (a project's own choice was mislabelled as a moderator's). A change's
  `links.evidence` now names its first typed evidence id; it named the change's own id, which
  answered 400 for suffixed ids such as `source:<uuid>:added`, and is absent when none resolves.
- **History and diff no longer fail for busy projects.** `/api/projects/{slug}/history`
  (`contractChanges`, `locks`) and `/diff` answered 500 for any project with more than a hundred
  change events in the window; they now read every page.
- **A diff says when HEY was not yet recording changes.** A window that ends before the change
  ledger began is `UNAVAILABLE` rather than a measured zero, and one that starts before it says
  `partial: true` with `collectedFrom`.
- **A diff no longer reports zero releases for a project HEY cannot read.** `releasesAdded` and
  `meaningfulShips` are `null` with `countsReason` when HEY holds no builder source it reads for
  the project, as `/coverage` already said.
- **Evidence receipts publish no more than the change ledger.** A `state:` receipt resolves only a
  move the ledger announces (a demotion it records but never announces is not found), and an
  `abi:` receipt gives the number of functions and events added and removed, not their names.
- **Syncing from `/api/changes` no longer misses a project hidden for a few minutes.** A project
  taken off the catalogue and put back between two ledger runs now has its events re-sent with new
  `seq` values, after tombstones, so a client that synced while it was hidden receives them.
- **A project returning to the catalogue does not replay its history through webhooks.** Its
  events come back as `origin: backfill` unless they were live news within the last seven days,
  and a subscription receives such a return only if it had received the event before.
- **`/api/changes?contract=` now receives retractions.** A tombstone matches the contract or token
  of the event it retracts; it still carries only the id.
- **The SDK verifies webhooks.** `verifyWebhookSignature`, `parseWebhookEvent` and `isReplay`.
- **Two more kinds of change.** `lock.observed` and `lock.withdrawn` (when HEY first read a
  HoodLock lock, and first read it withdrawn), and contract upgrades from the chain's own logs,
  dated by their block.
- **Stricter address checks.** HEY's fetchers now also refuse benchmarking, documentation and
  protocol ranges, and IPv6 forms that carry an IPv4 address (NAT64, 6to4, Teredo).
- **HEY's MCP server is hosted.** `claude mcp add --transport http hey-research
  https://heyresearch.xyz/mcp` — stateless Streamable HTTP, read-only, metered like the API. The
  tools read the same public API, so they can say nothing it does not.
- **Fourteen MCP tools replace twenty-two**, one per question: `find_projects`, `lookup_token`,
  `get_project_snapshot`, `get_changes`, `get_project_timeline`, `get_project_coverage`,
  `explain_fact`, `get_evidence`, `get_token_market`, `get_contract`, `project_diff`,
  `compare_projects`, `ask_hey` and `chain_overview`. Every answer tags each line FACT, DERIVED or
  UNKNOWN (activity status and Build Momentum are DERIVED), says how many it showed of how many
  and how to read on, never calls an FDV or an unknown kind a market cap, and links the JSON it
  came from. Resources and four research prompts come with them; the tools live in
  `packages/mcp-core`.
- **The SDK covers every route**: snapshot, coverage, explain, history, diff, contracts,
  evidence, the keyed bulk reads, the `/api/v1/builder` card (now a typed `HeyBuilderCard`) and
  search suggestions.
- **`/developers` rebuilt**: first calls, auth and limits, snapshot, changes, history, evidence,
  contracts, the rules every answer follows, the SDK, MCP hosted and local, status, and what HEY
  deliberately does not provide.

- **The Research Terminal, redesigned.** One header (Projects · What changed · Watchlist · search)
  and a search that is easy to find ("Search projects, tickers or contracts"), including on phones
  (`/terminal/search`). A project's workspace groups its eleven views into six (Overview,
  Timeline, Build, Market, On-chain, Research), and every old URL still opens. The Command Centre
  now answers "what changed on Robinhood Chain", and every item links to its exact record.
- **Market candles are green and red.** A measured up move is green and a down move is red; an
  unchanged day is neutral, and a missing or incomplete day gets no colour. Every direction also
  carries ▲/▼ or a sign, never colour alone. Builder state keeps its own labelled chip and never
  implies a market direction.
- **Fewer pages published on thin evidence.** "Contract verified" now means the explorer verified
  the project's own contract source. A token's own launch deploy is no longer a ship for
  publication. An X account several pages declare is not identity, except on protocols a curated
  ecosystem registry lists. A follow-up deployment from the deployer of a token nothing ties to
  the project counts only once a repository or a site ties them. The pages are hidden, not
  deleted, and remain searchable by contract as launch records.
- **Research Terminal search suggests while typing.** The header search and the search page list
  matching projects, contracts and Terminal views as the reader types, grouped the way the search
  page groups its results, with full keyboard and screen-reader support; without JavaScript the
  search is the same form as before. The suggestions come from a Terminal-only route that answers
  only readers the Terminal lets in (a preview reader gets nothing) and is never cached.
- **Faster first paint on phones.** Marks the site font does not carry (⋯, ◆, ●, ■, ↗ and the
  subscript in compact prices) are drawn instead of typed, so the first layout no longer waits for a
  fallback font. A compact price still copies as its full decimal (`$0.0000254`).
- **Wording that claimed more than HEY knows.** The MCP server and `llms.txt` describe Under the
  Radar as a positive Discovery Gap (verified activity with a market-attention percentile below
  its build percentile), and `shipping_in_silence` as Under the Radar and below the 40th
  market-attention percentile. The server's opening note says `get_token_market` returns one
  token's supply-concentration summary and names only its deployer. A project's date reads "First
  listed". On the market page and in the MCP, the launch stage reads "HEY first saw it on DEX on" a
  date instead of "since", and a contract that is not a proxy reads "No proxy pattern detected in
  the EIP-1967 implementation slot at the last check."
- **Snapshot, coverage, explain and evidence.** `GET /api/projects/{slug}/snapshot` answers a
  project's important state in one read; `/coverage` says what HEY knows, dimension by dimension,
  as states and never a score; `/explain?fact=` says why HEY publishes a figure (value, rule,
  inputs, lineage, evidence ids, what is unknown); `GET /api/evidence/{id}` resolves a typed id
  (`ship:…`, `signal:…`, `lock:4663:17`, …) to its receipt. Ships carry `precision` and
  `evidenceId`.
- **One rule for FDV or market cap.** Every `marketCapUsd` has a `valuationKind` beside it; the
  daily series names its closes by the same rule. A market that is not live has its valuation
  withheld on the dossier and in `/market` `days[]`, with the reason
  (`valuationWithheld`, `marketCapCloseWithheld`); `has=marketCap` and the market-cap filters count
  only valuations a card prints. Liquidity HEY's chain index measures as unsellable is not believed.
- **Knowledge time.** `/api/projects/{slug}` sends `firstRecordedByHeyAt` and, where an outside
  registry or launchpad dates the project, `externalListedAt` and `externalListedSource`.
  `firstSeenAt` is kept as a deprecated alias; `sort=newest` orders by knowledge time.
- **No measured-looking zero for an unmeasured project.** `/intelligence` sends `null` Build
  Momentum and velocity for a project HEY holds no readable builder source for, with
  `development.activityMeasured: false`.
- **Partner fields, additive.** `/api/v1/scan` adds `research_level`, `activity_measured`,
  `coverage`, `as_of`, `activity.meaningful_ships_30d` and `activity.last_ship_url`; the token
  lookup adds `activityMeasured`, `meaningfulShipsLast30Days` and `asOf`; `/api/v1/builder` adds
  `research_level`, `activity_measured`, `as_of` and a thirty-day `commits_30d` that agrees with the
  card. The zero address on `/api/v1/scan` is still a 400 and no longer counts against a key.
- **Beacon proxies are read as proxies.** Tokens behind a beacon (such as the bridged stock
  tokens) were reported as plain contracts. The proxy check now reads the implementation slot, the
  beacon and its implementation, and the explorer's own report, and says which one answered
  (`contract.proxy.kind` on `/api/projects/{slug}/market`). It never says "not a proxy" — only that
  no proxy pattern was detected.
- **Contracts as research entities.** `GET /api/contracts/{chainId}/{address}` and
  `GET /api/projects/{slug}/contracts`: creation, deployer, factory, verified source, proxy kind and
  implementation history, interface counts and changes, and seven-day use — each section saying
  whether HEY measured it. Counts, never function lists.
- **History and diff.** `GET /api/projects/{slug}/history` returns the points HEY recorded at the
  time, each labelled as what HEY concluded, what it observed, or what was reconstructed from the
  chain later, with each series' collection start; a day HEY did not record is absent, never zero.
  `GET /api/projects/{slug}/diff?from=&to=` compares two days and counts what happened between
  them, without claiming a cause.
- **Bulk reads, keyed.** `/api/snapshots?slugs=` (up to 10), `/api/token/{chainId}?addresses=` and
  `/api/v1/scan?tokens=` (up to 30): one request per item against the key's limits, input order
  kept, one bad item never failing the batch.
- **One error shape.** Every public route answers errors as
  `{error, message, requestId, retryable, retryAfterSeconds?}`, readable from a browser, including
  the 500 and an unknown path. Listings of contract changes, quiet builders, comebacks and unlocks
  say how many rows exist in all.
- **Market page additions.** Where the liquidity sits (pools holding it and the largest pool's
  share, collected from today on), launch milestones each on their own clock, and on-chain days
  that keep the measured calls when events could not be indexed.
- **A project shipping from the chain is measured.** Activity counts as measured when HEY's status
  rests on building it counted — a readable repository, changelog or feed, or at least one counted
  building event in the scorer's window, on-chain follow-up deployments included. The snapshot,
  the scan card, the intelligence route and the MCP no longer call such a project "UNKNOWN
  activity, no source"; its coverage says `onchain_building_evidence`.
- **One meaning of "counts as building".** The evidence receipt, the timeline and `/api/changes`
  count what the scorer counts: corroborated building events, a week of code activity or
  prereleases once. A self-reported update never counts.
- **The Discovery Gap explanation adds up.** `/explain?fact=discovery_gap` shows the two
  percentiles the gap was taken from, so the subtraction it prints holds, and shows no Build
  Momentum percentile where momentum is not published.
- **Explanations count what the scorer counts.** `/explain?fact=activity.status` counts only
  corroborated building events, sends a count HEY did not measure as null rather than 0, and, where
  a withdrawn ship leaves a published status with nothing under it, marks the status stale and says
  the next rescore replaces it.
- **A withdrawn ship moves the status at once.** When HEY withdraws a ship or source as not the
  project's own, the project is rescored straight away instead of up to twelve hours later.
- **The project page says why Build Momentum is missing.** "Not finished checking" only where
  HEY's research has not run; otherwise that HEY holds no repository, changelog or feed it can
  read.
- **One valuation-kind rule.** Where HEY holds the provider's market cap and FDV, they decide
  whether a figure is a market cap or an FDV on every surface, the daily chart included; the
  supply test names only a stored day whose reading HEY no longer holds.
- **A deployer is a launch service only by HEY's own rule.** `/api/contracts` said a token's
  deployer was shared as soon as one other tracked project used it, while `/market` said it was
  not. `sharedAcrossTrackedProjects` now follows the same three-project rule `/market` uses;
  `otherProjectsCount` is still the plain count.
- **A shared follow-up names the right project.** A contract two projects' deployer put up is
  listed under each project as that project's own, with its own evidence; the contract on its own
  names neither, rather than picking one by name.
- **MCP answers no stronger than the API.** Status and market-state moves, signals and
  market-integrity readings are tagged DERIVED in `get_evidence`, `get_changes` and the timeline;
  `project_diff` names each valuation end by its own kind; an on-chain event count over a window
  with unreadable days says so; the Builder Radar and chain overview keep the "not investment
  advice" disclaimer; and the server instructions now say that `get_contract` names the deployer
  with a count of other tracked projects.
- **Under the Radar, one definition.** The MCP guide, `llms.txt` and the docs now describe it as
  the surface lists it: eligible under the Under the Radar rule, with a positive Discovery Gap.
- **Docs name the current intelligence rules**, `intel-v3`.

## 2026-09-25

- **Research Terminal early access.** With the console's preview switch on, a reader the Terminal
  does not admit sees it in preview — project identities, with the research withheld on the server
  rather than hidden in the page — and can ask for early access with the wallet linked to their
  account. Requests are reviewed by hand; holding $HEY is context for the reviewer and never
  approves one. Every `/terminal` response is `private, no-store`.
- **Scoring `hbm-v15`.** A token whose market is not live gets no Discovery Gap and no market
  percentile, and is not in the population others are ranked against. Nor does a token HEY knows
  only from a market listing (no launch on this chain) that nothing the project publishes ties to
  it — a bridged copy of an outside asset. A daily-close high is dated to the end of its day, so a
  ship that same day is not "since the decline". Stored gaps and badges refill as projects are
  rescored.
- **`distributionRead`** on the market answer (`outcome`, `checkedAt`, `note`). When the latest
  holder read saw no balance change inside the provider's window, the answer says so and keeps the
  last good distribution with its date, instead of reading as "no holders".
- **Paid research is charged at the quoted price.** The wallet takes a quote before paying and sends
  exactly that amount; an expired quote covers only a transfer mined before it expired.

- **Renamed-project redirects point at the public site.** `GET /api/projects/{slug}` (and its
  `/market` and `/intelligence` routes) and `/api/badge/{slug}` answered an old slug with a
  `Location` on `https://0.0.0.0:3000`. They now redirect to `https://heyresearch.xyz/...` with
  `cache-control: no-store`.
- **`builderRadar.onCurrentBoard`** and **`builderRadar.rank7d`** on
  `GET /api/projects/{slug}/intelligence`. A project that dropped off the board keeps its last
  row; `onCurrentBoard: false` says that `rank` is a past standing. `rank7d` is the rank a week
  earlier recounted among today's board, as `/builders` measures movement.
- **`buildMomentum` is omitted for an UNKNOWN project with a score of 0.** That zero meant HEY found
  nothing it could read, not a measurement.
- **`liquidity.kind`** (`market` | `launch_inventory`) wherever a liquidity figure is returned: the
  list, the detail's `market` and `tokenMarket`, `/market` and `/intelligence` `current`, compare and
  the MCP. A launch pool's own token inventory is not a market, so `minLiquidity`, `sort=liquidity`
  and the coverage counts leave it out.
- **A new market status reason, `readings_implausible`** (status `INSUFFICIENT_DATA`): a provider's
  liquidity that its own volume and HEY's pool index cannot support. Its liquidity, valuation and
  stored high are withheld; price and volume stay. `pool_readings_disagree` and
  `readings_implausible` are not live markets.
- **Valuations name their kind** on `/api/this-week`, market `days[]`, market-moves and the timeline;
  a dead market's valuation is withheld there.
- **`tokenLock.nextUnlockAt`** and **`tokenLock.nextUnlockPct`** beside `until` (which is the last
  unlock).
- **Token verification** (`VERIFIED` / `UNVERIFIED` / `MISMATCH`) on the list, the token lookup,
  `/api/v1/scan` and `/api/v1/builder`.
- **First and last indexed trade** are read over the whole daily index, not the answer's window.
- **`kind=constructor`** and other inherited names are refused as signal kinds.
- The MCP offers `market_integrity` only when the server runs with `HEY_MARKET_INTEGRITY=public`, as
  the route is gated.
- **Search** treats a ticker's `$` as a sigil (`$HEY` finds HEY), and a whole contract address is
  matched exactly and quickly.

## 2026-09-20

- **`GET /api/v1/builder?chain=4663&token=0x…`** — builder activity for one contract, for a partner
  that already draws the chart. `status` (`active`/`stale`/`dormant`/`unknown`), `last_activity_at`,
  the corroborated `repo_url`, the latest release and post-launch deployment, and HEY's own status
  label to print. HEY's tables only, no provider call. `last_commit` is always `null` — HEY
  aggregates commits into weekly summaries and stores no SHA — and there is no `abandoned` status,
  because HEY sees silence rather than intent. An unpublished contract answers `404` with a
  `scan_url`.
- An **Open in RHTools** link on the project page, on a scan result and on the token's market page,
  wherever a reader already holds a contract. It is a reference in the existing link row, never a
  button, and absent when there is no contract.


- **A website a project declares is now screened.** The candidate site reader selected on the
  candidate's own URL, so a site that reached the project by any path other than the discovery feed
  was never fetched — which left the token unverified, the repository context-only, and the code
  activity unread on projects that had all three. It now falls back to the project's declared
  website and keeps the URL it read.

## 2026-09-19

- **`POST /api/scan` carries an evidence breakdown** (`scan-evidence-v1`): `identity`, `build`,
  `coverage` and `overall`, each either a 0–100 reading with a strength word or an explicit
  `insufficient` with the reason. It measures how much HEY could verify from public sources — not
  the project's quality, not risk, and nothing about what a token might do. A band HEY could not
  measure reports a sentence rather than a zero, `build` reuses the stored Build Momentum and is
  never recomputed, and a check HEY could not run is excluded from the total instead of counted
  against the project. `GET /api/v1/scan` is unchanged.

- **A refused API key now says how to carry on.** A `401` used to answer only "That API key is not
  valid."; every read endpoint answers the same call without a key at 120 requests a minute, and
  the message now says so and points at the page that issues one. Nothing about who is refused
  changed.
- **The edge's agent families read the `From` header first.** A crawler that spoofs a browser
  string still names itself there, so one that sends a plain `Chrome/130.0` is no longer filed as a
  suspected scraper. Only mailboxes matching a known crawler are read, because `From` may carry a
  person's own address, and neither the header nor the user agent is ever stored.
- **Two npm packages prepared.** `@hey-research-lab/sdk` (`packages/sdk`) is the whole read API as one
  typed client: `new HeyClient().scanCard(4663, address)`, `projects.items({ tab: 'still-building' })`
  walks a listing, a `429` surfaces as `HeyApiError` with `retryAfterSeconds` and is never retried
  for you. `@hey-research-lab/mcp` (`apps/mcp`) is the MCP server, unchanged in behaviour. Neither is
  published yet; build both from this tree.
- **A type-level contract test** in the private repository fails the gate when the API and the SDK
  disagree on a single field, in either direction.
- **Full-platform audit, eleven auditors, eighty-nine repairs.** For an integrator: commit summaries
  are no longer duplicated by an ISO-week key written in two casings; signals never announce a
  release the project page has withdrawn; the development signals count meaningful ships rather than
  bare contract deployments; a published project with no token redirects instead of answering 404 on
  its market page; `/api/signals` documents the four kinds that count addresses; and the API
  documentation states the single-token distribution boundary rather than denying it.
- `/badge/<slug>.svg?embed=1` renders only the badge, which the iframe snippet had always promised.

## 2026-09-18

- `GET /api/v1/scan?chain=4663&token=0x…` — the by-contract lookup in the shape a trading bot's
  card wants: `found`, status in HEY's own words, `verified_builder`, commits, releases and ships in
  thirty days, the project page and a CTA to it. `found: false` is a `200` for an unpublished token
  or another chain, so a bot prints nothing rather than guessing.
- `commits_30d` counts only summaries that carry their days, and is absent otherwise. It may carry
  `commits_30d_partial: true`, meaning HEY read a full page of a hundred commits inside the window
  and the figure is a floor — print `100+`, or drop it.
- A commit summary read from a cut page is titled "100+ commits since \<date\>" rather than an exact
  ninety-day count.
- Keys: a keyed request draws on its tier's per-minute bucket from one address; a suspended key or a
  blocked account answers `403` with a `reason`; a revoked or expired key answers `401`; the monthly
  allowance is checked before a request is counted; any request carrying a key header is answered
  `private, no-store`. The free tier's monthly ceiling is a console setting.
- `SCORING_VERSION` is `hbm-v8`: code activity counts once per ISO week however many repositories
  produced it, Still Building is measured against the daily close and needs a market reading under a
  week old, and a pool is "liquidity removed" only under an absolute ceiling.
- `/api/signals` echoes only a `slug` it actually applied and orders with a stable tiebreaker;
  `/api/projects/{slug}/intelligence` names the market source the way `/market` does; a `404` from
  `/api/badge` has the same `{error, message}` shape as every other route.
- A provider's `429` is honoured for exactly the `Retry-After` it names and never retried in place;
  a feed entry dated more than ten minutes ahead is skipped.
- `/api/health/deep` answers `503` when the worker has completed nothing for twenty minutes.
- An old project slug that now belongs to a withdrawn record is not-found on the API and a temporary
  redirect on the site; only a target still in the catalogue earns a permanent one.
- The lab's console gained an analytics section. It reads first-party rows and Google's own API,
  stores no IP, user agent or cross-day identifier, and none of it reaches a public figure or ranking.

## 2026-09-17

- `GET /api/token/{chainId}/{address}` answers for a bare contract address in one call: activity
  status in the site's own words, ships in thirty days, the last ship with its source, and a link
  back. An address with no published page answers `200` with `status: "unknown"`, not a 404. The
  address prefix is read in either case; the chain id is the plain integer `4663`.
- `GET /api/projects/{slug}` carries its newest five `ships` and, whenever it claims
  `stillBuilding`, the `stillBuildingEvidence` behind the claim.
- A bare contract deployment is a launch, not a ship, on every ship surface.
- `/api/projects` pages no longer overlap or drop rows inside ties, so a full walk by offset returns
  each project once; `/api/ships` never hands back an offset the cap will clamp.
- The per-client rate limit is consumed before any key is looked at.
- `GET /api/token` carries `researchLevel`; a record HEY has only indexed carries no ship count; the
  badge says "indexed", "checked" or "verified" by what HEY actually did.
- `tab=new-builders` is a seven-day window; a date that does not exist is refused rather than rolled
  forward.
- Site metadata consolidated: one builder for title, description, canonical and share card, and a
  public roadmap at [heyresearch.xyz/roadmap](https://heyresearch.xyz/roadmap).

## 2026-09-15

- **`/scan`** answers the builder question for a single contract address HEY has never seen: who
  built it, what is being built, and what HEY cannot see — with no score, no count of passed checks
  and no colour, because one number is all it takes for a reader to take a scan box as a safety
  rating. It reads no holders and no wallets.
- Two reads were added for it in `packages/sources`: the contract's creating call, which separates
  the factory that executed it from the account that sent it, and the contract's **method surface**,
  which for an address with no site and no repository is the only evidence there is.
- Each day also carries counts of the addresses behind the figures, and a token's concentration as a
  Gini and a Nakamoto coefficient. All are counts a provider returns; none selects, stores or names
  an address.

## 2026-09-14

- **Token distribution** on a token's market page: a bubble map of the largest balances drawn to
  scale, with pools, launchpad lockers and burned supply named and kept out of the concentration
  figure. This is the single exception to the no-holder-data rule, decided by the founder, and it is
  never scored, ranked across tokens, followed, or an input to any status or score.
- The denominator behind every share of supply is read from the token contract rather than a
  valuation; a token whose contract will not answer is skipped rather than mapped against a guess.
- Three guards now refuse a market reading before it is stored: a pool worth less than one whole
  token at the quoted price, a market cap above the same token's fully diluted valuation, and a
  supply that disagrees with the contract by more than a factor of two. Liquidity and volume are
  summed across a token's pools rather than taken from the deepest.

## 2026-09-13

- HEY keeps its own daily index: every token project has a market page with price, liquidity, trades
  and volume day by day, and Pulse shows Robinhood Chain day by day (`/api/chain`).
- **HEY Signal** (`/signals`) turns measured changes into a feed with before and after figures and
  their sources. The **Builder Radar** (`/builders`) ranks builders by verified development, on-chain
  use and research standing, never by price. Weekly reports are archived at `/reports/weekly`.
- A token card HEY cannot read building from says "No builder signal yet" and prints what HEY does
  know as context. Trading is not building.

## 2026-09-12

- Explore has two views: everything HEY tracks, and only the projects with a token, with a market
  lens (live market, verified token, launch stage, a liquidity floor, liquidity and volume orders).
  Every market sort says how many rows actually carry the figure. Tokenless builders are never
  hidden from the first view.

## Earlier

The catalogue, the project page, activity status, Build Momentum, the Discovery Gap, Still Building,
Under the Radar, the public API, the badge, Scout, bounties and `$HEY` shipped between July and
September 2026. [The methodology page](https://heyresearch.xyz/methodology) states every rule as it
runs today, and [docs/SOURCE_REGISTRY.md](docs/SOURCE_REGISTRY.md) lists every source with what was
actually observed when it was verified.
