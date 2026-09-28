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
  unknownActivityReason,
} from './status';

/**
 * Why an UNKNOWN is unknown (data-correctness pass, 2026-09-28).
 *
 * Regression: a Verified Builder with a ship two months old and no source HEY
 * reads printed "Activity unknown" under its badge. The chip now says what
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

  it('keeps the plain word where HEY reads a source, or where the caller does not know', () => {
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: true, lastMeaningfulShipAt: shipped })).toBeNull();
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', lastMeaningfulShipAt: shipped })).toBeNull();
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
    expect(activityPresentation('UNKNOWN', null).label).toBe(activityLabel('UNKNOWN'));
    // A reason never relabels a decided status.
    expect(activityPresentation('SHIPPING', 'no_readable_source').label).toBe(activityLabel('SHIPPING'));
  });

  it('the chip prints the presentation and carries the reason for parity checks', () => {
    const html = renderToStaticMarkup(createElement(ActivityChip, { status: 'UNKNOWN', unknownReason: 'no_readable_source' }));
    expect(html).toContain(ACTIVITY_NOT_MEASURABLE.label);
    expect(html).toContain('data-activity-status="UNKNOWN"');
    expect(html).toContain('data-unknown-reason="no_readable_source"');
    expect(html).not.toContain('Activity unknown');
  });

  it('still honours the older noBuilderSource flag', () => {
    const html = renderToStaticMarkup(createElement(ActivityChip, { status: 'UNKNOWN', noBuilderSource: true }));
    expect(html).toContain(NO_BUILDER_SIGNAL.label);
  });
});
