/**
 * Central brand constants (UI/UX V4 section 64).
 *
 * One place for the product's name so a rename never has to be a search of the
 * whole tree. Repository, database schema, env prefixes and package names stay
 * as they are — renaming those risks breaking deployments for no user-visible
 * gain (section 63).
 */
export const BRAND = {
  /** HEY's own X account (2026-09-11); the footer links it and the project page reads it as an official source. */
  xUrl: 'https://x.com/HeyResearch',
  name: 'HEY Research Lab',
  /** The one contact inbox the site names: account questions, API refusals, the Terms and the Privacy page. */
  contactEmail: 'hi@heyresearch.xyz',
  shortName: 'HEY',
  tokenTicker: 'HEY',
  chainName: 'Robinhood Chain',
  chainId: 4663,
  /** Public block explorer for the chain; token pages live under `/token/<address>`. */
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  tagline: "Find who's actually building on Robinhood Chain.",
  /*
   * No "before the market notices" line (positioning pass, 2026-09-30): it
   * promised a timing edge on a price, which HEY cannot prove and must not
   * sell. The site's words are in apps/web/src/lib/home-positioning.ts.
   */
  positioning: 'Builder intelligence for Robinhood Chain.',
  description:
    'The evidence behind Robinhood Chain projects: what builders shipped, when, and the public source for it.',
} as const;

/** `{Page} | HEY Research Lab`, with the homepage carrying the full positioning. */
export const pageTitle = (page?: string): string =>
  page ? `${page} | ${BRAND.name}` : `${BRAND.name} — The public record of building on ${BRAND.chainName}`;

/** The explorer's own page for a token contract. */
export const explorerTokenUrl = (address: string): string =>
  `${BRAND.explorerUrl}/token/${address.toLowerCase()}`;

/**
 * The brand marks every page draws, at content-hashed paths (2026-10-17, performance audit SPD-5).
 *
 * `/hey-mark.png` and its dark twin sit in the header of every page, and Next serves `public/` at `max-age=0`: each
 * page view sent two or three conditional requests through the edge to the origin for the same few KB. Under
 * `/brand/` the name carries the first eight hex characters of the file's SHA-256, so `next.config.ts` serves them
 * `immutable` for a year — new artwork is a new name, never an edit in place (`apps/web/src/lib/brand-marks.test.ts`
 * fails the build when a name and its bytes disagree). The unversioned files stay where they were, the same bytes,
 * for the share cards, the agent cards and any third party that already links them.
 */
export const BRAND_MARKS = {
  hey: '/brand/hey-mark.0716d350.png',
  heyDark: '/brand/hey-mark-dark.6cbbf794.png',
  hoodlock: '/brand/hoodlock-mark.6c12f33e.png',
} as const;
