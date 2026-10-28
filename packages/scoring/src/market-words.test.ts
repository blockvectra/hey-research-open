import { describe, expect, it } from 'vitest';

import { headed, marketStatusWords, marketWords, tokenMarketReasonSentence, tokenMarketStatusLabel, UNKNOWN_HEADS } from './market-status-words';
import { TOKEN_MARKET_REASONS, type TokenMarketStatusValue } from './token-market';
import { VALUATION_HIDDEN_WORDS } from './valuation-display';
import { DISCOVERY_GAP_WITHHELD_WORDS, STILL_BUILDING_WITHHELD_WORDS } from './withheld-words';

const STATUSES: TokenMarketStatusValue[] = ['ACTIVE_MARKET', 'LOW_LIQUIDITY', 'NO_LIQUIDITY', 'TRADING_INACTIVE', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED', 'INSUFFICIENT_DATA'];

/** One market, said once (2026-10-28 simplicity study, CON-2): every slot's words come from `marketWords`. */
describe('marketWords', () => {
  it('is the label rule and the reason sentence, for every status and reason', () => {
    for (const status of STATUSES) {
      for (const reason of [null, ...TOKEN_MARKET_REASONS]) {
        const words = marketWords(status, reason);
        expect(words.label).toBe(tokenMarketStatusLabel(status, reason));
        expect(words.sentence).toBe(tokenMarketReasonSentence(status, reason));
        expect(words.sentence.startsWith(words.label)).toBe(true);
      }
    }
  });

  it('refines an unclassified market by the facts beside it, under the "Not measured" head', () => {
    expect(marketWords('INSUFFICIENT_DATA', null, { hasCurrentReading: true, pricedDays: 30 }).label).toBe('Not measured — not classified yet');
    expect(marketWords('INSUFFICIENT_DATA', null, { hasCurrentReading: true, pricedDays: 1 }).label).toBe('Not measured — daily history too short');
    expect(marketWords('INSUFFICIENT_DATA', 'volume_unknown', { hasCurrentReading: true, pricedDays: 30 }).label).toBe('Readings not confirmed');
    expect(marketStatusWords('INSUFFICIENT_DATA', { hasCurrentReading: true, pricedDays: 30 })).toBe(marketWords('INSUFFICIENT_DATA', null, { hasCurrentReading: true, pricedDays: 30 }).label);
  });
});

/** Four heads, one separator (CON-10); the labels CLAUDE.md quotes stay word for word. */
describe('the unknown heads', () => {
  it('say every withheld, unread or unmeasured figure under one of four heads with " — "', () => {
    const heads = Object.values(UNKNOWN_HEADS);
    const words = [...Object.values(VALUATION_HIDDEN_WORDS), ...Object.values(DISCOVERY_GAP_WITHHELD_WORDS), ...Object.values(STILL_BUILDING_WITHHELD_WORDS)];
    for (const word of words) expect(heads.some((head) => word.startsWith(`${head} — `)), word).toBe(true);
    expect(headed(UNKNOWN_HEADS.notRead, 'no recent reading')).toBe(VALUATION_HIDDEN_WORDS.no_reading);
  });

  it('keeps the labels CLAUDE.md quotes', () => {
    expect(DISCOVERY_GAP_WITHHELD_WORDS.market_too_thin).toBe('Not measured — market too thin');
    expect(DISCOVERY_GAP_WITHHELD_WORDS.activity_unknown).toBe('Not measured — activity unknown');
    expect(tokenMarketStatusLabel('INSUFFICIENT_DATA', 'volume_unknown')).toBe('Readings not confirmed');
    expect(tokenMarketStatusLabel('ACTIVE_MARKET', 'launch_pool_trading')).toBe('Launch pool only');
  });

  it('points the valuation slot and the gap at the market instead of restating it', () => {
    expect(VALUATION_HIDDEN_WORDS.no_active_market).toBe('Withheld — see market');
    expect(VALUATION_HIDDEN_WORDS.unconfirmed).toBe('Withheld — see market');
    expect(DISCOVERY_GAP_WITHHELD_WORDS.market_not_live).toBe('Not measured — see market');
  });
});
