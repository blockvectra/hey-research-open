/**
 * Token verification and ship verification in words: the one table every surface reads (2026-10-28 simplicity study,
 * CON-9). Five copies of the token words and two of the ship words had grown in `@hey/ui`, the explain engine, the
 * share templates and the Terminal preview. Imports nothing at run time (`word-modules.test.ts`); `@hey/ui` adds its
 * tones on top. The stored values and the API's fields are unchanged (machine rule 10): these are display words only.
 *
 * Named for what each check is, never "verified" (2026-10-28 founder ruling R2, "semua R ya"; CON-1): a public reader
 * meets that word only in "Verified Builder". "Token verified" beside "Verified Builder" read as one claim made twice,
 * and "Source verified" on a ship as a third.
 *
 * The change ledger keeps its own stored words (`changes/sources.ts`, "Site names another contract"): a ledger
 * summary is written once and never rewritten for a display change.
 */
export type TokenVerificationWordsKey = 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH';

export const TOKEN_VERIFICATION_WORDS: Readonly<Record<TokenVerificationWordsKey, { label: string; help: string }>> = {
  VERIFIED: { label: 'Project names this contract', help: 'The project itself ties this contract to the project: its site names the contract, or the owner proved control of the deployer.' },
  // Reason-neutral (2026-10-22, full audit INV-3): the chip's title sat beside the reason's own sentence, and for a site that
  // names the contract (contested, disowned, unreachable) "nothing the project published" was false.
  UNVERIFIED: { label: 'Not named by the project', help: 'HEY has not confirmed that the project stands behind this contract. The page says why.' },
  MISMATCH: { label: 'Project names another contract', help: 'The project’s own site names a different contract than the one HEY tracks. Treat the tracked token with care.' },
};

/** A verification's words; anything else reads as unverified, never as more than HEY confirmed. */
export function tokenVerificationWords(verification: string | null | undefined): { label: string; help: string } {
  return TOKEN_VERIFICATION_WORDS[verification as TokenVerificationWordsKey] ?? TOKEN_VERIFICATION_WORDS.UNVERIFIED;
}

/**
 * Reasons where the project's own site does name the contract and still does not tie it (2026-10-28, R2): the site
 * disowns the token, a lookalike page's site contests it, or the site stopped answering HEY's reads. "Not named by the
 * project" would be false beside the reason's own sentence, so where the reason is printed the label says what is true.
 */
const SITE_NAMES_BUT_DOES_NOT_TIE: ReadonlySet<string> = new Set(['site_disclaims_contract', 'site_names_contract_contested', 'site_unreachable']);

export const TOKEN_NOT_CONFIRMED_LABEL = 'Not confirmed by the project';

/** The label for one token's check, read with its reason where the reason decides the words. */
export function tokenVerificationLabelFor(verification: string | null | undefined, reason?: string | null): string {
  if (verification === 'UNVERIFIED' && reason && SITE_NAMES_BUT_DOES_NOT_TIE.has(reason)) return TOKEN_NOT_CONFIRMED_LABEL;
  return tokenVerificationWords(verification).label;
}

/**
 * What stands behind a ship, in three words (2026-10-28, R2): a public source, a HEY moderator's check, or the builder's
 * own word. Self-reported stays visibly distinct (CLAUDE.md product rule 10). The stored values
 * (`PUBLICLY_VERIFIED`, `SOURCE_LINKED` …) and the API's fields are unchanged (machine rule 10).
 */
export const SHIP_VERIFICATION_WORDS: Readonly<Record<string, string>> = {
  PUBLICLY_VERIFIED: 'Source-backed',
  ADMIN_VERIFIED: 'Checked by HEY',
  SOURCE_LINKED: 'Source-backed',
  SELF_REPORTED: 'Self-reported',
  DISPUTED: 'Disputed',
  RETRACTED: 'Retracted',
};

/** A ship's verification in words; a value this build does not know reads "Not checked", never more than HEY holds. */
export function shipVerificationWords(status: string): string {
  return SHIP_VERIFICATION_WORDS[status] ?? 'Not checked';
}
