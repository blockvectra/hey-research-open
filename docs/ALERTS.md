# Alerts (2026-09-28)

An alert is a standing question to HEY: *tell me when this project ships a
release*, *when a watched project changes implementation*, *when an unlock on
my watchlist is due within seven days*. When HEY records a change that answers
it, the change appears in your inbox at `/account/alerts` — and, if you asked,
in an email or at one of your own webhooks.

Alerts **subscribe to canonical facts**. An alert never defines an event of its
own: every alert is a public event from HEY's change ledger (the same events
`GET /api/changes` serves and webhooks deliver), matched against your rule and
shown exactly as the ledger says it, with its evidence. There is no second
event feed, and an alert can never say something `/api/changes` does not.

An alert is a record of what changed. It is never a recommendation, and HEY
sends **no price or trading alerts**.

- [Presets](#presets)
- [What a rule is](#what-a-rule-is)
- [What can never be an alert](#what-can-never-be-an-alert)
- [Channels](#channels)
- [Matching, dedupe and retractions](#matching-dedupe-and-retractions)
- [The API](#the-api)
- [Security](#security)
- [Operating it](#operating-it)
- [Not built](#not-built)

## Presets

A reader starts from a sentence. Each preset is exactly one set of ledger event
types; nothing is computed for the alert.

| Preset | Sentence | Ledger types |
|---|---|---|
| `release` | When *project* ships a release | `build.release` |
| `implementation` | When *project* changes implementation | `contract.implementation_changed` |
| `resumed` | When *project* resumes building after a long quiet period | `build.resumed` — HEY's own Resumed status: shipping again after 60 or more days without observed activity (`ACTIVITY.dormancyGapDays`) |
| `unlock` | When an unlock for *project* is due within 7 days | `lock.unlock_due`, with `unlockWithinDays` (1–7) |
| `docs` | When official docs or site for *project* materially change | `research.source_changed` |
| `integrity` | When Market Integrity for *project* changes | `market_integrity.event` — offered only where HEY publishes Market Integrity |
| `usage` | When on-chain usage of *project* starts after a quiet period | `contract.method_first_observed`, `contract.method_resumed` — in the inbox only |

"Resumes after 30 days" is not a fact HEY records: the ledger's `build.resumed`
means 60 or more days, and an alert cannot lower that without inventing an
event. The preset says so.

*Project* is one of: a project (from its page), every project on your watchlist
**as it is when the change arrives**, or any published project.

## What a rule is

```json
{
  "name": "When HoodLock ships a release",
  "scope": "projects",
  "projects": ["hoodlock"],
  "eventTypes": ["build.release"],
  "conditions": {},
  "channels": { "email": false, "webhook": null, "telegram": false },
  "enabled": true
}
```

- **scope**: `projects` (1–50 published slugs), `watchlist`, or `all`.
- **eventTypes**: 1–40 alertable types (below).
- **conditions** narrow only the types they apply to, and only by facts the
  event itself carries:
  - `statusTo` / `statusFrom` — the `after` / `before` state of a transition
    (`build.status_changed`, `market.status_changed`,
    `token.launch_stage_changed`, `token.verification_changed`). An unknown side
    does not match.
  - `unlockWithinDays` (1–7) — for `lock.unlock_due`: the ledger announces an
    unlock seven days ahead; the notification is shown from N days before the
    locker's own unlock date.
  - `minSilenceDays` (30–365) — for `contract.method_resumed`: the event's own
    `longestSilenceDays` must be at least N. An event that does not carry the
    figure does not match: unknown is not a long silence.
- A rule starts at the ledger's current position when it is made or turned
  back on. An alert is about what happens next; history is on `/api/changes`.
- At most 25 rules per account.

Alertable types are the webhook-deliverable set (see
[Webhooks](/docs/webhooks#events)), `market_integrity.event` only where
published, plus `contract.method_first_observed` and `contract.method_resumed`.

## What can never be an alert

| Type | Why |
|---|---|
| `market.liquidity_moved`, `market.volume_spike` | market movement is context, not a change a project made; HEY sends no trading alerts |
| `market.distribution_changed` | derived from holder data |
| `market_integrity.event` where not published | the ledger keeps it Terminal-only |
| any Terminal-only row | alerts read public ledger rows only |
| a price target, a market cap or volume threshold | not a canonical fact, and not HEY's product |

## Channels

- **In HEY**, always: the inbox at `/account/alerts`, one row per event however
  many of your rules matched it, with the rules named. The unread count is on
  the account page and on `/updates`.
- **Email**, when you tick it and your address is confirmed through the same
  double opt-in every HEY message uses. At most **one message an hour** per
  reader, listing up to 20 events and how many more are in the inbox. Every
  message carries a one-click unsubscribe that turns off alert email and
  nothing else (mail kind `alerts`). With mail switched off, no confirmed
  address, or alert email switched off, the notification is marked skipped —
  turning mail on later does not send a backlog. Each run takes readers
  oldest-waiting first and never one already mailed this hour (2026-09-28: the
  first fifty by user id used to be re-picked and deferred every run, and
  nobody past them was reached). The rows a message covers are marked
  `sending` with its subject before the mailer is called, and `sending` is
  final: a crash after the mail ledger recorded the message never mails them
  again. Only rows left `sending` from an earlier hour with no ledger row for
  that subject — they never reached the mailer — go back to pending.
- **Webhook**, by naming one of **your own** webhook subscriptions. A rule never
  holds a URL: the subscription already passed the destination checks and a
  signed ping. The matcher queues a row in `webhook_deliveries` keyed
  `(subscription, seq)` — the fan-out's own key — so a subscription that also
  asks for the type is sent the event once, and the sender makes every check it
  makes for any delivery (DNS pinning, no redirects, no credentials). When both
  want the row, the earlier `next_attempt_at` wins while it is still PENDING
  (2026-09-28), so an unlock rule's hold never delays the subscription's own
  immediate delivery, whichever job ran first.
- The two `contract.method_*` types are **shown in HEY only**: pushing them out
  of HEY (email, webhook) is a founder decision that has not been made.
- **Telegram** (2026-09-30), to a private chat you linked from **Account →
  Telegram** (a ten-minute, single-use code the bot confirms by your display
  name). One message per event however many of your rules matched it, paced to
  a few a minute per chat; a burst of twenty or more becomes one message
  pointing to your inbox. A retracted event is never sent, and one already
  sent is edited to say it was withdrawn. Only the pushable types (the
  webhook-deliverable set) are sent, like email. Off until the bot is
  configured on the deployment; see [docs/TELEGRAM.md](TELEGRAM.md).
- **Discord is not built** (see [Not built](#not-built)).

## Matching, dedupe and retractions

One matcher, `MATCH_ALERTS`, every minute, one run at a time
(`packages/domain/src/alerts/match.ts`):

1. It reads `change_events` past its cursor (`alert_matcher_state`) in `seq`
   order, under the projector's lock in shared mode — the webhook fan-out's
   discipline, so a projector batch is never read half written.
2. Public, `live` upserts that are an alert's news can match: the event's
   first public appearance, or its return after a retraction. A later revision
   — a content change or an annotation — is not news to an alert (2026-09-28:
   it used to be, and was kept from notifying twice only by the
   `(rule_id, event_id)` row, which retention deletes after 90 days, so a
   revision after that told the reader again). `bootstrap` and `backfill`
   history is never news. The webhook fan-out keeps its own predicate.
3. `(rule_id, event_id)` is unique. A re-run, a crash between pages or two
   workers at once land on the same row, and every refused repeat is counted
   (`dedupe_total`).
4. A retraction marks the event's notifications retracted, stops a pending
   email, cancels a webhook delivery not yet sent and queues `event.retracted`
   for one that was. The inbox then says the change was withdrawn and nothing
   else about it. An event that comes back is un-retracted.
5. The cursor moves in the same transaction as the notifications it wrote.

A notification stores no text: the inbox, the API and the email render the
ledger's newest public revision through `publicChangeEvent`.

## The API

Manage your own rules with an API key (`authorization: Bearer <key>`) or, from
HEY's own pages, your session. Answers are `private, no-store`. Another
account's rule answers 404, exactly like one that does not exist.

| Route | |
|---|---|
| `GET /api/alerts` | your rules, the alertable types and the presets on this deployment |
| `POST /api/alerts` | make one: `{preset?, eventTypes?, scope?, projects?, conditions?, channels?, name?, enabled?}` |
| `GET /api/alerts/{id}` | one rule |
| `PATCH /api/alerts/{id}` | change `name`, `scope`, `projects`, `eventTypes`, `conditions`, `channels`, `enabled` |
| `DELETE /api/alerts/{id}` | delete it and its notifications |
| `GET /api/alerts/notifications?limit=&before=&unread=` | your inbox; each `event` is the `/api/changes` event, or null when withdrawn |
| `POST /api/alerts/notifications` | mark read: `{"eventIds": [...]}` or `{"all": true}` |

Refusals: `invalid_parameter`, `invalid_event_types` (with the reason per type),
`unknown_projects`, `rule_limit` (409), `email_unconfirmed` (409),
`telegram_unlinked` (409), `unknown_webhook`, `not_found`. The SDK types are `HeyAlertRule`,
`HeyAlertList`, `HeyAlertNotifications` and friends. There is no MCP tool.

## Security

- **Ownership** is in the same predicate as the id on every read and write;
  marking read touches only the caller's rows whatever ids are sent.
- **No URL** is accepted anywhere in an alert. Outbound delivery goes only
  through the account's own verified webhook subscriptions and the existing
  sender (CLAUDE.md machine-layer rule 11).
- **Rate limits**, per account: 20 creates an hour, 120 changes, 300 read-marks;
  signed-in API reads 120 a minute; keyed calls also spend the key's bucket.
- A cookie write from another origin is refused; HEY's forms are server actions,
  which Next checks for origin.
- **Audit**: every create, change and delete is an `audit_log` row naming what
  changed, never an address.
- **AI never creates an alert.** A copilot may propose one; only the reader,
  submitting the form or calling the API with their own key, makes it. Rules
  record their `origin` (`site` or `api`) and there is no `ai` value.
- An alert is a private reader choice: nothing here reaches activity status,
  Build Momentum, the Discovery Gap, the Radar or any ranking
  (`packages/domain/src/watchlist/neutrality.test.ts`).

## Operating it

- `HEY_ALERTS_ENABLED` — on unless `false`. Off, `/account/alerts` and
  `/api/alerts` answer 404 and the entry points go; the matcher keeps running
  over the rules that exist.
- `/admin/webhooks#alerts` — rules, matches, dedupe hits, email and webhook
  outcomes, failed channels, the matcher's backlog and lag
  (`alertsHealth()` in `packages/domain/src/alerts/health.ts`).
- Retention: read or retracted notifications older than 90 days are pruned a
  bounded slice per run.

## Not built

- **Discord.** Founder-owned: it needs a Discord application with a bot token
  kept as a server secret, and the same one-time linking Telegram uses
  (2026-09-30) so HEY never sends to a channel nobody proved they own.
- **Email for `contract.method_*` events** and **pushing** them at all: a
  founder decision.
- **Natural-language alert creation.** The copilot may later propose a rule
  through `AlertService`; the reader confirms it. Nothing creates one silently.
