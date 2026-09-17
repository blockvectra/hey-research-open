/**
 * Build `{ key: value }` only when the value exists.
 *
 * The schema uses optional properties rather than nullable ones, so a missing
 * provider field must be absent, never `undefined`. That is what keeps "we have
 * no market cap" distinguishable from "market cap is zero" (PRD V4 section 29:
 * never manufacture market cap).
 */
export const opt = <K extends string, V>(key: K, value: V | null | undefined) =>
  // A provider's explicit `null` is the same absence (2026-09-17): the
  // schemas accept it now, so one `null` field no longer voids a response.
  (value === undefined || value === null ? {} : { [key]: value }) as { [P in K]?: V };
