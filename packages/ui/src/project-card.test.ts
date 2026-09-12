import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { explorerTokenUrl } from './brand';
import { shortenAddress } from './format';
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

  it('says "No builder signal yet" only for UNKNOWN with nothing to read building from', () => {
    const html = render({ ...tokenBacked, activityStatus: 'UNKNOWN', hasBuilderSource: false });
    expect(html).toContain('No builder signal yet');
    expect(html).not.toContain('Activity unknown');
    // A source HEY can read keeps the plain word; a known status never changes.
    expect(render({ ...tokenBacked, activityStatus: 'UNKNOWN', hasBuilderSource: true })).toContain('Activity unknown');
    expect(render({ ...tokenBacked, activityStatus: 'SHIPPING', hasBuilderSource: false })).not.toContain('No builder signal');
  });

  it('prints what it knows under an UNKNOWN token card: trades and on-chain events, and nothing when it knows neither', () => {
    const html = render({ ...tokenBacked, activityStatus: 'UNKNOWN', hasBuilderSource: false, tokenMarketStatus: 'ACTIVE_MARKET', onchainEvents24h: 1204 });
    expect(html).toContain('data-testid="card-context-line"');
    expect(html).toContain('Traded today · 1,204 on-chain events / 24 h');
    expect(tradeContextLine({ ...tokenBacked, tokenMarketStatus: 'TRADING_INACTIVE', tokenMarketReason: 'launch_pool_no_trades' })).toBe('Launch pool, no trades yet');
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
    // A launch record wins: the venue is where it trades, not where it launched.
    expect(render({ ...tokenBacked, launchedVia: { name: 'Pons' }, marketVenue: 'Uniswap v4' })).not.toContain('DEX (');
    expect(marketLensLine({ ...tokenBacked, liquidityUsd: 12_000, launchStage: 'DEX', marketVenue: 'Uniswap v4', onchainEvents24h: 40 })).toBe('Liquidity $12K · in a Uniswap v4 pool · 40 on-chain events / 24 h');
    // Trades and the day's move join the line when the reading carries them (2026-09-13).
    expect(marketLensLine({ ...tokenBacked, liquidityUsd: 12_000, buys24h: 312, sells24h: 288, priceChange24hPct: 4.2 })).toBe('Liquidity $12K · 312 buys · 288 sells · +4.2% / 24 h');
    expect(formatPercentChange(-12.04)).toBe('−12.0%');
    expect(formatPercentChange(1234.5)).toBe('+1,235%');
    expect(formatPercentChange(undefined)).toBeUndefined();
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
    expect(html).toContain('Sdk Release');
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

  it('clamps the title to one line and carries the full title', () => {
    const html = renderWithShip({ title: 'A very long release title that would otherwise wrap onto several lines' });
    expect(html).toMatch(/data-testid="ship-title"/);
    expect(html).toMatch(/class="[^"]*truncate[^"]*"[^>]*title="A very long release title/);
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
    expect(html).toContain('Last ship');
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
