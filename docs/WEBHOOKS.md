# Webhooks (2026-09-26)

HEY can push the change ledger's public events to an HTTPS endpoint you run.
Each delivery is one event exactly as `GET /api/changes` serves it (the same
serialiser, `publicChangeEvent`), signed with a secret only you hold.

Webhooks are **read-only** and carry **public facts only**. Nothing a
webhook tells you is missing from `/api/changes`; a webhook only tells you
sooner. Webhooks plus cursor polling of `/api/changes?after=` are the two
supported ways to follow HEY. There is no server-sent event stream (see
[Why no stream](#why-no-stream)).

- [Who can subscribe](#who-can-subscribe)
- [Events](#events)
- [What is never delivered](#what-is-never-delivered)
- [Payload](#payload)
- [Headers and signature](#headers-and-signature)
- [Verifying (TypeScript, curl)](#verifying)
- [Retries, dead letters, disabling](#retries-dead-letters-disabling)
- [Idempotency, ordering, replay](#idempotency-ordering-replay)
- [Managing subscriptions](#managing-subscriptions)
- [What a callback URL must be](#what-a-callback-url-must-be)
- [Operating it](#operating-it)

## Who can subscribe

An **API account**: an account with an active API key and no hold. Create the
key at `/account`, then manage subscriptions with that key at `/api/webhooks`
or on the account page. At most 5 subscriptions per account. A hold placed on
the account later pauses delivery (nothing is lost; it waits), and lifting the
hold resumes it.

## Events

| Type | What happened | `occurredAt` |
|---|---|---|
| `build.release` | a release was published | the publication, EXACT or DATE |
| `build.ship` | another meaningful ship (feature, integration, docs) | the publication |
| `build.status_changed`, `build.dormant`, `build.resumed` | the activity status moved | null, OBSERVED |
| `build.accelerating` | the development-window signal: shipping faster | the window's end, WINDOW |
| `research.published` | a project page was published | null, OBSERVED |
| `research.builder_verified` | a builder was verified | null, OBSERVED |
| `research.source_added`, `research.source_unavailable`, `research.source_restored` | an official source appeared, stopped answering, came back | null, OBSERVED |
| `contract.deployed`, `contract.followup_deployed` | the launch deploy; a later contract from the project's deployer | the block time |
| `contract.implementation_changed` | a proxy's implementation changed (an upgrade log, or HEY saw it between two reads) | the block (log), or null, OBSERVED |
| `contract.interface_changed`, `contract.source_verified` | the verified interface changed; the source was verified | null, OBSERVED |
| `market.status_changed` | the token's market status moved (live, low liquidity, liquidity gone…) | null, OBSERVED |
| `token.launch_stage_changed`, `token.verification_changed` | launch stage; token verification | null, OBSERVED |
| `lock.unlock_due` | a HoodLock unlock enters its last seven days | the unlock, SCHEDULED |
| `lock.observed`, `lock.withdrawn` | HEY first read a HoodLock lock; first read it withdrawn | null, OBSERVED |
| `event.retracted` | an event **you were sent** is no longer public: drop it | — |

`occurredAt` is set only when an outside source dates the event; otherwise it
is `null` with `precision: "OBSERVED"` and `detectedAt` is when HEY knew. The
lock times are HEY's knowledge times: the locker hands out none.

Only events seen as they happened are pushed (`origin: "live"`). History HEY
indexed later (`bootstrap`, `backfill` — an old upgrade log read from the
chain's archive, for example) is on `/api/changes` and never pushed. A
subscription starts at the ledger's position when it is made: earlier events
are for `/api/changes`.

An event that comes back after a retraction (a project hidden and then restored, say) is pushed as
news only when it was first seen live and is still recent. Otherwise it is sent only to a
subscription that received it and was told it was gone.

A later revision of an event you were sent is delivered again only when what
it says changed (its summary, facts, evidence, time or precision) — not when
it only gained an annotation, such as the release signal that restates a
ship an hour later. Keep the highest `revision` per `event.id`.

## What is never delivered

| Not delivered | Why |
|---|---|
| `market_integrity.event` where HEY does not publish Market Integrity | not published there (founder decision F5); where it is published (`HEY_MARKET_INTEGRITY=public`) it is subscribable, `GET /api/webhooks` lists it in `eventTypes`, and an exit-pattern classification is delivered only where HEY names one. Publishing is never pushed as news: events already recorded enter the ledger as `backfill`. |
| `market.distribution_changed` | derived from holder data (founder decision). |
| `market.liquidity_moved`, `market.volume_spike` | market movement is context, not a change a project made; HEY sends no trading alerts. |
| `build.code_activity`, `build.slowing`, `contract.source_unverified`, `contract.usage_changed`, `contract.method_first_observed`, `contract.method_resumed`, `research.owner_verified`, `research.narrative_assigned` | on `/api/changes`; not pushed. |
| anything Terminal-only | never, on any public surface. |
| project-linked address events, holder lists | never. |

Asking for one of these is `400 invalid_event_types`, with the reason.

## Payload

```json
{
  "type": "build.release",
  "payloadVersion": 1,
  "deliveryId": "6f0c…",
  "sentAt": "2026-09-26T12:00:05.000Z",
  "event": { "id": "ship:2ac8…", "revision": 1, "op": "upsert", "type": "build.release", "…": "exactly as /api/changes" }
}
```

- `event.retracted`: `{"type": "event.retracted", …, "event": {"id", "revision", "op": "retract", "recordedAt"}}` — it names nothing else, so it never discloses a project that was hidden.
- `ping`: `{"type": "ping", …, "subscriptionId"}` — sent when a subscription is made, re-pointed or re-enabled, and when you ask.

`payloadVersion` changes only if the envelope changes meaning; the SDK refuses
a version it does not know rather than guess.

## Headers and signature

| Header | Value |
|---|---|
| `hey-signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` — two `v1=` for 24 h after a rotation |
| `hey-event-id` | the event id (absent on a ping) |
| `hey-delivery-id` | the delivery id: the same on every retry of one delivery |
| `hey-payload-version` | `1` |
| `user-agent` | `HEY-Webhooks/1` |
| `content-type` | `application/json` |

HEY sends nothing else: no cookie, no authorization, no key of any kind.

The secret (`whsec_…`) is shown once, when the subscription is made or
rotated. HEY does not store it — it is derived from a server key and the
subscription — so it cannot be shown again: rotate to get a new one.

## Verifying

Verify against the **raw body bytes**, before parsing. Reject a timestamp more
than five minutes from your clock, either way.

### TypeScript (`@hey-research/sdk`)

```ts
import { isReplay, parseWebhookEvent } from '@hey-research/sdk';

const seen = new Set<string>(); // a durable store (a table, Redis) in production

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  let event;
  try {
    event = await parseWebhookEvent({
      rawBody,
      header: request.headers.get('hey-signature'),
      secret: process.env.HEY_WEBHOOK_SECRET!, // never log it
    });
  } catch {
    return new Response('bad signature', { status: 400 });
  }
  if (await isReplay(event.deliveryId, seen)) return new Response(null, { status: 200 });
  switch (event.type) {
    case 'ping':
      break;
    case 'event.retracted':
      // delete event.event.id from your copy
      break;
    default:
      // upsert event.event, keeping the highest revision per id
  }
  return new Response(null, { status: 204 });
}
```

`verifyWebhookSignature({ rawBody, header, secret, toleranceSeconds?, now? })`
returns `{ ok: true, timestamp }` or `{ ok: false, reason }` without throwing;
the comparison is constant-time. `secret` may be an array while you roll your
own copy over.

### Shell (curl + openssl), to check one delivery by hand

```sh
# body.json holds the raw body exactly as received; SIG the hey-signature header.
T=$(printf '%s' "$SIG" | sed -E 's/.*t=([0-9]+).*/\1/')
printf '%s.%s' "$T" "$(cat body.json)" | openssl dgst -sha256 -hmac "$HEY_WEBHOOK_SECRET" | awk '{print $2}'
# compare with the v1= value(s) in $SIG, and check $T is within five minutes of `date +%s`.
```

## Retries, dead letters, disabling

- Answer with any 2xx within **5 seconds**. Only the first 4 KB of your answer is read; 256 characters of it are kept for you to see.
- Anything else is a failure: a 4xx, a 5xx, a timeout, a network error, and **any 3xx — redirects are never followed**, to anywhere.
- A failed delivery is retried at **1 min, 5 min, 30 min, 2 h, 6 h and 12 h**. The seventh failure makes it **DEAD** (a dead letter): it stays in your delivery log for 30 days and is not tried again unless an operator redelivers it.
- **Ten DEAD deliveries in a row disable the subscription**, with the reason. Re-enable it with `PATCH {"status": "active"}`: it is re-verified by a ping and restarts from the ledger's current position. Sync the gap from `/api/changes?after=<cursor>` using the `cursor` the subscription showed.
- A ping is tried once.
- Per endpoint, HEY sends at most 20 deliveries a minute and 2 at a time.
- An event withdrawn before it went out is **CANCELLED**, never sent.

## Idempotency, ordering, replay

- Deduplicate on `hey-delivery-id` (retries) and on `event.id` + `event.revision` (content).
- Deliveries are **not guaranteed in order**: retries and two-at-a-time sending reorder them. Order by `event.recordedAt`, and keep the highest `revision`.
- A captured request cannot be replayed later: the timestamp is signed, and the SDK refuses one outside the tolerance. `isReplay` catches repeats inside it.
- At-least-once: a receiver that answered slowly may see a delivery again. That is what `hey-delivery-id` is for.

## Managing subscriptions

All routes take `authorization: Bearer <key>` and answer `private, no-store`.
Another account's subscription answers `404`, like one that does not exist.

```sh
KEY=hey_…   # your API key; never paste it into a shared log

# Create: the answer holds the secret, once.
curl -sS -X POST https://heyresearch.xyz/api/webhooks \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"url":"https://example.com/hey","eventTypes":["build.release","lock.withdrawn"],"projects":["arrow"]}'

# List, read, change, remove
curl -sS -H "authorization: Bearer $KEY" https://heyresearch.xyz/api/webhooks
curl -sS -X PATCH -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"status":"disabled"}' https://heyresearch.xyz/api/webhooks/$ID
curl -sS -X DELETE -H "authorization: Bearer $KEY" https://heyresearch.xyz/api/webhooks/$ID

# Rotate the secret (shown once; the old one keeps signing for 24 h), ping, read the log
curl -sS -X POST -H "authorization: Bearer $KEY" https://heyresearch.xyz/api/webhooks/$ID/rotate
curl -sS -X POST -H "authorization: Bearer $KEY" https://heyresearch.xyz/api/webhooks/$ID/ping
curl -sS -H "authorization: Bearer $KEY" "https://heyresearch.xyz/api/webhooks/$ID/deliveries?status=DEAD&limit=20"
```

| Code | Status | Meaning |
|---|---|---|
| `key_required` | 401 | no key, or keys are closed on this deployment |
| `account_held` | 403 | the account is suspended or blocked |
| `subscription_limit` | 409 | the account already holds 5 |
| `invalid_event_types` | 400 | an unknown or never-delivered type (`detail.refused` says why) |
| `unknown_projects` | 400 | a slug that is not a published project (`detail.unknown`) |
| `invalid_destination` | 400 | the URL breaks a rule below (`detail.reason`) |
| `subscription_disabled` | 409 | ping a disabled subscription: re-enable it first |
| `payload_too_large` | 413 | a body over 16 KB |
| `webhooks_unavailable` | 503 | this deployment cannot sign (no `WEBHOOK_MASTER_KEY`) |
| `rate_limited` | 429 | per account: 10 creates, 10 rotations, 30 pings, 60 changes an hour |

## What a callback URL must be

A webhook is a request HEY's servers make to an address a stranger chose, on a
schedule, forever. The rules are checked when a URL is set **and again before
every attempt**, DNS included; the connection is then pinned to the addresses
just checked, so a DNS answer that changes in between (rebinding) cannot
redirect it.

- `https`, on port 443, to a dotted hostname — not an IP address, not a single-label name.
- No username or password in the URL (authenticate deliveries by their signature).
- Never HEY itself: `heyresearch.xyz`, its subdomains, the deployment's own host, or the origin addresses the operator lists.
- **Every** A/AAAA answer must be a public address. Refused: private (10/8, 172.16/12, 192.168/16), loopback, link-local and cloud metadata (169.254/16), CGNAT (100.64/10), "this network" (0/8), benchmarking (198.18/15), IETF protocol assignments (192.0.0/24), the three TEST-NETs, multicast and reserved; IPv6 loopback, unique-local, link-local and site-local, IPv4-mapped and IPv4-compatible (`::/96`), NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`), Teredo (`2001::/32`), documentation (`2001:db8::/32`), discard (`100::/64`) and multicast.
- Outside production only, `http://localhost:<port>` (or 127.0.0.1, [::1]) is accepted, so you can run a receiver on your own machine.

## Why no stream

A server-sent `/api/changes/stream` was considered and not built. The ledger
is written every five minutes (hourly for signals), so a stream could be no
fresher than polling `after=` every minute; the web tier compresses every
response and is replaced on each deploy, which drops long connections; and
keyed machine demand does not yet justify holding connections open. It will
be revisited when the producer runs in under a minute and keyed demand
exists.

## Operating it

- **Environment.** `WEBHOOK_MASTER_KEY` (web and worker; `openssl rand -hex 32`, at least 32 characters; unset means webhooks are off). Changing it changes every subscriber's secret — rotate each afterwards and tell the owners. `WEBHOOK_DENY_ADDRESSES`: the origin server's public addresses, comma-separated.
- **Worker.** `DELIVER_WEBHOOKS` runs every minute where the master key is set: fan-out (queue new public events per subscription, under the projector's lock in shared mode so the ledger is never read half-written), send what is due, prune settled deliveries older than 30 days. A ping or a redelivery wakes it at once.
- **Console.** `/admin/webhooks` (admin): endpoints by status, 24 h delivered/retrying/dead/cancelled, latency p50/p95, event types, disabled endpoints with reasons, and an audited **Redeliver** on a dead delivery. It warns when the oldest due delivery has waited more than ten minutes.
- **Audit.** Create, change, rotate, delete, auto-disable and redeliver are `audit_log` rows (`webhook.subscription.*`, `webhook.delivery.redelivered`).
- **A controlled live test** (production): `HEY_API_KEY=hey_… scripts/webhook-live-test.sh https://<your receiver> --wait-release 30` does the steps below — create, wait for the ping, watch for a release, delete — without printing the key or the secret. By hand: with a receiver you control (for example a one-off request-inspection URL you created yourself), create a subscription for `build.release` with your key, watch `GET /api/webhooks/{id}/deliveries` show the ping `SUCCEEDED` and the subscription `ACTIVE`, wait for the next release (`/api/changes?type=build.release` shows when one lands; delivery follows within the projector's five minutes plus a minute), verify the signature with the secret from the create answer, then point the receiver at a 500 and watch `RETRYING` on `/admin/webhooks`, and delete the subscription. Never paste the secret or your key into a shared log.
