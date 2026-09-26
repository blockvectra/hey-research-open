import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { HeyTokenMarket } from '@hey-research/sdk';
import type { HeyAskAnswer, HeyChain, HeyChangesPage, HeyComebacks, HeyCompare, HeyContractChanges, HeySilentBuilders, HeyUnlocks, HeyPage, HeyProject, HeyProjectDetail, HeyProjectIntelligence, HeyShip, HeyThisWeek } from '@hey-research/sdk';
import {
  STILL_BUILDING_MEANING,
  ago,
  projectLine,
  renderAccelerating,
  renderAskAnswer,
  renderBounties,
  renderBuilders,
  renderChain,
  renderChanges,
  renderComebacks,
  renderCompare,
  renderContractChanges,
  renderMarketMoves,
  renderProject,
  renderProjectIntelligence,
  renderProjects,
  renderShips,
  renderSignals,
  renderSilentBuilders,
  renderThisWeek,
  renderTimeline,
  renderTokenLookup,
  renderTokenMarket,
  renderUnlocks,
  renderWeeklyReport,
  stillBuildingEvidence,
  tokenMarketWords,
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

  it('says the token market state in the site’s words, before the figures (2026-09-25)', () => {
    const token = { chainId: 4663, contractAddress: '0xabc' };
    const quiet = projectLine(project({ token, tokenMarket: { status: 'TRADING_INACTIVE', reason: 'launch_pool_no_trades' } }), NOW);
    expect(quiet).toContain('market: trading inactive');
    // The site says "no longer detected" — an observation, not "removed" as a verdict.
    expect(projectLine(project({ token, tokenMarket: { status: 'LIQUIDITY_REMOVED' } }), NOW)).toContain('market: liquidity no longer detected');
    const live = projectLine(project({ token, tokenMarket: { status: 'ACTIVE_MARKET' }, marketCap: { usd: 24_000, source: 'coingecko' } }), NOW);
    expect(live.indexOf('market: active market')).toBeLessThan(live.indexOf('mcap'));
    expect(projectLine(project(), NOW)).not.toContain('market:');
    // A status the table does not know is printed as its own words, not guessed at.
    expect(tokenMarketWords('SOMETHING_NEW')).toBe('something new');
  });

  it('names a launch pool’s own supply for what it is, and dates a figure with no provider (2026-09-25)', () => {
    const inventory = projectLine(project({ liquidity: { usd: 42_000_000, source: 'dexscreener', kind: 'launch_inventory' } }), NOW);
    expect(inventory).toContain('of its own supply in the launch pool — not a market reading (dexscreener)');
    expect(inventory).not.toMatch(/\$42\.0M liquidity/);
    expect(projectLine(project({ liquidity: { usd: 9_000, source: 'onchain', kind: 'market' } }), NOW)).toContain('$9.0K liquidity (onchain)');
    // The token's last recorded depth has no provider: it is dated, never attributed to one.
    const earlier = projectLine(project({ liquidity: { usd: 467, observedAt: '2026-09-03T09:00:00Z', kind: 'market' } }), NOW);
    expect(earlier).toContain('liquidity (last recorded 2 days ago)');
    expect(earlier).not.toContain('undefined');
  });

  it('does not say "no builder signal yet" beside a recorded ship (2026-09-25)', () => {
    const line = projectLine(project({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastShippedAt: '2026-08-05T00:00:00Z' }), NOW);
    expect(line).not.toContain('no builder signal yet');
    expect(line).toContain('last shipped');
    expect(projectLine(project({ activityStatus: 'UNKNOWN', hasBuilderSource: false }), NOW)).toContain('no builder signal yet');
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
    ships: [],
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    firstRecordedByHeyAt: '2026-06-01T00:00:00.000Z',
    isClaimed: false,
    submitted: false,
    narratives: [{ slug: 'ai-agents', name: 'AI Agents', isPrimary: true }],
    sources: [
      { url: 'https://github.com/org/repo', sourceType: 'GITHUB_REPO', isVerified: true, confidence: 'OFFICIAL', contextOnly: false },
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
    detectedAt: '2026-09-03T12:00:00.000Z',
    precision: 'EXACT',
    evidenceId: 'ship:ship-1',
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
      shipped: { ships: 12, projects: 5, items: [{ project: agentos, ships: 3, latest: { title: 'Agent SDK v0.4', eventType: 'SDK_RELEASE', publishedAt: '2026-09-16T10:00:00.000Z', verification: 'SOURCE_VERIFIED' } }] },
      newBuilders: { total: 0, items: [] },
      backToShipping: { total: 0, comparable: 0, items: [] },
      stillBuilding: { total: 2, items: [{ slug: 'darkroute', name: 'DarkRoute', activityStatus: 'SHIPPING', url: 'https://hey/project/darkroute' }] },
      underTheRadar: { total: 0, items: [] },
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
          shipsLast30Days: 4, activityMeasured: true, lastShipAt: '2026-09-16T00:00:00Z',
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
    expect(found).not.toContain('MISMATCH');

    // A builder attached to a contract its own site disowns says so (2026-09-25).
    const mismatch = renderTokenLookup(
      {
        chainId: 4663, contractAddress: '0xabc', status: 'published', scanUrl: 's', disclaimer: 'D',
        project: {
          slug: 'x', name: 'X', url: 'u', activityStatus: 'SHIPPING', activityLabel: 'Shipping', activityHelp: 'h',
          shipsLast30Days: 1, activityMeasured: true, tokenVerification: { status: 'MISMATCH', reason: 'site_names_another_contract' }, badgeUrl: 'b',
        },
      },
      NOW,
    );
    expect(mismatch).toContain('MISMATCH: the project’s own site names a different contract');

    // A zero HEY did not measure is not printed as one (2026-09-26).
    const unmeasured = renderTokenLookup(
      {
        chainId: 4663, contractAddress: '0xabc', status: 'published', scanUrl: 's', disclaimer: 'D',
        project: {
          slug: 'x', name: 'X', url: 'u', activityStatus: 'UNKNOWN', activityLabel: 'Activity unknown', activityHelp: 'h',
          shipsLast30Days: 0, activityMeasured: false, tokenVerification: { status: 'UNVERIFIED' }, badgeUrl: 'b',
        },
      },
      NOW,
    );
    expect(unmeasured).toContain('UNKNOWN activity');
    expect(unmeasured).not.toContain('0 ships');
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

describe('Still Building evidence (round-7 audit 2026-09-18)', () => {
  /*
   * The API has sent `stillBuildingEvidence` beside `stillBuilding: true`
   * since 2026-09-17 and the client dropped it, so an agent could repeat the
   * badge without the drawdown and the ships that make it a claim. Two facts
   * in a clause, and no word that reads as a verdict.
   */
  const evidenced = { stillBuilding: true, stillBuildingEvidence: { drawdownPercent: 62.4, shipsSinceDecline: 5 } };

  it('states the drawdown and the ships since, as facts', () => {
    expect(stillBuildingEvidence(evidenced)).toBe('down 62% from the HEY-tracked high, 5 verified ships since');
    expect(stillBuildingEvidence({ stillBuildingEvidence: { drawdownPercent: -40, shipsSinceDecline: 1 } })).toBe('down 40% from the HEY-tracked high, 1 verified ship since');
    expect(stillBuildingEvidence({ stillBuildingEvidence: { drawdownPercent: 55 } })).toBe('down 55% from the HEY-tracked high');
    expect(stillBuildingEvidence({})).toBeUndefined();
  });

  it('travels with the badge on the listing line and in the dossier', () => {
    const line = projectLine(project(evidenced), NOW);
    expect(line).toContain('STILL BUILDING (down 62% from the HEY-tracked high, 5 verified ships since)');

    const dossier = renderProject(
      { ...project(evidenced), ships: [], firstSeenAt: '2026-06-01T00:00:00.000Z', firstRecordedByHeyAt: '2026-06-01T00:00:00.000Z', isClaimed: false, submitted: false, narratives: [], sources: [], disclaimer: 'not investment advice' },
      NOW,
    );
    expect(dossier).toContain(STILL_BUILDING_MEANING);
    expect(dossier).toContain('Still Building evidence: down 62% from the HEY-tracked high, 5 verified ships since.');
    for (const forbidden of ['buy', 'invest', 'undervalued', 'price target', 'predict', 'resilient', 'strong']) {
      expect(stillBuildingEvidence(evidenced)).not.toContain(forbidden);
    }
  });

  it('prints the bare badge when the API sent no evidence, and never invents one', () => {
    expect(projectLine(project({ stillBuilding: true }), NOW)).toMatch(/STILL BUILDING(?! \()/);
    expect(projectLine(project({ stillBuilding: true }), NOW)).not.toContain('HEY-tracked high');
  });
});

describe('renderProjectIntelligence (2026-09-24)', () => {
  const base: HeyProjectIntelligence = {
    project: project({ lastShippedAt: '2026-09-23T10:00:00.000Z' }),
    signals: [],
    urls: { page: 'https://heyresearch.xyz/project/agentos', detail: 'https://heyresearch.xyz/api/projects/agentos' },
    disclaimer: 'Not investment advice.',
  };
  const development: NonNullable<HeyProjectIntelligence['development']> = {
    rulesVersion: 'intel-v3',
    computedAt: '2026-09-24T12:00:00.000Z',
    observedSince: '2026-03-01T00:00:00.000Z',
    activityMeasured: true,
    velocity: { windowDays: 30, current: 6, previous: 2, changePct: 200, state: 'ACCELERATING' },
    cadence: { state: 'MEASURED', releases: 8, lookbackDays: 365, medianIntervalDays: 6, currentIntervalDays: 3.5, previousIntervalDays: 18, direction: 'FASTER', daysSinceLastRelease: 1 },
    consistency: { activeWeeks: 9, windowWeeks: 12, currentStreakWeeks: 4, longestStreakWeeks: 6, daysSinceMeaningfulShip: 1, longestSilenceDays: 40, resumptions: 0 },
    discoveryLag: { state: 'MEASURED', samples: 7, windowDays: 90, medianHours: 3, maxHours: 20 },
    marketAttention: 'VERY_LOW',
    changes: { windowDays: 30, buildMomentum: { current: 64, previous: 41, sameRules: true }, liquidityUsd: { current: 85_000, previous: 82_000 }, marketAttention: { current: 'VERY_LOW', previous: 'TYPICAL' }, cadenceDays: { current: 6, previous: 12 } },
  };

  it('tags every line as a fact, a derived figure or unknown', () => {
    const text = renderProjectIntelligence({ ...base, development });
    expect(text).toContain('DERIVED build velocity: accelerating — 6 meaningful events in the last 30 days against 2 in the 30 before (+200%).');
    expect(text).toContain('DERIVED release cadence: a release day every 6 days');
    expect(text).toContain('FACT Build Momentum 41 → 64 over 30 days.');
    expect(text).toMatch(/market attention \(context only, never an input/);
    expect(text).toContain('DERIVED market attention typical → very low over 30 days (context only).');
    expect(text).toContain('DERIVED release cadence every 12 → every 6 days over 30 days.');
    expect(text).toContain('not a buy signal');
    const body = text.split('\n').filter((line) => /^(FACT|DERIVED|UNKNOWN) /.test(line));
    expect(body.length).toBeGreaterThanOrEqual(8);
  });

  it('says unknown, not zero, where HEY does not hold enough', () => {
    const text = renderProjectIntelligence({
      ...base,
      development: {
        ...development,
        velocity: { windowDays: 30, current: 1, previous: null, changePct: null, state: 'NEW' },
        cadence: { state: 'INSUFFICIENT_RELEASES', releases: 1, lookbackDays: 365, daysSinceLastRelease: 3 },
        consistency: { ...development.consistency, activeWeeks: null },
        discoveryLag: { state: 'INSUFFICIENT_SAMPLES', samples: 1, windowDays: 90 },
        marketAttention: null,
        changes: { windowDays: 30, buildMomentum: { current: 12, previous: null, sameRules: false }, liquidityUsd: { current: null, previous: null }, marketAttention: { current: null, previous: null }, cadenceDays: { current: null, previous: null } },
      },
    });
    expect(text).toMatch(/UNKNOWN build velocity/);
    expect(text).toMatch(/UNKNOWN release cadence: 1 release day in 365 days; three are needed/);
    expect(text).toMatch(/UNKNOWN consistency/);
    expect(text).toMatch(/UNKNOWN discovery lag/);
    expect(text).toMatch(/UNKNOWN market attention/);
    expect(text).toMatch(/UNKNOWN Build Momentum change over 30 days: HEY holds no earlier reading/);
    expect(renderProjectIntelligence(base)).toMatch(/UNKNOWN development intelligence/);
  });
});

describe('renderAskAnswer and renderContractChanges (2026-09-24)', () => {
  it('keeps each line’s tag and source, and the price notice first', () => {
    const answer: HeyAskAnswer = {
      project: { slug: 'agentos', name: 'AgentOS', url: 'https://heyresearch.xyz/project/agentos' },
      question: 'should I buy before the release?',
      notice: { tag: 'FACT', text: 'HEY does not predict prices or say whether to buy or sell.' },
      fallback: false,
      sections: [{ question: 'What releases occurred?', lines: [{ tag: 'FACT', text: '2026-09-21 · v2.0', source: 'https://github.com/a/b' }, { tag: 'UNKNOWN', text: 'Release cadence: not enough releases yet.' }] }],
      disclaimer: 'Not investment advice.',
    };
    const text = renderAskAnswer(answer);
    expect(text.indexOf('FACT HEY does not predict')).toBeLessThan(text.indexOf('## What releases occurred?'));
    expect(text).toContain('FACT 2026-09-21 · v2.0 (source: https://github.com/a/b)');
    expect(text).toContain('UNKNOWN Release cadence');
  });

  it('names counted deployments and the signatures an interface gained or lost', () => {
    const page: HeyContractChanges = {
      days: 30,
      items: [
        { id: 'ship:1', kind: 'CONTRACT_DEPLOY_FOLLOWUP', project: { slug: 'equifold', name: 'Equifold' }, count: 208, latest: { title: 'Deployed a new contract: 0x0407…efa4', publishedAt: '2026-09-23T00:00:00.000Z' } },
        { id: 'abi:2', kind: 'INTERFACE_CHANGED', project: { slug: 'vault', name: 'Vault' }, address: '0xabc', functionsAdded: ['withdraw(uint256)'], functionsRemoved: [], eventsAdded: [], eventsRemoved: [], detectedAt: '2026-09-22T00:00:00.000Z', source: 'https://explorer/address/0xabc' },
      ],
      total: 2,
      truncated: false,
      disclaimer: 'd',
    };
    const text = renderContractChanges(page);
    expect(text).toContain('Equifold (equifold): 208 new contracts');
    expect(text).toContain('functions added: withdraw(uint256)');
    expect(renderContractChanges({ days: 7, items: [], total: 0, truncated: false, disclaimer: 'd' })).toMatch(/No evidence-backed contract change in the last 7 days/);
  });
});

describe('command centre renderers (2026-09-24)', () => {
  it('names quiet builders without a price view, and says so', () => {
    const page: HeySilentBuilders = { items: [{ slug: 'a', name: 'A', activityStatus: 'SHIPPING', url: 'https://h/project/a', meaningfulShips30d: 2, marketAttention: 'VERY_LOW' }], total: 1, truncated: false, method: 'm', disclaimer: 'd' };
    const text = renderSilentBuilders(page);
    expect(text).toContain('A — 2 verified ships in 30 days, market attention very low');
    expect(text).toContain('not a buy signal');
  });

  it('marks unlocks SCHEDULED with their proof', () => {
    const page: HeyUnlocks = { days: 30, items: [{ project: { slug: 'a', name: 'A', activityStatus: 'ACTIVE', url: 'u' }, lockId: 7, unlockAt: '2026-10-01T00:00:00.000Z', assetKind: 'TOKEN', lockedTokens: 1000, shareOfSupplyPct: 10, proof: 'https://hoodlock.tech/proof/lock/7', precision: 'SCHEDULED', id: 'lock:4663:7' }], total: 1, truncated: false, scope: 'hoodlock', disclaimer: 'd' };
    expect(renderUnlocks(page)).toContain('SCHEDULED 2026-10-01 00:00 UTC · A · lock #7 · 1,000 tokens (10% of recorded supply) — proof https://hoodlock.tech/proof/lock/7');
  });

  it('compares with UNKNOWN where a figure is not measured, and names no winner', () => {
    const page: HeyCompare = {
      projects: [
        { slug: 'a', name: 'A', url: 'u', activityStatus: 'SHIPPING', verifiedBuilder: true, sources: { verified: 1, total: 2 } },
        { slug: 'b', name: 'B', url: 'u', activityStatus: 'QUIET', buildMomentum: 12, verifiedBuilder: false, sources: { verified: 0, total: 1 }, marketCapUsd: 5000 },
      ],
      missing: ['c'],
      ignoredSlugs: [],
      method: 'No winner.',
      disclaimer: 'd',
    };
    const text = renderCompare(page);
    // No kind sent: a market cap, as before.
    expect(text).toContain('FACT market cap 5,000 USD (context)');
    const fdv = renderCompare({ ...page, projects: [{ ...page.projects[1]!, valuationKind: 'fdv', liquidityUsd: 42_000_000, liquidityKind: 'launch_inventory' }] });
    // By the kind the API sends, never by comparing figures (2026-09-25).
    expect(fdv).toContain('FACT fully diluted valuation 5,000 USD (context)');
    expect(fdv).not.toContain('market cap');
    expect(fdv).toContain('launch pool holds 42,000,000 USD of its own supply — not a market reading');
    expect(text).toContain('UNKNOWN Build Momentum: not measured');
    expect(text).toContain('FACT Build Momentum 12');
    expect(text).toContain('Not published: c.');
    expect(text.toLowerCase()).not.toMatch(/winner is|better|best/);
  });
});

describe('acceleration and market moves (2026-09-24)', () => {
  it('names builders shipping faster as derived, with both windows', () => {
    const text = renderAccelerating({
      items: [{ slug: 'faster', name: 'Faster', activityStatus: 'SHIPPING', lastShipAt: '2026-09-22T00:00:00.000Z', url: 'https://heyresearch.xyz/project/faster', velocity: { windowDays: 30, current: 5, previous: 1, changePct: 400 } }],
      method: 'Build velocity ACCELERATING.',
      disclaimer: 'Not advice.',
    });
    expect(text).toContain('DERIVED Faster — 5 meaningful events in 30 days vs 1 before');
    expect(text).not.toMatch(/\bbuy\b(?! signal)/i);
  });

  it('lists a move with what came before it, and says it is a sequence', () => {
    const text = renderMarketMoves({
      project: { slug: 'mover', name: 'Mover', url: 'https://heyresearch.xyz/project/mover' },
      threshold: { minChangePct: 25, lookbackDays: 7, windowDays: 90 },
      daysRead: 30,
      items: [{ day: '2026-09-14', previousDay: '2026-09-13', changePct: 50, marketCapUsd: 156000, previousMarketCapUsd: 104000, eventsBefore: [{ title: 'v2 released', eventType: 'GITHUB_RELEASE', publishedAt: '2026-09-11T10:00:00.000Z', verification: 'PUBLICLY_VERIFIED', source: 'https://github.com/x/y' }] }],
      method: 'Day-on-day moves.',
      disclaimer: 'Not advice.',
    });
    // No kind: HEY does not know the supply, so it says "valuation" and claims neither measure (2026-09-25).
    expect(text).toContain('FACT 2026-09-14: valuation +50% on 2026-09-13 (104,000 → 156,000 USD)');
    expect(text).toContain('FACT 2026-09-11 · v2 released — https://github.com/x/y');
    expect(text).toContain('A sequence, never a cause.');
  });

  it('names a move in a fully diluted valuation as one, never as a market cap', () => {
    const base = { day: '2026-09-14', previousDay: '2026-09-13', changePct: 50, marketCapUsd: 156000, previousMarketCapUsd: 104000, eventsBefore: [] };
    const page = { project: { slug: 'm', name: 'M', url: 'u' }, threshold: { minChangePct: 25, lookbackDays: 7, windowDays: 90 }, daysRead: 30, method: 'm', disclaimer: 'd' };
    const fdv = renderMarketMoves({ ...page, items: [{ ...base, valuationKind: 'fdv' }] });
    expect(fdv).toContain('FACT 2026-09-14: FDV +50%');
    expect(fdv).not.toContain('market cap');
    expect(renderMarketMoves({ ...page, items: [{ ...base, valuationKind: 'marketCap' }] })).toContain('FACT 2026-09-14: market cap +50%');
  });

  it('says unknown, not zero, without a daily index', () => {
    const text = renderMarketMoves({ project: { slug: 'm', name: 'M', url: 'u' }, threshold: { minChangePct: 25, lookbackDays: 7, windowDays: 90 }, daysRead: 0, items: [], method: 'm', disclaimer: 'd' });
    expect(text).toContain('UNKNOWN HEY holds too few daily market readings');
  });
});

describe('market integrity rendering (2026-09-25)', () => {
  it('puts the builder first, tags every line, and never says rug, scam or safe', async () => {
    const { renderMarketIntegrity } = await import('./render');
    const out = renderMarketIntegrity({
      slug: 'drained',
      url: 'https://heyresearch.xyz/project/drained',
      builderActivity: { status: 'SHIPPING', lastMeaningfulShipAt: '2026-09-24T10:00:00Z' },
      note: 'Market integrity describes the tracked token market, not whether development has stopped.',
      marketIntegrity: {
        rulesVersion: 'mi-v1', evaluatedAt: '2026-09-25T00:00:00Z', state: 'LIQUIDITY_REMOVED', marketActive: false, established: true, collapse: 'SEVERE',
        liquidityPeakUsd: 82_000, liquidityPeakDay: '2026-09-10', liquidityNowUsd: 1_129, liquidityNowDay: '2026-09-24', liquidityChangePct: -98.6,
        deteriorationStartDay: '2026-09-20', collapseDay: '2026-09-21', lastTradeDay: '2026-09-20', migrationDetected: false, migration: null, lockState: 'NONE', sourcesDisagree: false,
      },
      conflicts: [{ type: 'BUILDER_ACTIVE_MARKET_GONE', text: 'HEY observed recent builder activity while the tracked token market had already lost most of its liquidity.' }],
      events: [],
    });
    expect(out.split('\n')[2]).toMatch(/^FACT builder activity: shipping/);
    expect(out).toContain('DERIVED no verified replacement pool');
    expect(out).toContain('not whether development has stopped');
    expect(out.toLowerCase()).not.toMatch(/\brug|scam|\bsafe\b/);
  });
});

describe('renderTokenMarket: pools, the deployer and the supply (2026-09-25)', () => {
  const NOW = new Date('2026-09-25T12:00:00Z');
  const market: HeyTokenMarket = {
    slug: 'agentos',
    name: 'AgentOS',
    symbol: 'AOS',
    token: { chainId: 4663, contractAddress: '0xabc' },
    marketStatus: 'TRADING_INACTIVE',
    marketStatusReason: 'launch_pool_no_trades',
    verification: 'VERIFIED',
    days: [],
    lifecycle: {},
    checks: [],
    onchainDays: [],
    tvlDays: [],
    url: 'https://heyresearch.xyz/project/agentos/market',
    disclaimer: '…',
  };

  it('says the status and its reason in words', () => {
    expect(renderTokenMarket(market, NOW)).toContain('Market status: trading inactive (launch pool no trades)');
  });

  it('prints the pools and how much can be sold before the price moves', () => {
    const text = renderTokenMarket({ ...market, pools: { day: '2026-09-24', observedAt: '2026-09-24T23:00:00Z', pools: 2, liquidityUsd: 40_000, depthOnePctUsd: 350 } }, NOW);
    expect(text).toContain('Pools (read from the chain, 2026-09-24): 2 pools, liquidity $40.0K, about $350 can be sold before the price moves 1%.');
  });

  it('names the deployer as a fact about the contract, and a shared one as a launch service', () => {
    const text = renderTokenMarket({ ...market, contract: { deployer: '0xdep', deployerShared: true, createdAt: '2026-08-01T12:00:00.000Z', creationTx: '0xtx' } }, NOW);
    expect(text).toContain('Contract: deployed by 0xdep (a deployer that launched other projects HEY tracks: a launch service, not one team), created 2026-08-01, in transaction 0xtx.');
    // The closing sentence no longer claims no address is named.
    expect(text).toContain('no address but the contract’s deployer is named');
    expect(renderTokenMarket(market, NOW)).toContain('no address is named, scored, ranked or followed');
    expect(renderTokenMarket(market, NOW)).not.toContain('Contract: deployed');
  });

  it('summarises the supply without an address', () => {
    const text = renderTokenMarket(
      { ...market, distribution: { day: '2026-09-24', observedAt: '2026-09-24T20:00:00Z', holdersTotal: 1_830, top10SharePct: 41.24, top50SharePct: 63.9, burnedSharePct: 5, pooledSharePct: 12.4 } },
      NOW,
    );
    expect(text).toContain('1,830 holders, largest 10 balances hold 41.2%, largest 50 hold 63.9%, 5% burned, 12.4% in pools');
  });

  it("says an empty read is no balance change in the provider's window, beside the last map (2026-09-25)", () => {
    const note = "No balance change in the provider's window. The holder source reports balances that moved in about the last 9 days, and none of this token's did. That is not the same as no holders.";
    const distributionRead = { outcome: 'no_balance_change_in_window' as const, checkedAt: '2026-09-25T03:00:00Z', note };
    const kept = renderTokenMarket(
      { ...market, distribution: { day: '2026-09-18', observedAt: '2026-09-18T03:00:00Z', holdersTotal: 1_403 }, distributionRead },
      NOW,
    );
    expect(kept).toContain('1,403 holders');
    expect(kept).toContain(`Latest distribution read (2026-09-25): ${note} The snapshot above is from 2026-09-18.`);
    const none = renderTokenMarket({ ...market, distributionRead }, NOW);
    expect(none).toContain(`Distribution (2026-09-25): ${note}`);
    // A run that produced the map says nothing extra.
    expect(renderTokenMarket({ ...market, distributionRead: { outcome: 'mapped', checkedAt: '2026-09-25T03:00:00Z' } }, NOW)).not.toContain('Latest distribution read');
  });
});

describe('every listing says what it showed of the whole, and how to read on (2026-09-26, M2 G3)', () => {
  const signal = (id: string) => ({ id, kind: 'development_spike', group: 'development', label: 'Development spike', meaning: 'm', severity: 'notable', confidence: 0.9, importance: 70, observedAt: '2026-09-05T00:00:00.000Z', detectedAt: '2026-09-05T00:10:00.000Z', title: 't', summary: 's', evidence: [], source: 'ship_events', project: { slug: 'a', name: 'A', activityStatus: 'SHIPPING', url: 'u' }, url: 'u' });

  it('list_signals: shown of total, and the offset that reads the rest', () => {
    const text = renderSignals({ query: { offset: 0, limit: 2 }, total: 6011, nextOffset: 2, items: [signal('1'), signal('2')], disclaimer: 'd' }, NOW);
    expect(text).toContain('Showing 2 of 6011. For the rest, call list_signals again with offset=2.');
    const all = renderSignals({ query: {}, total: 1, items: [signal('1')], disclaimer: 'd' }, NOW);
    expect(all).toContain('Showing all 1.');
  });

  it('list_builders: shown of total, and the offset that reads the rest', () => {
    const builder = { slug: 'a', name: 'A', rank: 1, scores: { overall: 80, development: 70, onchain: 60, research: 90 }, activityStatus: 'SHIPPING', url: 'u' };
    const text = renderBuilders({ day: '2026-09-05', ranked: 715, total: 715, query: { offset: 25 }, method: 'm', items: [builder] as never, disclaimer: 'd' }, NOW);
    expect(text).toContain('Showing 1 of 715. For the rest, call list_builders again with offset=26.');
  });

  it('project_timeline: shown of the total, and the before cursor for older entries', () => {
    const entry = (i: number) => ({ id: `ship:${i}`, kind: 'release', at: '2026-09-01T10:00:00.000Z', precision: 'EXACT' as const, title: `v${i}`, countsAsBuilding: true });
    const timeline = {
      project: { slug: 'equifold', name: 'Equifold', url: 'https://heyresearch.xyz/project/equifold' },
      lens: 'everything',
      items: [entry(1), entry(2)],
      totals: { ships: 408, contractSource: 0, locks: 0, resumed: 0, marketIntegrity: 0, verification: 0 },
      total: 408,
      truncated: true,
      nextCursor: 'CURSOR',
      disclaimer: 'd',
    };
    const text = renderTimeline(timeline);
    expect(text).toContain('- EXACT 2026-09-01 · release · v1');
    expect(text).toContain('Showing 2 of 408. For older entries, call project_timeline again with before=CURSOR.');
    // Cut by the renderer too: said, with how to page instead.
    expect(renderTimeline(timeline, 1)).toContain('Showing 1 of 408. Call project_timeline again with limit=1 and follow the before= cursor it gives to read on.');
    expect(renderTimeline({ ...timeline, items: [], totals: { ...timeline.totals, ships: 0 }, total: 0, truncated: false, nextCursor: null })).toContain('Nothing HEY holds falls under this lens.');
  });

  it('contract_changes: says how many it showed, and that the route caps each kind', () => {
    const one: HeyContractChanges = { days: 30, items: [{ kind: 'VERIFIED', address: '0xabc', functionsAdded: [], functionsRemoved: [], eventsAdded: [], eventsRemoved: [], detectedAt: '2026-09-04T00:00:00.000Z', source: 'https://explorer/x', project: { slug: 'a', name: 'A' } }] as never, total: 1, truncated: false, disclaimer: 'd' };
    expect(renderContractChanges(one)).toContain('Showing 1.');
    const many: HeyContractChanges = { ...one, items: Array.from({ length: 100 }, () => one.items[0]!), total: 100 };
    expect(renderContractChanges(many)).toContain('at most 100 changes of each kind');
  });
});

describe('renderers without a test until 2026-09-26 (M2 G10)', () => {
  it('renderChain prints each day’s aggregates and names nobody', () => {
    const chain: HeyChain = { chainId: 4663, days: [{ day: '2026-09-04', dexTrades: 1200, projectsPublished: 3, ships: 12, buildersShipping: 7 }], volumeNote: 'Volume is decoded DEX trades.', disclaimer: 'd' };
    const text = renderChain(chain);
    expect(text).toContain('2026-09-04');
    expect(text).toContain('3 projects published');
    expect(text).toContain('12 verified ships from 7 builders');
    expect(text).toContain('nobody is named');
  });

  it('renderComebacks lists the resuming projects with their method, or says there are none', () => {
    const page: HeyComebacks = { items: [{ slug: 'a', name: 'A', activityStatus: 'RESUMED', url: 'https://h/project/a', lastShipAt: '2026-09-03T00:00:00.000Z' }] as never, method: 'Status RESUMED.', total: 1, truncated: false, disclaimer: 'd' };
    expect(renderComebacks(page)).toContain('- A, last ship 2026-09-03 — https://h/project/a');
    expect(renderComebacks(page)).toContain('Method: Status RESUMED.');
    expect(renderComebacks({ ...page, items: [] })).toContain('No project is resuming right now.');
  });

  it('renderBounties says claiming happens on the site, and when bounties are closed', () => {
    const rules = { claim: 'Sign in with a wallet on the site.', review: 'A moderator reviews it.' };
    expect(renderBounties({ open: false, items: [], rules, disclaimer: 'd' } as never)).toContain('closed right now');
    const bounty = { id: 'b1', url: 'https://h/bounties/b1', title: 'Map sources', description: '', kind: 'k', scope: 's', evidence: 'e', status: 'OPEN', taskStatus: 'OPEN', reward: { hey: '1000', heyBaseUnits: '1', targetUsd: '5' }, claim: { claimed: false, openToAll: true } };
    const text = renderBounties({ open: true, query: { status: 'open', limit: 50 }, summary: { openBounties: 1, committedHey: '1000', paidHey: '0' }, items: [bounty], rules, disclaimer: 'd' } as never, NOW);
    expect(text).toContain('Map sources [OPEN] · reward 1,000 HEY (≈ $5 at quote) · unclaimed, open to any wallet sign-in');
    expect(text).toContain('How claiming works: Sign in with a wallet on the site.');
  });
});

describe('renderChanges (2026-09-26)', () => {
  const upsert = {
    id: 'state:p:activity_status:9',
    revision: 1,
    op: 'upsert' as const,
    type: 'build.dormant' as const,
    domain: 'build' as const,
    origin: 'live' as const,
    project: { slug: 'arrow', name: 'Arrow', url: 'https://h/project/arrow' },
    occurredAt: null,
    precision: 'OBSERVED' as const,
    detectedAt: '2026-09-04T01:00:00.000Z',
    recordedAt: '2026-09-04T01:05:00.000Z',
    summary: 'Activity status moved from Shipping to Dormant',
    before: 'SHIPPING',
    after: 'DORMANT',
    evidence: [{ id: 'state:p:activity_status:9', label: 'HEY state record' }],
    source: 'hey_state',
    links: { project: 'p', evidence: 'e', timeline: 't' },
  };
  const ledger = { collectionStart: '2026-09-26T00:00:00.000Z', transitionsFrom: '2026-09-26T00:00:00.000Z', newestRecordedAt: null, projectorRanAt: '2026-09-26T10:00:00.000Z' };

  it('never gives an event a source time it does not have, and says how to read on', () => {
    const page: HeyChangesPage = { query: { mode: 'browse', limit: 1 }, items: [upsert], nextCursor: 'NEXT', hasMore: true, ledger, disclaimer: 'd' };
    const text = renderChanges(page);
    expect(text).toContain('OBSERVED (no source time; HEY saw it 2026-09-04) · build.dormant · Arrow (arrow): Activity status moved from Shipping to Dormant (SHIPPING → DORMANT)');
    expect(text).toContain('Showing 1; more exist. Call get_changes again with before=NEXT.');
    expect(text).toContain('status and market moves recorded from 2026-09-26 (none earlier exist)');
    expect(text.toLowerCase()).not.toMatch(/because|caused|buy/);
  });

  it('says a retraction is gone and names nothing else; a sync keeps its cursor', () => {
    const page: HeyChangesPage = { query: { mode: 'sync', after: 'c1.0', limit: 50 }, items: [{ id: 'ship:x', revision: 2, op: 'retract', recordedAt: '2026-09-05T00:00:00.000Z' }], nextCursor: 'KEEP', hasMore: false, ledger, disclaimer: 'd' };
    const text = renderChanges(page);
    expect(text).toContain('- RETRACTED ship:x (revision 2, 2026-09-05 00:00 UTC): HEY no longer makes this claim; drop it.');
    expect(text).toContain('Showing 1; that is the end of this sync (keep the cursor to read what comes next). Cursor: KEEP.');
  });
});
