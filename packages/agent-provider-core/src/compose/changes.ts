import type { HeyChangeUpsert } from '@hey-research-lab/sdk';

import { familyFreshness } from '../freshness';
import type { AgentClaim, AgentResponseOf, AgentUnknown } from '../schema';
import { derivedText, externalText, heyText } from '../text';
import { agentChange, envelope, looksLikeEvidenceId, type AgentComposeContext } from './common';

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
  ledger: { projectorRanAt: string | null; newestRecordedAt: string | null; collectionStart: string | null };
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

const TYPE_WORDS: Readonly<Record<string, string>> = {
  'build.release': 'release',
  'build.ship': 'ship',
  'build.code_activity': 'week of code activity',
  'build.status_changed': 'activity status change',
  'build.dormant': 'move to dormant',
  'build.resumed': 'resumption after dormancy',
  'build.accelerating': 'acceleration signal',
  'build.slowing': 'slowdown signal',
  'contract.deployed': 'contract deployment',
  'contract.followup_deployed': 'follow-up contract deployment',
  'contract.implementation_changed': 'implementation change',
  'contract.interface_changed': 'interface change',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? '' : 's'}`;

export function composeWhatChanged(ctx: AgentComposeContext, input: WhatChangedInput): AgentResponseOf<'what_changed'> {
  const isEvidenceId = input.isEvidenceId ?? looksLikeEvidenceId;
  const items = input.items.map((event) => agentChange(event, { slug: event.project.slug, url: event.project.url }, ctx.baseUrl, isEvidenceId));
  const ledgerFresh = familyFreshness('change_ledger', { observedAt: input.ledger.projectorRanAt, dataAsOf: input.ledger.newestRecordedAt, now: ctx.now });
  const ledgerRan = input.ledger.projectorRanAt !== null;
  const who = input.scope === 'project' && input.project ? input.project.slug : 'Robinhood Chain projects';

  const claims: AgentClaim[] = input.byType.slice(0, 40).map((row) => ({
    id: `window.${row.type}`,
    dimension: row.type.split('.')[0] ?? 'change',
    statement: derivedText(`${plural(row.count, TYPE_WORDS[row.type] ?? `${row.type} event`)} in the ${input.window.days}-day window (${row.type}).`),
    status: 'FACT' as const,
    value: row.count,
    source: { name: 'change ledger', type: 'hey_record' as const },
    observedAt: input.ledger.projectorRanAt,
    occurredAt: null,
    precision: 'WINDOW' as const,
    freshness: ledgerFresh.freshnessStatus,
    evidence: items.filter((item) => item.type === row.type).flatMap((item) => item.evidence).slice(0, 12),
    ...(row.type.startsWith('market.') ? { contextOnly: true as const } : {}),
  }));

  const typeWords = input.byType
    .slice(0, 4)
    .map((row) => plural(row.count, TYPE_WORDS[row.type] ?? row.type))
    .join(', ');
  const answer = !ledgerRan
    ? heyText('HEY’s change ledger has not run yet, so it cannot say what changed: this is unknown, not "nothing".')
    : input.total === 0
      ? derivedText(`HEY’s ledger recorded no change for ${who} in the last ${input.window.days} days${input.types ? ` of the types asked for` : ''}. Where a source is not watched (see unknowns), no change there is unknown, not absent.`)
      : derivedText(`${input.total} change${input.total === 1 ? '' : 's'} recorded for ${who} in the last ${input.window.days} days${typeWords ? ` (${typeWords}${input.byType.length > 4 ? ', …' : ''})` : ''}; showing the newest ${items.length}.`);

  const unknowns: AgentUnknown[] = [...(input.unknowns ? ledgerRelevantUnknowns(input.unknowns) : [])];
  if (!ledgerRan && !unknowns.some((unknown) => unknown.dimension === 'changeLedger')) {
    unknowns.unshift({ category: 'UNKNOWN', dimension: 'changeLedger', statement: heyText('HEY’s change ledger has not run on this deployment yet.'), doNotConclude: heyText('A missing value is not negative evidence. No event listed does not mean nothing changed.'), reason: 'change_ledger_not_run' });
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
