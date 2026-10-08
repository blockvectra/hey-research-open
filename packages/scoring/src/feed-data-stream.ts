/**
 * Data feeds are not ship sources (2026-10-08, ruling under the founder's
 * delegation).
 *
 * A feed that publishes data — a weekly digest of stablecoin supply, a depeg
 * alert per coin — writes the same title again and again with only its
 * figures, dates and tickers changed: "USDT Adds $482.55M On The Week". One
 * project held 135 such entries as ships, each filed as a FEATURE_RELEASE
 * because "adds" and "482.55" read as a feature and a version. They are a
 * script's output, the same thing the automated-commit rule
 * (`commit-automation.ts`, commit-substance-v3) found in commit subjects, and
 * this module reads feed titles with the same templating: the commit steps
 * (`SUBJECT_TEMPLATE_STEPS`), with tickers, calendar dates, versions and
 * sequence numbers folded first so that a release feed is never mistaken for
 * one.
 *
 * A feed is a data feed when, among its `FEED_DATA.window` most recent dated
 * entries, at least `FEED_DATA.minStreamEntries` — and at least half — belong
 * to a templated stream: one title template, repeated at least
 * `FEED_DATA.minTemplateRepeats` times with differing titles, that
 *
 *   - carries a figure: an amount (`$<n>`), a percentage, a magnitude
 *     (`<n>m`, `<n> billion`) or two numbers or more; a date, a version or a
 *     sequence number (`#12`) is never a figure — a changelog titled by its
 *     date, a release feed of "v1.4.2" and a numbered newsletter stay
 *     releases and posts;
 *   - names no version and no release ("release", "version", "changelog"):
 *     a release note that counts its fixes is still a release;
 *   - has words of its own (three letters or more besides placeholders).
 *
 * Unlike a commit stream, a clock alone never makes a feed data: a team's
 * weekly update on a schedule is the team's own writing; the changing
 * figures are what make it a script's.
 *
 * Pure: no clock, no I/O. Market and price data decide nothing here — only
 * the feed's own titles and dates are read. Every pattern is written in the
 * subset JavaScript and PostgreSQL read the same way, and the SQL twin
 * (`@hey/domain` `ships/data-feed.ts`) applies the same steps.
 */

import { AUTOMATION, applyTemplateSteps, EDGE_AFTER, EDGE_BEFORE, SUBJECT_TEMPLATE_STEPS, type TemplateStep } from './commit-automation';

export const FEED_DATA = {
  /** How many of a feed's most recent dated entries are read. */
  window: 50,
  /** How many entries of one title template make a stream. */
  minTemplateRepeats: 3,
  /** How many stream entries make a data feed — the commit rule's stream size. */
  minStreamEntries: AUTOMATION.minRepeats,
  /** The share of the window the stream entries must make up. */
  minShare: 0.5,
} as const;

/**
 * A ticker, before case is folded: a word of letters and digits that starts
 * with a letter and holds two capitals or more, optionally after `$` —
 * `USDT`, `$ETH`, `USDe`, `crvUSD`. Title Case words hold one capital and are
 * kept.
 */
export const FEED_TICKER_STEP: TemplateStep = {
  pattern: '(?<![A-Za-z0-9_$.])[$]?(?=[A-Za-z0-9]*[A-Z][A-Za-z0-9]*[A-Z])[A-Za-z][A-Za-z0-9]*(?![A-Za-z0-9_])',
  replacement: '<sym>',
};

const MONTH = '(january|february|march|april|may|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)';
const YEAR = '(19|20)[0-9]{2}';
const ORDINAL = '[0-9]{1,2}(st|nd|rd|th)?';

/** Calendar words, folded to `<time>` on lower-cased text: a date is never a figure. */
const FEED_CALENDAR_STEPS: readonly TemplateStep[] = [
  // "oct 1", "october 1st, 2026"
  { pattern: `${EDGE_BEFORE}${MONTH}[.]?[ ]+${ORDINAL}(,?[ ]+${YEAR})?${EDGE_AFTER}`, replacement: '<time>' },
  // "1 oct", "1st october 2026"
  { pattern: `${EDGE_BEFORE}${ORDINAL}[ ]+${MONTH}[.]?(,?[ ]+${YEAR})?${EDGE_AFTER}`, replacement: '<time>' },
  // "october 2026"
  { pattern: `${EDGE_BEFORE}${MONTH}[.]?,?[ ]+${YEAR}${EDGE_AFTER}`, replacement: '<time>' },
  // "week 40", "wk 3", "w40", "q3", "h1"
  { pattern: `${EDGE_BEFORE}((week|wk|w)[ ]?[0-9]{1,2}|q[1-4]|h[12])${EDGE_AFTER}`, replacement: '<time>' },
];

/** Versions and sequence numbers: a release's name and a post's number, never a figure. */
const FEED_VERSION_STEPS: readonly TemplateStep[] = [
  { pattern: '(?<![a-z0-9_.$€£])v[0-9]+([.][0-9]+)*(-[a-z0-9.]+)?(?![a-z0-9_%])', replacement: '<v>' },
  { pattern: '(?<![a-z0-9_.$€£])[0-9]+([.][0-9]+){2,3}(-[a-z0-9.]+)?(?![a-z0-9_%])', replacement: '<v>' },
  { pattern: '#[0-9]+', replacement: '#<seq>' },
  // A year on its own: "2026 recap".
  { pattern: `(?<![a-z0-9_.,$€£#-])${YEAR}(?![a-z0-9_%-]|[.,][0-9])`, replacement: '<time>' },
];

const [ISO_TIME_STEP, CLOCK_STEP, ...VALUE_STEPS] = SUBJECT_TEMPLATE_STEPS;

/**
 * The steps on a trimmed, lower-cased title, after tickers are folded: the
 * commit steps' timestamps first, then calendar words, versions and sequence
 * numbers, then the commit steps' hashes and numbers.
 */
export const FEED_TITLE_STEPS: readonly TemplateStep[] = [ISO_TIME_STEP!, CLOCK_STEP!, ...FEED_CALENDAR_STEPS, ...FEED_VERSION_STEPS, ...VALUE_STEPS];

/** A feed title with what a script changes from entry to entry set aside. */
export function feedTitleTemplate(title: string): string {
  const tickers = applyTemplateSteps(title.trim(), [FEED_TICKER_STEP]);
  return applyTemplateSteps(tickers.toLowerCase(), FEED_TITLE_STEPS).replace(/\s+/g, ' ');
}

/** A figure on a template: an amount, a percentage or a magnitude. */
export const FEED_FIGURE_PATTERN = '[$€£]<n>|<n> ?%|<n> ?(k|m|mm|b|bn|t|bp|bps|thousand|million|billion|trillion)(?![a-z])';
/** A bare number on a template; two or more are figures. */
export const FEED_NUMBER_PATTERN = '(?<![a-z$€£])<n>(?![a-z%])';
/** A template that names a version or a release is a release, whatever it counts. */
export const FEED_RELEASE_PATTERN = `<v>|${EDGE_BEFORE}(release|released|releases|version|changelog|hotfix|patch notes)${EDGE_AFTER}`;

/** Whether a template carries a figure a script writes. */
export function templateCarriesFigures(template: string): boolean {
  return new RegExp(FEED_FIGURE_PATTERN).test(template) || (template.match(new RegExp(FEED_NUMBER_PATTERN, 'g')) ?? []).length >= 2;
}

/** Whether a template has words of its own, besides its placeholders. */
export function templateHasOwnWords(template: string): boolean {
  return template.replace(/<[a-z]+>/g, '').replace(/[^a-z]/g, '').length >= 3;
}

/** Whether a template's entries can be a data stream: a figure, words of its own, no version and no release. */
export function isDataTemplate(template: string): boolean {
  return templateCarriesFigures(template) && templateHasOwnWords(template) && !new RegExp(FEED_RELEASE_PATTERN).test(template);
}

export type FeedEntrySubject = { title: string; publishedAt: Date };

export type DataFeedReading = {
  /** Whether the feed is a data feed. */
  dataFeed: boolean;
  /** The entries read: the window's dated entries. */
  entries: number;
  /** How many of them belong to a stream. */
  streamEntries: number;
  /** The streams found, for logs and tests. */
  streams: { template: string; entries: number }[];
};

/** Whether a feed's recent entries are a templated data stream. */
export function detectDataFeed(entries: readonly FeedEntrySubject[]): DataFeedReading {
  const recent = entries
    .filter((entry) => !Number.isNaN(entry.publishedAt.getTime()))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.publishedAt.getTime() - a.entry.publishedAt.getTime() || a.index - b.index)
    .slice(0, FEED_DATA.window)
    .map(({ entry }) => entry);
  const groups = new Map<string, FeedEntrySubject[]>();
  for (const entry of recent) {
    const template = feedTitleTemplate(entry.title);
    groups.set(template, [...(groups.get(template) ?? []), entry]);
  }
  const streams: DataFeedReading['streams'] = [];
  for (const [template, members] of groups) {
    if (members.length < FEED_DATA.minTemplateRepeats) continue;
    // The figures must actually change: one title repeated is not a stream.
    if (new Set(members.map((member) => member.title.trim().toLowerCase())).size < 2) continue;
    if (!isDataTemplate(template)) continue;
    streams.push({ template, entries: members.length });
  }
  const streamEntries = streams.reduce((sum, stream) => sum + stream.entries, 0);
  return {
    dataFeed: streamEntries >= FEED_DATA.minStreamEntries && streamEntries >= recent.length * FEED_DATA.minShare,
    entries: recent.length,
    streamEntries,
    streams,
  };
}
