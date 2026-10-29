import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { cardPreviewFacts, ProjectCard, type ProjectCardData } from './project-card';
import { PROJECT_LIST_COLUMNS, ProjectList, ProjectListRow } from './project-list';
import { shipWeekHeights, shipWeeksSentence, ShipWeeksChart, type ShipWeekSeriesData } from './ship-weeks';

/*
 * The builder list (V2, founder 2026-10-29; CLAUDE.md UI rule 14 amended): the card-fact rules hold for a row exactly
 * as for a card — the same ticker rule, the same R5 valuation rule, the same three separate facts — and the 8-week
 * chart keeps "not observed" apart from a measured zero.
 */
const ADDRESS = '0x82aE0000000000000000000000000000000091bF';
const NOW = new Date('2026-10-29T12:00:00Z');

const measured: ProjectCardData = {
  slug: 'agentos',
  name: 'AgentOS',
  symbol: 'AOS',
  projectKind: 'UTILITY',
  activityStatus: 'SHIPPING',
  marketCapUsd: 1_240_000,
  volume24hUsd: 25_000,
  token: { chainId: 4663, contractAddress: ADDRESS },
  tokenVerification: 'VERIFIED',
  tokenMarketStatus: 'ACTIVE_MARKET',
  tokenMarketReason: 'liquidity_and_volume',
  primaryNarrative: { slug: 'ai-agents', name: 'AI Agents' },
  latestShip: { id: 'ship-1', title: 'SDK v0.4', eventType: 'GITHUB_RELEASE', publishedAt: new Date('2026-10-27T12:00:00Z') },
  lastMeaningfulShipAt: new Date('2026-10-27T12:00:00Z'),
};

const weeks = (ships: (number | null)[]): ShipWeekSeriesData => ({
  weeks: ships.map((count, index) => ({ week: `2026-09-${String(7 + index).padStart(2, '0')}`, ships: count })),
  total: ships.reduce<number>((sum, count) => sum + (count ?? 0), 0),
  observed: ships.filter((count) => count !== null).length,
});

const row = (project: ProjectCardData, extra: Partial<Parameters<typeof ProjectListRow>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ProjectList, { caption: 'Projects', children: createElement(ProjectListRow, { project, now: NOW, weeks: weeks([0, 1, 0, 2, 0, 0, 0, 1]), ...extra }) }),
  );

const preview = () => createElement('button', { type: 'button', 'data-testid': 'card-preview' }, 'Preview') as ReactNode;

describe('a builder list row', () => {
  it('prints the founder’s columns in order, the name as the one link', () => {
    const html = row(measured, { preview });
    for (const column of PROJECT_LIST_COLUMNS) expect(html).toContain(column);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/project/agentos"');
    expect(html).toContain('data-testid="ticker"');
    expect(html).toContain('AI Agents');
    // The card's own phrase for a release (`cardShipPhrase`): "Release v0.4".
    expect(html).toContain('Release v0.4');
    expect(html).toContain('Project names this contract');
    expect(html).toContain('$1.2M');
  });

  it('never nests an interactive element: the Preview button is its own cell, outside the link', () => {
    const html = row(measured, { preview });
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<button/s);
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<a /s);
    expect(html).toMatch(/<td role="cell" class="v2-col-preview v2-cell-preview"><button/);
  });

  it('prints the same facts as the card and the preview: one builder for all three', () => {
    const facts = cardPreviewFacts(measured, { now: NOW });
    const html = row(measured);
    expect(html).toContain(facts.verification!.label);
    expect(html).toContain(facts.market.value!);
    expect(html).toContain(facts.latest!.when);
  });

  it('drops the ticker of a token that is not the project’s (cardTokenNotTheProjects), as the card does', () => {
    for (const notTheProjects of [{ tokenVerification: 'MISMATCH' }, { tokenVerificationReason: 'site_disclaims_contract' }]) {
      const html = row({ ...measured, ...notTheProjects });
      expect(html).not.toContain('data-testid="ticker"');
      expect(html).not.toContain('data-testid="market-cap"');
      const card = renderToStaticMarkup(createElement(ProjectCard, { project: { ...measured, ...notTheProjects } }));
      expect(card).not.toContain('data-testid="ticker"');
    }
  });

  it('prints a valuation only where R5 allows; otherwise the cell is empty, never 0 or a placeholder', () => {
    const unmeasured: ProjectCardData[] = [
      { ...measured, tokenMarketStatus: 'LOW_LIQUIDITY', tokenMarketReason: 'liquidity_below_floor' },
      { ...measured, tokenMarketStatus: 'TRADING_INACTIVE', tokenMarketReason: 'no_volume' },
      { ...measured, tokenMarketReason: 'launch_pool_trading' },
      { ...measured, volume24hUsd: 300 },
      { ...measured, tokenVerification: 'UNVERIFIED', tokenTickerContested: true },
      { ...measured, valuationImplausible: 'valuation_over_liquidity' },
    ];
    for (const project of unmeasured) {
      const html = row(project);
      expect(html).not.toContain('data-testid="market-cap"');
      expect(html).not.toMatch(/\$0\b/);
      expect(html).not.toContain('Withheld');
      expect(html).toMatch(/<td role="cell" class="v2-col-value v2-cell-value"><\/td>/);
    }
  });

  it('keeps development, the token check and the market as three separate cells', () => {
    const html = row({ ...measured, tokenVerification: 'UNVERIFIED' });
    expect(html).toContain('data-activity-status="SHIPPING"');
    expect(html).toMatch(/data-testid="row-token-check"><span class="text-hey-muted" data-verification="UNVERIFIED">Not named by the project<\/span><\/td>/);
    const tokenless = row({ ...measured, token: undefined, symbol: undefined, marketCapUsd: undefined });
    expect(tokenless).toContain('No token tracked');
    expect(tokenless).toContain('data-has-token="false"');
    const unread = row({ ...measured, tokenVerification: undefined });
    expect(unread).toContain('Not checked');
  });

  it('names a project with no counted ship as a reading of HEY’s record, never a blank', () => {
    const html = row({ ...measured, latestShip: undefined, lastMeaningfulShipAt: undefined, activityStatus: 'UNKNOWN' });
    expect(html).toContain('No counted ship on record');
  });

  it('draws "Not read" when the batched read did not answer, never an empty chart', () => {
    const html = row(measured, { weeks: undefined });
    expect(html).toContain('data-state="not-read"');
    expect(html).toContain('Not read');
  });

  it('carries the brand notice and HEY’s own disclosure, as the card does', () => {
    const html = row({ ...measured, brandNotice: { kind: 'robinhood_brand', title: 'No known affiliation with Robinhood', detail: 'x' } }, { disclosure: 'HEY’s own project — researched by the same rules' });
    expect(html).toContain('data-testid="brand-notice"');
    expect(html).toContain('data-testid="heys-own-token"');
  });
});

describe('the 8-week chart', () => {
  it('keeps a week not observed apart from a measured zero, in the marks and in the words', () => {
    const series = weeks([null, null, 0, 1, 0, 0, 2, 0]);
    const html = renderToStaticMarkup(createElement(ShipWeeksChart, { series }));
    expect(html.match(/data-ships="not-observed"/g)).toHaveLength(2);
    expect(html.match(/data-ships="0"/g)).toHaveLength(4);
    expect(html.match(/v2-weeks-zero/g)).toHaveLength(4);
    expect(html.match(/v2-weeks-bar"/g)).toHaveLength(2);
    expect(shipWeeksSentence(series)).toBe('3 counted ships in 8 weeks, oldest first: not observed, not observed, 0, 1, 0, 0, 2, 0.');
    expect(html).toContain(`aria-label="${shipWeeksSentence(series)}"`);
  });

  it('puts the total beside the bars as text, so no figure needs a hover', () => {
    const html = renderToStaticMarkup(createElement(ShipWeeksChart, { series: weeks([0, 1, 0, 2, 0, 0, 0, 1]) }));
    expect(html).toMatch(/data-testid="ship-weeks-total">4 ships</);
    expect(html).not.toContain('title=');
  });

  it('says a project HEY observed in none of the weeks is not observed, never 0 ships', () => {
    const series = weeks([null, null, null, null, null, null, null, null]);
    expect(shipWeeksSentence(series)).toBe('Not observed: HEY had not read this project in these 8 weeks.');
    const html = renderToStaticMarkup(createElement(ShipWeeksChart, { series }));
    expect(html).toContain('data-state="not-observed"');
    expect(html).not.toMatch(/data-testid="ship-weeks-total">0/);
    expect(html).toContain('data-testid="ship-weeks-total">not observed<');
  });

  it('scales a row on its own busiest week, on a floor of four, so a lone ship is never a full bar', () => {
    expect(shipWeekHeights(weeks([null, 0, 1, 8]))).toEqual([null, 0, 0.125, 1]);
    expect(shipWeekHeights(weeks([1, 0]))).toEqual([0.25, 0]);
  });
});

describe('the list’s order', () => {
  it('draws rows in the order the listing handed them, a valuation never reordering them', () => {
    const projects: ProjectCardData[] = [
      { ...measured, slug: 'small', marketCapUsd: 10_000 },
      { ...measured, slug: 'large', marketCapUsd: 90_000_000 },
      { ...measured, slug: 'tokenless', token: undefined, symbol: undefined, marketCapUsd: undefined },
      { ...measured, slug: 'middle', marketCapUsd: 2_000_000 },
    ];
    const html = renderToStaticMarkup(
      createElement(ProjectList, { caption: 'Projects', children: projects.map((project) => createElement(ProjectListRow, { key: project.slug, project, now: NOW })) }),
    );
    expect([...html.matchAll(/data-testid="project-row" data-slug="([^"]+)"/g)].map((match) => match[1])).toEqual(['small', 'large', 'tokenless', 'middle']);
  });

  it('has no sort in the list or its chart: the 8-week series and the market are context, never an order', () => {
    // The web app's wrapper is read where it exists: the public open-source subset ships @hey/ui without apps/web.
    const web = fileURLToPath(new URL('../../../apps/web/src/components/project-list.tsx', import.meta.url));
    const files = ['./project-list.tsx', './ship-weeks.tsx'].map((file) => fileURLToPath(new URL(file, import.meta.url)));
    for (const file of existsSync(web) ? [...files, web] : files) {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(source, file).not.toMatch(/\.(sort|toSorted|reverse)\(/);
    }
  });
});
