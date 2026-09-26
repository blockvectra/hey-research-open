import type {
  HeyBuildMarket,
  HeyContract,
  HeyCoverageDimension,
  HeyCoverageEntry,
  HeyCoverageState,
  HeyDiff,
  HeyDiffEnd,
  HeyEvidenceReceipt,
  HeyExplainedFact,
  HeyExplainIndex,
  HeyProjectContracts,
  HeyProjectCoverage,
  HeyProjectSnapshot,
  HeySourceFreshness,
} from '@hey-research/sdk';

import { STILL_BUILDING_MEANING, TAG_LEGEND, activityTag, atPrecision, liquidityWords, money, shownOf, stillBuildingEvidence, tokenMarketWords, valuationWord } from './render';

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

/** A coverage state as the tag an agent should read it with: measured is a fact about HEY's record, anything else is a gap. */
function coverageTag(state: HeyCoverageState): 'FACT' | 'UNKNOWN' {
  return state === 'MEASURED' || state === 'NOT_APPLICABLE' ? 'FACT' : 'UNKNOWN';
}

const DIMENSION_WORDS: Record<HeyCoverageDimension, string> = {
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
  timeline: 'timeline',
};

function coverageLine(dimension: HeyCoverageDimension, entry: HeyCoverageEntry): string {
  const facts = [entry.since ? `since ${entry.since.slice(0, 10)}` : undefined, entry.asOf ? `as of ${entry.asOf.slice(0, 16).replace('T', ' ')} UTC` : undefined, entry.reason ? `reason ${entry.reason}` : undefined].filter(Boolean);
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

/** `GET /api/projects/{slug}/snapshot` as text. */
export function renderSnapshot(s: HeyProjectSnapshot, now?: Date): string {
  const i = s.identity;
  const b = s.build;
  const lines: string[] = [`# ${i.name}${i.symbol ? ` ($${i.symbol})` : ''} — snapshot as of ${s.asOf.slice(0, 16).replace('T', ' ')} UTC`, i.url, ''];

  lines.push('## Identity');
  lines.push(`- DERIVED research level: ${pretty(i.researchLevel)}; catalogue: ${pretty(i.catalogStatus)}; kind: ${pretty(i.projectKind)}${i.primaryNarrative ? `; narrative: ${i.primaryNarrative.name}` : ''}`);
  lines.push(`- FACT first recorded by HEY ${i.firstRecordedByHeyAt.slice(0, 10)} (HEY's knowledge time)${i.externalListedAt ? `; listed by ${i.externalListedSource ?? 'an outside registry'} ${i.externalListedAt.slice(0, 10)} (their date, not HEY's)` : ''}`);
  lines.push(i.token ? `- FACT token: chain ${i.token.chainId}, contract ${i.token.contractAddress}` : '- FACT no token recorded — this is a project page, not a token.');

  lines.push('', '## Build');
  if (i.researchLevel === 'INDEXED') lines.push('- UNKNOWN activity: not researched yet — HEY indexed this record but has not read its sources.');
  else if (b.activityMeasured === false) lines.push(`- UNKNOWN activity (${pretty(b.activityStatus)}): HEY holds no builder source it can read, so no count here is a measured zero.`);
  else lines.push(`- ${activityTag(b.activityStatus)} activity status: ${pretty(b.activityStatus)}${b.lastShippedAt ? `; last meaningful ship ${b.lastShippedAt.slice(0, 10)}` : ''}`);
  lines.push(b.buildMomentum === undefined ? '- UNKNOWN Build Momentum: not measured' : `- DERIVED Build Momentum ${b.buildMomentum}${s.scoringVersion ? ` (${s.scoringVersion})` : ''}`);
  lines.push(b.discoveryGap === undefined ? '- UNKNOWN Discovery Gap: not measured' : `- DERIVED Discovery Gap ${b.discoveryGap}`);
  if (b.velocity) {
    lines.push(
      b.velocity.current === null
        ? `- UNKNOWN build velocity (${pretty(b.velocity.state)})`
        : `- DERIVED build velocity: ${pretty(b.velocity.state)} — ${b.velocity.current} meaningful events in ${b.velocity.windowDays} days${b.velocity.previous === null ? ', no earlier window to compare' : ` against ${b.velocity.previous} before`}`,
    );
  } else lines.push('- UNKNOWN build velocity');
  lines.push(b.cadence?.medianIntervalDays !== undefined ? `- DERIVED release cadence: a release day every ${b.cadence.medianIntervalDays} days (median)` : '- UNKNOWN release cadence: fewer than three release days');
  if (b.stillBuilding) {
    const evidence = stillBuildingEvidence(b);
    lines.push(`- DERIVED STILL BUILDING${evidence ? `: ${evidence}` : ''}. ${STILL_BUILDING_MEANING}`);
  }

  lines.push('', '## Market (context, never a ranking input)');
  const m = s.market;
  if (!m) lines.push('- NOT APPLICABLE: no tracked token, so no market.');
  else {
    if (m.tokenMarket) lines.push(`- DERIVED token market: ${tokenMarketWords(m.tokenMarket.status)}${m.tokenMarket.reason ? ` (${pretty(m.tokenMarket.reason)})` : ''}. A reading of the market, not of the team.`);
    if (m.marketCap) lines.push(`- FACT ${valuationWord(m.marketCap.kind)} ${money(m.marketCap.usd)} (${m.marketCap.source}${m.marketCap.observedAt ? `, ${m.marketCap.observedAt.slice(0, 10)}` : ''})`);
    else if (m.valuationWithheld) lines.push(`- DERIVED valuation withheld: the market is not live (${pretty(m.valuationWithheld)}). HEY holds a figure and does not publish it.`);
    else lines.push('- UNKNOWN valuation: no fresh reading.');
    lines.push(m.liquidity ? `- FACT ${liquidityWords(m.liquidity, now)}` : '- UNKNOWN liquidity: no reading.');
    if (m.volume24h) lines.push(`- FACT 24h volume ${money(m.volume24h.usd)}${m.volume24h.source ? ` (${m.volume24h.source})` : ''}`);
    if (m.launchStage) lines.push(`- FACT launch stage: ${pretty(m.launchStage)}`);
    lines.push(`- Market in depth: ${m.url}`);
  }

  lines.push('', '## On-chain');
  const o = s.onchain;
  if (!o) lines.push('- UNKNOWN on-chain use: HEY holds no reading of the contract.');
  else {
    lines.push(
      o.events24h === undefined
        ? `- UNKNOWN contract events: HEY could not index them (${o.daysMeasured} of ${o.daysCovered} days readable)${o.calls24h === undefined ? '' : `; FACT ${o.calls24h} calls in 24 h`}`
        : `- FACT ${o.events24h} contract events in 24 h${o.events7d === undefined ? '' : `, ${o.events7d} over ${o.daysCovered} days`}${o.calls24h === undefined ? '' : `; ${o.calls24h} calls in 24 h`} (read ${o.observedAt.slice(0, 10)}). Usage says the contract is used, not that anyone is building.`,
    );
  }

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
      else lines.push(`- ${c.precision} ${atPrecision(c.occurredAt, c.precision, c.detectedAt)} · ${c.type}: ${c.summary} (id ${c.id})`);
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

/** `GET /api/projects/{slug}/coverage` as text: states, never a score. */
export function renderCoverage(c: HeyProjectCoverage): string {
  const lines: string[] = [`# ${c.project.name} — what HEY knows and does not (computed ${c.computedAt.slice(0, 16).replace('T', ' ')} UTC)`, c.project.url, ''];
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
  const lines: string[] = [`# Why HEY shows ${e.fact} for ${e.project.name}`, e.project.url, ''];
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
  return [`# Facts HEY can explain for ${index.project.name}`, index.project.url, '', ...index.facts.map((f) => `- ${f.fact}: ${f.description}`), '', 'Call explain_fact again with one of these as `fact`.', index.disclaimer].join('\n');
}

/** `GET /api/evidence/{id}` as text. A withdrawn receipt names nothing it may not. */
export function renderEvidence(r: HeyEvidenceReceipt): string {
  if (r.withdrawn) {
    return [`# ${r.id} — withdrawn`, `HEY no longer makes this claim (${pretty(r.withdrawalReason)}). Do not cite it.${r.project ? ` Project: ${r.project.name} — ${r.project.url}` : ''}`, '', r.disclaimer].join('\n');
  }
  const lines: string[] = [`# Evidence ${r.id}`, `${r.project.name} — ${r.project.url}`, ''];
  lines.push(`FACT ${r.claimType} (${r.domain}): ${r.summary}`);
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

function contractLines(c: Omit<HeyContract, 'disclaimer'>): string[] {
  const lines: string[] = [];
  lines.push(`${c.name ? `${c.name} — ` : ''}chain ${c.chainId}, ${c.address}${c.role ? ` (${c.role})` : ''}${c.watched ? '' : ' — listed, not watched: HEY does not re-read this contract'}`);
  lines.push(c.associatedProject ? `- FACT project: ${c.associatedProject.name} — ${c.associatedProject.url}` : '- UNKNOWN project: no published project claims this contract.');
  if (c.creation) lines.push(`- FACT created ${c.creation.at ? atPrecision(c.creation.at, c.creation.precision) : 'at an unread time'}${c.creation.tx ? ` in ${c.creation.tx}` : ''}${c.creation.block ? `, block ${c.creation.block}` : ''}`);
  if (c.deployer) lines.push(`- FACT deployed by ${c.deployer.address}${c.deployer.sharedAcrossTrackedProjects ? ` — a deployer shared with ${c.deployer.otherProjectsCount} other tracked projects (a launch service, not one team)` : ''}`);
  if (c.factory) lines.push(`- FACT created through factory ${c.factory}`);
  const src = c.verifiedSource;
  lines.push(src.state === 'MEASURED' ? `- FACT verified source: ${src.verified ? 'yes' : 'no'}${src.compiler ? `; compiler ${src.compiler}` : ''}${src.contractName ? `; name ${src.contractName}` : ''}${src.checkedAt ? ` (checked ${src.checkedAt.slice(0, 10)})` : ''}` : `- UNKNOWN verified source: ${pretty(src.state)}`);
  lines.push(`- ${proxyWords(c.proxy)}`);
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
  if (c.evidence.length > 0) lines.push(`- Evidence ids: ${c.evidence.slice(0, 8).join(', ')}${c.evidence.length > 8 ? ` and ${c.evidence.length - 8} more` : ''}`);
  return lines;
}

/** `GET /api/contracts/{chainId}/{address}` as text. Counts, never function lists; no account but the deployer. */
export function renderContract(c: HeyContract): string {
  return [`# Contract`, c.url, '', ...contractLines(c), '', 'On-chain facts about a contract, never a verdict on it or on anyone who called it.', TAG_LEGEND, c.disclaimer].join('\n');
}

export function renderProjectContracts(p: HeyProjectContracts, limit = 10): string {
  const shown = p.items.slice(0, limit);
  const blocks = shown.map((c) => contractLines(c).join('\n'));
  return [
    `# ${p.project.name} — contracts on chain ${p.chainId}`,
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
  const lines: string[] = [`# ${d.project.name} — what changed between ${d.from} and ${d.to}`, d.project.url, ''];
  lines.push('## Build (counts on the date each item was published)');
  lines.push(`- FACT releases added: ${d.build.releasesAdded}; meaningful ships: ${d.build.meaningfulShips}`);
  lines.push(`- DERIVED activity status: ${end('then', d.build.status.then, pretty)} → ${end('now', d.build.status.now, pretty)}`);
  lines.push(`- DERIVED Build Momentum: ${end('then', d.build.momentum.then, String)} → ${end('now', d.build.momentum.now, String)}`);
  lines.push('', '## Market (context)');
  if (d.market.state === 'NOT_APPLICABLE') lines.push(`- NOT APPLICABLE: ${d.market.reason}`);
  else {
    const v = d.market.valuation;
    lines.push(`- FACT ${valuationWord(v.now.kind ?? v.then.kind)}: ${end('then', v.then, money)} → ${end('now', v.now, money)}`);
    lines.push(`- FACT liquidity: ${end('then', d.market.liquidity.then, money)} → ${end('now', d.market.liquidity.now, money)}`);
  }
  lines.push('', '## Changes recorded in the window (by the time HEY recorded them)');
  if (d.changes.state === 'UNAVAILABLE') lines.push(`- UNKNOWN: ${d.changes.reason}`);
  else {
    lines.push(`- FACT ${d.changes.total} change${d.changes.total === 1 ? '' : 's'}${d.changes.truncated ? ' (counted up to the cap; more exist)' : ''}: ${Object.entries(d.changes.byType).map(([type, n]) => `${type} ${n}`).join(', ') || 'none'}`);
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
    ...shown.map((p) => `- ${p.name}${p.symbol ? ` ($${p.symbol})` : ''}: DERIVED Build Momentum ${p.buildMomentum}; DERIVED market-attention percentile ${p.marketAttentionPercentile} (context) — ${p.url}`),
    '',
    shownOf(shown.length, page.items.length, 'The rest are in GET /api/chain/build-market.'),
    `Method: ${page.method}`,
    'A position on the map is not a recommendation, and building does not predict price.',
    TAG_LEGEND,
    page.disclaimer,
  ].join('\n');
}
