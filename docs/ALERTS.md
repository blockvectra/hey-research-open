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
- [Asking for an alert in words](#asking-for-an-alert-in-words)
- [What a rule is](#what-a-rule-is)
- [What can never be an alert](#what-can-never-be-an-alert)
- [Channels](#channels)
- [Matching, dedupe and retractions](#matching-dedupe-and-retractions)
- [The API](#the-api)
- [Security](#security)
- [Not built](#not-built)

## Presets

A reader starts from a sentence. Each preset is exactly one set of ledger event
types; nothing is computed for the alert.

| Preset | Sentence | Ledger types |
|---|---|---|
| `release` | When *project* ships a release | `build.release` |
| `ship` | When *project* ships an update | `build.ship` — every other ship the ledger publishes: a launch, an integration, a docs or product update (added 2026-10-09) |
| `code` | When *project* pushes code in a week | `build.code_activity` — HEY's weekly code-activity summary, once when it first arrives; in the inbox only (added 2026-10-09) |
| `deploy` | When *project* deploys a contract | `contract.deployed` — never `contract.followup_deployed`, a serial launcher's deploy that is context, not a ship (added 2026-10-03) |
| `implementation` | When *project* changes implementation | `contract.implementation_changed` |
| `resumed` | When *project* resumes building after a long quiet period | `build.resumed` — HEY's own Resumed status: shipping again after 60 or more days without observed activity (`ACTIVITY.dormancyGapDays`) |
| `status` | When the activity status of *project* changes | `build.status_changed`, `build.dormant`, `build.resumed` — every activity status move the ledger announces, measured from building (added 2026-10-03) |
| `unlock` | When an unlock for *project* is due within 7 days | `lock.unlock_due`, with `unlockWithinDays` (1–7) |
| `docs` | When official docs or site for *project* materially change | `research.source_changed` |
| `integrity` | When Market Integrity for *project* changes | `market_integrity.event` — offered only where HEY publishes Market Integrity |
| `usage` | When on-chain usage of *project* starts after a quiet period | `contract.method_first_observed`, `contract.method_resumed` — in the inbox only |

"Resumes after 30 days" is not a fact HEY records: the ledger's `build.resumed`
means 60 or more days, and an alert cannot lower that without inventing an
event. The preset says so.

*Project* is one of: a project (from its page), every project on your watchlist
**as it is when the change arrives**, or any published project.

## Follow → alerts in one step (Terminal, 2026-10-03)

In the Terminal, Follow opens a small form with one box, ticked by default:
"Alert me when it has a release, a contract deploy, a contract implementation
change, an unlock due within 7 days, a Market Integrity event or an activity
status change", with where the alerts go (in HEY; by email too when the account
has a confirmed address). One press follows the project and makes **one** rule:

- `scope: watchlist`, the presets `release`, `ship`, `code` (in HEY only),
  `deploy`, `implementation`, `unlock` (7 days), `integrity` (only where Market
  Integrity is published) and `status` — the meaningful ledger types only, never
  a price, market-movement or holder-derived type (`ship` and `code` added
  2026-10-09; rules made before gained them through migration
  `follow_bundle_ship_code`);
- to a linked Telegram chat by default (2026-10-09), and by email when the
  account has a confirmed address — or when the reader typed one in the box,
  which HEY sends its one confirmation and mails nothing to until it is opened;
- named "Projects you follow: what they ship and what changes" (the API
  reports it with `preset: null`);
- every project followed later is covered by the same rule, and unfollowing a
  project stops its alerts — the matcher reads the watchlist when the event
  arrives;
- pressing again makes nothing; a rule the reader switched off is switched back
  on from the ledger's head, never replayed.

The box is the follow form's own: unticked, Follow only follows. Once the rule
is on, Follow is a plain button again, and the Terminal's ⋯ menu and watchlist
say "Alerts on for projects you follow". The Terminal's starter set (an empty
watchlist's first visit) carries the same box.

**Unlocks are 7 days, not 30.** The ledger announces `lock.unlock_due` seven days
ahead — its documented meaning on `/api/changes` and every webhook — so no
alert can come earlier without changing what that event means for every
consumer.

## Asking for an alert in words

In the Research Terminal you can ask Ask HEY for an alert in a sentence —
"alert me when HoodLock ships a release", in English or Malay. Ask HEY reads
the sentence by fixed rules (no AI model) into one preset for one project and
shows it as a proposal: what the alert would say, and that nothing is created
until you confirm. **Only your press on "Confirm: create alert" makes the
rule**, through the same form and the same checks as any other; the proposal
alone creates nothing, and no model ever creates, changes or deletes a rule.
Signed out, the proposal asks you to sign in first; with alerts switched off,
it says so and offers nothing to confirm.

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
published, plus `contract.method_first_observed`, `contract.method_resumed` and
`build.code_activity` (2026-10-09).

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
  double opt-in every HEY message uses. An account signed in with GitHub or
  with a wallet may add an address on [/watchlist](/watchlist#email);
  [/account](/account) says where your alerts go. At most **one message an
  hour**, listing up to 20 events and how many more are in the inbox. Every
  message carries a one-click unsubscribe that turns off alert email and
  nothing else. With no confirmed address, or with alert email off, the alert
  stays in your inbox and no mail is sent; switching email on later does not
  send a backlog.
- **Webhook**, by naming one of **your own** [webhook subscriptions](WEBHOOKS.md).
  A rule never holds a URL: the subscription already passed HEY's destination
  checks and a signed ping. A subscription that also asks for the same type is
  sent the event once, not twice.
- The two `contract.method_*` types and `build.code_activity` are **shown in HEY
  only**: they are never emailed, sent to a webhook or to Telegram.
- **Telegram**, when HEY's Telegram bot is switched on: to a private chat you
  linked from **Account → Telegram** (a ten-minute, single-use code the bot
  confirms by your display name). One message per event however many of your
  rules matched it, paced to a few a minute per chat; a burst of twenty or more
  becomes one message pointing to your inbox. A retracted event is never sent,
  and one already sent is edited to say it was withdrawn. Only the types that
  can go to a webhook are sent, as with email. While the bot is off, the alert
  form says "Telegram alerts are not available yet." and offers no Telegram box.
- **Discord is not built** (see [Not built](#not-built)).

## Matching, dedupe and retractions

HEY checks new changes against every rule about once a minute.

- **Only news.** An alert fires on a change's first public appearance. A later
  correction or annotation of the same change does not alert you again, nor
  does its return after a retraction (since 2026-10-03: a revision keeps the
  change's first arrival, so it is never new again — the alert you already had
  is restored instead), and history HEY filled in after the fact is never news.
- **Once per rule and change.** However often HEY re-checks, one rule and one
  change make one notification.
- **Retractions.** When HEY withdraws a change, its notifications are marked
  withdrawn, an email not yet sent is stopped, a webhook delivery not yet sent
  is cancelled, and a webhook that already received it is sent
  `event.retracted`. The inbox then says the change was withdrawn and nothing
  else about it.
- **No stored copy.** A notification keeps no text of its own: the inbox, the
  API and the email always show the change as the ledger says it now.
- Read or withdrawn notifications older than 90 days are removed.

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
`telegram_unlinked` (409), `unknown_webhook`, `not_found`. When alerts are
switched off on a deployment, `/account/alerts` and `/api/alerts` answer 404.
The SDK types are `HeyAlertRule`, `HeyAlertList`, `HeyAlertNotifications` and
friends. There is no MCP tool.

## Security

- **Ownership** is checked together with the id on every read and write;
  marking read touches only your own rows whatever ids are sent.
- **No URL** is accepted anywhere in an alert. Anything that leaves HEY goes
  only to your own verified webhook subscriptions, your confirmed address or
  your linked Telegram chat.
- **Rate limits**, per account: 20 creates an hour, 120 changes, 300 read-marks;
  signed-in API reads 120 a minute; keyed calls also spend the key's bucket.
- A cookie write from another site is refused.
- **Audit**: every create, change and delete is recorded, naming what changed,
  never an address.
- **AI never creates an alert.** Ask HEY may propose one; only you, confirming
  the form or calling the API with your own key, make it. Every rule records
  whether it was made on the site or through the API; there is no third way.
- An alert is a private reader choice: nothing here reaches activity status,
  Build Momentum, the Discovery Gap, the Radar or any ranking, and a test
  fails the build if it ever does.

## Not built

- **Discord.** It needs its own bot and the same one-time linking Telegram
  uses, so HEY never sends to a channel nobody proved they own.
- **Email, webhooks or Telegram for `contract.method_*` events**: not decided.
