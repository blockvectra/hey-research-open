import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { HeyPage, HeyProject, HeyProjectDetail, HeyShip, HeyThisWeek } from './client';
import {
  STILL_BUILDING_MEANING,
  ago,
  projectLine,
  renderBuilders,
  renderProject,
  renderProjects,
  renderShips,
  renderSignals,
  renderThisWeek,
  renderTokenLookup,
  renderTokenMarket,
  renderWeeklyReport,
} from './render';

/**
 * What an agent is handed (2026-09-05).
 *
 * A model quotes whatever comes back, so these tests are about what the text
 * makes it possible to say. The failures worth guarding are not crashes: they
 * are a rendering that lets an assistant tell someone a project is a good buy,
 * report a market cap HEY never recorded, or present an unresearched record as
 * a verified claim.
 */
const NOW = new Date('2026-09-05T12:00:00Z');

const project = (over: Partial<HeyProject> = {}): HeyProject => ({
  slug: 'agentos',
  name: 'AgentOS',
  projectKind: 'UTILITY',
  activityStatus: 'SHIPPING',
  researchLevel: 'VERIFIED_BUILDER',
  catalogStatus: 'VERIFIED_BUILDER',
  stillBuilding: false,
  url: 'https://heyresearch.xyz/project/agentos',
  ...over,
});

const page = <T>(items: T[], over: Partial<HeyPage<T>> = {}): HeyPage<T> => ({
  query: { limit: 24, offset: 0, sort: 'activity' },
  total: items.length,
  items,
  disclaimer: 'Public, source-backed activity HEY recorded. … not investment advice.',
  ...over,
});

describe('projectLine', () => {
  it('leads with what HEY claims about activity, not with the market', () => {
    const line = projectLine(
      project({ symbol: 'AOS', marketCap: { usd: 24_000, source: 'coingecko' } }),
      NOW,
    );

    expect(line).toContain('AgentOS ($AOS)');
    expect(line.indexOf('shipping')).toBeLessThan(line.indexOf('mcap'));
    // A figure never travels without the provider that reported it.
    expect(line).toContain('$24.0K mcap (coingecko)');
  });

  it('says a record is unresearched instead of reporting its status as a finding', () => {
    // An INDEXED record has an activity status of UNKNOWN in the data. Printing
    // "unknown" would read as a measured result; it is an absence of research.
    const line = projectLine(project({ researchLevel: 'INDEXED', activityStatus: 'UNKNOWN' }), NOW);

    expect(line).toContain('activity not researched yet');
    expect(line).not.toMatch(/· unknown ·/);
  });

  it('prints no market figure when HEY has no reading', () => {
    const line = projectLine(project(), NOW);

    expect(line).not.toMatch(/mcap/);
    // Nothing that an agent could read as a value: no zero, no dash, no "n/a".
    expect(line).not.toMatch(/\$0|n\/a|N\/A|—/);
  });

  it('dates ships in words, so an agent is not left doing arithmetic', () => {
    expect(ago('2026-09-05T09:00:00Z', NOW)).toBe('today');
    expect(ago('2026-09-04T09:00:00Z', NOW)).toBe('yesterday');
    expect(ago('2026-08-29T12:00:00Z', NOW)).toBe('7 days ago');
    expect(ago('2026-07-05T12:00:00Z', NOW)).toBe('2 months ago');
  });
});

describe('renderProjects', () => {
  it('explains Still Building wherever the phrase appears', () => {
    const rendered = renderProjects(page([project({ stillBuilding: true })]), NOW);

    expect(rendered).toContain('STILL BUILDING');
    // The claim never travels without its meaning: this is the line that stops
    // an assistant reading the badge as a recommendation.
    expect(rendered).toContain(STILL_BUILDING_MEANING);
    expect(STILL_BUILDING_MEANING).toMatch(/not a prediction and not a buy signal/);
  });

  it('does not repeat the caveat when nothing claims it', () => {
    const rendered = renderProjects(page([project()]), NOW);
    expect(rendered).not.toContain(STILL_BUILDING_MEANING);
    // The API's own disclaimer still travels with every answer.
    expect(rendered).toContain('not investment advice');
  });

  it('shows the query as HEY read it, so an ignored filter is visible', () => {
    const rendered = renderProjects(
      page([project()], { query: { limit: 24, offset: 0, sort: 'activity' } }),
      NOW,
    );
    expect(rendered).toContain('"sort":"activity"');
  });

  it('says how to get the next page only when there is one', () => {
    expect(renderProjects(page([project()], { total: 100, nextOffset: 24 }), NOW)).toContain(
      'offset=24',
    );
    expect(renderProjects(page([project()]), NOW)).not.toContain('offset=');
  });

  it('an empty result says so and points at the query rather than inventing an answer', () => {
    const rendered = renderProjects(page<HeyProject>([], { total: 0 }), NOW);
    expect(rendered).toContain('No published project matches');
    expect(rendered).toContain('ignored rather than refused');
  });
});

describe('renderProject', () => {
  const detail = (over: Partial<HeyProjectDetail> = {}): HeyProjectDetail => ({
    ...project(),
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    isClaimed: false,
    submitted: false,
    narratives: [{ slug: 'ai-agents', name: 'AI Agents', isPrimary: true }],
    sources: [
      { url: 'https://github.com/org/repo', sourceType: 'GITHUB_REPO', isVerified: true, confidence: 'OFFICIAL' },
    ],
    disclaimer: 'Public, source-backed activity HEY recorded. … not investment advice.',
    ...over,
  });

  it('distinguishes "not measured" from "measured and found nothing"', () => {
    const unmeasured = renderProject(detail(), NOW);
    expect(unmeasured).toContain('has not run its activity measures');
    expect(unmeasured).toContain('different from measuring and finding nothing');
    // No number is invented for the absence.
    expect(unmeasured).not.toMatch(/build momentum/);

    const measured = renderProject(
      detail({
        score: {
          buildMomentum: 0,
          stillBuilding: false,
          calculatedAt: '2026-09-04T00:00:00.000Z',
          scoringVersion: 'hbm-v3',
        },
      }),
      NOW,
    );
    expect(measured).toContain('build momentum 0');
    expect(measured).toContain('hbm-v3');
  });

  it('says market data is context, not a ranking', () => {
    const rendered = renderProject(
      detail({
        market: {
          marketCapUsd: 2_400_000,
          observedAt: '2026-09-05T06:00:00.000Z',
          source: 'geckoterminal',
        },
      }),
      NOW,
    );

    expect(rendered).toContain('$2.40M');
    expect(rendered).toContain('geckoterminal');
    expect(rendered).toContain('never orders projects by price');
  });

  it('lists every source with how it was established', () => {
    const rendered = renderProject(detail(), NOW);
    expect(rendered).toContain('GITHUB_REPO: https://github.com/org/repo (verified)');
  });

  it('states token identity as the chain and contract, and says plainly when there is none', () => {
    const withToken = renderProject(
      detail({ token: { chainId: 4663, contractAddress: '0xabc' } }),
      NOW,
    );
    expect(withToken).toContain('chain 4663, contract 0xabc');

    const tokenless = renderProject(detail(), NOW);
    expect(tokenless).toContain('none recorded');
  });

  it('is explicit about whether ownership was proved or merely claimed', () => {
    expect(renderProject(detail({ isClaimed: true }), NOW)).toContain('claimed by a verified builder');
    expect(renderProject(detail({ submitted: true }), NOW)).toContain('self-reported at submission');
  });
});

describe('renderShips', () => {
  const ship = (over: Partial<HeyShip> = {}): HeyShip => ({
    id: 'ship-1',
    title: 'Agent SDK v0.4',
    eventType: 'SDK_RELEASE',
    publishedAt: '2026-09-03T10:00:00.000Z',
    verification: 'SOURCE_VERIFIED',
    sourceUrl: 'https://github.com/org/repo/releases/tag/v0.4',
    project: project({ symbol: 'AOS' }),
    url: 'https://heyresearch.xyz/project/agentos#ship-ship-1',
    ...over,
  });

  it('gives the agent something to cite, and says how the claim is backed', () => {
    const rendered = renderShips(page([ship()]), NOW);

    expect(rendered).toContain('source: https://github.com/org/repo/releases/tag/v0.4');
    expect(rendered).toContain('source verified');
    expect(rendered).toContain('2 days ago');
  });

  it('does not let a self-reported ship read like a verified one', () => {
    const rendered = renderShips(
      page([ship({ verification: 'SELF_REPORTED', sourceUrl: undefined })]),
      NOW,
    );

    expect(rendered).toContain('self reported');
    expect(rendered).toContain('no public source recorded');
  });
});

/**
 * The renderers the 2026-09-17 audit found untested — which is exactly where
 * its defects were: a series truncated in silence, evidence dropped from a
 * signal, a filter echo missing so a dropped filter read as an answer, and
 * "Still Building" printed without its meaning.
 */
describe('the renderers nothing was watching', () => {
  const NOW = new Date('2026-09-17T12:00:00Z');

  it('says when the day series it prints is shorter than the one it counted', () => {
    const days = Array.from({ length: 90 }, (_, i) => ({
      day: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
      liquidityCloseUsd: 1000 + i,
    }));
    const market = {
      slug: 'agentos',
      name: 'AgentOS',
      symbol: 'AOS',
      token: { chainId: 4663, contractAddress: '0xabc' },
      marketStatus: 'ACTIVE_MARKET',
      verification: 'VERIFIED',
      lifecycle: {},
      checks: [],
      onchainDays: [],
      tvlDays: [],
    };
    const wide = renderTokenMarket({ ...market, days } as never, NOW);
    expect(wide).toContain('Days indexed: 90');
    // The defect: 90 announced, 14 shown, nothing said.
    expect(wide).toMatch(/Showing the 14 most recent/);
    expect(wide).toContain('/api/projects/agentos/market');

    const narrow = renderTokenMarket({ ...market, days: days.slice(0, 5) } as never, NOW);
    expect(narrow).toContain('Days indexed: 5');
    expect(narrow).not.toMatch(/Showing the/);
  });

  it('cites the evidence a signal was read from, not just HEY', () => {
    const page = {
      query: { group: 'development' },
      total: 1,
      items: [
        {
          id: 's1',
          kind: 'development_spike',
          group: 'development',
          label: 'Development spike',
          meaning: 'More commits than usual.',
          severity: 'notable',
          confidence: 0.9,
          importance: 4,
          observedAt: '2026-09-16T00:00:00Z',
          title: 'AgentOS shipped more than usual',
          summary: 'Commits doubled.',
          evidence: [
            { label: 'Commit range', url: 'https://github.com/a/b/compare/x...y' },
            { label: 'HEY observed this on 16 September' },
          ],
          source: 'github_repo',
          project: { slug: 'agentos', name: 'AgentOS', activityStatus: 'SHIPPING', url: 'https://hey/p/agentos' },
          url: 'https://hey/signal/s1',
        },
      ],
    };
    const out = renderSignals(page as never, NOW);
    expect(out).toContain('https://github.com/a/b/compare/x...y');
    // An entry with no URL is HEY's own observation; naming it as a citation would be false.
    expect(out).not.toMatch(/evidence: HEY observed/);
    // And the filter is echoed, so a dropped one is visible rather than inferred.
    expect(out).toContain('Query as HEY read it');
  });

  it('echoes the Radar view it actually applied', () => {
    const page = { query: { filter: 'pons' }, day: '2026-09-17', ranked: 2, total: 2, method: 'Ranked by verified development.', items: [] };
    expect(renderBuilders(page as never, NOW)).toContain('Query as HEY read it');
    // Without an echo the renderer still says the rule, rather than silently promising nothing.
    const noEcho = { day: '2026-09-17', ranked: 0, total: 0, method: 'm', items: [] };
    expect(renderBuilders(noEcho as never, NOW)).toMatch(/ignored rather than refused/);
  });

  it('never prints the Still Building count without saying what it means', () => {
    const report = {
      week: '2026-W38',
      window: { start: '2026-09-14T00:00:00Z', end: '2026-09-21T00:00:00Z' },
      final: true,
      headline: 'A week.',
      overview: { published: 10, verifiedBuilders: 5, ships: 9, projectsShipping: 4, newBuilders: 1, backToShipping: 0, stillBuilding: 4, underTheRadar: 6 },
      chain: { days: 7 },
      shipped: [],
      newBuilders: [],
      backToShipping: [],
      topBuilders: [],
      movers: [],
      signals: [],
      url: 'https://hey/reports/weekly/2026-W38',
    };
    const out = renderWeeklyReport(report as never);
    expect(out).toContain('4 Still Building');
    expect(out).toContain(STILL_BUILDING_MEANING);
  });

  it('renders the weekly rollup instead of handing over raw JSON', () => {
    const agentos = { slug: 'agentos', name: 'AgentOS', symbol: 'AOS', activityStatus: 'SHIPPING', url: 'https://hey/project/agentos' };
    const week: HeyThisWeek = {
      window: { since: '2026-09-10T00:00:00Z', until: '2026-09-17T00:00:00Z', days: 7, label: '7 days to 17 Sep 2026' },
      summary: '12 ships from 5 projects.',
      shipped: { ships: 12, projects: 5, items: [{ project: agentos, ships: 3 }] },
      newBuilders: { total: 0, items: [] },
      backToShipping: { total: 0, items: [] },
      stillBuilding: { total: 2, items: [{ slug: 'darkroute', name: 'DarkRoute', activityStatus: 'SHIPPING', url: 'https://hey/project/darkroute' }] },
      links: { page: 'https://hey/this-week', ships: 'https://hey/ships', radar: 'https://hey/radar', methodology: 'https://hey/methodology' },
      disclaimer: 'Not a recommendation.',
    };
    const out = renderThisWeek(week);
    expect(out).not.toMatch(/^\s*[{[]/);
    expect(out).toContain('Ships: 12 from 5 projects.');
    // The two rules raw JSON slipped past.
    expect(out).toContain(STILL_BUILDING_MEANING);
    expect(out).toMatch(/does not name its provider in this rollup/);
  });

  it('answers an unindexed address plainly, and never as an error', () => {
    const unknown = renderTokenLookup(
      { chainId: 4663, contractAddress: '0xabc', status: 'unknown', scanUrl: 'https://hey/scan?address=0xabc', disclaimer: 'D' } as never,
      NOW,
    );
    expect(unknown).toMatch(/not an error/);
    expect(unknown).toContain('https://hey/scan?address=0xabc');

    const found = renderTokenLookup(
      {
        chainId: 4663,
        contractAddress: '0xabc',
        status: 'published',
        scanUrl: 's',
        disclaimer: 'D',
        project: {
          slug: 'darkroute', name: 'DarkRoute', symbol: 'dark', url: 'https://hey/p/darkroute',
          activityStatus: 'SHIPPING', activityLabel: 'Shipping', activityHelp: 'Shipped in the last 7 days.',
          shipsLast30Days: 4, lastShipAt: '2026-09-16T00:00:00Z',
          lastShip: { title: 'v0.4', publishedAt: '2026-09-16T00:00:00Z', sourceUrl: 'https://github.com/x' },
          badgeUrl: 'b',
        },
      } as never,
      NOW,
    );
    // HEY's own word for the status, never the enum an integrator would mistranslate.
    expect(found).toContain('Shipping');
    expect(found).not.toContain('SHIPPING');
    expect(found).toContain('4 ships in the last 30 days');
    expect(found).toContain('https://github.com/x');
  });
});

/*
 * The weekly rollup, rendered from a captured `/api/this-week` response
 * (2026-09-17). The renderer's first version was written against a shape the
 * API never had and threw on the real one, so every `this_week` call errored;
 * a fixture is what stops the type drifting from the API a second time.
 */
describe('renderThisWeek', () => {
  const week = JSON.parse(readFileSync(new URL('./fixtures/this-week.json', import.meta.url), 'utf8')) as HeyThisWeek;

  it('renders the captured payload without a single undefined', () => {
    const text = renderThisWeek(week);

    expect(text).toContain('# This week on Robinhood Chain (');
    expect(text).toContain('Ships: 2,540 from 597 projects.');
    expect(text).toContain('Newly verified builders: 294.');
    expect(text).toContain('Under the Radar: 38.');
    expect(text).toContain('Genius · shipping — https://heyresearch.xyz/project/genius-ai-77-genius — 1 ship; latest: Active development');
    expect(text).toContain('quiet → shipping on 2026-09-16');
    expect(text).toContain(STILL_BUILDING_MEANING);
    expect(text).toContain('Page: https://heyresearch.xyz/this-week');
    expect(text).not.toMatch(/undefined|\[object|NaN/);
  });

  it('shows ten rows a section and says where the rest are', () => {
    const radar = week.underTheRadar!;
    const long = { ...week, underTheRadar: { total: 38, items: Array.from({ length: 15 }, (_, i) => ({ ...radar.items[0]!, slug: `p${i}`, name: `Project ${i}` })) } };
    const text = renderThisWeek(long);
    const section = text.slice(text.indexOf('Under the Radar:\n'));

    expect(section.split('\n- ')).toHaveLength(11);
    expect(section).toContain('…and 5 more on https://heyresearch.xyz/this-week');
  });
});
