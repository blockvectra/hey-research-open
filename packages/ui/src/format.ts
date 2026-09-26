/**
 * Plain-language formatting (PRD V4 section 16.0 I).
 *
 * The interface says "Shipped 2d ago", never "DGS percentile". Internal jargon
 * belongs on the methodology page, not on a card.
 */

import { valuationKindOf } from '@hey/scoring/valuation-kind';

export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const delta = (now.getTime() - date.getTime()) / 1000;
  /*
   * A deadline ahead reads "in 5d", never "just now" (2026-09-17). The
   * negative difference was clamped to zero, so every sponsorship end, vote
   * close, bounty claim window, early-access date and bond maturity on the
   * site — and six admin surfaces — said "just now", which for a claim window
   * reads as already lapsed.
   */
  if (delta < 0) return `in ${span(-delta)}`;
  /*
   * A date is a date (10-agent audit, 2026-09-25). A source that gives only a
   * day is stored at 00:00 UTC — the rule `precisionOf` reads — and printing
   * it as "20h ago" claimed an hour nobody reported. Such a value reads by
   * UTC calendar day instead: today, yesterday, 3d ago.
   */
  if (isMidnightUtc(date)) {
    const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - date.getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
  }
  if (delta < 60) return 'just now';
  return `${span(delta)} ago`;
}

const isMidnightUtc = (date: Date): boolean =>
  date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;

function span(seconds: number): string {
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;
  if (minutes < 1) return 'a moment';
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  if (days < 30) return `${Math.floor(days)}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * A token price, at the precision the number deserves rather than a fixed two
 * places.
 *
 * Written four times before it lived here (copy audit, 2026-09-22): in the
 * workspace header, on the Market tab, inside the candle chart, and on the
 * public market page — and the four had already drifted, so $1234.5 printed
 * as `$1234.50` in the Terminal and `$1,234.5` one click away.
 */
export function formatTokenPrice(value: number): string {
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toPrecision(3)}`;
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const subscript = (value: number): string =>
  String(value)
    .split('')
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)])
    .join('');

/**
 * A token price in the Terminal (redesign, 2026-09-26). The public pages keep
 * `formatTokenPrice`.
 *
 * - from $1: grouped, two places — `$1,234.50`
 * - from $0.0001: three significant digits — `$0.0123`
 * - below that: the leading zeros counted in a subscript, then three
 *   significant digits — 0.0000211 is `$0.0₄211`, four zeros after the point.
 *   Seven zeros in a row cannot be counted at a glance; a subscript can.
 *
 * A price is never negative and an unknown price is not zero, so anything that
 * is not a positive finite number prints a dash. `formatTerminalPriceLong` is
 * the same figure written out in full, for `aria-label` and `title`.
 */
export function formatTerminalPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Rounded first, so 0.00009999 becomes 0.000100 and takes the plain form.
  const [mantissa = '', exponent = '0'] = value.toExponential(2).split('e');
  const power = Number(exponent);
  if (power >= -4) return `$${value.toPrecision(3)}`;
  return `$0.0${subscript(-power - 1)}${mantissa.replace('.', '')}`;
}

/** The same price written out in full (`$0.0000211`), for `aria-label` and `title`. */
export function formatTerminalPriceLong(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1) return formatTerminalPrice(value);
  return `$${value.toLocaleString('en-US', { maximumSignificantDigits: 6 })}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A day key (`2026-09-23`) or a Date, read as a UTC calendar day. */
const utcDay = (value: Date | string): Date =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);

/**
 * "23 Sep", or "23 Sep 2025" when the year is not the current one. UTC, the
 * same calendar HEY's daily index keys by.
 */
export function formatShortDate(value: Date | string, now: Date = new Date()): string {
  const date = utcDay(value);
  if (Number.isNaN(date.getTime())) return '—';
  const short = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  return date.getUTCFullYear() === now.getUTCFullYear() ? short : `${short} ${date.getUTCFullYear()}`;
}

/** A chart's month tick: "Jul". */
export function formatMonthTick(value: Date | string): string {
  const date = utcDay(value);
  return Number.isNaN(date.getTime()) ? '' : MONTHS[date.getUTCMonth()]!;
}

/** Compact USD, because a card has room for `$24K` and not for `$24,013.55`. */
export function formatUsdCompact(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  /*
   * A measured figure under a dollar is not zero (2026-09-15). Rounding it
   * printed `$0`, which is the one thing this product promises never to do:
   * absent is unknown, and a day-one token with a few cents of volume read
   * exactly like a token nobody traded. `$0` is now reserved for an actual
   * zero.
   */
  if (value > 0 && value < 1) return '<$1';
  // Each unit ends where rounding would print 1000 of it (2026-09-17):
  // $999,999 read "$1000K" and $999,999,999 "$1000M".
  if (value < 999.5) return `$${Math.round(value)}`;
  if (value < 999_500) return `$${trim(value / 1000)}K`;
  if (value < 999_500_000) return `$${trim(value / 1_000_000)}M`;
  return `$${trim(value / 1_000_000_000)}B`;
}

/**
 * The provider behind a market-cap reading, in plain words for a tooltip.
 * Mirrors `MARKET_SOURCES` in the domain package; an unknown key names itself.
 */
const MARKET_SOURCE_LABELS: Record<string, string> = {
  /*
   * A reading decoded from the chain is named for what it is, not for the
   * vendor that decoded it (2026-09-15) — and this key had no entry at all, so
   * a card was printing the raw string "bitquery" at readers. The provenance a
   * reader needs is that the figure came from trades on the chain rather than
   * from an aggregator's index; which supplier ran the query is ours.
   */
  bitquery: 'on-chain trades',
  dexscreener: 'DEX Screener',
  geckoterminal: 'GeckoTerminal',
  coingecko: 'CoinGecko',
  virtuals: 'Virtuals',
  'robinhood-stock-api': 'Robinhood',
};

export function formatMarketSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  return MARKET_SOURCE_LABELS[source] ?? source;
}

const trim = (value: number): string =>
  (value < 10 ? value.toFixed(1) : Math.round(value).toString()).replace(/\.0$/, '');

/** Event types are stored as enums; people read words. */
export function formatEventType(eventType: string): string {
  return eventType
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const KIND_LABELS: Record<string, string> = {
  UTILITY: 'Utility',
  MEME: 'Meme',
  HYBRID: 'Hybrid',
  INFRASTRUCTURE: 'Infrastructure',
  RWA: 'RWA',
  APPLICATION: 'Application',
  OTHER: 'Uncategorised',
};

export function formatProjectKind(kind: string): string {
  return KIND_LABELS[kind] ?? 'Uncategorised';
}

const VERIFICATION_LABELS: Record<string, string> = {
  PUBLICLY_VERIFIED: 'Source verified',
  ADMIN_VERIFIED: 'HEY verified',
  SOURCE_LINKED: 'Source linked',
  SELF_REPORTED: 'Self reported',
  DISPUTED: 'Disputed',
  RETRACTED: 'Retracted',
};

/** Self-reported and verified evidence must stay visibly distinct (CLAUDE.md rule 10). */
export function formatVerification(status: string): string {
  return VERIFICATION_LABELS[status] ?? 'Unverified';
}

/**
 * Whether a typed value is shaped like a contract address (2026-09-16).
 *
 * A presentation question, which is why it lives here: it decides how a field
 * behaves while someone is still typing into it, in the browser. Whether an
 * address is a token *identity* — the checksum form, the burn and zero
 * addresses that are well-formed and still nobody's project — is a domain
 * question, answered by `normalizeContractAddress` in `@hey/domain`, which a
 * client bundle cannot import without dragging the database layer with it.
 *
 * The two patterns are deliberately the same and must stay that way; this one
 * is never the authority on what HEY will accept.
 */
export function isAddressShaped(value: string): boolean {
  // The prefix in either case too: `0X…` is how some explorers print it (2026-09-17).
  return /^0[xX][a-fA-F0-9]{40}$/.test(value.trim());
}

/**
 * `0x82ae…91bf`: enough of both ends to recognise an address, never enough
 * to mistake it for the whole. The full address travels in `title` and the
 * copy action; the shortened form is display only.
 */
export function shortenAddress(address: string, head = 6, tail = 4): string {
  const value = address.trim();
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Free text from a source, as plain text (QA sweep 2026-09-04).
 *
 * Descriptions and ship notes arrive from launchpads, GitHub releases and
 * project sites carrying whatever markup their source used: Markdown images
 * (`![Upload](https://…)` was the first line of a card on the homepage),
 * headings, emphasis, links, backslash escapes (`@Axol\_io`) and runs of
 * spaces. HEY renders none of that as markup, so the marks were showing as
 * literal characters. This strips them to the words, keeps a link's text,
 * and collapses whitespace — including carriage returns and the double
 * spaces that were on the cards.
 *
 * Deliberately conservative: it removes syntax it recognises and leaves any
 * other character exactly as written. Nothing here rewrites what a project
 * said, only how its source happened to punctuate it.
 */
export function plainText(value: string | null | undefined): string {
  if (!value) return '';
  return (
    value
      // Images carry no words; a bare URL in their place would be noise.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      // Links keep their text; a link whose text is the URL keeps the URL.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Reference-style link definitions and HTML tags are not words.
      .replace(/^\s*\[[^\]]+\]:\s*\S+\s*$/gm, ' ')
      .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, ' ')
      // Headings, block quotes, list markers and rules at the start of a line.
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
      .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ' ')
      // A heading that follows a rule on the same line (flattened release notes).
      .replace(/(\s)#{1,6}\s+/g, '$1')
      /*
       * Backslash escapes come before the marks they escape (2026-09-06).
       *
       * Run last, they could not reach an escaped delimiter: the code rule
       * below consumed the backticks of `\`name\`` and left the two
       * backslashes stranded, which is how a production description read
       * "\sparkleware-catalog\" — the marks gone and their escaping still
       * there, the worst of both readings.
       *
       * Unescaping first means an author's deliberate "\*not italic\*" also
       * loses its asterisks. That is the right trade here: this function
       * exists to reduce a description to its words, and it removes the
       * emphasis either way.
       */
      .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1')
      // Fenced and inline code: keep what is inside.
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/`([^`]*)`/g, '$1')
      // Emphasis and strikethrough: bold, italic, both, underscores, tildes.
      .replace(/(\*{1,3}|_{1,3}|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
      // Whitespace, including CR/LF and non-breaking spaces, to single spaces.
      .replace(/[\s\u00a0]+/g, ' ')
      .trim()
  );
}

/**
 * Whether a valuation is a fully diluted one (parity audit, 2026-09-25): the
 * one rule the project page, the Terminal and the header already used, now
 * shared. A provider with no circulating supply sends the same number as its
 * market cap and its FDV; that number is an FDV, and is never called a market
 * cap (the founder's 2026-09-23 rule). Five surfaces had each chosen a label
 * on their own; 672 of 1,058 live valuations were FDV-only.
 */
export function isFullyDiluted(valueUsd: number | null | undefined, fdvUsd: number | null | undefined, impliedSupplyShare?: number): boolean {
  // The one rule (2026-09-26): `valuationKindOf` in @hey/scoring, shared with the daily series and the SQL.
  return valuationKindOf({ valueUsd, fdvUsd, impliedSupplyShare }) === 'fdv';
}

/**
 * The same name, from a kind a query or an API already decided (2026-09-25).
 * Charts and tooltips receive the kind rather than both figures; an unknown
 * kind is "Valuation", which claims neither measure.
 */
export function valuationKindLabel(kind: 'marketCap' | 'fdv' | null | undefined): string {
  return kind === 'fdv' ? 'Fully diluted valuation' : kind === 'marketCap' ? 'Market cap' : 'Valuation';
}

/** The name a valuation is printed under. */
export function valuationLabel(valueUsd: number | null | undefined, fdvUsd: number | null | undefined, short = false): string {
  return isFullyDiluted(valueUsd, fdvUsd) ? (short ? 'FDV' : 'Fully diluted valuation') : 'Market cap';
}

/**
 * A share of supply in per cent, for a sentence (truthfulness audit,
 * 2026-09-25): two decimals with trailing zeros dropped, and "<0.01" for a
 * real share too small to show — never "0" for tokens HEY saw locked.
 */
export function formatSharePct(value: number): string {
  if (value > 0 && value < 0.01) return '<0.01';
  return String(Math.round(value * 100) / 100);
}
