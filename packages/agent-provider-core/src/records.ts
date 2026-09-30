/**
 * The tag one HEY record carries, read from its typed id (2026-09-26, audit
 * §45 #8; moved here from the MCP core on 2026-09-30 so the agent contract
 * and the MCP renderers share one rule).
 *
 * A state transition HEY computed (activity status, market status, research
 * level), a signal over a window HEY measured (`signal:`, and the timeline's
 * `resumed:`) and a market-integrity reading are rules HEY applied: DERIVED,
 * as the explain engine and the snapshot tag the same facts. A ship, a
 * release, a lock, a contract change, a verified claim, token verification
 * and launch stage are records with a source: FACT.
 */
const DERIVED_STATE_KEYS: ReadonlySet<string> = new Set(['activity_status', 'market_status', 'catalog_status']);

export function recordTag(id: string): 'FACT' | 'DERIVED' {
  const [family, , key] = id.split(':');
  if (family === 'signal' || family === 'resumed' || family === 'integrity') return 'DERIVED';
  if (family === 'state') return DERIVED_STATE_KEYS.has(key ?? '') ? 'DERIVED' : 'FACT';
  return 'FACT';
}

/**
 * Whether a change event's `summary` is a source's own words (2026-09-30,
 * machine-safe text). A ship's summary is the title the source gave it — a
 * release name, a changelog heading, a commit week's title — passed on as
 * written. Every other ledger family's summary is a sentence HEY composed.
 */
export function summaryIsSourceText(eventId: string): boolean {
  return eventId.startsWith('ship:');
}
