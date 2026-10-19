import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { BuildTimeline, type TimelineItem } from './timeline';

/**
 * A folded run in the build timeline (2026-10-19 audit): one line in the
 * domain's words, the run's ships listed inside a disclosure with their own
 * anchors and evidence links — never 22 rows of "Deployed a new contract".
 */
const NOW = new Date('2026-10-19T10:00:00Z');
const deploy = (i: number): TimelineItem => ({
  id: `d${i}`,
  title: 'Deployed a new contract',
  eventType: 'CONTRACT_DEPLOY_FOLLOWUP',
  publishedAt: new Date(Date.parse('2026-10-12T16:04:02Z') - i * 4_000),
  verificationStatus: 'PUBLICLY_VERIFIED',
  sourceUrl: `https://explorer.example/tx/${i}`,
});

describe('BuildTimeline folds a run to one line', () => {
  it('prints the line once and lists every ship under a disclosure', () => {
    const items = Array.from({ length: 22 }, (_, i) => deploy(i));
    const line = '22 contracts deployed by the project’s deployer between 16:02:38 and 16:04:02 UTC on 12 Oct';
    const markup = renderToStaticMarkup(
      createElement(BuildTimeline, {
        now: NOW,
        items: [{ id: 'solo', title: 'v1.0', eventType: 'GITHUB_RELEASE', publishedAt: new Date('2026-10-13T00:00:00Z'), verificationStatus: 'PUBLICLY_VERIFIED' }, { kind: 'deploy_run', id: 'd0', line, items }],
      }),
    );
    expect(markup.match(/data-testid="timeline-run"/g)).toHaveLength(1);
    expect(markup).toContain('data-run-kind="deploy_run"');
    expect(markup).toContain(line);
    // The rows sit inside the <details>, each with its anchor and evidence link.
    const details = markup.slice(markup.indexOf('<details'), markup.indexOf('</details>'));
    expect(details).toContain('Show all 22 contracts');
    expect(details.match(/id="ship-d\d+"/g)).toHaveLength(22);
    expect(details.match(/View evidence/g)).toHaveLength(22);
    // The single ship outside the run is drawn as before.
    expect(markup).toContain('id="ship-solo"');
    expect(markup.indexOf('id="ship-solo"')).toBeLessThan(markup.indexOf('<details'));
  });
});
