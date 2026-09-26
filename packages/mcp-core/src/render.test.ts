import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { HeyDiff, HeyPage, HeyProject, HeyThisWeek, HeyTokenMarket } from '@hey-research/sdk';

import * as fx from './fixtures/api';
import {
  STILL_BUILDING_MEANING,
  ago,
  atPrecision,
  projectLine,
  renderAccelerating,
  renderAskAnswer,
  renderBuilders,
  renderChain,
  renderChanges,
  renderCompare,
  renderMarketIntegrity,
  renderMarketMoves,
  renderProjects,
  renderSilentBuilders,
  renderThisWeek,
  renderTimeline,
  renderTokenLookup,
  renderTokenMarket,
  renderUnlocks,
  renderWeeklyReport,
  stillBuildingEvidence,
  tokenMarketWords,
  valuationWord,
} from './render';
import { renderBuildMarket, renderContract, renderCoverage, renderDiff, renderEvidence, renderExplainIndex, renderExplained, renderProjectContracts, renderSnapshot } from './render-machine';

/**
 * What an agent is handed (2026-09-05; one test per tool since 2026-09-26).
 *
 * A model quotes whatever comes back, so these tests are about what the text
 * makes it possible to say. The failures worth guarding are not crashes: they
 * are a rendering that lets an assistant tell someone a project is a good buy,
 * report a valuation HEY never recorded or name an FDV a market cap, present
 * an unresearched record as a verified claim, drop the evidence, or answer
 * about a whole listing from one page of it.
 */
const NOW = new Date('2026-09-26T12:00:00Z');
const TAGGED = /\b(FACT|DERIVED|UNKNOWN)\b/;
/** Nothing a model could quote as a value HEY does not hold. */
const NO_GARBAGE = /undefined|\[object|NaN/;

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

describe('shared wording', () => {
  it('names a valuation by the kind the API sent, and an unknown kind never a market cap (M2 G9)', () => {
    expect(valuationWord('fdv')).toBe('FDV');
    expect(valuationWord('marketCap')).toBe('market cap');
    expect(valuationWord(undefined)).toBe('valuation');
  });

  it('prints a time at the precision HEY knows it, and never invents one', () => {
    expect(atPrecision('2026-09-14T00:00:00.000Z', 'WEEK')).toBe('week of 2026-09-14');
    expect(atPrecision('2026-09-14T10:30:00.000Z', 'EXACT')).toBe('2026-09-14 10:30 UTC');
    expect(atPrecision(null, 'OBSERVED', '2026-09-20T00:00:00Z')).toBe('no source time; HEY saw it 2026-09-20');
  });

  it('dates in words, so an agent is not left doing arithmetic', () => {
    expect(ago('2026-09-26T09:00:00Z', NOW)).toBe('today');
    expect(ago('2026-09-25T09:00:00Z', NOW)).toBe('yesterday');
    expect(ago('2026-09-19T12:00:00Z', NOW)).toBe('7 days ago');
    expect(ago('2026-07-26T12:00:00Z', NOW)).toBe('2 months ago');
  });

  it('says the Still Building evidence as two facts and nothing that reads as a verdict', () => {
    expect(stillBuildingEvidence({ stillBuildingEvidence: { drawdownPercent: 62.4, shipsSinceDecline: 5 } })).toBe('down 62% from the HEY-tracked high, 5 verified ships since');
    expect(stillBuildingEvidence({ stillBuildingEvidence: { drawdownPercent: 55 } })).toBe('down 55% from the HEY-tracked high');
    expect(stillBuildingEvidence({})).toBeUndefined();
    expect(tokenMarketWords('LIQUIDITY_REMOVED')).toBe('liquidity no longer detected');
    expect(tokenMarketWords('SOMETHING_NEW')).toBe('something new');
  });
});

describe('find_projects', () => {
  it('leads each line with a tagged activity claim, then the market with its provider and kind', () => {
    const line = projectLine(project({ symbol: 'AOS', marketCap: { usd: 24_000, source: 'coingecko', kind: 'marketCap' } }), NOW);
    expect(line).toContain('DERIVED shipping');
    expect(line.indexOf('shipping')).toBeLessThan(line.indexOf('market cap'));
    expect(line).toContain('$24.0K market cap (coingecko)');
    // No kind sent: a valuation, never "mcap" (2026-09-26).
    expect(projectLine(project({ marketCap: { usd: 24_000, source: 'coingecko' } }), NOW)).toContain('$24.0K valuation (coingecko)');
    expect(projectLine(project({ marketCap: { usd: 24_000, source: 'coingecko', kind: 'fdv' } }), NOW)).toContain('$24.0K FDV (coingecko)');
  });

  it('says a record is unresearched, or has no builder source, instead of reporting a status', () => {
    expect(projectLine(project({ researchLevel: 'INDEXED', activityStatus: 'UNKNOWN' }), NOW)).toContain('UNKNOWN activity: not researched yet');
    expect(projectLine(project({ activityStatus: 'UNKNOWN', hasBuilderSource: false }), NOW)).toContain('no builder signal yet');
    expect(projectLine(project({ activityStatus: 'UNKNOWN', hasBuilderSource: true }), NOW)).toContain('UNKNOWN activity: too few public sources to say either way');
    // Not beside a recorded ship (2026-09-25).
    expect(projectLine(project({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastShippedAt: '2026-08-05T00:00:00Z' }), NOW)).not.toContain('no builder signal yet');
  });

  it('names a launch pool’s own supply for what it is, and prints no market figure it does not hold', () => {
    expect(projectLine(project({ liquidity: { usd: 42_000_000, source: 'dexscreener', kind: 'launch_inventory' } }), NOW)).toContain('of its own supply in the launch pool — not a market reading');
    expect(projectLine(project(), NOW)).not.toMatch(/\$0|n\/a|mcap|valuation/);
  });

  it('renders a captured page: shown of total, the offset that reads on, the query echo, tags and Still Building’s meaning', () => {
    const text = renderProjects(fx.projectsPage, NOW);
    expect(text).toContain('Showing 2 of 17. For more, call find_projects again with the same arguments and offset=2.');
    expect(text).toContain('Query as HEY read it');
    expect(text).toContain('STILL BUILDING (down 62% from the HEY-tracked high, 5 verified ships since)');
    expect(text).toContain(STILL_BUILDING_MEANING);
    expect(text).toMatch(TAGGED);
    expect(text).toContain('$208.6K FDV (dexscreener)');
    expect(text).not.toMatch(NO_GARBAGE);
  });

  it('tells an empty result from a page past the end (M2 G9)', () => {
    expect(renderProjects(page<HeyProject>([], { total: 0 }), NOW)).toContain('No published project matches that.');
    const past = renderProjects(page<HeyProject>([], { total: 40, query: { offset: 48, limit: 24 } }), NOW);
    expect(past).toContain('past the end: 40 published projects match');
    expect(past).not.toContain('No published project matches');
  });

  it('shipping-in-silence: both halves of the definition, shown of total, never a buy signal', () => {
    const text = renderSilentBuilders(fx.silence);
    expect(text).toContain('Under the Radar and below the 40th market-attention percentile');
    expect(text).toContain('Showing 1 of 8.');
    expect(text).toContain('not a buy signal');
    expect(text).toMatch(TAGGED);
  });

  it('accelerating: DERIVED, both windows, and an unwatched window is unknown — never "none"', () => {
    const text = renderAccelerating(fx.accelerating);
    expect(text).toContain('DERIVED Faster — 5 meaningful events in 30 days vs 1 before');
    expect(text).toContain('vs an earlier window HEY did not watch (unknown)');
    expect(text).not.toMatch(/\bnone\b/);
    expect(text).toContain('at most 100');
  });

  it('builder-radar: ranks are DERIVED, price takes no part, and the offset reads on', () => {
    const text = renderBuilders(fx.builders, NOW);
    expect(text).toContain('DERIVED #3 AgentOS ($AOS)');
    expect(text).toContain('Market cap, price and volume take no part in it.');
    expect(text).toContain('Showing 1 of 715. For the rest, call find_projects again with surface=builder-radar and offset=1.');
    // A ranking keeps the API's disclaimer (audit §45 #9).
    expect(text).toContain(fx.builders.disclaimer);
  });
});

describe('lookup_token', () => {
  it('prints HEY’s words for the status, the evidence and whose contract it is', () => {
    const text = renderTokenLookup(fx.lookupPublished, NOW);
    expect(text).toContain('# AgentOS ($AOS) — Shipping');
    expect(text).not.toContain('SHIPPING');
    expect(text).toContain('FACT 8 ship records in the last 30 days');
    expect(text).toContain('DERIVED 4 meaningful ships in 30 days');
    expect(text).toContain('https://github.com/agentos/sdk/releases/tag/v0.4');
    expect(text).toContain('FACT verified: the project names this contract itself.');
  });

  it('answers an unindexed address plainly, and a zero HEY did not measure is not printed', () => {
    expect(renderTokenLookup(fx.lookupUnknown, NOW)).toMatch(/UNKNOWN: that is an answer, not an error/);
    const unmeasured = renderTokenLookup({ ...fx.lookupPublished, project: { ...fx.lookupPublished.project!, activityStatus: 'UNKNOWN', activityMeasured: false, shipsLast30Days: 0, meaningfulShipsLast30Days: undefined } }, NOW);
    expect(unmeasured).toContain('UNKNOWN activity');
    expect(unmeasured).not.toContain('0 ship');
    const mismatch = renderTokenLookup({ ...fx.lookupPublished, project: { ...fx.lookupPublished.project!, tokenVerification: { status: 'MISMATCH', reason: 'site_names_another_contract' } } }, NOW);
    expect(mismatch).toContain('MISMATCH: the project’s own site names a different contract');
  });
});

describe('get_project_snapshot', () => {
  const text = renderSnapshot(fx.snapshot, NOW);

  it('tags every section and never calls a withheld valuation zero or a market cap', () => {
    expect(text).toContain('- DERIVED activity status: shipping');
    expect(text).toContain('- DERIVED Build Momentum 67.4 (hbm-v15)');
    expect(text).toContain('- UNKNOWN Discovery Gap: not measured');
    expect(text).toContain('DERIVED valuation withheld: the market is not live (liquidity removed)');
    expect(text).not.toMatch(/market cap|\$0\b/);
  });

  it('keeps knowledge time apart from an outside listing date', () => {
    expect(text).toContain('FACT first recorded by HEY 2026-06-01 (HEY\'s knowledge time); listed by defillama 2022-10-19 (their date, not HEY\'s)');
  });

  it('says an unindexed events day is unknown, HoodLock is the only locker read, and Market Integrity is withheld', () => {
    expect(text).toContain('UNKNOWN contract events: HEY could not index them (0 of 7 days readable); FACT 1204 calls in 24 h');
    expect(text).toContain('HoodLock only; other lockers are not read, so this is not "no lock"');
    expect(text).toContain('UNKNOWN market integrity: WITHHELD');
  });

  it('sums contract events over the days HEY could read, and never calls that sum the whole window (audit §45 #7)', () => {
    const partial = renderSnapshot({ ...fx.snapshot, onchain: { events24h: 10, events7d: 30, daysCovered: 7, daysMeasured: 3, observedAt: '2026-09-25T18:00:00.000Z' } }, NOW);
    expect(partial).toContain('- FACT 10 contract events on the newest day HEY could read, 30 over the 3 days HEY could read (4 of 7 days unreadable: unknown, not zero)');
    expect(partial).not.toContain('30 over 7 days');
    const whole = renderSnapshot({ ...fx.snapshot, onchain: { events24h: 10, events7d: 30, daysCovered: 7, daysMeasured: 7, observedAt: '2026-09-25T18:00:00.000Z' } }, NOW);
    expect(whole).toContain('- FACT 10 contract events in 24 h, 30 over 7 days');
  });

  it('prints the latest changes at their precision, with ids, and where the rest are', () => {
    expect(text).toContain('- EXACT 2026-09-24 10:00 UTC · build.release: Released v0.4 (id ship:2ac87a66-0000-0000-0000-000000000001)');
    expect(text).toContain('- WEEK week of 2026-09-14 · build.code_activity');
    expect(text).toContain('get_changes with project=agentos');
  });

  it('lists what HEY does not know, and never a score', () => {
    expect(text).toContain('UNKNOWN: current market (WITHHELD), contract activity (NOT_ENOUGH_YET), supply distribution (STALE), locks (NO_SOURCE), market integrity (WITHHELD)');
    expect(text).toContain('UNKNOWN HoodLock: HEY has never read it');
    expect(text).toContain(STILL_BUILDING_MEANING);
    expect(text).not.toMatch(NO_GARBAGE);
  });

  it('says so when the ledger cannot list changes, rather than an empty list', () => {
    const unavailable = renderSnapshot({ ...fx.snapshot, latestChanges: { available: false, reason: 'The change ledger has not indexed this project yet.', url: 'u' } }, NOW);
    expect(unavailable).toContain('UNKNOWN changes: The change ledger has not indexed this project yet.');
  });
});

describe('get_changes', () => {
  it('prints each event’s time and precision, its evidence, a retraction by id alone, and the cursor', () => {
    const text = renderChanges(fx.changes);
    expect(text).toContain('- FACT EXACT 2026-09-24 · build.release · AgentOS (agentos): Released v0.4');
    expect(text).toContain('evidence: GitHub release — https://github.com/agentos/sdk/releases/tag/v0.4');
    expect(text).toContain('- RETRACTED signal:0b0b0000-0000-0000-0000-000000000009 (revision 2');
    expect(text).toContain('Showing 2; more exist. Call get_changes again with before=YzEuMTIzNDU.');
    expect(text).toMatch(TAGGED);
    expect(text.toLowerCase()).not.toMatch(/because|caused|\bbuy\b/);
  });

  it('never gives an event a source time it does not have; a sync keeps its cursor', () => {
    const observed = renderChanges({
      ...fx.changes,
      query: { mode: 'sync', after: 'c1.0', limit: 50 },
      items: [{ ...(fx.changes.items[0] as Extract<(typeof fx.changes.items)[number], { op: 'upsert' }>), occurredAt: null, precision: 'OBSERVED' }],
      hasMore: false,
      nextCursor: 'KEEP',
    });
    expect(observed).toContain('OBSERVED (no source time; HEY saw it 2026-09-24)');
    expect(observed).toContain('Cursor: KEEP.');
  });

  it('tags a status or market-state move and a measured window DERIVED, as explain_fact does (audit §45 #8)', () => {
    const release = fx.changes.items[0] as Extract<(typeof fx.changes.items)[number], { op: 'upsert' }>;
    const move = (id: string, type: typeof release.type) => ({ ...release, id, type, occurredAt: null, precision: 'OBSERVED' as const, countsAsBuilding: undefined, summary: 'moved' });
    const text = renderChanges({
      ...fx.changes,
      items: [
        move('state:9b1c0000-0000-0000-0000-000000000001:activity_status:4', 'build.status_changed'),
        move('state:9b1c0000-0000-0000-0000-000000000001:market_status:5', 'market.status_changed'),
        move('signal:0b0b0000-0000-0000-0000-000000000001', 'build.accelerating'),
        move('integrity:7a7a0000-0000-0000-0000-000000000001:lp_removed', 'market_integrity.event'),
        move('state:9b1c0000-0000-0000-0000-000000000001:verification:6', 'token.verification_changed'),
        release,
      ],
    });
    expect(text).toContain('- DERIVED OBSERVED (no source time; HEY saw it 2026-09-24) · build.status_changed');
    expect(text).toContain('- DERIVED OBSERVED (no source time; HEY saw it 2026-09-24) · market.status_changed');
    expect(text).toContain('- DERIVED OBSERVED (no source time; HEY saw it 2026-09-24) · build.accelerating');
    expect(text).toContain('- DERIVED OBSERVED (no source time; HEY saw it 2026-09-24) · market_integrity.event');
    // Token verification is FACT in the explain engine, and a release is a record with its source.
    expect(text).toContain('- FACT OBSERVED (no source time; HEY saw it 2026-09-24) · token.verification_changed');
    expect(text).toContain('- FACT EXACT 2026-09-24 · build.release');
    expect(text).not.toContain('Each event is a FACT');
  });
});

describe('get_project_timeline', () => {
  it('prints precision in words, shown of total and the before cursor', () => {
    const text = renderTimeline(fx.timeline);
    expect(text).toContain('- FACT EXACT 2026-09-01 10:00 UTC · release · v1.2 · counts as building — https://github.com/equifold/core/releases/tag/v1.2');
    expect(text).toContain('- FACT WEEK week of 2026-08-24 · code activity · 12 commits');
    expect(text).toContain('- FACT SCHEDULED scheduled 2026-10-01 00:00 UTC · unlock');
    expect(text).toContain('Showing 3 of 412. For older entries, call get_project_timeline again with before=T2.');
    expect(renderTimeline(fx.timeline, 1)).toContain('Showing 1 of 412. Call get_project_timeline again with limit=1');
    expect(text).toMatch(TAGGED);
  });

  it('tags a detected return to building and a market-integrity reading DERIVED, never FACT (audit §45 #8)', () => {
    const text = renderTimeline({
      ...fx.timeline,
      items: [
        { id: 'resumed:0b0b0000-0000-0000-0000-000000000001', kind: 'resumed', at: '2026-09-20T00:00:00.000Z', precision: 'OBSERVED', title: 'Back to shipping', countsAsBuilding: false },
        { id: 'integrity:7a7a0000-0000-0000-0000-000000000001', kind: 'market_integrity', at: '2026-09-19T00:00:00.000Z', precision: 'WINDOW', title: 'Liquidity removed', countsAsBuilding: false },
        { id: 'token-verification', kind: 'verification', at: '2026-09-18T00:00:00.000Z', precision: 'OBSERVED', title: 'Token verified', countsAsBuilding: false },
      ],
    });
    expect(text).toContain('- DERIVED OBSERVED HEY saw it 2026-09-20 · resumed · Back to shipping');
    expect(text).toContain('- DERIVED WINDOW window ending 2026-09-19 · market integrity');
    expect(text).toContain('- FACT OBSERVED HEY saw it 2026-09-18 · verification');
    expect(text).not.toContain('Each entry is a FACT');
  });
});

describe('get_project_coverage', () => {
  it('prints a state per dimension, what not to conclude, and never a score', () => {
    const text = renderCoverage(fx.coverage);
    expect(text).toContain('- FACT builder evidence: MEASURED');
    expect(text).toContain('- UNKNOWN locks: NO_SOURCE (reason hoodlock_only_none_found)');
    expect(text).toContain('Do not conclude anything from:');
    expect(text).toContain('- WITHHELD: Measured and deliberately not published on this surface.');
    // Only the states in use are explained.
    expect(text).not.toContain('- ERROR:');
    expect(text).not.toMatch(/score\s*[:=]|\/100|%/);
  });
});

describe('explain_fact', () => {
  it('carries the engine’s own state, the rule and version, lineage, unknown inputs and evidence ids', () => {
    const text = renderExplained(fx.explained);
    expect(text).toContain('DERIVED market.valuation: null (not held) — withheld: the market is not live');
    expect(text).toContain('Rule: valuation-kind (v1)');
    expect(text).toContain('- sanitation: The market status is LIQUIDITY_REMOVED.');
    expect(text).toContain('UNKNOWN inputs HEY does not hold: circulatingSupply.');
    expect(text).toContain('state:9b1c:market_status:4');
  });

  it('lists what can be explained when no fact is named', () => {
    expect(renderExplainIndex(fx.explainIndex)).toContain('- market.valuation: The valuation, its kind and why it is shown or withheld.');
  });
});

describe('get_evidence', () => {
  it('prints the claim, its precision, when HEY knew, the source URL and the backing', () => {
    const text = renderEvidence(fx.evidence);
    expect(text).toContain('FACT GITHUB_RELEASE (build): Released v0.4');
    expect(text).toContain('When: 2026-09-24 10:00 UTC (EXACT); HEY first knew 2026-09-24 11:00 UTC');
    expect(text).toContain('https://github.com/agentos/sdk/releases/tag/v0.4; backing: publicly verified; counts toward activity status');
  });

  it('tags a HEY state transition or signal DERIVED, as explain_fact does, and token verification FACT (audit §45 #8)', () => {
    const live = fx.evidence as Extract<typeof fx.evidence, { withdrawn: false }>;
    const state = (key: string) => ({ ...live, id: `state:514b4680-a7c1-4497-9e6a-1fa9ac342a8e:${key}:1`, claimType: `${key}_changed`, sourceType: 'hey', sourceUrl: null, verification: null, countsAsBuilding: undefined });
    expect(renderEvidence({ ...state('activity_status'), domain: 'build', summary: 'activity status: SHIPPING → ACTIVE' })).toContain('DERIVED activity_status_changed (build): activity status: SHIPPING → ACTIVE');
    expect(renderEvidence({ ...state('market_status'), domain: 'market', summary: 'market status: TRADING_INACTIVE → ACTIVE_MARKET' })).toContain('DERIVED market_status_changed (market)');
    expect(renderEvidence({ ...state('catalog_status'), domain: 'research' })).toContain('DERIVED catalog_status_changed');
    expect(renderEvidence({ ...live, id: 'signal:0b0b0000-0000-0000-0000-000000000001', claimType: 'development_spike', sourceType: 'hey' })).toContain('DERIVED development_spike');
    expect(renderEvidence({ ...state('verification'), domain: 'token' })).toContain('FACT verification_changed');
    expect(renderEvidence({ ...live, id: 'claim:0b0b0000-0000-0000-0000-000000000001', claimType: 'owner_verified', sourceType: 'hey' })).toContain('FACT owner_verified');
  });

  it('says a withdrawn record is withdrawn, and names no project it may not', () => {
    const text = renderEvidence(fx.evidenceWithdrawn);
    expect(text).toContain('HEY no longer makes this claim (not public). Do not cite it.');
    expect(text).not.toContain('Project:');
  });
});

describe('get_token_market', () => {
  const text = renderTokenMarket(fx.tokenMarket, NOW);

  it('names the valuation by its kind, never by comparing figures, and tags each block', () => {
    expect(text).toContain('FACT now (dexscreener, today): price $0.000208, FDV $208.6K');
    expect(renderTokenMarket({ ...fx.tokenMarket, current: { ...fx.tokenMarket.current!, valuationKind: undefined } }, NOW)).toContain('valuation $208.6K');
    expect(text).toContain('DERIVED market status: active market');
    expect(text).toMatch(/FACT token verification: verified/);
  });

  it('prints no unknown buy or sell count as zero (M2 G9)', () => {
    expect(text).toContain('- 2026-09-23: close $0.000200, liquidity $40.0K, 12 trades (7 buys / 5 sells), traded $180');
    expect(text).toContain('- 2026-09-24: close $0.000210, liquidity $41.0K, 9 trades (bitquery)');
    expect(text).not.toContain('0 buys');
  });

  it('prints the deployer as the only named account, the launchpad’s claim as its claim, and unindexed events as unknown', () => {
    expect(text).toContain('deployed by 0xdep0000000000000000000000000000000000001 (a deployer that launched other projects HEY tracks: a launch service, not one team)');
    expect(text).toContain('the launchpad (virtuals) says it launched 2026-08-01 — the launchpad\'s claim');
    expect(text).toContain('2026-09-24 not indexed');
    expect(text).toContain('largest 10 balances hold 41.2%');
    expect(text).toContain('the largest pool holds 82% of measured pool liquidity');
    expect(text).toContain('no address but the contract’s deployer is named');
  });

  it('states the day cap and where the rest are', () => {
    const days = Array.from({ length: 90 }, (_, i) => ({ day: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`, liquidityCloseUsd: 1000 + i }));
    const wide = renderTokenMarket({ ...fx.tokenMarket, days } as HeyTokenMarket, NOW);
    expect(wide).toMatch(/Showing the 14 most recent; the rest are in GET \/api\/projects\/agentos\/market\?days=90/);
  });

  it('include=moves: a sequence, never a cause, named by kind; a withheld index says withheld', () => {
    const moves = renderMarketMoves(fx.marketMoves);
    expect(moves).toContain('FACT 2026-09-14: valuation +50% on 2026-09-13 (104,000 → 156,000 USD)');
    expect(moves).toContain('A sequence, never a cause.');
    expect(renderMarketMoves({ ...fx.marketMoves, items: [{ ...fx.marketMoves.items[0]!, valuationKind: 'fdv' }] })).toContain('FDV +50%');
    const withheld = renderMarketMoves({ ...fx.marketMoves, daysRead: 0, items: [], withheldDays: 12, withheldReason: 'liquidity_removed' });
    expect(withheld).toContain('DERIVED valuation withheld on 12 indexed days (liquidity removed)');
    expect(renderMarketMoves({ ...fx.marketMoves, daysRead: 0, items: [] })).toContain('UNKNOWN HEY holds too few daily market readings');
  });
});

describe('get_contract', () => {
  it('prints the beacon proxy, the history with its clock, counts only, and unknown events as unknown', () => {
    const text = renderContract(fx.contract);
    expect(text).toContain('FACT a beacon proxy; implementation 0x1111000000000000000000000000000000000001; beacon 0x2222000000000000000000000000000000000002');
    expect(text).toContain("EXACT 2026-08-01 12:05 UTC · BeaconUpgraded → 0x1111000000000000000000000000000000000001 (read from the chain's logs");
    expect(text).toContain('FACT interface: 24 functions, 6 events');
    expect(text).toContain('8400 calls in 7 days, events not indexed (unknown, not zero)');
    expect(text).toContain('HEY marks this deployer shared: it also deployed the token of 12 other tracked projects (a launch service, not one team');
    expect(text.toLowerCase()).not.toContain('partnership');
  });

  it("calls a deployer a launch service only on HEY's own shared flag; below it, a count with no label (audit §45 #19)", () => {
    // Live: Rips' deployer, one other tracked project, stored flag false — /market says deployerShared false.
    const one = renderContract({ ...fx.contract, deployer: { address: '0x5b11c2be263b1c9e5a0878f2aee417a5a5728f2b', sharedAcrossTrackedProjects: false, otherProjectsCount: 1 } });
    expect(one).toContain('- FACT deployed by 0x5b11c2be263b1c9e5a0878f2aee417a5a5728f2b — the same account also deployed the token of 1 other tracked project\n');
    expect(one).not.toMatch(/launch service|shared/);
    const none = renderContract({ ...fx.contract, deployer: { address: '0x5b11c2be263b1c9e5a0878f2aee417a5a5728f2b', sharedAcrossTrackedProjects: false, otherProjectsCount: 0 } });
    expect(none).toContain('- FACT deployed by 0x5b11c2be263b1c9e5a0878f2aee417a5a5728f2b\n');
  });

  it('says no single project, rather than none, when a contract has no associated project (audit §45 #20)', () => {
    const text = renderContract({ ...fx.contract, associatedProject: null, role: undefined });
    expect(text).toContain('UNKNOWN project: no single published project claims this contract (none does, or more than one does equally).');
  });

  it('never reads an unread proxy as "not a proxy", and an older check says what it read', () => {
    const text = renderProjectContracts(fx.projectContracts);
    expect(text).toContain('listed, not watched');
    expect(text).toContain('UNKNOWN proxy: not read yet — never read this as "not a proxy"');
    expect(text).toContain('Showing all 2.');
    const older = renderContract({ ...fx.contract, proxy: { state: 'MEASURED', status: 'NOT_PROXY', checkedAt: '2026-09-08T00:00:00Z', history: [] } });
    expect(older).toContain('an older check that did not read the beacon slot');
    const full = renderContract({ ...fx.contract, proxy: { state: 'MEASURED', status: 'NOT_PROXY', kind: 'NONE_DETECTED', history: [] } });
    expect(full).toContain('the beacon slot or the explorer\'s claim');
  });
});

describe('project_diff', () => {
  it('prints then and now with their day and basis, a missing point as UNKNOWN with its reason, and no cause', () => {
    const text = renderDiff(fx.diff);
    expect(text).toContain('DERIVED activity status: then active on 2026-09-01, knowledge, hbm-v14 → now shipping on 2026-09-25, knowledge, hbm-v15');
    expect(text).toContain('then UNKNOWN (no persisted point on or before 2026-09-01)');
    expect(text).toContain('FACT valuation: then $104.0K on 2026-09-01, observed → now $208.6K on 2026-09-25, observed');
    expect(text).toContain('never a cause');
    expect(text.toLowerCase()).not.toMatch(/because|led to|caused/);
  });

  it("names each end of the valuation by its own kind, never one end's kind for both (audit §45 #6)", () => {
    type Valuation = Extract<HeyDiff['market'], { state: 'MEASURED' }>['valuation'];
    const withValuation = (valuation: Valuation) =>
      renderDiff({ ...fx.diff, market: { state: 'MEASURED', valuation, liquidity: { then: { value: null, reason: 'withheld' }, now: { value: null, reason: 'withheld' } } } });
    // Live arrow, 2026-09-17 → 2026-09-25: no kind on the first day (no supply read), a market cap on the last.
    const arrow = withValuation({ then: { value: 2_731_838, day: '2026-09-17', basis: 'observed' }, now: { value: 4_305_227, day: '2026-09-25', basis: 'observed', kind: 'marketCap' } });
    expect(arrow).toContain('- FACT valuation: then valuation $2.73M on 2026-09-17, observed → now market cap $4.31M on 2026-09-25, observed');
    expect(arrow).toContain('not the same measure');
    expect(arrow).not.toContain('FACT market cap:');
    const mixed = withValuation({ then: { value: 1_000_000, day: '2026-09-01', basis: 'observed', kind: 'fdv' }, now: { value: 400_000, day: '2026-09-25', basis: 'observed', kind: 'marketCap' } });
    expect(mixed).toContain('then FDV $1.00M on 2026-09-01, observed → now market cap $400.0K');
    const same = withValuation({ then: { value: 1_000_000, day: '2026-09-01', basis: 'observed', kind: 'fdv' }, now: { value: 400_000, day: '2026-09-25', basis: 'observed', kind: 'fdv' } });
    expect(same).toContain('- FACT FDV: then $1.00M on 2026-09-01, observed → now $400.0K');
    expect(same).not.toContain('not the same measure');
    const missing = withValuation({ then: { value: null, reason: 'no persisted point' }, now: { value: 400_000, day: '2026-09-25', basis: 'observed', kind: 'marketCap' } });
    expect(missing).toContain('then UNKNOWN (no persisted point) → now market cap $400.0K');
    expect(missing).not.toContain('not the same measure');
  });
});

describe('project_diff counts HEY cannot measure', () => {
  it('prints null build counts as UNKNOWN with their reason, and says a change count is partial (audit §45 #16, #17)', () => {
    const unmeasured = renderDiff({ ...fx.diff, build: { ...fx.diff.build, releasesAdded: null, meaningfulShips: null, countsReason: 'HEY holds no builder source it can read for this project.' } });
    expect(unmeasured).toContain('- UNKNOWN releases added and meaningful ships: HEY holds no builder source it can read for this project.');
    expect(unmeasured).not.toContain('releases added: null');
    if (fx.diff.changes.state !== 'MEASURED') throw new Error('fixture diff has measured changes');
    const partial = renderDiff({ ...fx.diff, changes: { ...fx.diff.changes, partial: true, collectedFrom: '2026-09-26T11:32:48.791Z' } });
    expect(partial).toContain('(partial: the ledger began recording on 2026-09-26, so only from then)');
  });
});

describe('compare_projects', () => {
  it('tags each line no stronger than the API, names the kind, and names no winner', () => {
    const text = renderCompare(fx.compare);
    expect(text).toContain('DERIVED activity status: shipping');
    expect(text).toContain('UNKNOWN activity status: unknown');
    expect(text).toContain('DERIVED Build Momentum 67');
    expect(text).not.toContain('FACT Build Momentum');
    expect(text).toContain('FACT fully diluted valuation 208,594 USD (context)');
    expect(text).toContain('FACT valuation 9,000 USD (context)');
    expect(text).toContain('Not published: ghost.');
    expect(text.toLowerCase()).not.toMatch(/winner is|better|best/);
  });
});

describe('ask_hey', () => {
  it('keeps each line’s tag and source', () => {
    const text = renderAskAnswer(fx.ask);
    expect(text).toContain('FACT 2026-09-24 · v0.4 (source: https://github.com/agentos/sdk/releases/tag/v0.4)');
    expect(text).toContain('UNKNOWN Release cadence');
  });
});

describe('chain_overview', () => {
  it('days: bounded, newest first, shown of total and where the rest are', () => {
    const text = renderChain(fx.chain);
    expect(text).toContain('Showing 31 of 40. Newest first; the older days are in GET /api/chain?days=40.');
    expect(text).toContain('2 newly verified builders');
    expect(text).toContain('nobody is named');
    expect(text).toMatch(TAGGED);
    // The API's disclaimer travels with the overview (audit §45 #9).
    expect(text.endsWith(fx.chain.disclaimer)).toBe(true);
  });

  it('this-week: the captured payload without an undefined, a valuation by kind, and Still Building’s meaning', () => {
    const week = JSON.parse(readFileSync(new URL('./fixtures/this-week.json', import.meta.url), 'utf8')) as HeyThisWeek;
    const text = renderThisWeek(week);
    expect(text).toContain('FACT ships: 2,540 from 597 projects.');
    expect(text).toContain('DERIVED Under the Radar: 38.');
    expect(text).toContain(STILL_BUILDING_MEANING);
    expect(text).not.toMatch(NO_GARBAGE);
    expect(text).not.toContain('mcap');
    const radar = week.underTheRadar!;
    const long = renderThisWeek({ ...week, underTheRadar: { total: 38, items: Array.from({ length: 15 }, (_, i) => ({ ...radar.items[0]!, slug: `p${i}`, name: `Project ${i}` })) } });
    expect(long).toContain('…and 5 more on https://heyresearch.xyz/this-week');
  });

  it('weekly-report: tagged, with Still Building’s meaning', () => {
    const text = renderWeeklyReport(fx.weeklyReport);
    expect(text).toContain('FACT overview: 9 verified ships');
    // Still Building, Under the Radar and status moves are rules HEY applied, as renderThisWeek says (audit §45 #8).
    expect(text).toMatch(/^DERIVED overview: .* Still Building · .* Under the Radar/m);
    expect(text).not.toMatch(/^FACT overview: .*(Still Building|Under the Radar|back to shipping)/m);
    expect(text).toContain(STILL_BUILDING_MEANING);
  });

  it('unlocks: SCHEDULED with proof and id, shown of total, HoodLock only', () => {
    const text = renderUnlocks(fx.unlocks);
    expect(text).toContain('SCHEDULED 2026-10-01 00:00 UTC · AgentOS · lock #17 (lock:4663:17) · 1,000 tokens (10% of recorded supply) — proof https://hoodlock.tech/proof/lock/17');
    expect(text).toContain('Showing 1 of 3.');
    expect(text).toContain('HoodLock only');
    expect(renderUnlocks({ ...fx.unlocks, items: [], total: 0, truncated: false })).toContain('this is not "no lock anywhere"');
  });

  it('build-market: a map, not a ranking, bounded with where the rest are', () => {
    const text = renderBuildMarket(fx.buildMarket);
    expect(text).toContain('Showing 30 of 35.');
    expect(text).toContain('a map, not a ranking');
    expect(text).toMatch(TAGGED);
  });
});

describe('market_integrity (gated)', () => {
  it('puts the builder first with a DERIVED tag, tags every line, and never says rug, scam or safe', () => {
    const out = renderMarketIntegrity(fx.marketIntegrity);
    expect(out.split('\n')[2]).toMatch(/^DERIVED builder activity: shipping/);
    expect(out).toContain('DERIVED no verified replacement pool');
    expect(out).toContain('not whether development has stopped');
    expect(out.toLowerCase()).not.toMatch(/\brug|scam|\bsafe\b/);
  });
});
