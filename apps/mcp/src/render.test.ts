import { describe, expect, it } from 'vitest';

import type { HeyPage, HeyProject, HeyProjectDetail, HeyShip } from './client';
import { ago, projectLine, renderProject, renderProjects, renderShips, STILL_BUILDING_MEANING } from './render';

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
