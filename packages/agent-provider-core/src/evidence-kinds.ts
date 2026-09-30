/**
 * What a claim rests on (2026-09-30, round 4): every claim in the agent
 * contract names the kind of basis it restates, whether or not that basis has
 * a typed evidence id.
 *
 * A typed id (`ship:`, `state:`, `source:` …) is cited only where a canonical
 * evidence record exists and resolves at `/api/evidence/{id}`. Many claims
 * have none, honestly: a rule's output, a count over the ledger, a coverage
 * state, a market reading. Those say so here instead of carrying an invented
 * id. The kind never makes a claim stronger than its FACT / DERIVED / UNKNOWN
 * tag.
 */
export const AGENT_EVIDENCE_KINDS = [
  'evidence_record',
  'rule_output',
  'ledger_count',
  'coverage_state',
  'market_reading',
  'usage_reading',
  'registry_record',
  'canonical_read',
  'not_held',
] as const;
export type AgentEvidenceKind = (typeof AGENT_EVIDENCE_KINDS)[number];

/** One sentence each, served in the catalogue (`GET /api/agent`) and the docs. */
export const AGENT_EVIDENCE_KIND_MEANINGS: Readonly<Record<AgentEvidenceKind, string>> = {
  evidence_record: 'One or more published records, each cited by a typed evidence id that resolves at /api/evidence/{id}.',
  rule_output: 'The output of a HEY rule (activity status, Build Momentum, Still Building); explainUrl gives the rule, its inputs and lineage. Evidence ids, when present, are the records the explain engine cites.',
  ledger_count: 'A true total over the change ledger for the window. Evidence ids, when present, are the listed events of that kind, not every one counted.',
  coverage_state: 'A coverage state from the project\'s coverage read (MEASURED, NO_SOURCE, STALE …): a state, never a score, and no single record behind it.',
  market_reading: 'A market provider\'s reading HEY stored: context only, never a builder input, and no evidence id family exists for it.',
  usage_reading: 'Decoded contract calls HEY counted per UTC day: context only, never a builder input.',
  registry_record: 'HEY\'s own record — its contract registry or token verification record — stated by the canonical read in explainUrl.',
  canonical_read: 'A field of one canonical public read (snapshot, token lookup, contract read), with the read time in observedAt.',
  not_held: 'HEY does not hold this: the claim is UNKNOWN and carries a reason.',
};
