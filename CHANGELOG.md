# Changelog

What changed, and when, for anyone reading the code or building on the API. Dates are the day the
change reached production. Older entries are condensed; the private repository keeps the full
record.

## 2026-09-19

- **Two npm packages prepared.** `@hey-research/sdk` (`packages/sdk`) is the whole read API as one
  typed client: `new HeyClient().scanCard(4663, address)`, `projects.items({ tab: 'still-building' })`
  walks a listing, a `429` surfaces as `HeyApiError` with `retryAfterSeconds` and is never retried
  for you. `@hey-research/mcp` (`apps/mcp`) is the MCP server, unchanged in behaviour. Neither is
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
