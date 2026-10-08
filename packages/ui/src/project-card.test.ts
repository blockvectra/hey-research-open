import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { explorerTokenUrl } from './brand';
import { isAddressShaped, shortenAddress } from './format';
import { ProjectCard, type ProjectCardData, formatPercentChange, marketLensLine, tradeContextLine } from './project-card';

const ADDRESS = '0x82aE0000000000000000000000000000000091bF';

const tokenBacked: ProjectCardData = {
  slug: 'agentos',
  name: 'AgentOS',
  symbol: 'AOS',
  projectKind: 'UTILITY',
  activityStatus: 'SHIPPING',
  marketCapUsd: 1_240_000,
  token: { chainId: 4663, contractAddress: ADDRESS },
  launchedVia: { name: 'Pons', url: 'https://ponsfamily.com/launchpad/0x82ae' },
  officialX: { handle: 'agentos', url: 'https://x.com/agentos' },
};

const render = (project: ProjectCardData) => renderToStaticMarkup(createElement(ProjectCard, { project }));

describe('shortenAddress', () => {
  it('keeps both ends and never the middle', () => {
    expect(shortenAddress(ADDRESS)).toBe('0x82aE…91bF');
    expect(shortenAddress('0xabc')).toBe('0xabc');
  });
});

describe('market cap provenance', () => {
  it('names the source as a title only, never as layout', () => {
    const html = render({ ...tokenBacked, marketCapSource: 'coingecko' });
    expect(html).toContain('title="via CoinGecko"');
    expect(html).toContain('$1.2M');
    expect(html).not.toContain('>via CoinGecko<');
  });

  it('shows the figure without a title when the source is unknown', () => {
    const html = render(tokenBacked);
    expect(html).toContain('$1.2M');
    expect(html).not.toContain('title="via');
  });
});

describe('ProjectCard — token-backed', () => {
  const html = render(tokenBacked);

  it('shows exactly the eight facts', () => {
    expect(html).toContain('AgentOS');
    expect(html).toContain('$AOS');
    expect(html).toContain('Market cap');
    expect(html).toContain('$1.2M');
    expect(html).toContain('0x82aE…91bF');
    expect(html).toContain('Shipping');
    expect(html).toContain('>Pons<');
    expect(html).toContain('@agentos');
  });

  it('shows one line of description under the contract when the project has one', () => {
    const withText = render({ ...tokenBacked, shortDescription: 'Autonomous agent infrastructure.' });
    expect(withText).toContain('data-testid="description"');
    expect(withText).toContain('Autonomous agent infrastructure.');
    expect(html).not.toContain('data-testid="description"');
  });

  it('carries the full address for copying and links the explorer page for this contract', () => {
    expect(html).toContain(`title="${ADDRESS}"`);
    expect(html).toContain(`data-address="${ADDRESS}"`);
    expect(html).toContain('data-chain-id="4663"');
    expect(html).toContain(`href="${explorerTokenUrl(ADDRESS)}"`);
    expect(html).toContain('aria-label="Copy contract address"');
  });

  it('carries none of the excluded facts', () => {
    for (const forbidden of ['Still Building', 'momentum', 'Discovery', 'holders', 'volume', 'liquidity', 'commits', 'weeks']) {
      expect(html.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('ProjectCard — fallbacks', () => {
  it('says market cap is unavailable rather than inventing one', () => {
    const html = render({ ...tokenBacked, marketCapUsd: undefined });
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('$1.2M');
  });

  it('omits the X account when no official one is mapped', () => {
    const html = render({ ...tokenBacked, officialX: undefined });
    expect(html).not.toContain('@agentos');
    expect(html).not.toContain('on X');
  });

  it('shows Unknown for a token without a launch record, without a link', () => {
    const html = render({ ...tokenBacked, launchedVia: { name: 'Unknown' } });
    expect(html).toContain('Unknown');
    expect(html).not.toContain('launch page');
  });

  it('renders the UNKNOWN status with the existing vocabulary', () => {
    const html = render({ ...tokenBacked, activityStatus: 'UNKNOWN' });
    expect(html).toContain('Activity unknown');
    expect(html).not.toContain('Shipping');
  });

  it('says "No builder source linked" only for UNKNOWN with nothing to read building from', () => {
    const html = render({ ...tokenBacked, activityStatus: 'UNKNOWN', hasBuilderSource: false });
    expect(html).toContain('No builder source linked');
    expect(html).not.toContain('Activity unknown');
    // A source HEY can read keeps the plain word; a known status never changes.
    expect(render({ ...tokenBacked, activityStatus: 'UNKNOWN', hasBuilderSource: true })).toContain('Activity unknown');
    expect(render({ ...tokenBacked, activityStatus: 'SHIPPING', hasBuilderSource: false })).not.toContain('No builder source linked');
    // Not beside a recorded ship (2026-09-25): a card that says "Last ship 1mo ago" has had a signal.
    expect(render({ ...tokenBacked, activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: new Date('2026-08-16T00:00:00Z') })).not.toContain('No builder source linked');
  });

  it('prints what it knows under an UNKNOWN token card: trades and on-chain events, and nothing when it knows neither', () => {
    const html = render({ ...tokenBacked, activityStatus: 'UNKNOWN', hasBuilderSource: false, tokenMarketStatus: 'ACTIVE_MARKET', onchainEvents24h: 1204 });
    expect(html).toContain('data-testid="card-context-line"');
    expect(html).toContain('Traded today · 1,204 on-chain events / 24 h');
    expect(tradeContextLine({ ...tokenBacked, tokenMarketStatus: 'TRADING_INACTIVE', tokenMarketReason: 'launch_pool_no_trades' })).toBe('Launch pool, no trades in the last day');
    expect(tradeContextLine({ ...tokenBacked, tokenMarketStatus: 'TRADING_INACTIVE', onchainEvents24h: 1 })).toBe('No trades today · 1 on-chain event / 24 h');
    expect(tradeContextLine({ ...tokenBacked })).toBeUndefined();
    // Not under a status HEY could read, and never on a tokenless card.
    expect(render({ ...tokenBacked, activityStatus: 'ACTIVE', tokenMarketStatus: 'ACTIVE_MARKET', onchainEvents24h: 5 })).not.toContain('card-context-line');
    expect(render({ ...tokenBacked, token: undefined, activityStatus: 'UNKNOWN', onchainEvents24h: 5 })).not.toContain('card-context-line');
  });

  it('names the pool a token trades in when no launch record names a launchpad', () => {
    const html = render({ ...tokenBacked, launchedVia: { name: 'Unknown' }, marketVenue: 'Uniswap v4' });
    expect(html).toContain('DEX (Uniswap v4)');
    expect(html).not.toContain('>Unknown<');
    expect(html).not.toContain('launch page');
    // A venue HEY cannot name is already "DEX": printed once, never "DEX (DEX)" (full audit, 2026-10-03).
    const unnamed = render({ ...tokenBacked, launchedVia: { name: 'Unknown' }, marketVenue: 'DEX' });
    expect(unnamed).not.toContain('DEX (DEX)');
    expect(unnamed).toMatch(/>DEX<\/span>/);
    // A launch record wins: the venue is where it trades, not where it launched.
    expect(render({ ...tokenBacked, launchedVia: { name: 'Pons' }, marketVenue: 'Uniswap v4' })).not.toContain('DEX (');
    expect(marketLensLine({ ...tokenBacked, liquidityUsd: 12_000, launchStage: 'DEX', marketVenue: 'Uniswap v4', onchainEvents24h: 40 })).toBe('Liquidity $12K · in a Uniswap v4 pool · 40 on-chain events / 24 h');
    // Trades and the day's move join the line when the reading carries them (2026-09-13).
    expect(marketLensLine({ ...tokenBacked, liquidityUsd: 12_000, buys24h: 312, sells24h: 288, priceChange24hPct: 4.2 })).toBe('Liquidity $12K · 312 buys · 288 sells · +4.2% / 24 h');
    expect(formatPercentChange(-12.04)).toBe('−12.0%');
    expect(formatPercentChange(1234.5)).toBe('+1,235%');
    expect(formatPercentChange(undefined)).toBeUndefined();
  });

  it('names a launch pool that traded "Launch pool only" and prints none of its figures as a market (RT2-01, 2026-10-09)', () => {
    const launchPool = {
      ...tokenBacked,
      tokenMarketStatus: 'ACTIVE_MARKET',
      tokenMarketReason: 'launch_pool_trading',
      marketCapUsd: 4_800_000,
      liquidityUsd: 2_400_000,
      volume24hUsd: 3_100,
      buys24h: 12,
      sells24h: 9,
      priceChange24hPct: 38,
      launchStage: 'CURVE',
    } as ProjectCardData;
    const html = render(launchPool);
    expect(html).toContain('data-valuation-state="launch_pool_only"');
    expect(html).toContain('>Launch pool only<');
    expect(html).not.toContain('$4.8M');
    expect(html).not.toContain('Market cap');
    const lens = renderToStaticMarkup(createElement(ProjectCard, { project: launchPool, marketLens: true }));
    expect(lens).not.toContain('$2.4M');
    // The pool's trades are measured and stay; its "liquidity" is the token's own supply and does not.
    expect(marketLensLine(launchPool)).toBe('Launch pool only · 24 h volume $3.1K · 12 buys · 9 sells · on the launch curve');
    expect(tradeContextLine(launchPool)).toBe('Launch pool only · traded today');
    // A measured active market keeps its figures.
    const measured = { ...launchPool, tokenMarketReason: 'liquidity_and_volume' } as ProjectCardData;
    expect(render(measured)).toContain('$4.8M');
    expect(marketLensLine(measured)).toContain('Liquidity $2.4M');
    expect(tradeContextLine(measured)).toBe('Traded today');
  });

  it('a launch pool with no trades in the last day says just that, never "no trades yet" (RT2-06, 2026-10-09)', () => {
    const quiet = { ...tokenBacked, tokenMarketStatus: 'TRADING_INACTIVE', tokenMarketReason: 'launch_pool_no_trades' } as ProjectCardData;
    expect(marketLensLine(quiet)).toBe('Launch pool, no trades in the last day');
    expect(marketLensLine(quiet)).not.toContain('yet');
  });

  it('prints no figure and no dead-market claim for readings HEY does not settle (2026-09-25)', () => {
    const implausible = { ...tokenBacked, tokenMarketStatus: 'INSUFFICIENT_DATA', tokenMarketReason: 'readings_implausible', volume24hUsd: 53 } as ProjectCardData;
    expect(marketLensLine(implausible)).toBe('Reported liquidity not confirmed');
    const html = render(implausible);
    expect(html).toContain('Unconfirmed');
    expect(html).not.toContain('No active market');
    const disagree = { ...tokenBacked, tokenMarketStatus: 'INSUFFICIENT_DATA', tokenMarketReason: 'pool_readings_disagree' } as ProjectCardData;
    expect(marketLensLine(disagree)).toBe('Pool readings disagree');
    expect(render(disagree)).toContain('Unconfirmed');
  });

  it('qualifies a contract the project’s own site contradicts, as the page does (2026-09-28)', () => {
    // agentos on production: tokens.verification MISMATCH; the page said "Contract mismatch", the card nothing.
    expect(render({ ...tokenBacked, tokenVerification: 'MISMATCH' })).toContain('Contract mismatch');
    expect(render({ ...tokenBacked, tokenVerification: 'UNVERIFIED' })).not.toContain('Contract mismatch');
    expect(render({ ...tokenBacked, tokenVerification: 'VERIFIED' })).not.toContain('Token verified');
  });

  it('says quietly that a token is unverified, and nothing when verification is unknown (AOP-09, 2026-10-09)', () => {
    // Autonolas on production: an UNVERIFIED market-listing token whose card printed "Valuation $2.3K" with no mark.
    const unverified = render({ ...tokenBacked, tokenVerification: 'UNVERIFIED' });
    expect(unverified).toContain('data-testid="token-unverified"');
    expect(unverified).toContain('>Token unverified<');
    // Text, not the page's chip.
    expect(unverified).not.toContain('token-verification-chip');
    expect(render({ ...tokenBacked, tokenVerification: 'VERIFIED' })).not.toContain('token-unverified');
    expect(render({ ...tokenBacked, tokenVerification: 'MISMATCH' })).not.toContain('token-unverified');
    expect(render(tokenBacked)).not.toContain('token-unverified');
  });

  it('says how old a stale reading is, and nothing for a current one (2026-09-28)', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    // firstviralonboardogcreatoraicoin on production: a Bitquery reading four days old, printed as current.
    const stale = renderToStaticMarkup(createElement(ProjectCard, { project: { ...tokenBacked, marketCapObservedAt: new Date('2026-09-24T00:07:00Z') }, now }));
    expect(stale).toContain('data-testid="valuation-age"');
    expect(stale).toContain('4d old');
    const fresh = renderToStaticMarkup(createElement(ProjectCard, { project: { ...tokenBacked, marketCapObservedAt: new Date('2026-09-28T09:00:00Z') }, now }));
    expect(fresh).not.toContain('valuation-age');
  });

  it('names no measure over a hidden figure: "Valuation" for every empty state (2026-09-28)', () => {
    // Quivertrade on production: a real market cap distinct from its FDV, in a launch pool nobody traded.
    const deadCap = { ...tokenBacked, marketCapUsd: 22_085, fdvUsd: 29_616, tokenMarketStatus: 'TRADING_INACTIVE', tokenMarketReason: 'launch_pool_no_trades' } as ProjectCardData;
    const deadFdv = { ...deadCap, marketCapUsd: 24_000, fdvUsd: 24_000 } as ProjectCardData;
    const unread = { ...tokenBacked, marketCapUsd: undefined } as ProjectCardData;
    for (const project of [deadCap, deadFdv, unread]) {
      const html = render(project);
      expect(html).toContain('>Valuation<');
      expect(html).not.toContain('Market cap');
      expect(html).not.toContain('$22K');
      expect(html).not.toContain('$24K');
    }
    expect(render(deadCap)).toContain('No active market');
    expect(render(unread)).toContain('data-valuation-state="no_reading"');
    // A launch pool with no trades is dead whatever status sits beside it (`marketIsLive`); the card's own list missed that.
    expect(render({ ...deadFdv, tokenMarketStatus: 'LOW_LIQUIDITY' } as ProjectCardData)).toContain('No active market');
  });
});

describe('ProjectCard — with a ship (ships feed)', () => {
  const now = new Date('2026-09-03T12:00:00Z');
  const ship = {
    id: 'ship-1',
    eventType: 'SDK_RELEASE',
    title: 'Agent SDK v0.4',
    publishedAt: new Date('2026-09-01T12:00:00Z'),
    verificationStatus: 'PUBLICLY_VERIFIED',
    sourceUrl: 'https://agentos.example/ship/0',
  };
  const renderWithShip = (override: Partial<typeof ship> = {}) =>
    renderToStaticMarkup(createElement(ProjectCard, { project: tokenBacked, ship: { ...ship, ...override }, now }));

  it('shows the ship as a block under the identity and stops there: no market cap, address or description', () => {
    const html = renderWithShip();
    expect(html).toContain('data-testid="latest-ship"');
    expect(html).toContain('data-ship-id="ship-1"');
    /*
     * "Ship", not "Latest ship": this block renders whichever event the
     * surface handed the card, and on the ships feed that is one row of a
     * history — AUM0's card once read "Latest ship" over a release from seven
     * hours ago beside a status line saying "Last ship 3h ago".
     */
    expect(html).toContain('>Ship<');
    expect(html).toContain('SDK release');
    expect(html).toContain('Agent SDK v0.4');
    expect(html).toContain('2d ago');
    expect(html).toContain('Source verified');

    // Order: identity header, then the ship, then the footer (UI/UX audit U11).
    const identity = html.indexOf('$AOS');
    const block = html.indexOf('data-testid="latest-ship"');
    const footer = html.indexOf('data-testid="launched-via"');
    expect(identity).toBeLessThan(block);
    expect(block).toBeLessThan(footer);

    for (const fact of ['AgentOS', '$AOS', 'Shipping', '>Pons<', '@agentos']) {
      expect(html).toContain(fact);
    }
    // The token facts live on the project page, one click away, not on every event.
    for (const absent of ['data-testid="market-cap"', 'data-testid="contract-address"', 'data-testid="description"']) {
      expect(html).not.toContain(absent);
    }
  });

  it('links the source as a nested target that opens in a new tab, never the project', () => {
    const html = renderWithShip();
    expect(html).toContain('data-testid="ship-source"');
    expect(html).toContain('href="https://agentos.example/ship/0"');
    expect(html).toContain('aria-label="Open source for Agent SDK v0.4"');
    expect(html).toMatch(/data-testid="ship-source"[^>]*target="_blank"/);
    expect(html).toMatch(/data-testid="ship-source"[^>]*rel="noopener noreferrer"/);
    expect(renderWithShip({ sourceUrl: undefined })).not.toContain('data-testid="ship-source"');
  });

  it('keeps a self-reported claim visibly distinct from a verified one', () => {
    const verified = renderWithShip();
    const selfReported = renderWithShip({ verificationStatus: 'SELF_REPORTED' });
    expect(selfReported).toContain('Self reported');
    expect(selfReported).toContain('data-verification="SELF_REPORTED"');
    expect(selfReported).not.toContain('Source verified');
    expect(verified).toMatch(/data-testid="ship-verification" class="text-hey-secondary"/);
    expect(selfReported).toMatch(/data-testid="ship-verification" class="italic text-hey-muted"/);
  });

  // Two lines, not one (ux-data audit, 2026-10-01): on /ships one line cut "Active development: 100+ commits since 20…" before the dates that tell two cards apart.
  it('clamps the title to two lines and carries the full title', () => {
    const html = renderWithShip({ title: 'A very long release title that would otherwise wrap onto several lines' });
    expect(html).toMatch(/data-testid="ship-title"/);
    expect(html).toMatch(/class="[^"]*line-clamp-2[^"]*"[^>]*title="A very long release title/);
  });

  it('renders the same card as before when no ship is given', () => {
    const html = render(tokenBacked);
    // The block's own marker, rather than a word that appears in "Shipping".
    expect(html).not.toContain('latest-ship');
    expect(html).not.toContain('data-ship-id');
    expect(html).not.toContain('Source');
  });
});

describe('ProjectCard — tokenless', () => {
  const html = render({
    slug: 'hoodlens',
    name: 'HoodLens',
    projectKind: 'INFRASTRUCTURE',
    activityStatus: 'ACTIVE',
    websiteUrl: 'https://www.hoodlens.example/docs',
    shortDescription: 'Open indexer tooling for Robinhood Chain.',
    lastMeaningfulShipAt: new Date('2026-09-01T00:00:00Z'),
    launchedVia: { name: 'Independent' },
    officialX: { handle: 'hoodlens', url: 'https://x.com/hoodlens' },
  });

  it('shows kind, site and X account, and no ticker, market cap or contract address', () => {
    expect(html).toContain('Infrastructure');
    // The last ship rides the builder line (public IA pass, 2026-09-28); the market slot says once that HEY tracks no token
    // (2026-10-03: "No token tracked", never the absolute "No token" — a project may hold one HEY has not linked).
    expect(html).toContain('data-testid="card-last-ship"');
    expect(html).toContain('Shipped');
    expect(html).toContain('data-testid="no-token"');
    expect(html).toContain('>No token tracked<');
    expect(html).not.toContain('>No token<');
    expect(html).toContain('Open indexer tooling');
    expect(html).toContain('hoodlens.example');
    expect(html).toContain('@hoodlens');
    expect(html).toContain('Independent');
    expect(html).toContain('data-has-token="false"');
    expect(html).not.toContain('Market cap');
    expect(html).not.toContain('contract-address');
    expect(html).not.toContain('data-testid="ticker"');
  });
});

describe('isAddressShaped', () => {
  it('accepts an address in either case', () => {
    expect(isAddressShaped(ADDRESS)).toBe(true);
    expect(isAddressShaped(ADDRESS.toLowerCase())).toBe(true);
    expect(isAddressShaped(`  ${ADDRESS}  `)).toBe(true);
  });

  it('refuses anything that is not forty hex characters after 0x', () => {
    expect(isAddressShaped('0xabc')).toBe(false);
    expect(isAddressShaped(`${ADDRESS}0`)).toBe(false);
    expect(isAddressShaped(ADDRESS.replace('0x', ''))).toBe(false);
    expect(isAddressShaped('agentos')).toBe(false);
  });

  /*
   * Shape only. The burn address is well-formed and is not a project; that
   * judgement belongs to `normalizeContractAddress` in the domain, and a field
   * deciding how to behave while someone types must not pre-empt it.
   */
  it('is a shape question, not an identity one', () => {
    expect(isAddressShaped('0x000000000000000000000000000000000000dEaD')).toBe(true);
  });
});

describe('token lock', () => {
  it('names the locker and the share, and never the word liquidity', () => {
    const html = render({ ...tokenBacked, tokenLock: { supplyPct: 2.53, until: '2027-09-09', pairLocked: false } });
    expect(html).toContain('2.53% HoodLock');
    expect(html).toContain('9 Sep 2027');
    /*
     * `apps/web/e2e/cards.spec.ts` asserts a card never contains the word
     * "liquidity". The lock copy says "pair" for the same reason, and this
     * pins it at the component level so the break is found here first.
     */
    expect(html).not.toMatch(/liquidity/i);
  });

  it('names the locker without inventing a share HEY does not know', () => {
    const html = render({ ...tokenBacked, tokenLock: { until: '2027-09-09', pairLocked: false } });
    expect(html).toContain('HoodLock');
    expect(html).not.toContain('%');
    expect(html).not.toContain('0%');
  });

  it("carries HoodLock's own mark, so the locker is recognisable without reading", () => {
    const html = render({ ...tokenBacked, tokenLock: { supplyPct: 2.53, until: '2027-09-09', pairLocked: false } });
    expect(html).toContain('/hoodlock-mark.png');
    /* Decorative: the words beside it already say HoodLock, so a reader is not told twice. */
    expect(html).toMatch(/<img[^>]+hoodlock-mark\.png[^>]+alt=""/);
    /* And the generic padlock it replaced is gone. */
    expect(html).not.toContain('lucide-lock');
  });

  it('says a pair is locked only when one is', () => {
    const locked = render({ ...tokenBacked, tokenLock: { supplyPct: 10, until: '2027-01-01', pairLocked: true } });
    expect(locked).toMatch(/pair holding this token is locked/i);
    const plain = render({ ...tokenBacked, tokenLock: { supplyPct: 10, until: '2027-01-01', pairLocked: false } });
    expect(plain).not.toMatch(/pair holding this token is locked/i);
  });

  it('draws nothing at all when HEY found no lock, rather than an unlocked state', () => {
    const html = render(tokenBacked);
    expect(html).not.toContain('data-testid="token-lock"');
    expect(html).not.toMatch(/unlocked|not locked|no lock/i);
  });

  it('never shows a lock chip on a project with no token', () => {
    const { token: _token, tokenLock: _lock, ...tokenless } = { ...tokenBacked, tokenLock: { supplyPct: 5, until: '2027-01-01', pairLocked: false } };
    expect(render(tokenless as ProjectCardData)).not.toContain('data-testid="token-lock"');
  });
});

describe('ProjectCard — builder line and latest signal (public IA pass, 2026-09-28)', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const renderAt = (project: ProjectCardData) => renderToStaticMarkup(createElement(ProjectCard, { project, now }));
  const latestShip = { id: 'a1b2', title: 'Agent **SDK** v0.4', eventType: 'SDK_RELEASE', publishedAt: new Date('2026-09-26T12:00:00Z') };

  it('names what shipped and when, in one line after the status', () => {
    const html = renderAt({ ...tokenBacked, latestShip, lastMeaningfulShipAt: latestShip.publishedAt });
    expect(html).toContain('data-testid="card-latest-signal"');
    expect(html).toContain('data-ship-id="a1b2"');
    // The canonical phrase (`cardShipPhrase`): the kind and the version, then the age.
    expect(html).toContain('>SDK v0.4<');
    expect(html).toContain('· 2d ago');
    // Markdown from a source is words in the full title.
    expect(html).toContain('title="SDK release: Agent SDK v0.4"');
    // Never cut by CSS: the line wraps at a word instead.
    expect(html).not.toMatch(/data-testid="card-latest-signal"[^>]*class="[^"]*truncate/);
    expect(html).not.toMatch(/<p[^>]*data-testid="card-latest-signal"[\s\S]*?truncate[\s\S]*?<\/p>/);
    // The status comes before the evidence in reading order.
    expect(html.indexOf('data-activity-status')).toBeLessThan(html.indexOf('card-latest-signal'));
    // One date, not two.
    expect(html.match(/data-testid="card-last-ship"/g)).toHaveLength(1);
  });

  it('names a code week by its kind and its week, never "Active development: 100…" nor the rolling count', () => {
    const code = { id: 'c1', title: 'Active development: 100+ commits since 2026-09-16 across 1 contributor', eventType: 'CODE_ACTIVITY', publishedAt: new Date('2026-09-28T02:00:00Z') };
    const html = renderAt({ ...tokenBacked, latestShip: code, lastMeaningfulShipAt: code.publishedAt });
    expect(html).toContain('>Code changes<');
    expect(html).not.toContain('100+ commits');
    expect(html).toContain('· this week');
    expect(html).not.toContain('>Active development');
  });

  it('shows the date alone when the ship would only restate the status', () => {
    const vague = { id: 'v1', title: 'Active development', eventType: 'CODE_ACTIVITY', publishedAt: new Date('2026-09-25T12:00:00Z') };
    const html = renderAt({ ...tokenBacked, latestShip: vague, lastMeaningfulShipAt: vague.publishedAt });
    expect(html).not.toContain('card-latest-signal');
    expect(html).toContain('Shipped 3d ago');
  });

  it('falls back to the date alone when HEY holds a date but no counted ship', () => {
    const html = renderAt({ ...tokenBacked, lastMeaningfulShipAt: new Date('2026-07-28T12:00:00Z') });
    expect(html).not.toContain('card-latest-signal');
    expect(html).toContain('Shipped 2mo ago');
  });

  it('says nothing about a ship that never happened', () => {
    const html = renderAt({ ...tokenBacked, activityStatus: 'UNKNOWN', hasBuilderSource: false });
    expect(html).not.toContain('card-last-ship');
    expect(html).not.toContain('card-latest-signal');
    expect(html).toContain('No builder source linked');
  });

  it('a ship card carries its ship, not a second latest-signal line', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectCard, {
        project: { ...tokenBacked, latestShip },
        ship: { id: 's1', eventType: 'GITHUB_RELEASE', title: 'v1.0', publishedAt: latestShip.publishedAt, verificationStatus: 'PUBLICLY_VERIFIED' },
        now,
      }),
    );
    expect(html).toContain('data-testid="latest-ship"');
    expect(html).not.toContain('card-latest-signal');
    expect(html).not.toContain('data-testid="market-cap"');
  });

  it('keeps a long name and a long ticker inside the card', () => {
    const html = renderAt({ ...tokenBacked, name: 'A'.repeat(90), symbol: 'VERYLONGTICKERSYMBOLTHATGOESON' });
    expect(html).toContain('line-clamp-2 [overflow-wrap:anywhere]');
    // The identity line truncates rather than widening the grid track.
    expect(html).toMatch(/<p class="mt-1 truncate[^"]*"><span data-testid="ticker"/);
  });

  it('draws a monogram when there is no logo, and never an empty image', () => {
    const html = renderAt({ ...tokenBacked, logoUrl: null });
    expect(html).not.toContain('<img');
  });

  it('keeps FDV and market cap apart: an FDV-only reading is "Valuation", with the measure named', () => {
    const html = renderAt({ ...tokenBacked, marketCapUsd: 238_000, fdvUsd: 238_000 });
    expect(html).toContain('>Valuation<');
    expect(html).toContain('title="Fully diluted valuation');
    expect(html).not.toContain('>Market cap<');
    const known = renderAt({ ...tokenBacked, marketCapUsd: 22_085, fdvUsd: 29_616 });
    expect(known).toContain('>Market cap<');
  });

  it('a verified builder with nothing to keep reading says so rather than "unknown"', () => {
    const html = renderAt({
      ...tokenBacked,
      activityStatus: 'UNKNOWN',
      hasBuilderSource: false,
      researchLevel: 'VERIFIED_BUILDER',
      lastMeaningfulShipAt: new Date('2026-07-28T12:00:00Z'),
    });
    expect(html).toContain('data-unknown-reason');
    expect(html).not.toContain('>Activity unknown<');
  });
});

describe('the $HEY disclosure line (round 4, 2026-09-30)', () => {
  const DISCLOSURE = 'HEY’s own token — researched by the same rules';

  it('prints the words it is given, once, under the identity', () => {
    const html = renderToStaticMarkup(createElement(ProjectCard, { project: tokenBacked, disclosure: DISCLOSURE }));
    expect(html.match(/data-testid="heys-own-token"/g)).toHaveLength(1);
    expect(html).toContain(DISCLOSURE);
    expect(html.indexOf('data-testid="heys-own-token"')).toBeLessThan(html.indexOf('data-testid="card-builder"'));
  });

  it('prints nothing without it, and changes nothing else on the card', () => {
    const plain = render(tokenBacked);
    expect(plain).not.toContain('heys-own-token');
    const marked = renderToStaticMarkup(createElement(ProjectCard, { project: tokenBacked, disclosure: DISCLOSURE }));
    expect(marked.replace(/<p class="[^"]*" data-testid="heys-own-token">[^<]*<\/p>/, '')).toBe(plain);
  });
});

describe('ProjectCard — data states are not categories (ux-data audit, 2026-10-01)', () => {
  it('names no category from the catch-all "Other" narrative', () => {
    const html = render({ ...tokenBacked, primaryNarrative: { slug: 'other', name: 'Other' } });
    expect(html).not.toContain('data-testid="card-narrative"');
    expect(html).not.toMatch(/>Other</);
    // A real narrative still reads.
    expect(render({ ...tokenBacked, primaryNarrative: { slug: 'ai-agents', name: 'AI Agents' } })).toContain('>AI Agents<');
  });

  it('prints no lone dash where a description is only punctuation', () => {
    const html = render({ ...tokenBacked, shortDescription: '-' });
    expect(html).not.toMatch(/>\s*-\s*</);
  });
});
