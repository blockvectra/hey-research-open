import { heyText, derivedText, type AgentText } from './text';

/**
 * What HEY does not know, as five categories (2026-09-30, readiness §5).
 *
 * The categories restate HEY's canonical coverage states (`project-coverage`)
 * and its identity checks (token verification, repository ownership, owner
 * verification) for an agent that has to decide when not to rely on HEY:
 *
 * | category                | from                                                          |
 * |-------------------------|---------------------------------------------------------------|
 * | `NOT_MEASURED`          | `NO_SOURCE`, `NOT_RESEARCHED`; usage not watched or not read     |
 * | `INSUFFICIENT_EVIDENCE` | `NOT_ENOUGH_YET`; usage over part of the window                 |
 * | `STALE`                 | `STALE`                                                        |
 * | `NOT_VERIFIED`          | an unverified token, context-only repositories or packages, an unconfirmed site, no verified owner |
 * | `UNKNOWN`               | `SOURCE_UNAVAILABLE`, `ERROR`; activity status `UNKNOWN`; a ledger that cannot answer |
 *
 * `MEASURED`, `NOT_APPLICABLE` and `WITHHELD` are not gaps: a meme with no
 * package is not missing one, and a withheld figure is measured and says so.
 *
 * A gap is never negative evidence. Each carries `doNotConclude`, the one
 * sentence an agent must keep beside it.
 */
export const AGENT_UNKNOWN_CATEGORIES = ['UNKNOWN', 'NOT_MEASURED', 'NOT_VERIFIED', 'STALE', 'INSUFFICIENT_EVIDENCE'] as const;
export type AgentUnknownCategory = (typeof AGENT_UNKNOWN_CATEGORIES)[number];

export type CoverageStateCode = 'MEASURED' | 'NO_SOURCE' | 'NOT_ENOUGH_YET' | 'STALE' | 'SOURCE_UNAVAILABLE' | 'NOT_APPLICABLE' | 'NOT_RESEARCHED' | 'ERROR' | 'WITHHELD';

/** Reason codes on a gap state that mean "HEY has not verified whose it is", not "HEY has not read it". */
const NOT_VERIFIED_REASONS: ReadonlySet<string> = new Set(['context_only_repositories', 'claimed_package_links_only', 'site_not_corroborated', 'context_only_docs']);

/** The category a coverage entry belongs to; undefined when it is not a gap. */
export function categoryOfCoverage(state: CoverageStateCode, reason?: string): AgentUnknownCategory | undefined {
  if (reason && NOT_VERIFIED_REASONS.has(reason) && state !== 'MEASURED' && state !== 'NOT_APPLICABLE' && state !== 'WITHHELD') return 'NOT_VERIFIED';
  switch (state) {
    case 'NO_SOURCE':
    case 'NOT_RESEARCHED':
      return 'NOT_MEASURED';
    case 'NOT_ENOUGH_YET':
      return 'INSUFFICIENT_EVIDENCE';
    case 'STALE':
      return 'STALE';
    case 'SOURCE_UNAVAILABLE':
    case 'ERROR':
      return 'UNKNOWN';
    default:
      return undefined;
  }
}

export const DO_NOT_CONCLUDE: Readonly<Record<AgentUnknownCategory, string>> = {
  NOT_MEASURED: 'HEY has not measured this. Do not read it as zero, as absent or as negative evidence about the project.',
  INSUFFICIENT_EVIDENCE: 'HEY has read too little of this to say. Do not treat a partial figure as the whole, or the gap as a finding.',
  STALE: 'HEY’s newest reading is older than its freshness limit. Do not treat it as current.',
  NOT_VERIFIED: 'HEY has not verified this link. Do not treat it as the project’s own, and do not treat it as false either.',
  UNKNOWN: 'HEY cannot say. A missing value is not negative evidence.',
};

export function doNotConclude(category: AgentUnknownCategory): AgentText {
  return heyText(DO_NOT_CONCLUDE[category]);
}

export type AgentUnknownInput = {
  category: AgentUnknownCategory;
  dimension: string;
  /** HEY's sentence for the gap: a canonical gap sentence (`coverageGaps`) or one written here. */
  statement: string;
  reason: string;
  coverageState?: CoverageStateCode;
  asOf?: string;
  detailUrl?: string;
};

export function agentUnknown(input: AgentUnknownInput) {
  return {
    category: input.category,
    dimension: input.dimension,
    // Canonical gap sentences are HEY's fixed words; a sentence that carries a record value is derived.
    statement: /\d|"/.test(input.statement) ? derivedText(input.statement) : heyText(input.statement),
    doNotConclude: doNotConclude(input.category),
    ...(input.coverageState ? { coverageState: input.coverageState } : {}),
    reason: input.reason,
    ...(input.asOf ? { asOf: input.asOf } : {}),
    ...(input.detailUrl ? { detailUrl: input.detailUrl } : {}),
  };
}
