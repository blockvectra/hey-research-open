import { describe, expect, it } from 'vitest';

import { commitSubjectTemplate } from './commit-automation';
import { detectDataFeed, FEED_DATA, feedTitleTemplate, isDataTemplate, type FeedEntrySubject } from './feed-data-stream';

/**
 * Data feeds are not ship sources (2026-10-08). The positive fixtures are
 * shaped on the production example — a stablecoin watcher's weekly digest and
 * depeg feeds, "USDT Adds $482.55M On The Week" — and the negatives on the
 * release feeds, dated changelogs and numbered newsletters a project's own
 * site writes.
 */
const day = (n: number) => new Date(Date.UTC(2026, 9, 7) - n * 86_400_000);
const feed = (titles: readonly string[], gapDays = 1): FeedEntrySubject[] => titles.map((title, index) => ({ title, publishedAt: day(index * gapDays) }));

const TICKERS = ['USDT', 'USDC', 'USDe', 'PYUSD', 'crvUSD', 'DAI'] as const;
const weeklyDigest = (): FeedEntrySubject[] => {
  const entries: FeedEntrySubject[] = [];
  for (let week = 0; week < 6; week += 1) {
    TICKERS.forEach((ticker, index) => {
      const amount = (((week + 3) * (index + 7) * 37.13) % 900).toFixed(2);
      const verb = (week + index) % 3 === 0 ? 'Sheds' : 'Adds';
      entries.push({ title: `${ticker} ${verb} $${amount}M On The Week`, publishedAt: new Date(day(week * 7).getTime() + index * 60_000) });
    });
  }
  // The digest's own headline, once a week, with a total in billions.
  for (let week = 0; week < 6; week += 1) entries.push({ title: `Stablecoin Supply Reaches $${(301.4 + week).toFixed(1)}B`, publishedAt: day(week * 7) });
  return entries;
};

describe('feedTitleTemplate', () => {
  it('sets aside figures, tickers, dates, versions and sequence numbers', () => {
    expect(feedTitleTemplate('USDT Adds $482.55M On The Week')).toBe('<sym> adds $<n>m on the week');
    expect(feedTitleTemplate('USDe Sheds $1,204.10M On The Week')).toBe('<sym> sheds $<n>m on the week');
    expect(feedTitleTemplate('$ETH dominance at 54.2%')).toBe('<sym> dominance at <n>%');
    expect(feedTitleTemplate('crvUSD depegs to $0.9712')).toBe('<sym> depegs to $<n>');
    expect(feedTitleTemplate('Changelog — October 1st, 2026')).toBe('changelog — <time>');
    expect(feedTitleTemplate('Product update, 3 Oct 2026')).toBe('product update, <time>');
    expect(feedTitleTemplate('Digest 2026-10-01: 12 pools, 3 new')).toBe('digest <time>: <n> pools, <n> new');
    expect(feedTitleTemplate('Acme v1.2.3 ships 15 fixes')).toBe('acme <v> ships <n> fixes');
    expect(feedTitleTemplate('Acme 2.10.0-rc.1 is out')).toBe('acme <v> is out');
    expect(feedTitleTemplate('This Week in Acme #42')).toBe('this week in acme #<seq>');
    expect(feedTitleTemplate('Q3 2026 in review')).toBe('<time> <time> in review');
    expect(feedTitleTemplate('Week 40 recap')).toBe('<time> recap');
  });

  it('leaves the commit template as it was', () => {
    expect(commitSubjectTemplate('stats: 7.80609407393365932 BNB distributed')).toBe('stats: <n> bnb distributed');
    expect(commitSubjectTemplate('chore: refresh ledgers 2026-10-01T17:09:57Z')).toBe('chore: refresh ledgers <time>');
  });

  it('a data template carries a figure, has words, and names no release', () => {
    expect(isDataTemplate('<sym> adds $<n>m on the week')).toBe(true);
    expect(isDataTemplate('pool stats: <n> swaps, <n> lps')).toBe(true);
    expect(isDataTemplate('tvl up <n>%')).toBe(true);
    expect(isDataTemplate('weekly update <n>')).toBe(false); // one bare number is a counter, not a figure
    expect(isDataTemplate('changelog — <time>')).toBe(false);
    expect(isDataTemplate('acme <v> ships <n> fixes')).toBe(false);
    expect(isDataTemplate('release <n>: <n> fixes and <n> features')).toBe(false);
    expect(isDataTemplate('$<n>m')).toBe(false); // no words of its own
  });
});

describe('detectDataFeed — data feeds', () => {
  it('reads a weekly stablecoin digest as a data feed', () => {
    const reading = detectDataFeed(weeklyDigest());
    expect(reading.entries).toBe(42);
    expect(reading.dataFeed).toBe(true);
    expect(reading.streams.map((stream) => stream.template).sort()).toEqual(
      expect.arrayContaining(['<sym> adds $<n>m on the week', '<sym> sheds $<n>m on the week']),
    );
  });

  it('reads a depeg alert feed, on no clock, as a data feed', () => {
    const titles = TICKERS.flatMap((ticker, index) => [`${ticker} depegs to $0.97${index}1`, `${ticker} recovers peg at $0.99${index}8`]);
    const entries = titles.map((title, index) => ({ title, publishedAt: day(index * index * 0.3) }));
    expect(detectDataFeed(entries).dataFeed).toBe(true);
  });

  it("reads a depeg feed in basis points as a data feed (pharos.watch's depeg.xml, 2026-10-08)", () => {
    const titles = ['USDB depeg -158 bps', 'pathUSD depeg -361 bps', 'BRZ depeg -484 bps', 'USDe depeg -52 bps', 'PYUSD depeg -21 bps', 'EURC depeg -77 bp', 'USDB depeg -90 bps'];
    const entries = titles.map((title, index) => ({ title, publishedAt: day(index * 1.7) }));
    expect(detectDataFeed(entries).dataFeed).toBe(true);
  });

  it('reads a stats feed with its own date stamps as a data feed', () => {
    const titles = Array.from({ length: 10 }, (_, index) => `Pool stats 2026-09-${String(20 + index).padStart(2, '0')}: ${120 + index * 7} swaps, ${10 + index} LPs`);
    expect(detectDataFeed(feed(titles)).dataFeed).toBe(true);
  });
});

describe('detectDataFeed — release feeds and a team\'s writing stay ship sources', () => {
  it('a release feed whose notes count their fixes', () => {
    const titles = Array.from({ length: 12 }, (_, index) => `Acme v1.${index}.0: ${index + 4} fixes and ${index % 3} new features`);
    expect(detectDataFeed(feed(titles, 7)).dataFeed).toBe(false);
  });

  it('a changelog titled by its date, weekly on a clock', () => {
    const titles = Array.from({ length: 12 }, (_, index) => `Changelog — ${day(index * 7).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`);
    expect(detectDataFeed(feed(titles, 7)).dataFeed).toBe(false);
    const updates = Array.from({ length: 12 }, (_, index) => `Product update, ${day(index * 7).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`);
    expect(detectDataFeed(feed(updates, 7)).dataFeed).toBe(false);
  });

  it('a numbered newsletter on a clock', () => {
    expect(detectDataFeed(feed(Array.from({ length: 12 }, (_, index) => `This Week in Acme #${40 - index}`), 7)).dataFeed).toBe(false);
    expect(detectDataFeed(feed(Array.from({ length: 12 }, (_, index) => `Weekly update ${40 - index}`), 7)).dataFeed).toBe(false);
    expect(detectDataFeed(feed(Array.from({ length: 8 }, (_, index) => `Q${(index % 4) + 1} ${2025 - Math.floor(index / 4)} in review`), 90)).dataFeed).toBe(false);
  });

  it('a blog where figure posts are a minority', () => {
    const posts = ['Launching on Robinhood Chain', 'Our audit is published', 'Introducing limit orders', 'New docs site', 'Hiring a protocol engineer', 'Community call recap', 'Bridge support for Arbitrum', 'Mobile app beta', 'Fee switch proposal', 'Points program', 'Security update', 'Gas savings in the router'];
    const tvl = Array.from({ length: 7 }, (_, index) => `Acme TVL reaches $${12 + index * 3}M`);
    // Seven figure posts among nineteen: a stream, but not the feed.
    const reading = detectDataFeed(feed([...posts, ...tvl]));
    expect(reading.streamEntries).toBe(7);
    expect(reading.dataFeed).toBe(false);
    // Five figure posts alone: fewer than the stream size.
    expect(detectDataFeed(feed(tvl.slice(0, 5))).dataFeed).toBe(false);
  });

  it('one title repeated is not a stream', () => {
    expect(detectDataFeed(feed(Array.from({ length: 10 }, () => 'Raised $5M to build on Robinhood Chain'))).dataFeed).toBe(false);
  });

  it('reads only the most recent window', () => {
    const old = weeklyDigest().map((entry) => ({ ...entry, publishedAt: new Date(entry.publishedAt.getTime() - 400 * 86_400_000) }));
    const recent = feed(Array.from({ length: FEED_DATA.window }, (_, index) => `Post ${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))} of our journey`));
    // Fifty fresh posts with no figures push the old digest out of the window.
    expect(detectDataFeed([...old, ...recent]).dataFeed).toBe(false);
  });
});
