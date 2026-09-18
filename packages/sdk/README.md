# @hey-research/sdk

Typed client for the [HEY Research](https://heyresearch.xyz) public API — the
builder-discovery layer for Robinhood Chain. It answers one question: **which
projects are still building, what have they shipped, and which of them is
nobody looking at?**

Every call reads the same source-backed record the site renders. Nothing here
ranks by price, values a token, or knows anything about a wallet, because HEY
does not.

```sh
npm install @hey-research/sdk
```

Node 18 or newer, or any runtime with `fetch`. ESM and CommonJS, types included,
no dependencies.

## Usage

```ts
import { HeyClient } from '@hey-research/sdk';

const hey = new HeyClient();

const page = await hey.projects.list({ tab: 'still-building', limit: 10 });
for (const project of page.items) {
  console.log(project.name, project.activityStatus, project.lastShippedAt ?? 'no ship recorded');
}

const agentos = await hey.projects.get('agentos');
console.log(agentos.ships[0]?.title, agentos.ships[0]?.sourceUrl);

const card = await hey.scanCard(4663, '0x…');
if (card.found) console.log(card.status_label, card.activity.ships_30d);
```

An API key from [heyresearch.xyz/account](https://heyresearch.xyz/account) lifts
the anonymous rate limit and nothing else; browsing needs no key.

```ts
const hey = new HeyClient({ apiKey: process.env.HEY_API_KEY, userAgent: 'my-newsletter/1.2' });
```

### Calls

| Method | Route |
|---|---|
| `projects.list(query)` / `pages(query)` / `items(query)` | `GET /api/projects` |
| `projects.get(slug)` | `GET /api/projects/{slug}` |
| `projects.market(slug, { days })` | `GET /api/projects/{slug}/market` |
| `projects.intelligence(slug)` | `GET /api/projects/{slug}/intelligence` |
| `ships.list(query)` / `pages(query)` / `items(query)` | `GET /api/ships` |
| `signals.list(query)` / `pages(query)` / `get(id)` | `GET /api/signals`, `/api/signals/{id}` |
| `builders.list(query)` / `pages(query)` | `GET /api/builders` |
| `token.lookup(chainId, address)` | `GET /api/token/{chainId}/{address}` |
| `scanCard(chainId, address)` | `GET /api/v1/scan` |
| `bounties.list({ status, limit })` / `get(id)` | `GET /api/bounties`, `/api/bounties/{id}` |
| `reports.weekly.list()` / `get(week)` | `GET /api/reports/weekly`, `/api/reports/weekly/{week}` |
| `chain({ days })` | `GET /api/chain` |
| `thisWeek()` | `GET /api/this-week` |
| `status()` | `GET /api/status` |
| `get<T>(path, params)` | any route, with the same headers and errors |

Query fields mirror the parameters documented at
[heyresearch.xyz/developers](https://heyresearch.xyz/developers). `has` takes an
array and is sent comma-joined. Undefined and empty values are not sent.

### Paging

Two listings page two ways, and the helpers follow each:

- `projects` and `ships` say where the next page starts (`nextOffset`, absent
  when the listing ends). `pages()` follows it; `items()` flattens the rows.
- `signals` and `builders` say only how many there are (`total`). `pages()`
  steps by the rows each page actually held until the total is reached.

```ts
for await (const ship of hey.ships.items({ sort: 'detected', detectedSince: watermark })) {
  // mirror along detectedAt, never publishedAt
}
```

Both are async iterables: stop reading and no further request is made.

### Absent means unknown

A field the API does not know is left out, never sent as `null` or `0`. A
missing `marketCap` is not a zero market cap; a project with no `score` has not
been measured. The types say so — most fields are optional — and the one shape
that carries `null` is `HeyStatus`, where "never captured" is a fact about the
platform. `stillBuilding: true` always travels with `stillBuildingEvidence`.

### Errors

Every failure is a `HeyApiError` with a `code`:

| `code` | When |
|---|---|
| `not_found` | 404 — no published record at that address |
| `unauthorized` | 401 — the API key was refused |
| `forbidden` | 403 — a hold on the key or account; `reason` says which |
| `quota` | 429 with `{ error: 'quota' }` — the key's monthly allowance is used |
| `rate_limited` | any other 429; `retryAfterSeconds` from the `retry-after` header |
| `bad_request` | 400 |
| `unavailable` | 503 |
| `timeout` | no answer within `timeoutMs` (default 15 s) |
| `network` | `fetch` itself threw |
| `http` | any other non-2xx |

The message is the sentence HEY sent, when it sent one. `status` and the parsed
`body` are attached.

**No retries.** The client never retries on your behalf; a 429 surfaces with
`retryAfterSeconds` and you decide. A paging walk ends with the same error a
single call would throw.

### In a browser

The client sets a `user-agent` of `hey-research-sdk/<version>` (prefixed by your
`userAgent` option) so HEY's traffic console can tell callers apart. Browsers
treat `user-agent` as a forbidden header and drop it silently; the API does not
need it, so nothing breaks — only the console's label.

## What it will not say

HEY records public building activity. It is not investment advice, it does not
predict or rank by price, and it holds no wallet data. *Still Building* is a
narrow claim — verified activity through a market drawdown HEY tracked — and
never a buy signal.

## Licence

MIT © HEY Research Lab
