import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuilderActivityChart } from './project-visuals';
import { BuildTimeline, CodeWeekHighlights } from './timeline';

/*
 * What shipped, not only a count (2026-10-02, outsider audit): the chart's
 * axes are labelled, and a code week in the timeline lists what changed.
 */
describe('BuilderActivityChart — labelled axes', () => {
  const weeks = [
    { week: '2026-09-14', ships: 0 },
    { week: '2026-09-21', ships: 3, headline: 'v1.2.0' },
    { week: '2026-09-28', ships: 1, headline: 'Code changes' },
  ];
  const html = renderToStaticMarkup(createElement(BuilderActivityChart, { weeks }));

  it('names the unit, the week convention and the first and last week', () => {
    expect(html).toContain('ships per week (count)');
    expect(html).toContain('Monday to Sunday, UTC');
    expect(html).toContain('>2026-09-14<');
    expect(html).toContain('>2026-09-28<');
  });

  it('prints the top of the y axis and each week’s count, and reads aloud as numbers', () => {
    expect(html).toContain('>3<');
    expect(html).toMatch(/aria-label="Meaningful ships per week[^"]*2026-09-21 3/);
  });
});

describe('a code week in the timeline', () => {
  it('lists up to three commit subjects, each linking to its commit', () => {
    const html = renderToStaticMarkup(
      createElement(BuildTimeline, {
        now: new Date('2026-10-02T00:00:00Z'),
        items: [
          {
            id: 'w1',
            title: 'Code changes, week of 2026-09-28 – 2026-10-04 · 12 commits',
            eventType: 'CODE_ACTIVITY',
            publishedAt: new Date('2026-10-01T10:00:00Z'),
            verificationStatus: 'SOURCE_LINKED',
            sourceUrl: 'https://github.com/o/r/commits?since=2026-09-28T00%3A00%3A00.000Z&until=2026-10-05T00%3A00%3A00.000Z',
            highlights: [
              { text: 'Add swap router', href: 'https://github.com/o/r/commit/abc1234' },
              { text: 'Fix oracle decimals', href: 'https://github.com/o/r/commit/abc1235' },
            ],
          },
        ],
      }),
    );
    expect(html).toContain('Code changes, week of 2026-09-28 – 2026-10-04 · 12 commits');
    expect(html).not.toContain('Active development');
    expect(html).toContain('href="https://github.com/o/r/commit/abc1234"');
    expect(html).toContain('Fix oracle decimals');
    expect(html).toContain('commits?since=');
  });

  it('draws nothing without highlights', () => {
    expect(renderToStaticMarkup(createElement(CodeWeekHighlights, { highlights: [] }))).toBe('');
  });
});
