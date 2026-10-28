import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_NOT_MEASURABLE,
  ActivityChip,
  activityLabel,
  activityPresentation,
  NO_BUILDER_SIGNAL,
  showsNoBuilderSignal,
  TokenMarketChip,
  tokenMarketLabel,
  TokenVerificationChip,
  unknownActivityReason,
} from './status';

/**
 * Why an UNKNOWN is unknown (data-correctness pass, 2026-09-28).
 *
 * Regression: a Verified Builder with a ship two months old and no source HEY
 * reads printed "Not measured — activity unknown" under its badge. The chip now says what
 * HEY can and cannot see, from the same three facts on every surface.
 */
describe('unknownActivityReason', () => {
  const shipped = new Date('2026-07-14T00:00:00Z');

  it('is null for every decided status, whatever the sources', () => {
    for (const status of ['SHIPPING', 'ACTIVE', 'QUIET', 'DORMANT', 'RESUMED']) {
      expect(unknownActivityReason({ activityStatus: status, hasBuilderSource: false, lastMeaningfulShipAt: null })).toBeNull();
    }
  });

  it('separates "nothing ever shipped" from "shipped, but nothing to keep reading"', () => {
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: null })).toBe('no_builder_signal');
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: shipped })).toBe('no_readable_source');
  });

  it('keeps the plain word where HEY reads a source and nothing shipped, or where the caller does not know', () => {
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: true, lastMeaningfulShipAt: null })).toBeNull();
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', lastMeaningfulShipAt: shipped })).toBeNull();
  });

  // 2026-10-28 simplicity study, DATA-10: a ship beside UNKNOWN is the scorer's no-coverage reading, never a bare "Not measured — activity unknown".
  it('says why beside a ship, whatever the source flag reads now', () => {
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: true, lastMeaningfulShipAt: shipped })).toBe('no_readable_source');
  });

  it('is the rule showsNoBuilderSignal answers from', () => {
    expect(showsNoBuilderSignal({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: null })).toBe(true);
    expect(showsNoBuilderSignal({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: shipped })).toBe(false);
  });
});

describe('activityPresentation', () => {
  it('names each reason once, and falls back on the status word', () => {
    expect(activityPresentation('UNKNOWN', 'no_builder_signal').label).toBe(NO_BUILDER_SIGNAL.label);
    expect(activityPresentation('UNKNOWN', 'no_readable_source').label).toBe(ACTIVITY_NOT_MEASURABLE.label);
    expect(activityPresentation('UNKNOWN', null).label).toBe('Not measured — activity unknown');
    expect(activityLabel('UNKNOWN')).toBe('Not measured');
    // A reason never relabels a decided status.
    expect(activityPresentation('SHIPPING', 'no_readable_source').label).toBe(activityLabel('SHIPPING'));
  });

  it('the chip prints the presentation and carries the reason for parity checks', () => {
    const html = renderToStaticMarkup(createElement(ActivityChip, { status: 'UNKNOWN', unknownReason: 'no_readable_source' }));
    expect(html).toContain(ACTIVITY_NOT_MEASURABLE.label);
    expect(html).toContain('data-activity-status="UNKNOWN"');
    expect(html).toContain('data-unknown-reason="no_readable_source"');
    expect(html).not.toContain('Not measured — activity unknown');
  });

  it('still honours the older noBuilderSource flag', () => {
    const html = renderToStaticMarkup(createElement(ActivityChip, { status: 'UNKNOWN', noBuilderSource: true }));
    expect(html).toContain(NO_BUILDER_SIGNAL.label);
  });
});

/**
 * A market's state is not a builder state and not a direction (public UX
 * review, 2026-09-28; CLAUDE.md UI rule 13): no chip on the token row wears
 * the builder green, the market up/down tokens or any other colour.
 */
describe('token market and verification chips', () => {
  const statuses = ['ACTIVE_MARKET', 'LOW_LIQUIDITY', 'NO_LIQUIDITY', 'TRADING_INACTIVE', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED', 'INSUFFICIENT_DATA', 'TOKEN_NOT_LAUNCHED'] as const;

  it('never colours a market state', () => {
    for (const status of statuses) {
      const html = renderToStaticMarkup(createElement(TokenMarketChip, { status }));
      expect(html, status).not.toMatch(/status-|market-up|market-down|text-green|text-red|text-gold/);
      expect(html, status).toMatch(/text-hey-(ink|muted)/);
    }
  });

  it('never colours a token verification', () => {
    for (const verification of ['VERIFIED', 'UNVERIFIED', 'MISMATCH'] as const) {
      const html = renderToStaticMarkup(createElement(TokenVerificationChip, { verification }));
      expect(html, verification).not.toMatch(/status-|market-up|market-down|text-green|text-red/);
    }
  });

  it('says "No token tracked" once, in one wording', () => {
    expect(tokenMarketLabel('TOKEN_NOT_LAUNCHED')).toBe('No token tracked');
    // A traded market on a depth reading over a week old (2026-10-16, ruling #139).
    expect(tokenMarketLabel('INSUFFICIENT_DATA', 'liquidity_not_current')).toBe('Readings not confirmed');
    // The scoring package's one label rule (2026-10-28, CON-2): every unconfirmed reason, never a literal copy.
    expect(tokenMarketLabel('INSUFFICIENT_DATA', 'volume_unknown')).toBe('Readings not confirmed');
    expect(tokenMarketLabel('INSUFFICIENT_DATA', 'removal_unconfirmed')).toBe('Readings not confirmed');
    expect(tokenMarketLabel('INSUFFICIENT_DATA', 'launch_pool_volume_unknown')).toBe('Readings not confirmed');
    expect(tokenMarketLabel('INSUFFICIENT_DATA')).toBe('Market data insufficient');
  });
});
