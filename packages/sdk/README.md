# @hey-research/sdk

> **Not yet published to npm; build from source.** Until the first release the
> `npm install` line below does not resolve. Clone the repository and run
> `pnpm install && pnpm --filter @hey-research/sdk build`.

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

Every public route has a method (2026-09-26); each response type is held equal
to the API's serialiser by a contract test.

| Method | Route |
|---|---|
| **One project** | |
| `projects.snapshot(slug)` | `GET /api/projects/{slug}/snapshot` — the important state in one read |
| `projects.coverage(slug)` | `GET /api/projects/{slug}/coverage` — what HEY knows and does not, as states |
| `projects.explain(slug)` / `explain(slug, fact, { source })` | `GET /api/projects/{slug}/explain` — the facts HEY can explain / why it shows one |
| `projects.get(slug)` | `GET /api/projects/{slug}` — the dossier |
| `projects.market(slug, { days })` | `GET /api/projects/{slug}/market` |
| `projects.marketMoves(slug, { days, min })` | `GET /api/projects/{slug}/market-moves` |
| `projects.intelligence(slug)` | `GET /api/projects/{slug}/intelligence` |
| `projects.timeline(slug, { lens, limit, before })` / `timelinePages(slug, { lens, limit })` | `GET /api/projects/{slug}/timeline` |
| `projects.history(slug, { series, from, to })` | `GET /api/projects/{slug}/history` |
| `projects.diff(slug, { from, to })` | `GET /api/projects/{slug}/diff` |
| `projects.contracts(slug)` | `GET /api/projects/{slug}/contracts` |
| `projects.ask(slug, question)` | `GET /api/projects/{slug}/ask` |
| `projects.marketIntegrity(slug)` | `GET /api/projects/{slug}/market-integrity` (404 until HEY publishes it) |
| `projects.compare(slugs)` | `GET /api/compare` — two to four, no winner |
| **Catalogue** | |
| `projects.list(query)` / `pages(query)` / `items(query)` | `GET /api/projects` |
| `search.suggest(q)` | `GET /api/search/suggest` |
| `ships.list(query)` / `pages(query)` / `items(query)` | `GET /api/ships` |
| `signals.list(query)` / `pages(query)` / `get(id)` | `GET /api/signals`, `/api/signals/{id}` |
| `builders.list(query)` / `pages(query)` | `GET /api/builders` |
| **Changes and evidence** | |
| `changes.list(query)` / `pages(query)` / `items(query)` | `GET /api/changes` (browse, newest first) |
| `changes.sync(cursor, query)` | `GET /api/changes?after=` (mirror: from a kept cursor to the head) |
| `evidence.get(id)` | `GET /api/evidence/{id}` — a typed id as a receipt |
| **Contracts and tokens** | |
| `contracts.get(chainId, address)` | `GET /api/contracts/{chainId}/{address}` |
| `token.lookup(chainId, address)` | `GET /api/token/{chainId}/{address}` |
| `token.bulk(chainId, addresses)` | `GET /api/token/{chainId}?addresses=` — keyed only, at most 30 |
| `snapshots.bulk(slugs)` | `GET /api/snapshots?slugs=` — keyed only, at most 10 |
| **Partner cards** | |
| `scanCard(chainId, address)` | `GET /api/v1/scan` |
| `scanCards(chainId, addresses)` | `GET /api/v1/scan?tokens=` — keyed only, at most 30 |
| `builderCard(chainId, address)` | `GET /api/v1/builder` — snake_case, explicit nulls |
| **The chain** | |
| `chain({ days })` | `GET /api/chain` |
| `thisWeek()` | `GET /api/this-week` |
| `reports.weekly.list()` / `get(week)` | `GET /api/reports/weekly`, `/api/reports/weekly/{week}` |
| `silence()` | `GET /api/chain/silence` — Under the Radar and below the 40th market-attention percentile |
| `accelerating()` | `GET /api/chain/accelerating` |
| `comebacks()` | `GET /api/chain/comebacks` — status RESUMED |
| `unlocks({ days })` | `GET /api/chain/unlocks` — HoodLock only |
| `buildMarket()` | `GET /api/chain/build-market` |
| `contractChanges({ days })` | `GET /api/chain/contract-changes` |
| **The rest** | |
| `bounties.list({ status, limit })` / `get(id)` | `GET /api/bounties`, `/api/bounties/{id}` |
| `status()` | `GET /api/status` |
| `get<T>(path, params)` | any route, with the same headers and errors |

A bulk read costs one request per item against both the per-minute bucket and
the monthly allowance, answers every item in input order with its own
`found`/`error`, and is refused whole with 400 `batch_too_large` past its
maximum.

Query fields mirror the parameters documented at
[heyresearch.xyz/developers](https://heyresearch.xyz/developers). `has` takes an
array and is sent comma-joined. Undefined and empty values are not sent.

### Paging

Listings page three ways, and the helpers follow each:

- `projects` and `ships` say where the next page starts (`nextOffset`, absent
  when the listing ends). `pages()` follows it; `items()` flattens the rows.
- `signals` and `builders` say only how many there are (`total`). `pages()`
  steps by the rows each page actually held until the total is reached.
- `changes` and a project's timeline carry an opaque `nextCursor`
  (`cursorPages`, exported).

To keep a copy of what changed, sync the change ledger — it is the one
mirroring contract, and nothing is missed: a fact HEY recorded or published
late gets a position after your cursor, and a retraction arrives as a
tombstone.

```ts
let cursor = await store.get('hey-cursor') ?? 'c1.0';
for await (const page of hey.changes.sync(cursor, { type: ['build.release'] })) {
  for (const event of page.items) {
    if (event.op === 'retract') await store.delete(event.id);
    else await store.upsertIfNewer(event.id, event.revision, event);
  }
  cursor = page.nextCursor!; // keep it only after the page is applied
  await store.set('hey-cursor', cursor);
}
```

Both are async iterables: stop reading and no further request is made.

**One walk at a time.** Read serially and a full walk of the catalogue is
comfortable — 101 pages, 4,844 items, no duplicates and no refusal, measured
against the live API without a key. `Promise.all` over several `list()` or
`pages()` calls is a different thing: the anonymous limit is 120 a minute per
address, and 150 concurrent requests were first refused at request 19, with 82
refused in all. One client, one walk at a time — or use a key, which raises the
bucket to your tier.

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

**One redirect, and only to HEY's own API.** The API key is sent as a bearer
token on every request, so the client asks `fetch` not to follow redirects
itself. A renamed project's old slug answers `308` to its new API path; the
client follows that one hop when it stays on the same origin under `/api/`
(since 2026-09-26). Any other 3xx — another host, a page, a second hop —
becomes a `http` error naming the host the `Location` pointed at, and the key
is never sent there. If you see one, `baseUrl` is pointing somewhere that
forwards — give it the origin that answers directly (`https://heyresearch.xyz`,
not an `http://` or vanity form of it). A `fetchImpl` of your own must keep
that property: do not replay the `Authorization` header across origins.

### In a browser

The client sets a `user-agent` of `hey-research-sdk/<version>` (prefixed by your
`userAgent` option) so HEY's traffic console can tell callers apart. Browsers
treat `user-agent` as a forbidden header and drop it silently; the API does not
need it, so nothing breaks — only the console's label.

## Receiving webhooks

HEY can POST its public changes to an endpoint you register at
`/api/webhooks` (see `docs/WEBHOOKS.md`). Verify each delivery against the
raw body before you trust it:

```ts
import { isReplay, parseWebhookEvent } from '@hey-research/sdk';

const rawBody = await request.text();
const event = await parseWebhookEvent({ rawBody, header: request.headers.get('hey-signature'), secret: process.env.HEY_WEBHOOK_SECRET! });
if (!(await isReplay(event.deliveryId, seen))) {
  // event.type: a HeyWebhookEventType, 'event.retracted' or 'ping'
}
```

`verifyWebhookSignature` returns `{ ok, reason }` instead of throwing, uses
Web Crypto (Node 18+, Deno, Bun, Workers, browsers) and compares in constant
time; the default tolerance is five minutes either way. `WEBHOOK_EVENT_TYPES`
lists what a subscription may ask for.

## What it will not say

HEY records public building activity. It is not investment advice, it does not
predict or rank by price, and it holds no wallet data. *Still Building* is a
narrow claim — verified activity through a market drawdown HEY tracked — and
never a buy signal.

## Licence

MIT © HEY Research Lab
