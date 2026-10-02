import { formatEventType, formatRelativeTime, plainText, truncateAtWord } from './format';

/**
 * The card's latest-ship phrase (public UX review, 2026-09-28): what shipped,
 * in a few words, and when — "Release v0.2.14 · 2d ago", "Code changes · this
 * week", "Contract deployed · 3d ago".
 *
 * The card printed the stored title and let CSS cut it, so a code week read
 * "Active development: 100…" beside a "Shipping" chip — the status twice and
 * the fact never. This is the one function that words the line: short by
 * construction, cut only at a word, and silent when all it could say is the
 * status the chip already shows.
 *
 * The titles it reads are the domain's own (`draftFromCodeActivity` writes
 * "Active development: 100+ commits since 2026-09-16 across 1 contributor");
 * `ship-phrase.test.ts` pins that shape.
 */
export type CardShipPhraseInput = { eventType: string; title: string; publishedAt: Date };
export type CardShipPhrase = { what: string; when: string };

/** Longest "what" the card prints; a phone card has about this much beside the chip. */
export const CARD_SHIP_WHAT_MAX = 28;

/** Release-like ships name their version: "Release v0.2.14", "SDK v0.4". */
const VERSIONED: Readonly<Record<string, string>> = {
  GITHUB_RELEASE: 'Release',
  FEATURE_RELEASE: 'Release',
  APP_RELEASE: 'App',
  SDK_RELEASE: 'SDK',
  API_RELEASE: 'API',
  GAME_RELEASE: 'Game',
  DEMO_RELEASE: 'Demo',
  DESIGN_RELEASE: 'Design',
};

/** Ships whose type is the whole story: the title adds an address, not a fact a card needs. */
const FIXED: Readonly<Record<string, string>> = {
  CONTRACT_DEPLOY: 'Contract deployed',
  CONTRACT_DEPLOY_FOLLOWUP: 'New contract deployed',
  CONTRACT_UPGRADE: 'Contract upgraded',
};

/** A version with at least one dot: v0.2.14, 1.0, v2.3.0-beta.1. "V1" in a product name is not a version. */
const VERSION = /(?:^|[\s(@:/—–-])(v?\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)(?=$|[\s),:;—–])/i;

/** A commit count as the code-activity title writes it: "100+ commits", "6 commits", "1 commit". */
const COMMITS = /(\d[\d,]*\+?)\s+commits?\b/i;

/**
 * Words that only restate a builder status. A phrase made of them says what
 * the chip beside it already says, and the card shows the date alone.
 */
const STATUS_ONLY = new Set([
  'active',
  'active development',
  'development',
  'shipping',
  'still building',
  'building',
  'resumed',
  'quiet',
  'dormant',
  'update',
  'activity',
  'code activity',
]);

const DAY_MS = 86_400_000;

/** The Monday (UTC) of a date's ISO week. */
function weekStart(date: Date): number {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS;
}

/**
 * A code week is dated by its week, not its last commit's hour: the ship is
 * one week's aggregate (`code-activity:<repo>:<iso week>`), so "this week"
 * is what it measured and "10h ago" was only when its last commit landed.
 */
function weekWords(publishedAt: Date, now: Date): string {
  const weeks = Math.round((weekStart(now) - weekStart(publishedAt)) / (7 * DAY_MS));
  if (weeks <= 0) return 'this week';
  if (weeks === 1) return 'last week';
  if (weeks < 9) return `${weeks} weeks ago`;
  return formatRelativeTime(publishedAt, now);
}

/**
 * "Code changes", not the title's count (2026-10-02, outsider audit). The
 * count in a code week's stored title is the rolling window it was read over
 * ("100+ commits since 2026-08-22"), so "100+ commits · this week" claimed a
 * hundred commits in a week that may have held three. The card names the
 * kind and the week; the week's own count and what changed are on the
 * timeline (`codeWeekDetails`). A title with no commit summary in it only
 * restates the status and stays silent.
 */
function commitWhat(title: string): string | undefined {
  return COMMITS.test(title) ? 'Code changes' : undefined;
}

function titleWhat(eventType: string, title: string): string {
  const cut = truncateAtWord(title, CARD_SHIP_WHAT_MAX);
  // One long token (a hash, a path) has no word to cut at: say what kind of ship it was instead.
  return cut.atWord ? cut.text : formatEventType(eventType);
}

function whatOf(eventType: string, rawTitle: string): string | undefined {
  const title = plainText(rawTitle);
  if (eventType === 'CODE_ACTIVITY') return commitWhat(title);
  const fixed = FIXED[eventType];
  if (fixed) return fixed;
  const prefix = VERSIONED[eventType];
  if (prefix) {
    const version = VERSION.exec(title)?.[1];
    if (version) return `${prefix} ${version}`;
  }
  return title ? titleWhat(eventType, title) : undefined;
}

const restatesStatus = (what: string, statusLabel?: string): boolean => {
  const words = what.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words === '' || STATUS_ONLY.has(words) || (statusLabel !== undefined && words === statusLabel.toLowerCase());
};

/**
 * The phrase for a card's latest ship, or nothing when HEY cannot say more
 * than the status (the card then shows only the date: "Shipped 3d ago").
 */
export function cardShipPhrase(ship: CardShipPhraseInput, options: { now?: Date; statusLabel?: string } = {}): CardShipPhrase | undefined {
  const now = options.now ?? new Date();
  const what = whatOf(ship.eventType, ship.title);
  if (!what || restatesStatus(what, options.statusLabel)) return undefined;
  const when = ship.eventType === 'CODE_ACTIVITY' ? weekWords(ship.publishedAt, now) : formatRelativeTime(ship.publishedAt, now);
  return { what, when };
}

/**
 * A ship's title as a card prints it (2026-10-02, outsider audit). A code
 * week's stored title is its rolling measurement ("Active development: 100+
 * commits since 2026-08-22 …"), which read as the same commits counted in
 * every week; a card names the fixed Monday–Sunday UTC week the ship is keyed
 * on instead, from its own date (a code week is dated inside its week). A
 * title a surface already worded by its week ("Code changes, week of …",
 * `codeWeekTitle`) is kept; every other ship keeps its title.
 */
export function displayShipTitle(ship: { eventType: string; title: string; publishedAt: Date }): string {
  const title = plainText(ship.title);
  if (ship.eventType !== 'CODE_ACTIVITY' || title.startsWith('Code changes')) return title;
  const monday = weekStart(ship.publishedAt);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return `Code changes, week of ${day(monday)} – ${day(monday + 6 * DAY_MS)}`;
}
