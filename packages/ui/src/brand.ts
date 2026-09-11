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
  shortName: 'HEY',
  tokenTicker: 'HEY',
  chainName: 'Robinhood Chain',
  chainId: 4663,
  /** Public block explorer for the chain; token pages live under `/token/<address>`. */
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  tagline: "Find who's actually building on Robinhood Chain.",
  secondaryTagline: 'See who is shipping before the market notices.',
  positioning: 'Builder intelligence for Robinhood Chain.',
  description:
    'Discover active projects, recent ships, and builders across Robinhood Chain with HEY Research Lab.',
} as const;

/** `{Page} | HEY Research Lab`, with the homepage carrying the full positioning. */
export const pageTitle = (page?: string): string =>
  page ? `${page} | ${BRAND.name}` : `${BRAND.name} — ${BRAND.chainName} Builder Intelligence`;

/** The explorer's own page for a token contract. */
export const explorerTokenUrl = (address: string): string =>
  `${BRAND.explorerUrl}/token/${address.toLowerCase()}`;
