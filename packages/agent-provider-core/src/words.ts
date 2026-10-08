/**
 * Counted words in HEY-authored answer text (2026-09-30).
 *
 * The contract's sentences say "1 release" and "2 releases", "in the last
 * day" and "in the last 7 days". Plurals are spelled out, never produced by
 * appending an "s": "week of code activity" is "weeks of code activity", not
 * "week of code activitys". Pure and deterministic: the same count gives the
 * same words on REST, MCP and A2A.
 */
export type CountNoun = { readonly one: string; readonly other: string };

/** A noun with its plural; the plural defaults to the singular plus "s" only when none is given. */
export const noun = (one: string, other: string = `${one}s`): CountNoun => ({ one, other });

/** "0 releases", "1 release", "2 releases". */
export function countOf(n: number, word: CountNoun): string {
  return `${n} ${n === 1 ? word.one : word.other}`;
}

/** "in the last day", "in the last 7 days". */
export function inTheLastDays(days: number): string {
  return days === 1 ? 'in the last day' : `in the last ${days} days`;
}

/** The words for each change type HEY names in prose; any other type reads "<type> event(s)". */
export const CHANGE_TYPE_NOUNS: Readonly<Record<string, CountNoun>> = {
  'build.release': noun('release'),
  'build.ship': noun('ship'),
  'build.code_activity': noun('week of code activity', 'weeks of code activity'),
  'build.status_changed': noun('activity status change'),
  'build.dormant': noun('move to dormant', 'moves to dormant'),
  'build.resumed': noun('resumption after dormancy', 'resumptions after dormancy'),
  'build.accelerating': noun('acceleration signal'),
  'build.slowing': noun('slowdown signal'),
  'contract.deployed': noun('contract deployment'),
  'contract.followup_deployed': noun('follow-up contract deployment'),
  'contract.implementation_changed': noun('implementation change'),
  'contract.interface_changed': noun('interface change'),
  'contract.source_verified': noun('source verification'),
  'contract.source_unverified': noun('source verification lost', 'source verifications lost'),
  'contract.usage_changed': noun('usage change'),
  'contract.method_first_observed': noun('method first observed', 'methods first observed'),
  'contract.method_resumed': noun('method resumed', 'methods resumed'),
  'market.status_changed': noun('market status change'),
  'market.liquidity_moved': noun('liquidity move'),
  'market.volume_spike': noun('volume spike'),
  'market.distribution_changed': noun('distribution change'),
  'token.launch_stage_changed': noun('launch stage change'),
  'token.verification_changed': noun('token verification change'),
  'research.published': noun('research publication'),
  'research.builder_verified': noun('builder verification'),
  'research.owner_verified': noun('owner verification'),
  'research.source_added': noun('source added', 'sources added'),
  'research.source_unavailable': noun('source unavailable', 'sources unavailable'),
  'research.source_restored': noun('source restored', 'sources restored'),
  'research.source_changed': noun('source change'),
  'research.narrative_assigned': noun('narrative assignment'),
  'lock.unlock_due': noun('scheduled unlock'),
  'lock.observed': noun('lock observed', 'locks observed'),
  'lock.withdrawn': noun('lock withdrawal'),
  'market_integrity.event': noun('market-integrity event'),
};

export function changeTypeNoun(type: string): CountNoun {
  return CHANGE_TYPE_NOUNS[type] ?? noun(`${type} event`);
}

export const WORD_MEANINGFUL_EVENT = noun('meaningful event');
export const WORD_MEANINGFUL_BUILDING_EVENT = noun('meaningful building event');
export const WORD_CHANGE = noun('change');
export const WORD_THING = noun('thing');

/**
 * The valuation gate's reason codes as the public API sends them in
 * `valuationWithheld` (round 4, 2026-09-30): a valuation not plausible from
 * the readings HEY has. The rule and its thresholds live in `@hey/scoring`
 * (`VALUATION_IMPLAUSIBLE_REASONS`); a parity test in the web app holds this
 * list to that one.
 */
export const VALUATION_NOT_PLAUSIBLE_CODES = [
  'valuation_over_liquidity',
  'unlisted_over_ceiling',
  'chain_evidence_contradicts',
] as const;

const VALUATION_NOT_PLAUSIBLE_REASON_WORDS: Readonly<
  Record<(typeof VALUATION_NOT_PLAUSIBLE_CODES)[number], string>
> = {
  valuation_over_liquidity: 'at least 10,000× the liquidity measured in the same reading',
  unlisted_over_ceiling: 'above $10B on a Robinhood Chain token that no listing HEY reads carries',
  chain_evidence_contradicts: "contradicted more than 10× by HEY's own chain readings (its decoded trades' price, or its chain pool index on a day the reading barely traded)",
};

/** Whether an API `valuationWithheld` code is the valuation gate's (not plausible) rather than a market's. */
export function isValuationNotPlausible(
  code: string,
): code is (typeof VALUATION_NOT_PLAUSIBLE_CODES)[number] {
  return (VALUATION_NOT_PLAUSIBLE_CODES as readonly string[]).includes(code);
}

/**
 * Why a valuation is withheld, as a clause, from the API's `valuationWithheld`
 * code: "the market is not live (liquidity removed)", or "it is not plausible
 * from the readings HEY has — … (valuation_over_liquidity)". The same words on
 * REST, MCP and A2A.
 */
export function valuationWithheldClause(code: string): string {
  return isValuationNotPlausible(code)
    ? `it is not plausible from the readings HEY has — ${VALUATION_NOT_PLAUSIBLE_REASON_WORDS[code]} (${code})`
    : `the market is not live (${code.toLowerCase().replace(/_/g, ' ')})`;
}

/** The agent contract's sentence for a withheld valuation; a market that is not live keeps its v1 words. */
export function valuationWithheldSentence(code: string): string {
  return isValuationNotPlausible(code)
    ? `HEY holds a market reading for this token and withholds its valuation: ${valuationWithheldClause(code)}.`
    : 'HEY holds a market reading for this token and withholds the valuation: the market is not live.';
}
