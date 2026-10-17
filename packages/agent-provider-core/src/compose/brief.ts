import type { HeyChangeUpsertRead, HeyThisWeek } from '@hey-research-lab/sdk';

import { familyFreshness } from '../freshness';
import type { AgentClaim, AgentResponseOf } from '../schema';
import { derivedText, heyText } from '../text';
import { countOf, noun, WORD_CHANGE } from '../words';
import { agentChange, envelope, looksLikeEvidenceId, type AgentCodeWeeks, type AgentComposeContext } from './common';

/**
 * chain_brief (2026-10-18, persona audit PB-26 / AG-6): "what is happening on Robinhood Chain?" in one call — the
 * week `/api/this-week` already composes (ships and the projects behind them, builders newly verified, status
 * recoveries, Still Building and Under the Radar held today) and the newest changes that count as building, with
 * what each code week shipped. An agent stitched four to six endpoints for it, or landed on market rows.
 *
 * Restated, never recomputed: every count is the rollup's own, over its own window; the changes are the ledger's,
 * `building=only` over the same window, with the window's true total. Under the Radar and Still Building are
 * counts of what HEY's rules hold, each with its method — strict by design, so a small number is the rule's, not
 * the chain's. No market figure, no ranking, no project picked out.
 */
export type ChainBriefInput = {
  week: HeyThisWeek;
  /** The newest changes that count as building in the week's window, newest first (`/api/changes`, building only). */
  building: readonly HeyChangeUpsertRead[];
  /** Every change that counts as building in that window: a true total, never the page. */
  buildingTotal: number;
  ledger: { projectorRanAt: string | null; newestRecordedAt: string | null };
  moreUrl: string;
  codeWeeks?: AgentCodeWeeks;
  isEvidenceId?: (id: string) => boolean;
};

/** How many building changes the brief lists: the newest, the rest one call away. */
export const CHAIN_BRIEF_CHANGES = 10;

/** What each count means, in the rollup's own rules (`weekly.ts`), so a reader can tell two near names apart (AG-9). */
export const CHAIN_BRIEF_METHODS = {
  statusRecoveries: 'Projects whose activity status HEY read moving from Quiet or Dormant to Shipping, Active or Resumed in the window, on HEY’s own readings; not the narrower Back from dormancy listing (RESUMED after 60+ days without activity).',
  stillBuilding: 'Projects HEY holds Still Building today: verified activity continuing through a market drawdown HEY tracked, measured only on an active market; a record, not a buy signal.',
  underTheRadar: 'Projects HEY holds Under the Radar today: building ahead of market attention by HEY’s rule (a positive Discovery Gap on an active market, attention at most typical). Strict by design, so a small count is the rule’s, not the chain’s.',
  newlyVerified: 'Projects HEY recorded as Verified Builders in the window.',
} as const;

const WORD_SHIP = noun('ship');
const WORD_PROJECT = noun('project');
const WORD_BUILDER = noun('builder');

export function composeChainBrief(ctx: AgentComposeContext, input: ChainBriefInput): AgentResponseOf<'chain_brief'> {
  const isEvidenceId = input.isEvidenceId ?? looksLikeEvidenceId;
  const { week } = input;
  const items = input.building.slice(0, CHAIN_BRIEF_CHANGES).map((event) => agentChange(event, { slug: event.project.slug, url: event.project.url }, ctx.baseUrl, isEvidenceId, input.codeWeeks?.get(event.id)));
  const ledgerFresh = familyFreshness('change_ledger', { observedAt: input.ledger.projectorRanAt, dataAsOf: input.ledger.newestRecordedAt, now: ctx.now });
  const window = { days: week.window.days, from: week.window.since, to: week.window.until, label: week.window.label };
  const count = (id: string, dimension: string, value: number, statement: string, status: 'FACT' | 'DERIVED', evidence: AgentClaim['evidence'] = []): AgentClaim => ({
    id,
    dimension,
    statement: derivedText(statement),
    status,
    value,
    source: status === 'FACT' ? { name: 'HEY record', type: 'hey_record' } : { name: 'hey', type: 'hey_rule' },
    observedAt: week.window.until,
    occurredAt: null,
    precision: 'WINDOW',
    freshness: ledgerFresh.freshnessStatus,
    evidence,
    evidenceKind: status === 'FACT' ? 'ledger_count' : 'rule_output',
  });
  const claims: AgentClaim[] = [
    count('week.ships', 'build', week.shipped.ships, `${countOf(week.shipped.ships, WORD_SHIP)} from ${countOf(week.shipped.projects, WORD_PROJECT)} in the ${week.window.label} (${week.shipped.rule.counts}).`, 'FACT'),
    count('week.newly_verified_builders', 'build', week.newBuilders.total, `${countOf(week.newBuilders.total, WORD_BUILDER)} newly verified. ${CHAIN_BRIEF_METHODS.newlyVerified}`, 'FACT'),
    count('week.status_recoveries', 'build', week.backToShipping.total, `${countOf(week.backToShipping.total, noun('status recovery', 'status recoveries'))} of ${week.backToShipping.comparable} projects HEY read more than once in the window. ${CHAIN_BRIEF_METHODS.statusRecoveries}`, 'DERIVED'),
    count('week.still_building', 'build', week.stillBuilding.total, `${countOf(week.stillBuilding.total, WORD_PROJECT)} Still Building. ${CHAIN_BRIEF_METHODS.stillBuilding}`, 'DERIVED'),
    count('week.under_the_radar', 'build', week.underTheRadar.total, `${countOf(week.underTheRadar.total, WORD_PROJECT)} Under the Radar. ${CHAIN_BRIEF_METHODS.underTheRadar}`, 'DERIVED'),
    count('week.building_changes', 'build', input.buildingTotal, `${countOf(input.buildingTotal, WORD_CHANGE)} that count as building in the change ledger over the same window.`, 'FACT', items.flatMap((item) => item.evidence).slice(0, 12)),
  ];
  const ran = input.ledger.projectorRanAt !== null;
  const answer = derivedText(
    `On Robinhood Chain in the ${week.window.label}: ${countOf(week.shipped.ships, WORD_SHIP)} from ${countOf(week.shipped.projects, WORD_PROJECT)}, ${countOf(week.newBuilders.total, WORD_BUILDER)} newly verified, ${countOf(week.backToShipping.total, noun('status recovery', 'status recoveries'))}. HEY holds ${week.stillBuilding.total} Still Building and ${week.underTheRadar.total} Under the Radar today (strict by design). ${ran ? `${countOf(input.buildingTotal, WORD_CHANGE)} that count as building; the newest ${items.length} are listed.` : 'The change ledger has not run here, so which changes count as building is unknown, not none.'}`,
  );
  return envelope(ctx, {
    capability: 'chain_brief',
    status: 'ok',
    subject: { kind: 'chain' },
    answer,
    answerStatus: 'FACT',
    claims,
    unknowns: ran
      ? []
      : [{ category: 'UNKNOWN', dimension: 'changeLedger', statement: heyText('HEY’s change ledger has not run on this deployment yet.'), doNotConclude: heyText('No change listed does not mean nothing was built.'), reason: 'change_ledger_not_run' }],
    freshness: [ledgerFresh],
    dataEvidence: items.flatMap((item) => item.evidence),
    data: {
      window,
      shipped: { ships: week.shipped.ships, projects: week.shipped.projects, rule: { id: week.shipped.rule.id, counts: week.shipped.rule.counts.slice(0, 400) } },
      newlyVerifiedBuilders: { total: week.newBuilders.total, method: heyText(CHAIN_BRIEF_METHODS.newlyVerified) },
      statusRecoveries: { total: week.backToShipping.total, comparable: week.backToShipping.comparable, method: heyText(CHAIN_BRIEF_METHODS.statusRecoveries) },
      stillBuilding: { total: week.stillBuilding.total, method: heyText(CHAIN_BRIEF_METHODS.stillBuilding) },
      underTheRadar: { total: week.underTheRadar.total, method: heyText(CHAIN_BRIEF_METHODS.underTheRadar) },
      building: { total: input.buildingTotal, shown: items.length, items, more: input.moreUrl },
      weekUrl: week.links.page,
    },
    page: week.links.page,
    canonical: [`${ctx.baseUrl}/api/this-week`, input.moreUrl],
    rules: [{ id: 'weekly_ships', version: week.shipped.rule.id }],
  });
}
