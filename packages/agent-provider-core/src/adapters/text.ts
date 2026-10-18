import type { AgentChange, AgentClaim, AgentIntelligenceResponse, AgentResearchData, AgentUnknown } from '../schema';
import { quoteForTransport, QUOTED_TEXT_LEGEND, type AgentText } from '../text';

/**
 * The agent contract as plain text (2026-09-30), for transports that carry
 * words: the MCP tool's text and an A2A text part. Every line restates a
 * field of the JSON answer — the tag, the value, the dates, the evidence ids
 * — and a source's words are quoted and labelled as data
 * (`quoteForTransport`), never printed where they could read as HEY's.
 *
 * Two levels of detail (2026-10-14, AG-04). `summary` — the default on the
 * MCP tool's text — is the answer line, the claims, the unknowns, the links
 * and the citation: what an agent needs to answer a person and say where it
 * came from, in about 4 KB, with the whole JSON one resource link away.
 * `full` adds the capability's data lines, the freshness schedule, the
 * evidence list and the methodology. Both end on the citation line
 * (`citation.text`), the last thing a model reads.
 */
export type AgentTextDetail = 'summary' | 'full';

const q = (value: AgentText): string => quoteForTransport(value);
const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : 'not dated');

function claimLine(claim: AgentClaim): string {
  const value = claim.value === null ? '' : ` [${String(claim.value)}]`;
  const when = claim.occurredAt ? ` · happened ${day(claim.occurredAt)}${claim.precision ? ` (${claim.precision})` : ''}` : claim.precision ? ` · ${claim.precision}` : '';
  const observed = claim.observedAt ? ` · HEY read ${day(claim.observedAt)}` : '';
  const evidence = claim.evidence.length > 0 ? ` · evidence ${claim.evidence.map((ref) => ref.id).join(', ')}` : '';
  const context = claim.contextOnly ? ' · context only' : '';
  const reason = claim.reason ? ` · reason ${claim.reason}` : '';
  // What the claim rests on (round 4): printed where no id is cited, so a line never looks unsupported when it is a rule's output or a count.
  const basis = claim.evidenceKind && claim.evidence.length === 0 ? ` · basis ${claim.evidenceKind.replace(/_/g, ' ')}` : '';
  return `- ${claim.status} ${claim.id}${value}: ${q(claim.statement)}${when}${observed} · freshness ${claim.freshness}${context}${reason}${basis}${evidence}`;
}

/** What a code week changed (PB-25): "29 commits, e.g. «feat: …»" — the count as HEY holds it, the subjects quoted as a source's words. */
function codeWords(change: AgentChange): string {
  const code = change.code;
  if (!code) return '';
  const count = code.commits === null ? 'commits not counted' : `${code.commitsAtLeast ? 'at least ' : ''}${code.commits} commit${code.commits === 1 ? '' : 's'}`;
  const examples = code.highlights.length > 0 ? `, e.g. ${code.highlights.map((highlight) => q(highlight.subject)).join(', ')}` : '';
  return ` · ${count}${examples}`;
}

function changeLine(change: AgentChange): string {
  const when = change.occurredAt ? `${day(change.occurredAt)} (${change.precision})` : `HEY saw it ${day(change.detectedAt)} (${change.precision})`;
  const evidence = change.evidence.length > 0 ? ` · evidence ${change.evidence.map((ref) => ref.id).join(', ')}` : '';
  const verification = change.verification === 'SELF_REPORTED' ? ' · self-reported by the project, not verified' : change.verification === 'DISPUTED' ? ' · disputed' : '';
  return `- ${when} ${change.status} ${change.type} — ${change.project.slug}: ${q(change.summary)}${codeWords(change)}${change.countsAsBuilding ? ' · counts as building' : ''}${verification}${evidence}`;
}

/** Under the Radar beside Still Building (PA-6): its state, the gap or why it is withheld; nothing when the answer does not carry it. */
function underTheRadarWords(state: AgentResearchData['builderState']): string {
  const radar = state.underTheRadar;
  if (!radar) return '';
  const gap = typeof state.discoveryGap === 'number' ? `, Discovery Gap ${state.discoveryGap}` : state.discoveryGapWithheld ? `, Discovery Gap not measured (${state.discoveryGapWithheld})` : '';
  return `; Under the Radar ${radar.state}${radar.state === 'NOT_MEASURED' && radar.reason ? ` (${radar.reason})` : ''}${gap}`;
}

function unknownLine(unknown: AgentUnknown): string {
  return `- ${unknown.category} ${unknown.dimension}: ${q(unknown.statement)} Do not conclude: ${q(unknown.doNotConclude)} (reason ${unknown.reason}${unknown.coverageState ? `, coverage ${unknown.coverageState}` : ''})`;
}

/**
 * The capability's own lines. In `summary` they are only what the claims do not already say and an
 * answer cannot do without (AG-04): research_project keeps its latest meaningful change (the claims
 * carry identity, builder state, contract identity, market and usage); builder_status keeps the status,
 * the rule and its boundary (the inputs and lineage are the full text's); what_changed keeps every event,
 * because the events are the answer; verify_project, compare_builders and unknowns are short and kept whole.
 */
function dataLines(response: AgentIntelligenceResponse, detail: AgentTextDetail): string[] {
  if (!response.data) return [];
  const summary = detail === 'summary';
  switch (response.capability) {
    case 'research_project': {
      const d = response.data;
      if (summary) return d.latestMeaningfulChange ? ['Latest meaningful change:', changeLine(d.latestMeaningfulChange)] : [];
      const lines = [
        `Identity: ${d.identity.slug} — ${q(d.identity.name)}${d.identity.symbol ? ` (${q(d.identity.symbol)})` : ''}; kind ${d.identity.projectKind}; research level ${d.identity.researchLevel}; first recorded by HEY ${day(d.identity.firstRecordedByHeyAt)}.`,
        `Builder state: ${d.builderState.activityStatus}; last meaningful ship ${d.builderState.lastMeaningfulShipAt ? day(d.builderState.lastMeaningfulShipAt) : 'none recorded or not measured'}; meaningful events in 30 days ${d.builderState.meaningfulEvents30d ?? 'not measured'}; Build Momentum ${d.builderState.buildMomentum ?? 'not measured'}; Still Building ${d.builderState.stillBuildingState ?? (d.builderState.stillBuilding ? 'HELD' : 'no')}${underTheRadarWords(d.builderState)}${d.builderState.scoringVersion ? ` (${d.builderState.scoringVersion})` : ''}.`,
        `Contract identity: ${d.contractIdentity.token ? `token ${d.contractIdentity.token.address} on chain ${d.contractIdentity.token.chainId}, verification ${d.contractIdentity.token.verification ?? 'unknown'}${d.contractIdentity.token.verificationReason ? ` (${d.contractIdentity.token.verificationReason})` : ''}` : 'no token'}; owner verified ${d.contractIdentity.ownerVerified ? 'yes' : 'no'}.`,
      ];
      if (d.latestMeaningfulChange) lines.push('Latest meaningful change:', changeLine(d.latestMeaningfulChange));
      if (d.recentChanges.items.length > 0) lines.push(`Recent changes (${d.recentChanges.items.length} shown; more at ${d.recentChanges.url}):`, ...d.recentChanges.items.map(changeLine));
      else if (!d.recentChanges.available) lines.push(`Recent changes: UNKNOWN (${d.recentChanges.reason ?? 'ledger unavailable'}).`);
      if (d.marketContext) {
        const m = d.marketContext;
        lines.push(`Market context (context only, never a builder judgement): ${m.valuation ? `${m.valuation.kind === 'fdv' ? 'FDV' : m.valuation.kind === 'marketCap' ? 'market cap' : 'valuation'} $${Math.round(m.valuation.usd).toLocaleString('en-US')} from ${m.valuation.source}${m.valuation.observedAt ? ` read ${day(m.valuation.observedAt)}` : ''}` : m.valuationWithheld ? `valuation withheld (${m.valuationWithheld})` : 'no reading'}${m.tokenMarketStatus ? `; market status ${m.tokenMarketLabel ? `${m.tokenMarketLabel} (${m.tokenMarketStatus})` : m.tokenMarketStatus}` : ''}.`);
      }
      if (d.usageContext) lines.push(`Usage context (context only): ${d.usageContext.state} (${d.usageContext.reason})${d.usageContext.calls === null ? '' : `; ${d.usageContext.calls} calls over ${d.usageContext.windowDays ?? '?'} days`}${d.usageContext.activeContracts === null ? '' : `; ${d.usageContext.activeContracts} of ${d.usageContext.watchedContracts} watched contracts active`}.`);
      return lines;
    }
    case 'what_changed': {
      const d = response.data;
      return [
        `Window: ${d.window.days} days, ${day(d.window.from)} to ${day(d.window.to)} (by when it happened, else when HEY detected it); scope ${d.scope}${d.types ? `; types ${d.types.join(', ')}` : ''}.`,
        `Showing ${d.shown} of ${d.total}${d.countsAsBuilding === undefined ? '' : `; ${d.countsAsBuilding} of the ${d.total} count as building`}. Read further, newest first, at ${d.more}`,
        ...(d.byType.length > 0 ? [`By type: ${d.byType.map((row) => `${row.type} ${row.count}`).join(', ')}.`] : []),
        ...d.items.map(changeLine),
        `Ledger: last projector run ${d.ledger.projectorRanAt ?? 'never'}; collecting since ${d.ledger.collectionStart ?? 'not started'}${d.ledger.transitionsFrom ? `; status moves and reclassifications since ${d.ledger.transitionsFrom}` : ''}.`,
        // Where to pick up next time (2026-10-17, AG-7): what HEY records after this answer, never this window again.
        ...(d.resume ? [`Resume later from cursor ${d.resume.cursor}: ${d.resume.url} (then keep each page's nextCursor).`] : []),
      ];
    }
    case 'builder_status': {
      const d = response.data;
      return [
        `Status: ${d.state} ${d.status} — ${q(d.statusMeaning)}`,
        `Rule ${d.methodology.ruleId} (${d.methodology.version}): ${q(d.methodology.rule)}`,
        ...(!summary && d.inputs.length > 0 ? ['Inputs:', ...d.inputs.map((input) => `- ${input.name}: ${Array.isArray(input.value) ? input.value.join(', ') : String(input.value)}${input.source ? ` (${input.source})` : ''}${input.observedAt ? ` read ${day(input.observedAt)}` : ''}`)] : []),
        ...(!summary && d.lineage.length > 0 ? ['Lineage:', ...d.lineage.map((step) => `- ${step.step}: ${q(step.text)}`)] : []),
        `Status rests on current evidence: ${d.statusRestsOnCurrentEvidence === null ? 'unknown' : d.statusRestsOnCurrentEvidence ? 'yes' : 'no — due to be scored again'}.`,
        `Build Momentum: ${d.buildMomentum.state} ${d.buildMomentum.value ?? d.buildMomentum.classification}. Still Building: ${d.stillBuilding.state} ${d.stillBuilding.classification}${d.stillBuilding.stillBuildingState ? ` (${d.stillBuilding.stillBuildingState})` : ''}. ${q(d.stillBuilding.meaning)}`,
        `Never an input to this status: ${d.excludedContext.map((entry) => entry.item).join(', ')}.`,
        ...(d.unknownInputs.length > 0 ? [`UNKNOWN inputs: ${d.unknownInputs.join(', ')}.`] : []),
      ];
    }
    case 'verify_project': {
      const d = response.data;
      return [
        `Verdict: ${d.verdict} (${d.reasonCode}) for ${d.address} on chain ${d.chainId}.`,
        ...d.reasons.map((reason) => `- ${q(reason)}`),
        `Recorded project: ${d.recordedProject ? `${d.recordedProject.slug}${d.recordedProject.role ? ` (as ${d.recordedProject.role})` : ''}` : 'none'}${d.askedProject ? `; asked about ${d.askedProject.slug} (${d.askedProject.found ? 'published' : 'not found'})` : ''}.`,
        `Building activity applies to this contract: ${d.activityAppliesToContract === null ? 'unknown' : d.activityAppliesToContract ? 'yes' : 'no'}. Attribution only; never a safety reading.`,
      ];
    }
    case 'compare_builders': {
      const d = response.data;
      return [
        `Window: ${d.windowDays} days; order as requested; comparison ${d.completeness ?? 'complete'}; same peer cohort: ${d.sameCohort === null ? 'unknown' : d.sameCohort ? 'yes' : 'no'}.`,
        ...d.projects.map((p) => `- ${p.slug}: ${p.activityStatus}; last meaningful ship ${p.lastMeaningfulShipAt ? day(p.lastMeaningfulShipAt) : 'none recorded'}; meaningful events 30d ${p.meaningfulEvents30d ?? 'not measured'}${p.meaningfulEventsPrevious30d === null ? '' : ` (${p.meaningfulEventsPrevious30d} the 30 before)`}; release cadence ${p.releaseCadence?.medianIntervalDays ?? 'not measured'}${p.releaseCadence?.medianIntervalDays ? ' days' : ''}; active weeks ${p.activeWeeks?.weeks == null ? 'not measured' : `${p.activeWeeks.weeks} of ${p.activeWeeks.windowWeeks}`}; Build Momentum ${p.buildMomentum ?? 'not measured'}; verified builder ${p.verifiedBuilder ? 'yes' : 'no'}; peer cohort ${p.peer?.cohort ?? 'none'}.`),
        ...(d.missing.length > 0 ? [`Not found: ${d.missing.join(', ')}.`] : []),
        q(d.method),
        `Not compared: ${d.excludedContext.map((entry) => entry.item).join(', ')}.`,
      ];
    }
    case 'chain_brief': {
      const d = response.data;
      return [
        `Window: ${d.window.label} (${day(d.window.from)} to ${day(d.window.to)}).`,
        `Shipped: ${d.shipped.ships} ships from ${d.shipped.projects} projects (${d.shipped.rule.id}). Newly verified builders: ${d.newlyVerifiedBuilders.total}. Status recoveries: ${d.statusRecoveries.total} of ${d.statusRecoveries.comparable} projects read more than once.`,
        `Held today: Still Building ${d.stillBuilding.total}; Under the Radar ${d.underTheRadar.total} (strict by design).`,
        `Building changes: showing ${d.building.shown} of ${d.building.total}, newest first; read further at ${d.building.more}`,
        ...d.building.items.map(changeLine),
        `The week: ${d.weekUrl}`,
      ];
    }
    case 'unknowns': {
      const d = response.data;
      return [
        `Counts: ${Object.entries(d.counts).map(([category, count]) => `${category} ${count}`).join(', ')}.`,
        `Measured (figures there are measurements, zeros included): ${d.measured.join(', ') || 'none'}.`,
        ...(d.notApplicable.length > 0 ? [`Not applicable: ${d.notApplicable.join(', ')}.`] : []),
        ...(d.withheld.length > 0 ? [`Withheld (measured, not published here): ${d.withheld.join(', ')}.`] : []),
      ];
    }
  }
}

/** What the subject resolved from (AG-01), without echoing the caller's text: the field, and the slug it became. */
function resolvedLine(response: AgentIntelligenceResponse): string | undefined {
  const subject = response.subject;
  if (!subject?.resolvedFrom || !subject.project) return undefined;
  // A retired slug (PD-5): the page was renamed or merged, and the answer is the page it leads to.
  if (subject.resolvedFrom.slug && !subject.resolvedFrom.address && !subject.resolvedFrom.q) {
    return `Resolved from the slug sent as project, which HEY retired when that page was renamed or merged, to project ${subject.project.slug}; use ${subject.project.slug} from now on.`;
  }
  const by = subject.resolvedFrom.address ? `address ${subject.resolvedFrom.address}` : 'the name or ticker sent as q';
  return `Resolved from ${by} to project ${subject.project.slug} through HEY’s project search.`;
}

/** The candidates an ambiguous name or ticker could mean (AG-01): the slugs to send back, never a pick. */
function candidateLines(response: AgentIntelligenceResponse): string[] {
  const candidates = response.error?.candidates;
  if (!candidates || candidates.length === 0) return [];
  const total = response.error?.candidatesTotal;
  const heading = total && total.count > candidates.length ? `Candidates (${candidates.length} of ${total.atLeast ? 'at least ' : ''}${total.count}; send one as project):` : 'Candidates (send one as project):';
  return [
    heading,
    ...candidates.map(
      (candidate) =>
        `- ${candidate.slug}: ${q(candidate.name)}${candidate.symbol ? ` (${q(candidate.symbol)})` : ''}${candidate.activityStatus ? ` · status ${candidate.activityStatus}` : ''}${candidate.catalogStatus ? ` · ${candidate.catalogStatus}` : ''}${candidate.token ? ` · token ${candidate.token.address}` : ''} · ${candidate.url}`,
    ),
  ];
}

/**
 * The citation line (AG-02): the last line of the text, after everything else, so a model that keeps
 * only the end of an answer still keeps where it came from.
 */
export function citationLine(response: Pick<AgentIntelligenceResponse, 'citation'>): string | undefined {
  return response.citation?.text;
}

export function renderAgentResponseText(response: AgentIntelligenceResponse, options: { detail?: AgentTextDetail } = {}): string {
  const detail: AgentTextDetail = options.detail ?? 'full';
  const lines: string[] = [
    `# HEY ${response.capability} — ${response.schema} v${response.schemaVersion}`,
    `Chain: ${response.chain.name} (${response.chain.chainId}) · as of ${response.asOf} · status ${response.status}`,
    '',
    `Answer (${response.answerStatus}): ${q(response.answer)}`,
  ];
  // HEY's own token (round 4): the disclosure right under the answer, in the founder's words.
  for (const disclosure of response.disclosures ?? []) lines.push(`Disclosure: ${q(disclosure.statement)}${disclosure.projects.length > 0 ? ` (${disclosure.projects.join(', ')})` : ''}.`);
  const resolved = resolvedLine(response);
  if (resolved) lines.push(resolved);
  if (response.error) lines.push(`Error ${response.error.code}: ${q(response.error.message)}${response.error.movedTo ? ` Moved to ${response.error.movedTo}.` : ''}`);
  lines.push(...candidateLines(response));
  const data = dataLines(response, detail);
  if (data.length > 0) lines.push('', ...data);
  if (response.claims.length > 0) lines.push('', 'Claims (FACT recorded with its source · DERIVED a rule HEY applied · UNKNOWN not held):', ...response.claims.map(claimLine));
  if (response.unknowns.length > 0) lines.push('', 'What HEY does not know:', ...response.unknowns.map(unknownLine));
  if (detail === 'full' && response.freshness.length > 0) {
    lines.push(
      '',
      'Freshness:',
      ...response.freshness.map((entry) => `- ${entry.family}: ${entry.freshnessStatus}${entry.observedAt ? `, read ${entry.observedAt.slice(0, 16).replace('T', ' ')} UTC` : ', never read'}; stale after ${entry.staleAfterHours} h; refreshed by ${entry.refresh.job} every ${entry.refresh.everyMinutes === entry.refresh.slowestMinutes ? `${entry.refresh.everyMinutes} min` : `${entry.refresh.everyMinutes}–${entry.refresh.slowestMinutes} min`}; next ${entry.nextExpectedRefresh ?? entry.nextExpectedRefreshReason ?? 'unknown'}`),
    );
  }
  if (detail === 'full' && response.evidence.length > 0) lines.push('', 'Evidence (typed ids; open with get_evidence or the receipt URL):', ...response.evidence.slice(0, 40).map((ref) => `- ${ref.id} — ${ref.receiptUrl}`));
  lines.push('');
  if (detail === 'full') lines.push(`Methodology: ${response.methodology.rules.map((rule) => `${rule.id} ${rule.version}`).join(', ')}.`);
  if (response.links.page) lines.push(`Page: ${response.links.page}${response.links.pageAttributed ? ` (attributed link ${response.links.pageAttributed})` : ''}`);
  lines.push(`Canonical JSON: ${response.links.self}${detail === 'summary' ? ' (the full answer: data, freshness, every evidence id)' : ''}`);
  if (response.citation) lines.push(`Cite in an AgentResearchReceipt as {"kind":"hey_agent_answer","capability":"${response.citation.capability}","schemaVersion":"1","url":"${response.citation.url}","asOf":"${response.citation.asOf}"}.`);
  lines.push(`Not provided: ${response.boundaries.notProvided.join(', ')}.`, q(response.boundaries.disclaimer));
  // A source's words are quoted «…» above: the legend sits before the citation, which stays last.
  const body = lines.join('\n');
  const legend = body.includes('«') ? `\n\n${QUOTED_TEXT_LEGEND}` : '';
  const citation = citationLine(response);
  return `${body}${legend}${citation ? `\n${citation}` : ''}`;
}
