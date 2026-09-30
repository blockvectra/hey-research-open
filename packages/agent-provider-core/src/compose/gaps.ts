import type { HeyCoverageEntry } from '@hey-research-lab/sdk';

import { agentUnknown, categoryOfCoverage, type CoverageStateCode } from '../unknowns';
import type { AgentUnknown } from '../schema';

/**
 * One gap from HEY's canonical gap list (`coverageGaps` in the domain): the
 * dimension, its state and HEY's sentence for it, in reading order. The web
 * app passes the domain's list so the sentence is the one every surface
 * prints; this package never writes a second one.
 */
export type CanonicalGap = { dimension: string; state: CoverageStateCode; sentence: string; reason?: string; asOf?: string };

/**
 * The identity and builder facts whose absence is itself a gap: whether the
 * activity status is known, whether the project names its token, whether an
 * owner is verified, whether Build Momentum and usage are measured, whether
 * the change ledger could answer.
 */
export type GapFacts = {
  activityStatus: string;
  tokenVerification: { status: 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH'; reason?: string } | null;
  ownerVerified: boolean;
  /** Build Momentum as the serialiser's gate publishes it; undefined when not measured. */
  buildMomentum: number | undefined;
  usage: { state: string; reason: string; observedAt?: string } | null | undefined;
  ledger: { available: boolean; reason?: string };
  /** The project's name and ticker, only to test whether they borrow a brand HEY holds no evidence of (2026-09-30). */
  identity?: { name: string; symbol?: string | null };
};

/**
 * A third party's brand in a project's own name or ticker (2026-09-30,
 * adversarial review): tokens named "Robinhood Official Dex" or "The Official
 * Robinhood's Mascot" are researched like any project, and an agent must not
 * read HEY's record as Robinhood's involvement. HEY holds no evidence of any
 * Robinhood-issued project, so the name alone is a gap, never a finding.
 */
const BORROWED_BRANDS: readonly { brand: string; pattern: RegExp }[] = [{ brand: 'Robinhood', pattern: /robin\s*hood/i }];

export function borrowedBrandOf(identity: { name: string; symbol?: string | null } | undefined): string | undefined {
  if (!identity) return undefined;
  const words = `${identity.name} ${identity.symbol ?? ''}`.normalize('NFKC');
  return BORROWED_BRANDS.find((entry) => entry.pattern.test(words))?.brand;
}

const TOKEN_REASON_WORDS: Readonly<Record<string, string>> = {
  owner_has_not_published_contract: 'The verified owner has not published the token contract on the project’s own site or signed for it.',
  self_reported: 'The token was named in the project’s submission; the project’s own site or an on-chain signature has not confirmed it.',
  launchpad_record: 'HEY knows the token from a launchpad record; the project has not been seen naming it.',
  launchpad_record_site_silent: 'HEY knows the token from a launchpad record, and the project’s site does not name it.',
  market_listing: 'HEY knows the token from a market listing; the project has not been seen naming it.',
  site_silent: 'The project’s site does not name the token contract.',
  not_checked: 'HEY has not yet checked whether the project names the token contract.',
};

/**
 * Every gap for one project, identity checks first, then the coverage
 * dimensions in HEY's reading order. A dimension appears once.
 */
export function projectUnknowns(input: { gaps: readonly CanonicalGap[]; dimensions: Readonly<Record<string, HeyCoverageEntry>> | undefined; facts: GapFacts; coverageUrl: string; explainUrl: (fact: string) => string }): AgentUnknown[] {
  const { facts } = input;
  const out: AgentUnknown[] = [];
  const seen = new Set<string>();
  const push = (unknown: AgentUnknown) => {
    if (seen.has(unknown.dimension)) return;
    seen.add(unknown.dimension);
    out.push(unknown);
  };

  if (facts.activityStatus === 'UNKNOWN') {
    push(agentUnknown({ category: 'UNKNOWN', dimension: 'activityStatus', statement: 'HEY does not measure this project’s building: it holds no source it can read building from, or the activity it reads is recorded under another page. This is a gap in HEY’s sources, not a finding about the team.', reason: 'activity_status_unknown', detailUrl: input.explainUrl('activity.status') }));
  }
  const brand = borrowedBrandOf(facts.identity);
  if (brand) {
    push(agentUnknown({ category: 'NOT_VERIFIED', dimension: 'brandAffiliation', statement: `The project’s name or ticker uses ${brand}’s name. HEY holds no evidence that ${brand} is involved with it; HEY researches it like any other project.`, reason: 'name_uses_third_party_brand' }));
  }
  if (facts.tokenVerification?.status === 'MISMATCH') {
    // A known conflict, not an absence (2026-09-30): the project's own site names another contract, so this token is not shown to be its own.
    push(agentUnknown({ category: 'NOT_VERIFIED', dimension: 'tokenOwnership', statement: 'The project’s own site names a different contract than the token HEY tracks for it: its building activity does not apply to this token.', reason: 'token_site_names_another_contract', detailUrl: input.explainUrl('token.verification') }));
  }
  if (facts.tokenVerification?.status === 'UNVERIFIED') {
    const reason = facts.tokenVerification.reason ?? 'not_checked';
    push(agentUnknown({ category: 'NOT_VERIFIED', dimension: 'tokenOwnership', statement: TOKEN_REASON_WORDS[reason] ?? 'The project has not been seen naming this token contract.', reason: `token_${reason}`, detailUrl: input.explainUrl('token.verification') }));
  }
  if (!facts.ownerVerified) {
    push(agentUnknown({ category: 'NOT_VERIFIED', dimension: 'projectOwner', statement: 'No owner has proved control of this project’s site, repository or contract to HEY.', reason: 'owner_not_verified' }));
  }
  if (facts.buildMomentum === undefined && facts.activityStatus !== 'UNKNOWN') {
    push(agentUnknown({ category: 'NOT_MEASURED', dimension: 'buildMomentum', statement: 'Build Momentum is not measured for this project.', reason: 'build_momentum_not_measured', detailUrl: input.explainUrl('build.momentum') }));
  }
  if (!facts.ledger.available) {
    push(agentUnknown({ category: 'UNKNOWN', dimension: 'changeLedger', statement: 'HEY’s change ledger could not list this project’s changes for this answer.', reason: facts.ledger.reason ?? 'change_ledger_not_available' }));
  }
  const usage = facts.usage;
  if (usage) {
    const category = usage.state === 'NOT_WATCHED' || usage.state === 'NOT_READ' ? 'NOT_MEASURED' : usage.state === 'STALE' ? 'STALE' : usage.state === 'PARTIAL' ? 'INSUFFICIENT_EVIDENCE' : undefined;
    if (category) {
      const statement =
        usage.state === 'NOT_WATCHED'
          ? 'HEY does not watch this project’s contracts for product usage, so use is not measured.'
          : usage.state === 'NOT_READ'
            ? 'HEY has not rolled up this project’s product usage yet.'
            : usage.state === 'STALE'
              ? 'HEY’s newest usage reading for this project is out of date.'
              : 'HEY holds usage for only part of the window.';
      push(agentUnknown({ category, dimension: 'usage', statement, reason: usage.reason, ...(usage.observedAt ? { asOf: usage.observedAt } : {}) }));
    }
  }

  for (const gap of input.gaps) {
    const category = categoryOfCoverage(gap.state, gap.reason);
    if (!category) continue;
    const entry = input.dimensions?.[gap.dimension];
    push(
      agentUnknown({
        category,
        dimension: gap.dimension,
        statement: gap.sentence,
        reason: gap.reason ?? entry?.reason ?? gap.state.toLowerCase(),
        coverageState: gap.state,
        ...(gap.asOf ? { asOf: gap.asOf } : {}),
        detailUrl: entry?.detailUrl ?? input.coverageUrl,
      }),
    );
  }
  return out;
}

/** The coverage dimensions by what they say: measured, not applicable, withheld. */
export function coverageBuckets(dimensions: Readonly<Record<string, HeyCoverageEntry>> | undefined): { measured: string[]; notApplicable: string[]; withheld: string[] } {
  const entries = Object.entries(dimensions ?? {});
  return {
    measured: entries.filter(([, entry]) => entry.state === 'MEASURED').map(([dimension]) => dimension),
    notApplicable: entries.filter(([, entry]) => entry.state === 'NOT_APPLICABLE').map(([dimension]) => dimension),
    withheld: entries.filter(([, entry]) => entry.state === 'WITHHELD').map(([dimension]) => dimension),
  };
}
