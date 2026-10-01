import type {
  HeyBuildMarket,
  HeyContract,
  HeyDeveloperFootprint,
  HeyEconomicsMetric,
  HeyMarketPromotion,
  HeyProtocolEconomics,
  HeyCoverageDimension,
  HeyCoverageEntry,
  HeyCoverageState,
  HeyDiff,
  HeyDiffEnd,
  HeyDiscoveryGapWithheld,
  HeyEvidenceReceipt,
  HeyExplainedFact,
  HeyExplainIndex,
  HeyProjectContracts,
  HeyProjectCoverage,
  HeyProjectSnapshot,
  HeyResearchSummary,
  HeySecurityContext,
  HeySourceFreshness,
  HeyPeerContext,
  HeyUsageSummary,
  HeyStillBuildingWithheld,
} from '@hey-research-lab/sdk';

import { quoteExternal, stillBuildingStateOf, summaryIsSourceText, valuationWithheldClause } from '@hey/agent-provider-core';

import { activityTag, atPrecision, composedWords, derivedWords, liquidityWords, money, quotedName, recordTag, shownOf, STILL_BUILDING_MEANING, stillBuildingEvidence, summaryWords, TAG_LEGEND, tokenMarketWords, valuationWord } from './render';

/**
 * The machine-layer reads as text (2026-09-26): snapshot, coverage, explain,
 * evidence, contracts, diff and the build × market map.
 *
 * The same four rules as `render.ts`, and one more that matters most here:
 * **say no more than the API.** Coverage is states and never a score; an
 * explanation carries the state the explain engine gave it; a withheld value
 * says it is withheld; a proxy HEY did not read is "not read", never "not a
 * proxy"; and a diff is two readings on named clocks, never a cause.
 */

const pretty = (value: string): string => value.toLowerCase().replace(/_/g, ' ');

/**
 * Why a Discovery Gap is absent, in the scoring package's words (hbm-v18,
 * 2026-09-30). The MCP ships without `@hey/scoring`, so this is a literal;
 * `apps/web/src/app/mcp/definitions.test.ts` holds it to
 * `DISCOVERY_GAP_WITHHELD_WORDS`.
 */
export const GAP_WITHHELD_WORDS: Readonly<Record<HeyDiscoveryGapWithheld, string>> = {
  no_token: 'Not measured — no tracked token',
  market_not_live: 'Not measured — no live market',
  token_not_the_projects: 'Not measured — the token is not tied to the project',
  market_too_thin: 'Not measured — market too thin',
  active_pool_not_read: 'Not measured — no reading of the pool that makes the market active',
  no_market_reading: 'Not measured — no current market reading',
  no_build_momentum: 'Not measured — no building recorded',
};

/**
 * Why Still Building was not measured, in the scoring package's words
 * (hbm-v19, 2026-09-30): the Discovery Gap's words for the same market.
 * `apps/web/src/app/mcp/definitions.test.ts` holds it to
 * `STILL_BUILDING_WITHHELD_WORDS`.
 */
export const STILL_BUILDING_WITHHELD_WORDS: Readonly<Record<HeyStillBuildingWithheld, string>> = {
  market_not_live: GAP_WITHHELD_WORDS.market_not_live,
  token_not_the_projects: GAP_WITHHELD_WORDS.token_not_the_projects,
  market_too_thin: GAP_WITHHELD_WORDS.market_too_thin,
  valuation_not_plausible: 'Not measured — valuation not plausible',
  no_token: GAP_WITHHELD_WORDS.no_token,
  active_pool_not_read: GAP_WITHHELD_WORDS.active_pool_not_read,
  no_market_reading: GAP_WITHHELD_WORDS.no_market_reading,
  activity_unknown: 'Not measured — activity unknown',
  not_scored: 'Not measured — not scored yet',
};

/**
 * A withheld code in its words, lower-cased for a sentence (hbm-v21): a code
 * this build does not know yet — the lists only grow — still reads "not
 * measured", never a crash or "undefined".
 */
function withheldWords(words: Readonly<Record<string, string>>, code: string): string {
  return (words[code] ?? 'Not measured').replace(/^Not measured/, 'not measured');
}

/** A coverage state as the tag an agent should read it with: measured is a fact about HEY's record, anything else is a gap. */
function coverageTag(state: HeyCoverageState): 'FACT' | 'UNKNOWN' {
  return state === 'MEASURED' || state === 'NOT_APPLICABLE' ? 'FACT' : 'UNKNOWN';
}

export const DIMENSION_WORDS: Record<HeyCoverageDimension, string> = {
  identity: 'identity',
  builderEvidence: 'builder evidence',
  repositories: 'repositories',
  releases: 'releases',
  marketCurrent: 'current market',
  marketHistory: 'market history',
  contractDeployment: 'contract deployment',
  contractActivity: 'contract activity',
  contractSource: 'verified source',
  contractInterface: 'contract interface',
  distribution: 'supply distribution',
  locks: 'locks',
  marketIntegrity: 'market integrity',
  protocolEconomics: 'protocol economics',
  timeline: 'timeline',
  officialDocs: 'official docs',
  apiDocs: 'API description',
  sourceChanges: 'official source changes',
  gitHost: 'repository metadata',
  package: 'published packages',
  securityContext: 'package advisories',
};

/**
 * Reason codes a bare token would let an agent misread (2026-09-27): each
 * says how far the reading goes, so "none found" is never read as "none",
 * "not applicable" never as deficient, and a registry's silence never as a
 * zero. Codes not listed print as they are.
 */
export const REASON_WORDS: Readonly<Record<string, string>> = {
  none_found_in_package_index: 'the package index lists none for its official repositories — a reading of that index only, not "no package"',
  no_repository_no_package: 'no repository and no package: a package is not expected here',
  no_official_repository: 'HEY holds repositories for this project, none marked official, so it reads none of their metadata',
  claimed_package_links_only: "packages only claim an official repository; none is confirmed as the project's own",
  package_lookup_not_run: 'the package index has not been asked yet',
  accepted_package_links: 'packages an official source ties to the project',
  no_accepted_package: "no package confirmed as the project's own, so no advisory applies",
  ecosystem_not_covered_by_osv: 'the advisory database does not cover this package ecosystem',
  no_advisory_for_published_version: 'the advisory database lists none for the published version',
  advisories_about_published_package: 'advisories about the published version — never a verdict on the project',
  scorecard_checks_only: 'only published Scorecard checks, never an aggregate score',
  not_tracked_by_registry: 'the registry lists the protocol but does not track this metric',
  no_protocol_listing: 'matched to no DefiLlama protocol',
  registry_context_only: 'a registry figure, context only',
  no_api_description_linked: 'the official site links no API description (HEY reads one only when linked)',
  api_description_disallowed: 'the site asks crawlers not to read its API description',
  no_baseline_yet: 'one reading so far: the first read is a baseline, never a change',
  meme_no_docs_expected: 'a meme token: no docs expected',
  site_disallows_reading: "the site's robots.txt asks HEY not to read it",
  no_official_site: 'no corroborated official site',
  site_not_corroborated: "the site is not corroborated as the project's own",
  source_verified_template_token: 'verified source is a launchpad template, not project-authored code',
  source_verified_explorer_matched: 'verified by a bytecode match to source published for another contract',
  source_verified_project_authored: 'source published for this address',
  source_verified_project_authored_other_contract: 'the token is not project-authored, but another watched contract of the project has source published for its own address',
  source_verified_authorship_unconfirmed: 'verified; how the explorer came to hold the source is not read yet',
  changes_since_first_read_template_interface: "a template's interface, counted from HEY's first read",
};

const reasonWords = (reason: string): string => (REASON_WORDS[reason] ? `${reason}: ${REASON_WORDS[reason]}` : reason);

function coverageLine(dimension: HeyCoverageDimension, entry: HeyCoverageEntry): string {
  const facts = [entry.since ? `since ${entry.since.slice(0, 10)}` : undefined, entry.asOf ? `as of ${entry.asOf.slice(0, 16).replace('T', ' ')} UTC` : undefined, entry.reason ? `reason ${reasonWords(entry.reason)}` : undefined].filter(Boolean);
  return `- ${coverageTag(entry.state)} ${DIMENSION_WORDS[dimension]}: ${entry.state}${facts.length ? ` (${facts.join('; ')})` : ''}${entry.detailUrl ? ` — ${entry.detailUrl}` : ''}`;
}

function freshnessLine(f: HeySourceFreshness): string {
  if (!f.observedAt) return `- UNKNOWN ${f.label}: HEY has never read it`;
  return `- ${f.state === 'fresh' ? 'FACT' : f.state === 'stale' ? 'FACT (stale)' : 'UNKNOWN'} ${f.label}: last read ${f.observedAt.slice(0, 16).replace('T', ' ')} UTC (${f.state}; stale after ${f.staleAfterHours} h)`;
}

/** What each coverage dimension says HEY must not conclude, for an agent that reads only this. */
function mustNotConclude(dimensions: Record<HeyCoverageDimension, HeyCoverageEntry>): string[] {
  return (Object.entries(dimensions) as [HeyCoverageDimension, HeyCoverageEntry][])
    .filter(([, entry]) => coverageTag(entry.state) === 'UNKNOWN')
    .map(([dimension, entry]) => `${DIMENSION_WORDS[dimension]} (${entry.state})`);
}

/**
 * The Research Summary (2026-09-28) as HEY's domain composed it: each line's
 * own tag, text, freshness and typed evidence ids, printed and never
 * restated — the MCP says no more than the API does. A server that predates
 * the field prints nothing here.
 */
export function summaryLines(summary: HeyResearchSummary | undefined, sourceTitles: readonly string[] = []): string[] {
  if (!summary || summary.lines.length === 0) return [];
  const out = ["## Research summary (HEY's answer first; the sections below are its evidence)"];
  for (const line of summary.lines) {
    const stale = line.freshness === 'stale' ? ' (stale reading)' : '';
    const reason = line.tag === 'UNKNOWN' && line.reason ? ` [${reasonWords(line.reason)}]` : '';
    const evidence = line.evidence.length > 0 ? ` Evidence: ${line.evidence.map((entry) => entry.id).join(', ')}.` : '';
    // A line that repeats a ship's title carries a source's words and is quoted whole, as the agent contract types it (round 4); every other line is HEY's.
    const quotesSource = sourceTitles.some((title) => title.length > 0 && line.text.includes(title));
    out.push(`- ${line.tag} ${line.label}: ${quotesSource ? composedWords(line.text, 'research_summary_quoting_source') : derivedWords(line.text)}${stale}${reason}${evidence}`);
  }
  out.push('  Each line has a detailUrl and, for its evidence ids, a receiptUrl on the snapshot; get_evidence id=<id> reads one.', '');
  return out;
}

/** `GET /api/projects/{slug}/snapshot` as text. */
export function renderSnapshot(s: HeyProjectSnapshot, now?: Date): string {
  const i = s.identity;
  const b = s.build;
  const lines: string[] = [`# ${quotedName(i.name, i.symbol)} — snapshot as of ${s.asOf.slice(0, 16).replace('T', ' ')} UTC`, i.url, ''];

  lines.push(...summaryLines(s.summary, s.latestChanges.available ? s.latestChanges.items.flatMap((item) => (item.op === 'upsert' && summaryIsSourceText(item.id, item.type) ? [item.summary] : [])) : []));

  lines.push('## Identity');
  lines.push(`- DERIVED research level: ${pretty(i.researchLevel)}; catalogue: ${pretty(i.catalogStatus)}; kind: ${pretty(i.projectKind)}${i.primaryNarrative ? `; narrative: ${quoteExternal(i.primaryNarrative.name, 'narrative')}` : ''}`);
  lines.push(`- FACT first recorded by HEY ${i.firstRecordedByHeyAt.slice(0, 10)} (HEY's knowledge time)${i.externalListedAt ? `; listed by ${i.externalListedSource ?? 'an outside registry'} ${i.externalListedAt.slice(0, 10)} (their date, not HEY's)` : ''}`);
  lines.push(i.token ? `- FACT token: chain ${i.token.chainId}, contract ${i.token.contractAddress}` : '- FACT no token recorded — this is a project page, not a token.');

  lines.push('', '## Build');
  if (i.researchLevel === 'INDEXED') lines.push('- UNKNOWN activity: not researched yet — HEY indexed this record but has not read its sources.');
  else if (b.activityMeasured === false) lines.push(`- UNKNOWN activity (${pretty(b.activityStatus)}): HEY holds no builder source it can read, so no count here is a measured zero.`);
  else lines.push(`- ${activityTag(b.activityStatus)} activity status: ${pretty(b.activityStatus)}${b.lastShippedAt ? `; last meaningful ship ${b.lastShippedAt.slice(0, 10)}` : ''}`);
  lines.push(b.buildMomentum === undefined ? '- UNKNOWN Build Momentum: not measured' : `- DERIVED Build Momentum ${b.buildMomentum}${s.scoringVersion ? ` (${s.scoringVersion})` : ''}`);
  lines.push(
    b.discoveryGap !== undefined
      ? `- DERIVED Discovery Gap ${b.discoveryGap}`
      : b.discoveryGapWithheld
        ? `- UNKNOWN Discovery Gap: ${withheldWords(GAP_WITHHELD_WORDS, b.discoveryGapWithheld)} (${b.discoveryGapWithheld})`
        : '- UNKNOWN Discovery Gap: not measured',
  );
  if (b.velocity) {
    lines.push(
      b.velocity.current === null
        ? `- UNKNOWN build velocity (${pretty(b.velocity.state)})`
        : `- DERIVED build velocity: ${pretty(b.velocity.state)} — ${b.velocity.current} meaningful events in ${b.velocity.windowDays} days${b.velocity.previous === null ? ', no earlier window to compare' : ` against ${b.velocity.previous} before`}`,
    );
  } else lines.push('- UNKNOWN build velocity');
  lines.push(b.cadence?.medianIntervalDays !== undefined ? `- DERIVED release cadence: a release day every ${b.cadence.medianIntervalDays} days (median)` : '- UNKNOWN release cadence: fewer than three release days');
  // Round 4 (2026-09-30): the three states `stillBuilding: false` cannot tell apart, from the API's own field.
  const stillState = stillBuildingStateOf({ apiState: b.stillBuildingState });
  if (b.stillBuilding) {
    const evidence = stillBuildingEvidence(b);
    lines.push(`- DERIVED STILL BUILDING${evidence ? `: ${evidence}` : ''}. ${STILL_BUILDING_MEANING} (stillBuildingState ${stillState})`);
  } else if (b.stillBuildingWithheld) {
    // Not measured, never "not met" (hbm-v19): the market is not one HEY measures a drawdown on.
    lines.push(`- UNKNOWN Still Building: ${withheldWords(STILL_BUILDING_WITHHELD_WORDS, b.stillBuildingWithheld)} (${b.stillBuildingWithheld}; stillBuildingState ${stillState})`);
  } else if (stillState === 'NOT_MEASURED') {
    lines.push('- UNKNOWN Still Building: not measured — HEY has not scored this project (stillBuildingState NOT_MEASURED)');
  } else {
    lines.push('- DERIVED Still Building: does not hold — measured, and not met (stillBuildingState NOT_HELD)');
  }

  lines.push('', '## Market (context, never a ranking input)');
  const m = s.market;
  if (!m) lines.push('- NOT APPLICABLE: no tracked token, so no market.');
  else {
    if (m.tokenMarket) lines.push(`- DERIVED token market: ${tokenMarketWords(m.tokenMarket.status)}${m.tokenMarket.reason ? ` (${pretty(m.tokenMarket.reason)})` : ''}. A reading of the market, not of the team.`);
    if (m.marketCap) lines.push(`- FACT ${valuationWord(m.marketCap.kind)} ${money(m.marketCap.usd)} (${m.marketCap.source}${m.marketCap.observedAt ? `, ${m.marketCap.observedAt.slice(0, 10)}` : ''})`);
    else if (m.valuationWithheld) lines.push(`- DERIVED valuation withheld: ${valuationWithheldClause(m.valuationWithheld)}. HEY holds a figure and does not publish it.`);
    else lines.push('- UNKNOWN valuation: no fresh reading.');
    lines.push(m.liquidity ? `- FACT ${liquidityWords(m.liquidity, now)}` : '- UNKNOWN liquidity: no reading.');
    if (m.volume24h) lines.push(`- FACT 24h volume ${money(m.volume24h.usd)}${m.volume24h.source ? ` (${m.volume24h.source})` : ''}`);
    if (m.launchStage) lines.push(`- FACT launch stage: ${pretty(m.launchStage)}`);
    if (m.promotion) lines.push(promotionLine(m.promotion));
    lines.push(`- Market in depth: ${m.url}`);
  }

  lines.push('', '## Protocol economics (registry context, never building)');
  lines.push(...economicsLines(s.protocolEconomics, s.coverage?.protocolEconomics));

  lines.push('', '## Developer footprint (context, never a ship)');
  lines.push(...(s.developerFootprint ? footprintLines(s.developerFootprint) : ["- UNKNOWN developer footprint: HEY could not read this project's coverage."]));

  lines.push('', '## Security context (evidence, never a verdict)');
  lines.push(...(s.security ? securityLines(s.security) : ["- UNKNOWN security context: HEY could not read it just now."]));

  lines.push('', '## On-chain');
  const o = s.onchain;
  if (!o) lines.push('- UNKNOWN on-chain use: HEY holds no reading of the contract.');
  else {
    /*
     * The event sums cover only the days HEY could read (audit §45 #7): with a
     * blind day in the window, the figure is over those days, the rest are
     * unknown, and the newest readable day may not be the latest one.
     */
    const partial = o.daysMeasured < o.daysCovered;
    const events = partial
      ? `- FACT ${o.events24h} contract events on the newest day HEY could read${o.events7d === undefined ? '' : `, ${o.events7d} over the ${o.daysMeasured} days HEY could read`} (${o.daysCovered - o.daysMeasured} of ${o.daysCovered} days unreadable: unknown, not zero)`
      : `- FACT ${o.events24h} contract events in 24 h${o.events7d === undefined ? '' : `, ${o.events7d} over ${o.daysCovered} days`}`;
    lines.push(
      o.events24h === undefined
        ? `- UNKNOWN contract events: HEY could not index them (${o.daysMeasured} of ${o.daysCovered} days readable)${o.calls24h === undefined ? '' : `; FACT ${o.calls24h} calls in 24 h`}`
        : `${events}${o.calls24h === undefined ? '' : `; ${o.calls24h} calls in 24 h`} (read ${o.observedAt.slice(0, 10)}). Usage says the contract is used, not that anyone is building.`,
    );
  }

  lines.push('', '## Usage (its own dimension, never building or a ranking)');
  lines.push(...(s.usage ? usageLines(s.usage) : ["- UNKNOWN usage: HEY could not read this project's usage just now."]));

  lines.push('', '## Peer context (one dimension at a time, never a score)');
  lines.push(...peerContextLines(s.peerContext));

  lines.push('', '## Verification and sources');
  const v = s.verification;
  if (v.token) lines.push(`- ${v.token.status === 'UNVERIFIED' ? 'UNKNOWN' : 'FACT'} token verification: ${pretty(v.token.status)}${v.token.reason ? ` (${pretty(v.token.reason)})` : ''}`);
  lines.push(`- FACT ownership: ${v.ownerVerified ? 'claimed by a verified owner' : v.submitted ? 'self-reported at submission, not verified' : 'not claimed'}`);
  lines.push(`- FACT sources: ${v.sources.total} registered, ${v.sources.own} the project's own, ${v.sources.verified} verified, ${v.sources.contextOnly} context only (not this project's evidence)`);
  lines.push(s.evidenceSummary.meaningfulEvents30d === null ? '- UNKNOWN meaningful events in 30 days: not measured' : `- DERIVED ${s.evidenceSummary.meaningfulEvents30d} meaningful events in 30 days`);

  lines.push('', '## Locks and integrity');
  const lock = s.locks.tokenLock;
  if (lock) {
    lines.push(
      `- FACT HoodLock: ${lock.supplyPct === undefined ? 'a live lock' : `${lock.supplyPct}% of supply locked`}${lock.nextUnlockAt ? `; next unlock ${lock.nextUnlockAt.slice(0, 10)}${lock.nextUnlockPct === undefined ? '' : ` (${lock.nextUnlockPct}% of supply)`}` : ''}${lock.until ? `; last unlock ${lock.until.slice(0, 10)}` : ''}${lock.pairLocked ? '; LP locked' : ''}`,
    );
  } else if (s.locks.coverage) {
    lines.push(`- ${coverageTag(s.locks.coverage.state)} locks: ${s.locks.coverage.state}${s.locks.coverage.reason ? ` (${s.locks.coverage.reason})` : ''} — HoodLock only; other lockers are not read, so this is not "no lock".`);
  } else lines.push('- UNKNOWN locks: HoodLock only, and HEY found none; other lockers are not read.');
  lines.push(`- ${s.integrity.state === 'MEASURED' ? 'DERIVED' : s.integrity.state === 'NOT_APPLICABLE' ? 'FACT' : 'UNKNOWN'} market integrity: ${s.integrity.state} (${s.integrity.reason})`);

  lines.push('', '## Latest changes');
  if (s.latestChanges.available) {
    if (s.latestChanges.items.length === 0) lines.push('- FACT no public change recorded yet.');
    for (const c of s.latestChanges.items) {
      if (c.op === 'retract') lines.push(`- RETRACTED ${c.id}`);
      else lines.push(`- ${c.precision} ${atPrecision(c.occurredAt, c.precision, c.detectedAt)} · ${c.type}: ${summaryWords(c.id, c.summary, c.type)} (id ${c.id})`);
    }
    lines.push(`  More: get_changes with project=${i.slug}, or ${s.latestChanges.url}`);
  } else lines.push(`- UNKNOWN changes: ${s.latestChanges.reason} — ${s.latestChanges.url}`);

  lines.push('', '## Freshness');
  for (const f of s.freshness) lines.push(freshnessLine(f));
  if (s.coverage) {
    const gaps = mustNotConclude(s.coverage);
    lines.push('', '## What HEY does not know');
    lines.push(gaps.length ? `- UNKNOWN: ${gaps.join(', ')}. Do not read these as zero or as "none".` : '- Every dimension is measured or does not apply.');
    lines.push(`  Per dimension: get_project_coverage slug=${i.slug}`);
  }

  const l = s.links;
  lines.push('', `Links: detail ${l.detail} · timeline ${l.timeline} · changes ${l.changes} · coverage ${l.coverage} · explain ${l.explain} · contracts ${l.contracts}${l.market ? ` · market ${l.market}` : ''}`);
  lines.push(TAG_LEGEND, s.disclaimer);
  return lines.join('\n');
}

const PROMOTION_WORDS: Record<HeyMarketPromotion['entries'][number]['kind'], string> = {
  MARKET_PROMOTION_OBSERVED: 'paid promotion',
  COMMUNITY_TAKEOVER_PROFILE_OBSERVED: 'community-takeover profile',
};

/** Paid promotion and takeover sightings (2026-09-27): presence and dates, never an amount, never a ranking input. */
export function promotionLine(p: HeyMarketPromotion): string {
  const newest = p.entries[0];
  const when = newest ? (newest.providerAt ? `${newest.providerAt.slice(0, 10)} (the provider's date)` : `${newest.firstObservedAt.slice(0, 10)} (first seen by HEY)`) : undefined;
  return `- FACT promotion or takeover seen ${p.total} time${p.total === 1 ? '' : 's'}${newest ? `; newest: ${PROMOTION_WORDS[newest.kind]} on ${newest.channel}, ${when}` : ''}. Context only: paid promotion never reaches a ranking, a score or a signal of building.`;
}

const METRIC_LABEL = { fees24h: 'fees 24h', revenue24h: 'revenue 24h', dexVolume24h: 'DEX volume 24h' } as const;

function metricWords(label: string, metric: HeyEconomicsMetric): string {
  if (metric.state === 'MEASURED') return `FACT ${label} ${metric.valueUsd === 0 ? 'zero, as measured' : money(metric.valueUsd)}`;
  if (metric.state === 'NOT_TRACKED') return `FACT ${label}: not tracked by the registry`;
  return `UNKNOWN ${label}: ${metric.state === 'SOURCE_UNAVAILABLE' ? 'the registry did not answer' : 'not read yet'}`;
}

/** What DefiLlama measures of a matched protocol (2026-09-27), each metric in its own state; absent says why, from coverage. */
export function economicsLines(e: HeyProtocolEconomics | undefined, coverage: HeyCoverageEntry | undefined): string[] {
  if (!e || e.protocols.length === 0) {
    if (!coverage) return ["- UNKNOWN protocol economics: HEY could not read this project's coverage."];
    return [`- ${coverageTag(coverage.state)} protocol economics: ${coverage.state}${coverage.reason ? ` (${reasonWords(coverage.reason)})` : ''}`];
  }
  const lines: string[] = [];
  for (const p of e.protocols) {
    lines.push(`- FACT DefiLlama lists ${quoteExternal(p.protocolName, 'defillama')}${p.category ? ` (${quoteExternal(p.category, 'defillama')})` : ''}, matched by ${pretty(p.matchedBy)}: TVL ${money(p.tvlUsd)} on ${p.tvlDay}`);
    const metrics = (Object.keys(METRIC_LABEL) as (keyof typeof METRIC_LABEL)[]).map((key) => metricWords(METRIC_LABEL[key], p[key]));
    lines.push(`  ${metrics.join('; ')}${p.economicsDay ? ` (for ${p.economicsDay})` : ''}`);
    if (p.auditLinks.length > 0 || p.methodologyUrl) lines.push(`  FACT the registry links ${p.auditLinks.length} audit report${p.auditLinks.length === 1 ? '' : 's'}${p.methodologyUrl ? ' and a methodology' : ''} — links, never verdicts`);
  }
  lines.push('  A registry figure is context beside the market: it never reaches activity status, Build Momentum, the Discovery Gap or the Radar.');
  return lines;
}

const AUDIT_AUTHORITY_WORDS = { AUDITOR_PUBLISHED: "on the auditor's own site", PROJECT_CLAIMED: "claimed by the project (linked from its official site)", REGISTRY_LISTED: 'listed by DefiLlama only' } as const;
const INDEX_WORDS: Record<string, string> = { official_site: "the project's homepage", official_site_files: 'its sitemap and llms.txt', defillama: 'its DefiLlama listing' };
const indexes = (readFrom: string[]): string => readFrom.map((index) => INDEX_WORDS[index] ?? pretty(index)).join(', ');

/**
 * Security context (2026-09-28): what HEY found, each item with where it was
 * found; "none found" names the indexes read; unread is UNKNOWN. No score and
 * no verdict, and no stronger than the API's own states.
 */
export function securityLines(c: HeySecurityContext): string[] {
  const lines: string[] = [];
  const a = c.audits;
  if (a.state === 'MEASURED') {
    lines.push(`- FACT ${a.items.length} audit report link${a.items.length === 1 ? '' : 's'} found (read from ${indexes(a.readFrom)}):`);
    for (const item of a.items.slice(0, 5)) {
      lines.push(`  - ${item.auditor ? `${quoteExternal(item.auditor.name, 'auditor_link')}${item.auditor.basis === 'URL_PATH' ? ' (named in the link only)' : ''}, ` : ''}${AUDIT_AUTHORITY_WORDS[item.authority]}: ${item.url} [${item.id}]`);
    }
    if (a.items.length > 5) lines.push(`  (showing 5 of ${a.items.length}; the full list is in the snapshot's security.audits)`);
  } else if (a.state === 'NONE_FOUND') lines.push(`- FACT no audit link found on ${indexes(a.readFrom)} (read ${a.readAt.slice(0, 10)}) — a reading of those only`);
  else lines.push(`- ${a.state === 'NOT_APPLICABLE' ? 'FACT' : 'UNKNOWN'} audits: ${pretty(a.state)} (${pretty(a.reason)})`);
  const b = c.bugBounty;
  if (b.state === 'MEASURED') for (const item of b.items.slice(0, 3)) lines.push(`- FACT bug bounty ${item.platform ? `on ${quoteExternal(item.platform, 'bounty_platform')}` : "page on the project's site"}: ${item.url} [${item.id}]`);
  else if (b.state === 'NONE_FOUND') lines.push(`- FACT no bug-bounty link found on ${indexes(b.readFrom)} — a reading of those only`);
  else lines.push(`- UNKNOWN bug bounty: ${pretty(b.state)} (${pretty(b.reason)})`);
  const t = c.securityTxt;
  if (t.state === 'MEASURED') lines.push(`- FACT security.txt published${t.contacts ? ` with ${t.contacts.length} contact${t.contacts.length === 1 ? '' : 's'}` : ''}${t.expired ? ' (its Expires date has passed)' : ''}, read ${t.readAt.slice(0, 10)}: ${t.url}`);
  else if (t.state === 'NONE_FOUND') lines.push(`- FACT no security.txt at ${t.url} (read ${t.readAt.slice(0, 10)})`);
  else lines.push(`- ${t.state === 'NOT_APPLICABLE' ? 'FACT' : 'UNKNOWN'} security.txt: ${pretty(t.state)} (${pretty(t.reason)})`);
  const v = c.advisories;
  if (v.state === 'MEASURED') {
    lines.push(`- FACT ${v.items.length} open OSV advisor${v.items.length === 1 ? 'y' : 'ies'} about the published versions of ${v.packagesRead} package${v.packagesRead === 1 ? '' : 's'} HEY reads${v.stale ? ' (reading stale)' : ''}:`);
    for (const item of v.items.slice(0, 5)) lines.push(`  - ${item.advisoryId} on ${quoteExternal(`${item.packageName}@${item.version}`, 'package_registry')}${item.fixedVersions.length > 0 ? `, fixed in ${item.fixedVersions.join(', ')}` : ''}: ${item.url}`);
  } else if (v.state === 'NONE_FOUND') lines.push(`- FACT no open OSV advisory for the published versions of the ${v.packagesRead} package${v.packagesRead === 1 ? '' : 's'} HEY reads${v.readAt ? ` (read ${v.readAt.slice(0, 10)})` : ''} — a reading of OSV, not a statement about the code`);
  else lines.push(`- ${v.state === 'NOT_APPLICABLE' ? 'FACT' : 'UNKNOWN'} advisories: ${pretty(v.state)} (${pretty(v.reason)})`);
  const r = c.repositoryChecks;
  if (r.state === 'MEASURED') for (const repo of r.repositories.slice(0, 3)) lines.push(`- FACT OpenSSF Scorecard for ${quoteExternal(repo.repo, 'git_host')}: ${repo.checks.length} checks as published${repo.date ? ` (${repo.date.slice(0, 10)})` : ''}, never summed`);
  else if (r.state === 'NONE_FOUND') lines.push(`- FACT no Scorecard published for the ${r.repositoriesRead} official repositor${r.repositoriesRead === 1 ? 'y' : 'ies'} HEY asked about`);
  else lines.push(`- ${r.state === 'NOT_APPLICABLE' ? 'FACT' : 'UNKNOWN'} repository checks: ${pretty(r.state)} (${pretty(r.reason)})`);
  lines.push(`- UNKNOWN incidents: HEY reads no incident or postmortem source.`);
  lines.push(`  ${c.meaning} Nothing here reaches activity status, Build Momentum, the Discovery Gap or the Radar.`);
  return lines;
}

/** The developer footprint in four lines (2026-09-27): each in its coverage state; a count only where measured. */
export function footprintLines(f: HeyDeveloperFootprint): string[] {
  const read = (at: string | undefined) => (at ? `, read ${at.slice(0, 10)}` : '');
  const r = f.repositories;
  // "None held" is a gap unless coverage says repositories do not apply (review repair, 2026-09-27): the tag follows the state.
  const repos =
    r.official === 0
      ? `- ${coverageTag(r.state)} official repositories: none held (${r.state}, ${reasonWords(r.reason)})`
      : `- ${coverageTag(r.state)} official repositories: ${r.official}; metadata read for ${r.metadataRead} (${r.state}, ${reasonWords(r.reason)})`;
  const d = f.productionDeployment;
  const deployment =
    d.state === 'MEASURED'
      ? `- FACT newest production deployment ${d.at.slice(0, 10)} (environment ${quoteExternal(d.environment, 'github_deployment')}${read(d.readAt)}) — a dated record of an environment, not building`
      : d.state === 'NONE_FOUND'
        ? `- FACT no production deployment recorded on GitHub${read(d.readAt)} (other hosts are not read)`
        : d.state === 'NOT_APPLICABLE'
          ? '- FACT production deployments: not applicable (no official repository)'
          : `- UNKNOWN production deployments: ${d.state === 'ERROR' ? 'the last read failed' : 'not read yet'}`;
  const k = f.packages;
  const packages =
    k.accepted !== undefined && k.claimed !== undefined && (k.accepted > 0 || k.claimed > 0)
      ? `- ${coverageTag(k.state)} packages: ${k.accepted} accepted as the project's own, ${k.claimed} claimed (a claim rests only on what its publisher typed, such as an official repository or homepage). A package publication is never a ship.`
      : `- ${coverageTag(k.state)} packages: ${k.state} (${reasonWords(k.reason)})`;
  const a = f.advisories;
  const advisories =
    a.current !== undefined
      ? `- ${a.state === 'STALE' ? 'FACT (stale)' : 'FACT'} ${a.current} current advisor${a.current === 1 ? 'y' : 'ies'} about accepted packages' published versions${a.asOf ? ` (read ${a.asOf.slice(0, 10)})` : ''} — about a published version, never a verdict on the project`
      : `- ${coverageTag(a.state)} package advisories: ${a.state} (${reasonWords(a.reason)})`;
  return [repos, deployment, packages, advisories, `  Per dimension: ${f.coverageUrl}`];
}

/** `GET /api/projects/{slug}/coverage` as text: states, never a score. */
export function renderCoverage(c: HeyProjectCoverage): string {
  const lines: string[] = [`# ${quotedName(c.project.name)} — what HEY knows and does not (computed ${c.computedAt.slice(0, 16).replace('T', ' ')} UTC)`, c.project.url, ''];
  for (const [dimension, entry] of Object.entries(c.dimensions) as [HeyCoverageDimension, HeyCoverageEntry][]) lines.push(coverageLine(dimension, entry));
  const gaps = mustNotConclude(c.dimensions);
  lines.push('', gaps.length ? `Do not conclude anything from: ${gaps.join(', ')}. A missing figure there is unknown, never zero.` : 'Every dimension is measured or does not apply.');
  lines.push('', 'Freshness:', ...c.freshness.map(freshnessLine));
  const used = new Set(Object.values(c.dimensions).map((entry) => entry.state));
  lines.push('', 'States:', ...(Object.entries(c.states) as [HeyCoverageState, string][]).filter(([state]) => used.has(state)).map(([state, meaning]) => `- ${state}: ${meaning}`));
  lines.push('', 'Coverage is a set of states, never a score. FACT = measured or does not apply; UNKNOWN = HEY does not hold it.', c.disclaimer);
  return lines.join('\n');
}

const inputValue = (value: unknown): string => (value === null ? 'null (not held)' : Array.isArray(value) ? value.join(', ') : String(value));

/** `GET /api/projects/{slug}/explain?fact=` as text: the engine's state, never a stronger one. */
export function renderExplained(e: HeyExplainedFact): string {
  const lines: string[] = [`# Why HEY shows ${e.fact} for ${quotedName(e.project.name)}`, e.project.url, ''];
  lines.push(`${e.state} ${e.fact}: ${inputValue(e.value)} — ${e.classification}`);
  lines.push(`Rule: ${e.canonicalRule.id} (${e.canonicalRule.version}): ${e.canonicalRule.text}`);
  const provenance = [e.source ? `source ${e.source}` : 'no single source', e.observedAt ? `observed ${e.observedAt.slice(0, 16).replace('T', ' ')} UTC` : undefined, e.freshness ? `${e.freshness.state} (stale after ${e.freshness.staleAfterHours} h)` : undefined].filter(Boolean);
  lines.push(`Provenance: ${provenance.join('; ')}.`);
  if (e.inputs.length > 0) lines.push('', 'Inputs:', ...e.inputs.map((input) => `- ${input.name}: ${inputValue(input.value)}${input.source ? ` (${input.source}${input.observedAt ? `, ${input.observedAt.slice(0, 10)}` : ''})` : ''}`));
  if (e.lineage.length > 0) lines.push('', 'Lineage:', ...e.lineage.map((step) => `- ${step.step}: ${step.text}`));
  if (e.unknownInputs.length > 0) lines.push('', `UNKNOWN inputs HEY does not hold: ${e.unknownInputs.join(', ')}.`);
  if (e.evidence.length > 0) lines.push('', 'Evidence (open with get_evidence):', ...e.evidence.map((item) => `- ${item.id} — ${item.url}`));
  lines.push('', `Reason: ${e.reason}`, TAG_LEGEND, e.disclaimer);
  return lines.join('\n');
}

export function renderExplainIndex(index: HeyExplainIndex): string {
  return [`# Facts HEY can explain for ${quotedName(index.project.name)}`, index.project.url, '', ...index.facts.map((f) => `- ${f.fact}: ${f.description}`), '', 'Call explain_fact again with one of these as `fact`.', index.disclaimer].join('\n');
}

/** `GET /api/evidence/{id}` as text. A withdrawn receipt names nothing it may not. */
export function renderEvidence(r: HeyEvidenceReceipt): string {
  if (r.withdrawn) {
    return [`# ${r.id} — withdrawn`, `HEY no longer makes this claim (${pretty(r.withdrawalReason)}). Do not cite it.${r.project ? ` Project: ${quotedName(r.project.name)} — ${r.project.url}` : ''}`, '', r.disclaimer].join('\n');
  }
  const lines: string[] = [`# Evidence ${r.id}`, `${quotedName(r.project.name)} — ${r.project.url}`, ''];
  // A status or market-state move and a signal are rules HEY applied: DERIVED, as explain_fact says (audit §45 #8).
  lines.push(`${recordTag(r.id)} ${r.claimType} (${r.domain}): ${summaryWords(r.id, r.summary)}`);
  lines.push(`When: ${atPrecision(r.publishedAt, r.precision, r.detectedAt)} (${r.precision}); HEY first knew ${r.detectedAt.slice(0, 16).replace('T', ' ')} UTC; recorded ${r.recordedAt.slice(0, 10)}.`);
  lines.push(`Source: ${r.sourceType}${r.sourceUrl ? ` — ${r.sourceUrl}` : ' (no public URL; HEY\'s own observation)'}${r.verification ? `; backing: ${pretty(r.verification)}` : ''}${r.countsAsBuilding ? '; counts toward activity status' : ''}.`);
  if (r.sources && r.sources.length > 0) lines.push('', 'Evidence rows:', ...r.sources.map((row) => `- ${row.sourceType}: ${row.sourceUrl} (observed ${row.observedAt.slice(0, 10)})`));
  lines.push('', r.disclaimer);
  return lines.join('\n');
}

function proxyWords(proxy: HeyContract['proxy']): string {
  if (proxy.state !== 'MEASURED') return `UNKNOWN proxy: ${proxy.state === 'NOT_READ' ? 'not read yet' : pretty(proxy.state)} — never read this as "not a proxy"`;
  if (proxy.status === 'PROXY') {
    const kind = proxy.kind === 'BEACON' ? 'a beacon proxy' : proxy.kind === 'EXPLORER_REPORTED' ? 'a proxy, as the explorer reports it' : 'an EIP-1967 proxy';
    return `FACT ${kind}${proxy.implementation ? `; implementation ${proxy.implementation}` : ''}${proxy.beacon ? `; beacon ${proxy.beacon}` : ''}${proxy.checkedAt ? ` (checked ${proxy.checkedAt.slice(0, 10)})` : ''}${proxy.changedAt ? `; implementation last changed ${proxy.changedAt.slice(0, 10)}` : ''}`;
  }
  if (proxy.status === 'ERROR') return 'UNKNOWN proxy: the last read failed';
  const when = proxy.checkedAt ? ` at the check on ${proxy.checkedAt.slice(0, 10)}` : '';
  // Only a reading that looked in all three places says so; an older one read the implementation slot alone.
  return proxy.kind === 'NONE_DETECTED'
    ? `FACT no proxy pattern detected in the EIP-1967 implementation slot, the beacon slot or the explorer's claim${when}`
    : `FACT no proxy pattern detected in the EIP-1967 implementation slot${when} (an older check that did not read the beacon slot)`;
}

/**
 * What HEY says about a token's deployer (audit §45 #19). "A launch service"
 * only on HEY's own shared-deployer flag — the rule that stops crediting its
 * later deployments to the project, the one /market reads too. Below it, a
 * count of other tracked projects is a count, never a label.
 */
function deployerWords(d: NonNullable<HeyContract['deployer']>): string {
  const n = d.otherProjectsCount;
  const others = `${n} other tracked ${n === 1 ? 'project' : 'projects'}`;
  if (d.sharedAcrossTrackedProjects) return ` — HEY marks this deployer shared: it also deployed the token of ${others} (a launch service, not one team; none of its later deployments is credited to a project)`;
  return n > 0 ? ` — the same account also deployed the token of ${others}` : '';
}

function contractLines(c: Omit<HeyContract, 'disclaimer'>): string[] {
  const lines: string[] = [];
  lines.push(`${c.name ? `${quoteExternal(c.name, 'contract_explorer')} — ` : ''}chain ${c.chainId}, ${c.address}${c.role ? ` (${c.role})` : ''}${c.watched ? '' : ' — listed, not watched: HEY has not read this contract yet'}`);
  lines.push(c.associatedProject ? `- FACT project: ${quotedName(c.associatedProject.name)} — ${c.associatedProject.url}` : '- UNKNOWN project: no single published project claims this contract (none does, or more than one does equally).');
  if (c.creation) lines.push(`- FACT created ${c.creation.at ? atPrecision(c.creation.at, c.creation.precision) : 'at an unread time'}${c.creation.tx ? ` in ${c.creation.tx}` : ''}${c.creation.block ? `, block ${c.creation.block}` : ''}`);
  if (c.deployer) lines.push(`- FACT deployed by ${c.deployer.address}${deployerWords(c.deployer)}`);
  if (c.factory) lines.push(`- FACT created through factory ${c.factory}`);
  const src = c.verifiedSource;
  lines.push(
    src.state === 'MEASURED'
      ? `- FACT verified source: ${src.verified ? 'yes' : 'no'}${src.compiler ? `; compiler ${quoteExternal(src.compiler, 'contract_explorer')}` : ''}${src.contractName ? `; name ${quoteExternal(src.contractName, 'contract_explorer')}` : ''}${src.checkedAt ? ` (checked ${src.checkedAt.slice(0, 10)})` : ''}${src.method ? `; ${VERIFICATION_METHOD_WORDS[src.method]}${src.match ? ` (${src.match.toLowerCase()} match)` : ''}` : ''}`
      : `- UNKNOWN verified source: ${pretty(src.state)}`,
  );
  if (src.authorship) lines.push(`- DERIVED whose code: ${AUTHORSHIP_WORDS[src.authorship.kind]} (${pretty(src.authorship.reason)})`);
  lines.push(sourcifyWords(src.sourcify));
  lines.push(`- ${proxyWords(c.proxy)}`);
  if (c.proxy.clonedFrom) lines.push(`- FACT an immutable minimal clone (EIP-1167) of ${c.proxy.clonedFrom}, as the explorer reports it: its code is that contract's and cannot change`);
  for (const h of c.proxy.history.slice(0, 5)) lines.push(`  ${h.precision} ${atPrecision(h.occurredAt, h.precision, h.detectedAt)} · ${h.event ?? 'implementation changed'} → ${h.implementation ?? 'unknown'} (${h.source === 'onchain_logs' ? 'read from the chain\'s logs' : 'seen by HEY between two reads'}; id ${h.id})`);
  const itf = c.interface;
  lines.push(itf.state === 'MEASURED' ? `- FACT interface: ${itf.functionCount ?? '?'} functions, ${itf.eventCount ?? '?'} events${itf.baselineSince ? `, baseline since ${itf.baselineSince.slice(0, 10)}` : ''}; ${itf.changes.length} recorded change${itf.changes.length === 1 ? '' : 's'}` : `- UNKNOWN interface: ${pretty(itf.state)}`);
  for (const ch of itf.changes.slice(0, 5)) lines.push(`  ${ch.detectedAt.slice(0, 10)} ${pretty(ch.kind)}: +${ch.functionsAdded}/−${ch.functionsRemoved} functions, +${ch.eventsAdded}/−${ch.eventsRemoved} events (id ${ch.id})`);
  const a = c.activity;
  lines.push(
    a.state === 'MEASURED'
      ? `- FACT activity over ${a.daysMeasured} measured days: ${a.calls7d === null ? 'calls not read' : `${a.calls7d} calls in 7 days`}, ${a.events7d === null ? 'events not indexed (unknown, not zero)' : `${a.events7d} events in 7 days`}${a.newestDay ? ` (newest day ${a.newestDay})` : ''}`
      : `- UNKNOWN activity: ${pretty(a.state)}`,
  );
  lines.push(methodWords(a.methods));
  if (c.evidence.length > 0) lines.push(`- Evidence ids: ${c.evidence.slice(0, 8).join(', ')}${c.evidence.length > 8 ? ` and ${c.evidence.length - 8} more` : ''}`);
  return lines;
}

const VERIFICATION_METHOD_WORDS: Record<NonNullable<HeyContract['verifiedSource']['method']>, string> = {
  SOURCE_PUBLISHED: 'source published for this address',
  BYTECODE_MATCH: 'matched by the explorer to source published for identical bytecode, not published for this address',
  SOURCIFY: 'source published through Sourcify',
  VERIFIER_ALLIANCE: 'source published through the Verifier Alliance',
};

const AUTHORSHIP_WORDS: Record<NonNullable<HeyContract['verifiedSource']['authorship']>['kind'], string> = {
  TEMPLATE: 'a launchpad template, not project-authored code',
  EXPLORER_MATCHED: "a bytecode match to someone else's source",
  PROJECT_AUTHORED: 'source published for this address',
  UNCONFIRMED: "not yet known (the explorer's record has not been read)",
};

/** Sourcify's answer: NOT_READ is never "not verified". */
function sourcifyWords(v: HeyContract['verifiedSource']['sourcify']): string {
  if (v.state === 'NOT_READ') return '- UNKNOWN Sourcify: not read (HEY asks only for watched contracts the explorer calls unverified, and proxies) — not "unverified"';
  if (v.state === 'ERROR') return '- UNKNOWN Sourcify: the last read failed';
  const when = v.checkedAt ? ` (checked ${v.checkedAt.slice(0, 10)})` : '';
  return v.status === 'MATCH' ? `- FACT Sourcify holds verified source for it${v.match ? ` (${pretty(v.match)})` : ''}${when}` : `- FACT Sourcify holds no source for it${when}`;
}

/**
 * Calls per method (2026-09-27) as one line: counts by bucket and how many of
 * the contract's own functions were called, never which. A contract HEY has
 * not read that way is UNKNOWN, never "no calls".
 */
function methodWords(m: HeyContract['activity']['methods']): string {
  if (m.state !== 'MEASURED' || !m.window || m.calls === undefined || !m.buckets) {
    return `- UNKNOWN calls per method: HEY has not read this contract's calls by method${m.collectedThrough ? ` in the last seven days (it holds ${m.collectedFrom} to ${m.collectedThrough})` : ''}.`;
  }
  const b = m.buckets;
  const share = (n: number) => (m.calls ? `${Math.round((n / m.calls) * 100)}%` : '0%');
  const extras = [
    m.namedFromAbi ? `${m.namedFromAbi} of the named calls were named by the contract's own verified ABI.` : undefined,
    m.undecodedWithCandidates
      ? `${m.undecodedWithCandidates} undecoded selector${m.undecodedWithCandidates === 1 ? ' has' : 's have'} a signature candidate — a database's guess, never a name, and not counted as named.`
      : undefined,
    m.creationCalls ? `${m.creationCalls} call${m.creationCalls === 1 ? '' : 's'} to its creation code (the deployment, not a method) counted apart.` : undefined,
  ].filter(Boolean);
  return `- FACT calls per method, ${m.window.from} to ${m.window.to} (${m.window.days} days, decoded calls): ${m.calls} calls — ERC-20 standard ${b.erc20Standard} (${share(b.erc20Standard)}), the contract's own named functions ${b.named} (${share(b.named)}), undecoded ${b.undecoded}; ${m.distinctFunctions ?? 0} of its own function${m.distinctFunctions === 1 ? '' : 's'} called.${extras.length ? ` ${extras.join(' ')}` : ''} Function names are withheld on the public API. HEY holds these counts from ${m.collectedFrom}.`;
}

/** `GET /api/contracts/{chainId}/{address}` as text. Counts, never function lists; no account but the deployer. */
export function renderContract(c: HeyContract): string {
  return [`# Contract`, c.url, '', ...contractLines(c), '', 'On-chain facts about a contract, never a verdict on it or on anyone who called it.', TAG_LEGEND, c.disclaimer].join('\n');
}

export function renderProjectContracts(p: HeyProjectContracts, limit = 10): string {
  const shown = p.items.slice(0, limit);
  const blocks = shown.map((c) => contractLines(c).join('\n'));
  return [
    `# ${quotedName(p.project.name)} — contracts on chain ${p.chainId}`,
    p.project.url,
    '',
    blocks.join('\n\n') || 'No contract is registered for this project.',
    '',
    shownOf(shown.length, p.total, shown.length < p.items.length ? `Call get_contract with chainId and address for any contract, or read ${p.project.url.replace('/project/', '/api/projects/')}/contracts.` : p.truncated ? 'The API itself lists fewer than it holds.' : undefined),
    p.method,
    TAG_LEGEND,
    p.disclaimer,
  ].join('\n');
}

function end<T>(label: string, e: HeyDiffEnd<T>, format: (value: T) => string): string {
  if (e.value === null) return `${label} UNKNOWN (${e.reason ?? 'no persisted point'})`;
  return `${label} ${format(e.value)}${e.day ? ` on ${e.day}` : ''}${e.basis ? `, ${e.basis.replace(/_/g, ' ')}` : ''}${e.scoringVersion ? `, ${e.scoringVersion}` : ''}`;
}

/** `GET /api/projects/{slug}/diff` as text: then and now from persisted points, counts on named clocks. Never a cause. */
export function renderDiff(d: HeyDiff): string {
  const lines: string[] = [`# ${quotedName(d.project.name)} — what changed between ${d.from} and ${d.to}`, d.project.url, ''];
  lines.push('## Build (counts on the date each item was published)');
  if (d.build.releasesAdded === null || d.build.meaningfulShips === null) {
    lines.push(`- UNKNOWN releases added and meaningful ships: ${d.build.countsReason ?? 'HEY does not read building for this project, so no count here is a measured zero.'}`);
  } else {
    lines.push(`- FACT releases added: ${d.build.releasesAdded}; meaningful ships: ${d.build.meaningfulShips}`);
  }
  lines.push(`- DERIVED activity status: ${end('then', d.build.status.then, pretty)} → ${end('now', d.build.status.now, pretty)}`);
  lines.push(`- DERIVED Build Momentum: ${end('then', d.build.momentum.then, String)} → ${end('now', d.build.momentum.now, String)}`);
  lines.push('', '## Market (context)');
  if (d.market.state === 'NOT_APPLICABLE') lines.push(`- NOT APPLICABLE: ${d.market.reason}`);
  else {
    /*
     * Each end is named by its own kind (audit §45 #6): a day with no supply
     * read has no kind, and an FDV beside a market cap is two measures, not
     * one figure moving. One shared word only when both ends agree.
     */
    const v = d.market.valuation;
    const same = v.then.kind === v.now.kind;
    const endOf = (label: string, e: HeyDiffEnd<number>) => end(same || e.value === null ? label : `${label} ${valuationWord(e.kind)}`, e, money);
    lines.push(`- FACT ${same ? valuationWord(v.now.kind) : 'valuation'}: ${endOf('then', v.then)} → ${endOf('now', v.now)}`);
    if (!same && v.then.value !== null && v.now.value !== null) lines.push('  The two ends are not the same measure, so the difference between them is not one figure moving.');
    lines.push(`- FACT liquidity: ${end('then', d.market.liquidity.then, money)} → ${end('now', d.market.liquidity.now, money)}`);
  }
  lines.push('', '## Changes recorded in the window (by the time HEY recorded them)');
  if (d.changes.state === 'UNAVAILABLE') lines.push(`- UNKNOWN: ${d.changes.reason}`);
  else {
    lines.push(`- FACT ${d.changes.total} change${d.changes.total === 1 ? '' : 's'}${d.changes.truncated ? ' (counted up to the cap; more exist)' : ''}${d.changes.partial && d.changes.collectedFrom ? ` (partial: the ledger began recording on ${d.changes.collectedFrom.slice(0, 10)}, so only from then)` : ''}: ${Object.entries(d.changes.byType).map(([type, n]) => `${type} ${n}`).join(', ') || 'none'}`);
    lines.push(`  Read them: get_changes with project=${d.project.slug} and since/until, or ${d.changes.url}`);
  }
  lines.push('', 'Two readings side by side, never a cause.', d.method, TAG_LEGEND, d.disclaimer);
  return lines.join('\n');
}

/** Rows of the build × market map printed before the answer points at the rest. */
const MAP_ROWS = 30;

/** `GET /api/chain/build-market` as text: two measures side by side, a map and not a ranking. */
export function renderBuildMarket(page: HeyBuildMarket): string {
  const shown = page.items.slice(0, MAP_ROWS);
  return [
    '# Build Momentum beside market attention (a map, not a ranking)',
    ...shown.map((p) => `- ${quotedName(p.name, p.symbol)}: DERIVED Build Momentum ${p.buildMomentum}; DERIVED market-attention percentile ${p.marketAttentionPercentile} (context) — ${p.url}`),
    '',
    shownOf(shown.length, page.items.length, 'The rest are in GET /api/chain/build-market.'),
    `Method: ${page.method}`,
    'A position on the map is not a recommendation, and building does not predict price.',
    TAG_LEGEND,
    page.disclaimer,
  ].join('\n');
}

/**
 * Peer context in the snapshot (2026-09-28, peers-v1), no stronger than the
 * API: each measured figure's own line, restated verbatim; a figure whose
 * cohort is too small says so; nothing is combined into one number, and a
 * position against a median is never a judgement.
 */
export function peerContextLines(p: HeyPeerContext | undefined): string[] {
  if (!p) return ["- UNKNOWN peer context: HEY could not read it just now."];
  if (p.state === 'NOT_COMPUTED') return [`- UNKNOWN peer context (${p.reason ?? 'not_computed_yet'}): the daily run has not placed this project yet.`];
  if (p.state === 'NO_COHORT' || !p.cohort) return [`- NOT APPLICABLE peer context (${p.reason ?? 'no_cohort'}): no comparable group of the same type, so nothing is compared.`];
  // A run the daily job has not replaced says so, with its date (2026-09-28): an older context never passes for today's.
  const stale = p.freshness?.state === 'STALE' ? ` STALE: not recomputed in ${p.freshness.staleAfterHours} hours; as of ${p.freshness.asOf.slice(0, 10)}.` : '';
  const lines = [`- DERIVED cohort: ${quoteExternal(p.cohort.label, 'narrative')} (${p.rulesVersion}; a median from ${p.minimums.median} measured projects, a percentile from ${p.minimums.percentile}; ${p.computedAt ? `computed ${p.computedAt.slice(0, 10)}` : 'not dated'}).${stale}`];
  for (const d of p.dimensions) {
    if (d.state !== 'MEASURED') continue;
    lines.push(`- ${d.median === null ? 'UNKNOWN' : 'DERIVED'} ${derivedWords(d.line)}`);
  }
  const recomputing = p.dimensions.filter((d) => d.state !== 'MEASURED' && d.reason === 'recomputing_after_scoring_change');
  for (const d of recomputing) lines.push(`- UNKNOWN ${derivedWords(d.line)}`);
  const unmeasured = p.dimensions.filter((d) => d.state !== 'MEASURED' && !recomputing.includes(d)).map((d) => d.label);
  if (unmeasured.length > 0) lines.push(`- UNKNOWN not measured for this project, so not compared: ${unmeasured.join(', ')}.`);
  lines.push(`  Method: ${p.methodology}`);
  return lines;
}

/**
 * Product usage in the snapshot (2026-09-28), no stronger than the API: a
 * count of distinct caller addresses is a count of addresses for one day,
 * never of people and never added across days; a window with uncovered days
 * says so; a project HEY does not watch is UNKNOWN, not zero.
 */
export function usageLines(u: HeyUsageSummary): string[] {
  const n = (value: number) => value.toLocaleString('en-US');
  if (u.state === 'NOT_APPLICABLE') return ['- NOT APPLICABLE usage: no contract recorded for this project.'];
  if (u.state === 'NOT_WATCHED') return [`- UNKNOWN usage (${u.reason}): the project has a contract, but none is in HEY's method watch, so no count here would be a measured zero.`];
  if (u.calls === undefined || !u.window) return [`- UNKNOWN usage (${u.state}, ${u.reason}): nothing rolled up for the window yet — not zero.`];
  const lines: string[] = [];
  const partial = u.daysCovered !== undefined && u.daysCovered < u.window.days;
  const span = partial ? ` over the ${u.daysCovered} of ${u.window.days} days HEY holds (${pretty(u.reason)}; the rest unknown, not zero)` : ` in ${u.window.days} d`;
  const contracts = u.activeContracts === undefined ? '' : `${n(u.activeContracts)} active of ${n(u.watchedContracts)} watched contract${u.watchedContracts === 1 ? '' : 's'} · `;
  lines.push(
    `- FACT ${contracts}${n(u.calls)} calls${span} (${u.window.from} to ${u.window.to}); ${n(u.erc20Calls ?? 0)} of them the ERC-20 surface, ${n(u.otherCalls ?? 0)} the contracts' own functions.${u.state === 'STALE' ? ' STALE: the rollup is behind.' : ''}`,
  );
  const callers = u.callerAddresses;
  if (callers) {
    const figure = (f: { day: string; count: number; basis: 'EXACT' | 'FLOOR' }) => `${n(f.count)}${f.basis === 'FLOOR' ? ' or more' : ''} on ${f.day}`;
    const parts = [callers.latestDay ? `newest day ${figure(callers.latestDay)}` : 'newest day unknown', ...(callers.peakDay ? [`busiest day ${figure(callers.peakDay)}`] : [])];
    lines.push(
      callers.latestDay || callers.peakDay
        ? `- FACT distinct caller addresses (a count per day; addresses, not people): ${parts.join('; ')}. UNKNOWN across the window: counts for different days cannot be added.`
        : '- UNKNOWN distinct caller addresses: no day in the window carries a count.',
    );
  }
  lines.push(u.events === null || u.events === undefined ? `- UNKNOWN events (${u.eventsReason ?? 'not read'})` : `- FACT ${n(u.events)} contract events in the window`);
  const facts = u.methodEvents.firstObserved + u.methodEvents.resumed;
  if (facts > 0) {
    lines.push(
      `- FACT method facts in the window: ${u.methodEvents.firstObserved} first-ever call${u.methodEvents.firstObserved === 1 ? '' : 's'}, ${u.methodEvents.resumed} resumed after 30+ silent days (ids ${u.methodEvents.ids.join(', ')}).`,
    );
  }
  if (u.topMethods.length > 0) lines.push(`- FACT most-called: ${u.topMethods.map((m) => `${pretty(m.bucket)} ${n(m.calls)}`).join(', ')} (function names stay on the Terminal).`);
  lines.push(`  Usage says the contracts are used, not that anyone is building. Collection starts ${u.collectedFrom ?? 'unknown'}; daily figures: ${u.url}`);
  return lines;
}
