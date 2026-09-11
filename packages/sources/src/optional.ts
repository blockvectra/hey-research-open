/**
 * Build `{ key: value }` only when the value exists.
 *
 * The schema uses optional properties rather than nullable ones, so a missing
 * provider field must be absent, never `undefined`. That is what keeps "we have
 * no market cap" distinguishable from "market cap is zero" (PRD V4 section 29:
 * never manufacture market cap).
 */
export const opt = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
