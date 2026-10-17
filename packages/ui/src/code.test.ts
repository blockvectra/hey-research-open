import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PublicCodeCard, releasesValue } from './code';
import { showsNoBuilderSignal } from './status';

/** Copy that contradicted the line beside it (audit A10-14, 2026-09-25). */
describe('the code panel headline', () => {
  it('says "Quiet" over a repository HEY read and found nothing in, never "Not measurable"', () => {
    const html = renderToStaticMarkup(
      createElement(PublicCodeCard, { data: { measurable: false, quiet: true, reason: 'No public commits or GitHub releases in the last 60 days.' } }),
    );
    expect(html).toContain('Quiet');
    expect(html).not.toContain('Not measurable');
  });

  it('keeps "Not measurable" where HEY could not read', () => {
    const html = renderToStaticMarkup(createElement(PublicCodeCard, { data: { measurable: false, reason: 'No public repository is mapped to this project.' } }));
    expect(html).toContain('Not measurable');
  });
});

describe('showsNoBuilderSignal', () => {
  it('holds for UNKNOWN with nothing to read and no ship on record', () => {
    expect(showsNoBuilderSignal({ activityStatus: 'UNKNOWN', hasBuilderSource: false })).toBe(true);
  });

  it('does not hold beside a recorded ship (hoodlock, blorb)', () => {
    expect(showsNoBuilderSignal({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: new Date('2026-08-16T00:00:00Z') })).toBe(false);
  });

  it('does not hold for a known status or a readable source', () => {
    expect(showsNoBuilderSignal({ activityStatus: 'SHIPPING', hasBuilderSource: false })).toBe(false);
    expect(showsNoBuilderSignal({ activityStatus: 'UNKNOWN', hasBuilderSource: true })).toBe(false);
    expect(showsNoBuilderSignal({ activityStatus: 'UNKNOWN' })).toBe(false);
  });
});

/** Release days, said as such (persona audit PB-16, 2026-10-18). */
describe('the code panel’s GitHub releases', () => {
  it('names the release days behind several releases, and stays a plain count otherwise', () => {
    expect(releasesValue(1, 3)).toBe('3 on 1 release day');
    expect(releasesValue(2, 5)).toBe('5 on 2 release days');
    expect(releasesValue(2, 2)).toBe('2');
    expect(releasesValue(4, undefined)).toBe('4');
  });

  it('prints it on the card', () => {
    const html = renderToStaticMarkup(
      createElement(PublicCodeCard, {
        data: { measurable: true, score: 40, activeDevDays: 3, windowDays: 60, contributors: 1, releases: 1, releasesPublished: 3, dimensions: [], heatmap: [] },
      }),
    );
    expect(html).toContain('3 on 1 release day');
  });
});
