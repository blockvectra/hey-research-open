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

/* ------------------------------------------------------------ the citation */

/** Who an answer is cited to. The same words the MCP handshake and the registry entry carry. */
export const CITATION_PUBLISHER = 'HEY Research Lab';

/**
 * The citation as one sentence (2026-10-14, AG-02): "Source: HEY Research
 * Lab, builder research for Robinhood Chain — https://heyresearch.xyz/project/chit,
 * as of 2026-10-14, rules hbm-v28". The last line of every MCP text and A2A
 * text part, and `citation.text` on the API, so an answer an agent repeats
 * carries where it came from and when. The URL is the clean canonical page
 * (or the answer's own URL when the answer has no page: a chain-wide window);
 * the date is the answer's `asOf` day; the rules are the scoring version the
 * answer rests on, else the capability's first rule.
 */
export function citationText(input: { chainName: string; url: string; asOf: string; rules?: string | null | undefined }): string {
  const rules = input.rules ? `, rules ${input.rules}` : '';
  return `Source: ${CITATION_PUBLISHER}, builder research for ${input.chainName} — ${input.url}, as of ${input.asOf.slice(0, 10)}${rules}`;
}

/* ------------------------------------------- the research answer's lead */

/**
 * The Research Summary's build answer as the subject of a plain sentence
 * (2026-10-14, AG-02). The summary's `answer` is the canonical human reading
 * of the status ("Shipping consistently", "Last shipped 12 days ago", "Quiet
 * for 34 days", "Shipping again after 40 quiet days"; `BUILD_ANSWER_WORDS`
 * and `buildAnswer` in the domain's summary composer) and the line's text is
 * the canonical figures ("4 meaningful events in 30 days; latest ship 3 days
 * ago."). This joins the two with a name and no new judgement: "Chit is
 * shipping consistently: 4 meaningful events in 30 days; latest ship 3 days
 * ago." A reading this table does not know (an UNKNOWN state's label, a
 * later vocabulary) is kept as the summary wrote it: "Chit: No builder source
 * linked". Every word a reader could repeat is HEY's canonical sentence.
 */
const BUILD_ANSWER_LEADS: readonly { pattern: RegExp; lead: (name: string, rest: string) => string }[] = [
  { pattern: /^Shipping consistently$/i, lead: (name) => `${name} is shipping consistently` },
  { pattern: /^Shipped this week$/i, lead: (name) => `${name} shipped this week` },
  { pattern: /^Building$/i, lead: (name) => `${name} is building` },
  { pattern: /^Last shipped (.+)$/i, lead: (name, rest) => `${name} last shipped ${rest}` },
  { pattern: /^Quiet for (.+)$/i, lead: (name, rest) => `${name} has been quiet for ${rest}` },
  { pattern: /^Quiet$/i, lead: (name) => `${name} is quiet` },
  { pattern: /^Dormant: no ship for (.+)$/i, lead: (name, rest) => `${name} is dormant: no ship for ${rest}` },
  { pattern: /^Dormant$/i, lead: (name) => `${name} is dormant` },
  { pattern: /^Shipping again after (.+)$/i, lead: (name, rest) => `${name} is shipping again after ${rest}` },
];

export function buildAnswerLead(name: string, answer: string): string {
  const trimmed = answer.trim().replace(/[.:]+$/, '');
  for (const entry of BUILD_ANSWER_LEADS) {
    const match = entry.pattern.exec(trimmed);
    if (match) return entry.lead(name, match[1] ?? '');
  }
  return `${name}: ${trimmed}`;
}

/**
 * The build line's figures without its status label: "Shipping: 4 meaningful
 * events in 30 days; latest ship 3 days ago." → "4 meaningful events in 30
 * days; latest ship 3 days ago." The label is the part before the first
 * ": " (the summary writes `${label}: ${parts}`); a line with none is kept whole.
 */
export function buildLineFigures(text: string): string {
  const index = text.indexOf(': ');
  return (index > 0 && index < 48 ? text.slice(index + 2) : text).trim();
}

/**
 * A project's name as the lead of HEY's own sentence, when it can stand
 * there: short, printable, no instruction-like words. Otherwise the slug,
 * which is HEY's own identifier. A name is a source's words; inside a
 * `derived` sentence it is folded and checked like any other, and this keeps
 * a long or instruction-shaped name out of the one line an agent repeats.
 */
const PLAIN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'’&+\-_()$]{0,39}$/u;
export function leadName(name: string | undefined, slug: string, looksLikeInstruction: (text: string) => boolean): string {
  const trimmed = (name ?? '').trim();
  return trimmed && PLAIN_NAME.test(trimmed) && !looksLikeInstruction(trimmed) ? trimmed : slug;
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
  'sources_disagree',
] as const;

const VALUATION_NOT_PLAUSIBLE_REASON_WORDS: Readonly<
  Record<(typeof VALUATION_NOT_PLAUSIBLE_CODES)[number], string>
> = {
  valuation_over_liquidity: 'at least 10,000× the liquidity measured in the same reading',
  unlisted_over_ceiling: 'above $10B on a Robinhood Chain token that no listing HEY reads carries',
  chain_evidence_contradicts: "contradicted more than 10× by HEY's own chain readings (its decoded trades' price, or its chain pool index on a day the reading barely traded)",
  sources_disagree: 'more than 10× away from another source\'s price for the same token within a day, so HEY cannot say which figure is the market',
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
