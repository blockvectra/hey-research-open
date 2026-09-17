/**
 * Plain-language formatting (PRD V4 section 16.0 I).
 *
 * The interface says "Shipped 2d ago", never "DGS percentile". Internal jargon
 * belongs on the methodology page, not on a card.
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (days < 30) return `${Math.floor(days)}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
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
  if (value < 1000) return `$${Math.round(value)}`;
  if (value < 1_000_000) return `$${trim(value / 1000)}K`;
  if (value < 1_000_000_000) return `$${trim(value / 1_000_000)}M`;
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
