/**
 * Two round-4 founder decisions (2026-09-30), as the agent contract carries
 * them. Both are additive: no v1 field changes meaning.
 *
 * **`stillBuildingState`.** `stillBuilding` keeps its v1 meaning — `false`
 * both when the badge was measured and not met and when it was not measured
 * at all (a nullable field is deferred to `/api/v2`). Beside it the contract
 * now says which: `HELD`, `NOT_HELD` (measured, not met) or `NOT_MEASURED`
 * (no market drawdown HEY measures, or no score). When the public API sends
 * its own `stillBuildingState` the contract restates it; otherwise it reads
 * the API's `stillBuilding` and `stillBuildingWithheld`, exactly as the
 * explain engine classifies them.
 *
 * **HEY's own token.** Wherever `$HEY`'s project appears in an agent answer or
 * MCP output, the disclosure says so. Rankings stay neutral: no bonus and no
 * demotion (the self-preference rule); the disclosure is the only difference.
 */
export const STILL_BUILDING_STATES = ['HELD', 'NOT_HELD', 'NOT_MEASURED'] as const;
export type StillBuildingState = (typeof STILL_BUILDING_STATES)[number];

const isState = (value: unknown): value is StillBuildingState => typeof value === 'string' && (STILL_BUILDING_STATES as readonly string[]).includes(value);

/**
 * The API's own `stillBuildingState` (round 4, 2026-09-30), restated: the
 * scorer decides it (`stillBuildingState` in `@hey/scoring`) and every surface
 * reads it. The contract derives nothing of its own: without the API's state,
 * the state is not known, never a guess from `stillBuilding` alone.
 */
export function stillBuildingStateOf(input: { apiState?: unknown }): StillBuildingState {
  return isState(input.apiState) ? input.apiState : 'NOT_MEASURED';
}

/** The explain engine's `still_building` classification in the contract's three states. */
export function stillBuildingStateOfClassification(classification: string): StillBuildingState {
  if (classification === 'STILL_BUILDING') return 'HELD';
  if (classification === 'NOT_MET') return 'NOT_HELD';
  return 'NOT_MEASURED';
}

/**
 * The founder's words (round 4, 2026-09-30), printed wherever `$HEY` appears:
 * the domain's `HEYS_OWN_TOKEN_DISCLOSURE`, word for word. This package cannot
 * import the domain, so `agent-canonical-parity.test.ts` in the web app holds
 * the two equal, and `STILL_BUILDING_STATES` equal to the scorer's.
 */
export const HEY_OWN_TOKEN_DISCLOSURE = 'HEY’s own token — researched by the same rules';
export const HEY_OWN_TOKEN_DISCLOSURE_CODE = 'hey_own_token' as const;

/** Where HEY's own project is, for a composer: its slugs, and its token contract. */
export type OwnProject = { slugs: readonly string[]; token: { chainId: number; address: string } | null };
