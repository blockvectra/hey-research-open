import type { HeyChangeUpsert } from '@hey-research-lab/sdk';

import { familyFreshness } from '../freshness';
import { AGENT_LIMITS, type AgentChange, type AgentClaim, type AgentResponseOf, type AgentUnknown } from '../schema';
import { derivedText, externalText, heyText } from '../text';
import { changeTypeNoun, countOf, inTheLastDays, WORD_CHANGE } from '../words';
import { agentChange, envelope, isContextChange, looksLikeEvidenceId, type AgentComposeContext } from './common';

/**
 * what_changed (2026-09-30): the canonical change ledger over a window of
 * days, for one project or for the projects building on Robinhood Chain.
 *
 * The events are the ledger's own (`currentChanges`, the read HEY Today and
 * the Terminal's "What changed" use), serialised by `publicChangeEvent`; the
 * total and the per-type counts are one count over exactly the same filter
 * (`countCurrentChanges`), so `total` is the window's, never the page's.
 */
export type WhatChangedInput = {
  scope: 'project' | 'chain';
  project?: { slug: string; name: string; url: string; token?: { chainId: number; address: string } };
  window: { days: number; from: string; to: string };
  types: string[] | null;
  items: readonly HeyChangeUpsert[];
  total: number;
  byType: readonly { type: string; count: number }[];
  /**
   * The window's events that count toward activity status, by type, by the
   * ledger's own `countsAsBuilding` flag (2026-09-30): the answer leads with
   * these, so a chain-wide "what changed?" opens with building rather than
   * market readings. Absent from a caller that did not count them.
   */
  building?: readonly { type: string; count: number }[];
  /** The caller asked for `building=only`: every event here counts as building. */
  buildingOnly?: boolean;
  ledger: { projectorRanAt: string | null; newestRecordedAt: string | null; collectionStart: string | null; transitionsFrom?: string | null };
  moreUrl: string;
  /** Gaps that limit which changes HEY can see for this project (no builder source, contracts not watched …). */
  unknowns?: AgentUnknown[];
  isEvidenceId?: (id: string) => boolean;
};

const LEDGER_DIMENSIONS: ReadonlySet<string> = new Set(['activityStatus', 'changeLedger', 'builderEvidence', 'repositories', 'releases', 'contractDeployment', 'contractActivity', 'contractInterface', 'sourceChanges', 'locks', 'officialDocs']);

/** The gaps that bound what a change feed can show: an unwatched source is unknown, never quiet. */
export function ledgerRelevantUnknowns(unknowns: readonly AgentUnknown[]): AgentUnknown[] {
  return unknowns.filter((unknown) => LEDGER_DIMENSIONS.has(unknown.dimension));
}

export function composeWhatChanged(ctx: AgentComposeContext, input: WhatChangedInput): AgentResponseOf<'what_changed'> {
  const isEvidenceId = input.isEvidenceId ?? looksLikeEvidenceId;
  const all = input.items.map((event) => agentChange(event, { slug: event.project.slug, url: event.project.url }, ctx.baseUrl, isEvidenceId));
  /*
   * The contract's size bound, held when the answer is made (2026-09-30,
   * adversarial review): fifty events over thirty days could reach 69 KB,
   * past the published 64 KB. The newest events are kept and `shown` says how
   * many; the total is always the window's.
   */
  let answer = composeWindow(ctx, input, all);
  let keep = all.length;
  while (keep > 0 && answerBytes(answer) > AGENT_LIMITS.maxResponseBytes) {
    keep = Math.max(0, Math.min(keep - 1, Math.floor(keep * 0.8)));
    answer = composeWindow(ctx, input, all.slice(0, keep));
  }
  return answer;
}

const answerBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** Words for a few counted types: " (40 releases, 17 ships, …)". */
function typeWords(rows: readonly { type: string; count: number }[]): string {
  if (rows.length === 0) return '';
  return ` (${rows
    .slice(0, 4)
    .map((row) => countOf(row.count, changeTypeNoun(row.type)))
    .join(', ')}${rows.length > 4 ? ', …' : ''})`;
}

const byCount = (a: { type: string; count: number }, b: { type: string; count: number }): number => b.count - a.count || a.type.localeCompare(b.type);

function composeWindow(ctx: AgentComposeContext, input: WhatChangedInput, items: AgentChange[]): AgentResponseOf<'what_changed'> {
  const ledgerFresh = familyFreshness('change_ledger', { observedAt: input.ledger.projectorRanAt, dataAsOf: input.ledger.newestRecordedAt, now: ctx.now });
  const ledgerRan = input.ledger.projectorRanAt !== null;
  const who = input.scope === 'project' && input.project ? input.project.slug : 'Robinhood Chain projects';

  // Building first (2026-09-30, adversarial review): by the ledger's own countsAsBuilding flag; the rest is context and HEY's own records.
  const building = input.buildingOnly ? input.byType : input.building;
  const buildingTotal = building ? building.reduce((sum, row) => sum + row.count, 0) : undefined;
  const buildingRows = building ? building.filter((row) => row.count > 0).sort(byCount) : [];
  const contextRows = building
    ? input.byType
        .map((row) => ({ type: row.type, count: row.count - (building.find((entry) => entry.type === row.type)?.count ?? 0) }))
        .filter((row) => row.count > 0)
        .sort(byCount)
    : [];

  /*
   * A window older than the ledger's transitions (2026-09-30, adversarial
   * review): status moves, resumptions and HEY's other reclassifications are
   * recorded only from `transitionsFrom`; releases and ships are indexed from
   * their sources' own history. Before that instant a transition is absent
   * here, not zero, and the answer says so.
   */
  const transitionsFrom = input.ledger.transitionsFrom ?? null;
  const partialWindow = ledgerRan && transitionsFrom !== null && Date.parse(input.window.from) < Date.parse(transitionsFrom);
  const partialWords = partialWindow ? ` HEY’s ledger records status moves and its other reclassifications only since ${transitionsFrom!.slice(0, 10)}; before that they are absent here, not zero.` : '';

  const buildingClaim: AgentClaim[] =
    ledgerRan && buildingTotal !== undefined
      ? [
          {
            id: 'window.counts_as_building',
            dimension: 'build',
            statement: derivedText(`${buildingTotal} of ${input.total} ${input.total === 1 ? 'change counts' : 'changes count'} toward activity status in the ${input.window.days}-day window.`),
            status: 'FACT',
            value: buildingTotal,
            source: { name: 'change ledger', type: 'hey_record' },
            observedAt: input.ledger.projectorRanAt,
            occurredAt: null,
            precision: 'WINDOW',
            freshness: ledgerFresh.freshnessStatus,
            evidence: items.filter((item) => item.countsAsBuilding).flatMap((item) => item.evidence).slice(0, 12),
          },
        ]
      : [];
  const typeClaims: AgentClaim[] = input.byType.slice(0, 40).map((row) => ({
    id: `window.${row.type}`,
    dimension: row.type.split('.')[0] ?? 'change',
    statement: derivedText(`${countOf(row.count, changeTypeNoun(row.type))} in the ${input.window.days}-day window (${row.type}).`),
    status: 'FACT' as const,
    value: row.count,
    source: { name: 'change ledger', type: 'hey_record' as const },
    observedAt: input.ledger.projectorRanAt,
    occurredAt: null,
    precision: 'WINDOW' as const,
    freshness: ledgerFresh.freshnessStatus,
    evidence: items.filter((item) => item.type === row.type).flatMap((item) => item.evidence).slice(0, 12),
    // Market, market-integrity and usage events are context, never building (2026-09-30: not only `market.*`).
    ...(isContextChange({ domain: row.type.split('.')[0] ?? '', type: row.type }) ? { contextOnly: true as const } : {}),
  }));
  const claims: AgentClaim[] = [...buildingClaim, ...typeClaims];

  const recorded = `recorded for ${who} ${inTheLastDays(input.window.days)}`;
  const answer = !ledgerRan
    ? heyText('HEY’s change ledger has not run yet, so it cannot say what changed: this is unknown, not "nothing".')
    : input.total === 0
      ? derivedText(`HEY’s ledger recorded no ${input.buildingOnly ? 'change that counts as building' : 'change'} for ${who} ${inTheLastDays(input.window.days)}${input.types ? ` of the types asked for` : ''}. Where a source is not watched (see unknowns), no change there is unknown, not absent.${partialWords}`)
      : input.buildingOnly
        ? derivedText(`${countOf(input.total, WORD_CHANGE)} that count as building ${recorded}${typeWords(buildingRows)}; showing the newest ${items.length}.${partialWords}`)
        : buildingTotal !== undefined
          ? derivedText(
              `${countOf(input.total, WORD_CHANGE)} ${recorded}. ${buildingTotal === 0 ? 'None of them counts as building' : `${buildingTotal} ${buildingTotal === 1 ? 'counts' : 'count'} as building${typeWords(buildingRows)}`}${contextRows.length > 0 ? `; the other ${input.total - buildingTotal} are context and HEY’s own records${typeWords(contextRows)}` : ''}. Showing the newest ${items.length} of every type; ask with building=only for building alone.${partialWords}`,
            )
          : derivedText(`${countOf(input.total, WORD_CHANGE)} ${recorded}${typeWords(input.byType)}; showing the newest ${items.length}.${partialWords}`);

  const unknowns: AgentUnknown[] = [...(input.unknowns ? ledgerRelevantUnknowns(input.unknowns) : [])];
  if (!ledgerRan && !unknowns.some((unknown) => unknown.dimension === 'changeLedger')) {
    unknowns.unshift({ category: 'UNKNOWN', dimension: 'changeLedger', statement: heyText('HEY’s change ledger has not run on this deployment yet.'), doNotConclude: heyText('A missing value is not negative evidence. No event listed does not mean nothing changed.'), reason: 'change_ledger_not_run' });
  }
  if (partialWindow) {
    unknowns.push({
      category: 'INSUFFICIENT_EVIDENCE',
      dimension: 'changeLedgerWindow',
      statement: derivedText(`The window starts ${input.window.from.slice(0, 10)}, before HEY’s ledger began recording status moves and reclassifications (${transitionsFrom!.slice(0, 10)}). Releases and ships are indexed from their sources’ own history; the other transitions are not.`),
      doNotConclude: heyText('Do not read a count of status moves, resumptions or reclassifications as the whole window: the part before the ledger began recording them is absent, not zero.'),
      reason: 'ledger_window_partial',
      asOf: transitionsFrom!,
    });
  }

  return envelope(ctx, {
    capability: 'what_changed',
    status: 'ok',
    subject:
      input.scope === 'project' && input.project
        ? { kind: 'project', project: { slug: input.project.slug, name: externalText(input.project.name, 'project_record'), url: input.project.url, ...(input.project.token ? { token: input.project.token } : {}) } }
        : { kind: 'chain' },
    answer,
    answerStatus: ledgerRan ? 'FACT' : 'UNKNOWN',
    claims,
    unknowns,
    freshness: [ledgerFresh],
    dataEvidence: items.flatMap((item) => item.evidence),
    data: {
      scope: input.scope,
      window: { days: input.window.days, from: input.window.from, to: input.window.to, basis: 'occurred_else_detected' },
      types: input.types,
      total: input.total,
      ...(buildingTotal !== undefined ? { countsAsBuilding: buildingTotal } : {}),
      byType: input.byType.slice(0, 40).map((row) => ({ type: row.type, count: row.count })),
      shown: items.length,
      items,
      ledger: input.ledger,
      more: input.moreUrl,
    },
    ...(input.project ? { page: input.project.url, citationProject: input.project.slug } : {}),
    canonical: [input.moreUrl],
  });
}
