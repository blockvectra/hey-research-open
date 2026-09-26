# Putting HEY in your bot

Someone pastes a contract address into a chat. You want one line that says whether anyone is
actually building it. This is how, end to end, in one HTTP call and no account.

## The one call

```
GET https://heyresearch.xyz/api/token/4663/{contractAddress}
```

No key. No account. No signup. **120 requests a minute** per client, cached 60 seconds at the
edge, and readable from a browser as well as a server — `access-control-allow-origin: *` is set
and the preflight is answered.

Try it now, on a project that is shipping:

```bash
curl -s https://heyresearch.xyz/api/token/4663/0xebb4c5b97e4117e30ec82ce025e6f21dded05436
```

## What comes back

```jsonc
{
  "chainId": 4663,
  "contractAddress": "0xebb4…5436",
  "status": "published",
  "project": {
    "slug": "darkroute",
    "name": "DarkRoute",
    "symbol": "dark",
    "url": "https://heyresearch.xyz/project/darkroute",
    "activityStatus": "SHIPPING",
    "activityLabel": "Shipping",
    "activityHelp": "Shipped something meaningful in the last 7 days.",
    "shipsLast30Days": 4,
    "lastShipAt": "2026-09-16T02:38:59.000Z",
    "lastShip": {
      "title": "Active development: 3 commits in the last 90 days across 1 contributor",
      "publishedAt": "2026-09-16T02:38:59.000Z",
      "sourceUrl": "https://github.com/darkrouteRH/contracts"
    },
    "deployedAt": "2026-09-08T09:25:46.000Z",
    "badgeUrl": "https://heyresearch.xyz/badge/darkroute.svg"
  },
  "scanUrl": "https://heyresearch.xyz/scan?address=0xebb4…5436",
  "disclaimer": "…"
}
```

| Field | What it is |
|---|---|
| `activityStatus` | One of `SHIPPING`, `ACTIVE`, `QUIET`, `DORMANT`, `RESUMED`, `UNKNOWN`. Derived from what a project ships, never from price. |
| `activityLabel` | The same status in words. **Use this rather than mapping the enum yourself** — see below. |
| `shipsLast30Days` | Ships in the window the field names, counted exactly the way the project page counts them. Your number and the page a reader lands on cannot disagree. |
| `lastShip` | The most recent one, with `sourceUrl` — the actual commit, release or post it was read from. Link it. |
| `deployedAt` | When the contract went on chain, read from the block. Absent where HEY has not read one. |
| `badgeUrl` | A ready-made SVG: name, status, last ship. Drop it in the card if it fits. |
| `url` | The page behind all of it. **Always render this.** |

## The three answers you must handle

| Case | HTTP | Do this |
|---|---|---|
| `status: "published"` | 200 | Render the line. |
| `status: "unknown"` | 200 | HEY has no published page. There is no `project`. Offer `scanUrl`. |
| `error` | 400 | Not an address, or not this chain. Say nothing about the token. |

**Why `unknown` is a 200 and not a 404.** Most addresses pasted into a group chat are not
indexed projects. A 404 would make your ordinary case an error branch. So the shape is uniform,
you check one field, and `scanUrl` gives you somewhere to send the person: HEY reads the chain
live for an address it has never seen.

An address HEY holds but has not reviewed also answers `unknown`. An unreviewed launch record
is not a project, and this endpoint will not pretend otherwise.

## The bot, in about thirty lines

```js
const HEY = 'https://heyresearch.xyz';

async function heyLine(address) {
  const r = await fetch(`${HEY}/api/token/4663/${address}`);
  // 400 means the address is not one, or not this chain.
  if (r.status === 400) return null;
  if (!r.ok) return null;           // stay quiet on a hiccup

  const d = await r.json();

  if (d.status !== 'published') {
    return `HEY: not indexed yet · read the chain → ${d.scanUrl}`;
  }

  const p = d.project;
  const ships = p.shipsLast30Days === 1 ? '1 ship' : `${p.shipsLast30Days} ships`;
  const when = p.lastShipAt ? `, last ${daysAgo(p.lastShipAt)}` : '';

  // p.activityLabel is HEY's own wording. Do not invent your own.
  return `HEY: ${p.activityLabel} · ${ships} in 30d${when} → ${p.url}`;
}

function daysAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
}
```

Which renders as:

```
HEY: Shipping · 4 ships in 30d, last today → heyresearch.xyz/project/darkroute
HEY: not indexed yet · read the chain → heyresearch.xyz/scan?address=0x7655…d78a
```

## Four things not to do

**Do not translate the status yourself.** Use `activityLabel`. Left to themselves, integrators
turn `DORMANT` into *dead* and `UNKNOWN` into *suspicious*. Dormant means HEY has observed no
public activity for a long time. It is not the same as abandoned, and unknown is a gap in *our*
knowledge, not a fault of the project. The labels ship in the payload so nobody has to guess.

**Do not present it as a risk reading.** HEY gives no score, no grade and no safe/unsafe
verdict, anywhere, by design — the moment there is one number on a card, people read it as a
rating. If you want a risk signal, put one from a tool that actually does that work *beside*
our line. `Honeypot: clean · HEY: Shipping, 4 ships in 30d` is a better card than either of us
alone, and neither is pretending to be the other.

**Do not drop the link.** Whatever you render, carry `url`. Someone who sees a HEY line should
be one tap from the evidence behind it. This is the one condition of use.

**Do not poll `POST /api/scan` in a hot path.** That second, heavier endpoint reads the chain
live for an address nobody has indexed. It allows **ten requests an hour**, is never cached,
and spends a budget HEY's scheduled indexing needs first. Link people to `scanUrl` instead —
that is a page, and it costs you nothing.

## Limits, caching and failure

- **120 requests a minute** per client. Over that, `429` with a `retry-after` in seconds.
- Answers are cached **60 seconds** and served stale for five minutes while they refresh.
  Caching on your side beyond that buys nothing; the catalogue moves on HEY's worker schedule,
  not per request.
- Dates are ISO 8601, UTC, always.
- **Absent means unknown.** A field HEY has no answer for is left out — never sent as `null` or
  `0`. Do not fill a gap with a zero: a missing `deployedAt` means HEY has not read one, not
  that the contract was deployed at the epoch.
- If HEY is down, say nothing rather than guessing. A bot that omits a line is fine; one that
  invents one is not.

## The builder call: `GET /api/v1/builder?chain=4663&token=0x…` (2026-09-20)

For a surface that already has the chart and wants the other half. Same two parameters as the card
call, HEY's own tables only. One difference in validation (2026-09-26, corrected): a chain other
than 4663 is a **400** here, where the card call answers `200` with `found: false, reason: "chain"`;
an unpublished contract is a **404** here, with `scan_url`.

```jsonc
{
  "status": "active",                 // active | stale | dormant | unknown
  "hey_status_label": "Shipping",     // print this, not your own word for it
  "token_verification": "VERIFIED",   // VERIFIED | UNVERIFIED | MISMATCH (2026-09-25)
  "last_activity_at": "2026-09-19T10:00:00.000Z",
  "repo_url": "https://github.com/…",
  "latest_release": { "version": "v1.2.0", "url": "…", "timestamp": "…" },
  "hey_project_url": "https://heyresearch.xyz/project/…"
}
```

Five things worth knowing before you render it:

- **Print `hey_status_label`, not a word of your own.** Left to themselves, integrators turn a quiet
  project into "dead". HEY's vocabulary is deliberate and the labels travel with the enum.
- **There is no `abandoned`.** HEY sees silence, not intent. The most it will say is `dormant`.
- **`last_commit` is always `null`.** HEY aggregates commits into weekly summaries and stores no SHA.
  Use `last_code_activity`, and treat `commits` as a floor when `commits_partial` is true.
- **Carry `hey_project_url`.** Someone who sees a HEY line should be one tap from the evidence behind
  it. This is the one condition of use.
- **Check `token_verification` (2026-09-25).** The activity belongs to the project; the verification
  belongs to this address. On `MISMATCH` the project's own site names a different contract — do not
  print the activity as this token's.
- **Or read `activity_applies_to_token` (2026-09-27, additive).** `false` exactly on `MISMATCH`.
  Every other field keeps its value; on `false`, print the activity as the project's, never as this
  token's, and do not link from the token to `hey_project_url`.
- **Check `activity_measured` (2026-09-26).** `false` means HEY holds no repository, changelog or
  feed it can read for this project (or its status is unknown): `unknown` is then not a finding.
  `research_level` says how far HEY's research went; `as_of` when the project was last scored.
  `last_code_activity.commits_30d` (with `commits_30d_partial` and `window_start`) is the same
  thirty-day count as the card call's `commits_30d`, so the two calls agree; `commits` is the newest
  weekly summary's own figure, as that week recorded it.

## The card call: `GET /api/v1/scan?chain=4663&token=0x…` (2026-09-18)

The same answer as the one call above, in the shape a trading bot's card wants and with two more
figures. Built for the Chit bot's line above its buy and sell buttons —
`HEY: Shipping · 12 commits · 2 releases · Verified builder · see on HEY ↗` — and open to any bot.

```jsonc
{
  "found": true,
  "chainId": 4663,
  "contractAddress": "0x…",
  "status": "shipping",                 // shipping | active | resumed | quiet | dormant | unknown
  "status_label": "Shipping",           // HEY's own words for it — print these
  "status_help": "Shipped something meaningful in the last 7 days.",
  "verified_builder": true,
  "token_verification": "VERIFIED",     // MISMATCH: the project's own site names another contract (2026-09-25)
  "activity_applies_to_token": true,    // false exactly on MISMATCH; the card then has no cta (2026-09-27)
  "activity": { "commits_30d": 12, "releases_30d": 2, "ships_30d": 4, "last_ship": "2026-09-16", "last_ship_title": "v0.9.1" },
  "project": { "slug": "darkroute", "name": "DarkRoute", "symbol": "dark" },
  "project_url": "https://heyresearch.xyz/project/darkroute",
  "logo_url": "https://heyresearch.xyz/api/logo?u=…&s=128",
  "badge_url": "https://heyresearch.xyz/badge/darkroute.svg",
  "cta": { "label": "See the builder on HEY", "url": "https://heyresearch.xyz/project/darkroute" },
  "disclaimer": "…"
}
```

- `found: false` for a token HEY has no published page for, and — as a **200**, not a 400 — for a
  chain HEY does not index (`reason: "chain"`; Robinhood Chain 4663 only, the 46630 testnet
  included). Print nothing in both cases. A malformed `token` is a 400: that is a bug on your side.
- `chain` is optional and defaults to 4663.
- `commits_30d_partial: true` (2026-09-18) means HEY read a full page of a hundred commits that started
  inside the window, so `commits_30d` is a floor; print it as `100+`, or drop the figure.
- `commits_30d` is absent when the project has no repository HEY reads — never a zero that reads as
  "nobody committed". It counts commits by day across the project's repositories, deduplicated;
  `releases_30d` counts releases, launches and feature releases; `ships_30d` is every meaningful
  ship, the figure the project page shows.
- A database read only: answers in tens of milliseconds, `public, max-age=60` so your own cache can
  be short, 120 a minute without a key, your tier's bucket with one. Not `POST /api/scan`, which is
  the on-demand chain scan (ten an hour) — the name here is the partner's spelling.
- The `cta` always points at the project page, and is **absent when `activity_applies_to_token` is
  `false`** (2026-09-27): the project's own site names a different contract, so nothing on the card
  invites a reader from this token to the project. Every other field is still sent, with its value.
  There is no risk field, no score and no verdict;
  put a risk read from a tool that does that work beside this line.
- **Is a zero a measurement? (2026-09-26, additive.)** `activity_measured: false` means HEY holds
  no repository, changelog or feed it can read for this project, or cannot decide its status:
  `ships_30d: 0` and `releases_30d: 0` are then not findings — print nothing rather than "0 ships".
  `coverage` says why (`measured`, `no_source`, `not_researched`), `research_level` how far HEY's
  research went, and `as_of` when the project was last scored. `activity.meaningful_ships_30d`
  counts ships by the rule behind the status (a week of prereleases or code summaries counts once);
  `ships_30d` stays the ship-record count the project page shows. `activity.last_ship_url` is the
  last ship's public source.
- The zero address (`0x000…000`), which bots send for a native coin, answers **200**
  `{"found": false, "reason": "not_a_token", …}` from 2026-09-27 (it was a 400): print nothing. It
  costs you nothing — no allowance, no rate bucket — on the single call and, item by item, in the bulk
  call (`tokens=`); a batch of nothing else is free. The burn address (`0x…dead`) and any malformed
  token are still a 400.

## The partner contract: what never changes (2026-09-26)

Every change to these three calls is **additive**. What is below keeps its meaning; a change of
meaning would ship as a new versioned path, beside the old one for at least ninety days, with a
migration note. `/api/v1/` is the partner namespace, not an API version.

- **`/api/v1/scan`:** every key and type above; the lower-case six-state `status`; `found: false`
  as a 200 for an unpublished token and for another chain; 400 for a malformed token; `last_ship` as
  `YYYY-MM-DD`; `commits_30d` absent (not 0) without a readable repository; `ships_30d` and
  `releases_30d` as numbers with their meaning; the CTA (left out only when
  `activity_applies_to_token` is `false`, 2026-09-27); `found: false, reason: "not_a_token"` for the
  zero address (2026-09-27); the 60-second public cache; CORS `*`.
- **`/api/v1/builder`:** the four-value `status` with no `abandoned`; `last_commit: null`; explicit
  `null` for a field HEY does not hold; 404 with `scan_url` for an unpublished contract; 400 for
  another chain.
- **`/api/token/{chainId}/{address}`:** the camelCase shape; `status: "unknown"` as a 200; the chain
  id in the path, digits only; `shipsLast30Days` as a number. `researchLevel` is sent for every
  published project (the docs once said it was absent for a researched page; it never was).

Additive fields so far: `token_verification` / `tokenVerification` (2026-09-25); `research_level`,
`activity_measured`, `coverage`, `as_of`, `meaningful_ships_30d`, `last_ship_url`,
`activityMeasured`, `meaningfulShipsLast30Days`, `asOf`, and the builder call's `commits_30d`,
`commits_30d_partial`, `window_start` (2026-09-26); `activity_applies_to_token` /
`activityAppliesToToken` and `reason: "not_a_token"` (2026-09-27). The one change that is not purely
additive was agreed as a founder decision on 2026-09-27: on a `MISMATCH` token the card leaves out
`cta`, and the zero address answers `200` instead of `400`.

## If you want more

The same public API carries the rest of what HEY knows, on the same terms — no key, 120 a
minute. See [the public read API](/docs/public-api) for every endpoint, field and limit, and
[the MCP server](/docs/mcp) to give an assistant the same index, read-only.

If you write TypeScript or JavaScript, the card call above is one typed method in HEY's SDK
(2026-09-19). The package is built and tested in the repository but **not on npm yet** — the
`@hey-research` scope does not exist, so `npm i @hey-research/sdk` does not resolve; build it
with `pnpm --filter @hey-research/sdk build` until it is published. The shapes come with it:

```ts
import { HeyClient } from '@hey-research/sdk';
const hey = new HeyClient();
const card = await hey.scanCard(4663, address);
if (!card.found) return null;                       // unpublished token or another chain: print nothing
return `HEY: ${card.status_label} · ${card.activity.commits_30d ?? '–'} commits · ${card.activity.releases_30d} releases${card.verified_builder ? ' · Verified builder' : ''} · see on HEY ↗ ${card.project_url}`;
```

The client adds nothing to the API — no retry, no cache, no field the route does not send — so
everything on this page about the three answers, the limits and the four things not to do
applies to it unchanged.

## What HEY will never send you

Worth stating plainly, so you do not design around something that is not coming.

- No wallet analytics, no PnL, no smart-money labels, no holder lists read as a claim about
  people. HEY does not build it. The one thing it does keep is a daily snapshot of a *single
  token's* largest balances, which draws the distribution map on that token's market page. No
  payload carries a balance or an address, and it is never an input to activity status, Build
  Momentum, the Discovery Gap or the Builder Radar. What it does reach is `/api/signals`, as the
  `concentration_rose` kind — a Nakamoto count with its before and after, in a feed of measured
  changes (2026-09-19).
- No risk score, no safety grade, no verdict.
- No paid placement in any ordering. Nothing anyone pays HEY changes a status, a rank or a figure.
- No claim that a project which keeps building will be worth more. Those are two different
  things and HEY keeps them apart.

What is left is narrow on purpose: **who is building, what they shipped, when, and where HEY
read it.**
