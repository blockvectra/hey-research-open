/**
 * Research level in words: the one table the header badge, "What HEY
 * checked" and the Research Summary's build line read (2026-10-01, round 2).
 *
 * The outsider test found the badge "Researched" beside the build line's
 * "Not researched yet · HEY indexed this record and has not read its
 * sources" on 158 published projects. Both were true of different things —
 * the badge says HEY researched the project's public profile, the line said
 * HEY had not yet read its sources for ship events — but the line borrowed
 * the INDEXED level's words for a project that is not indexed-only. The
 * level now decides the words the line uses, so the two can never disagree.
 *
 * Pure: no React, no database. `@hey/ui` adds its colours on top.
 */
export type ResearchLevelWordsKey = 'INDEXED' | 'RESEARCHED' | 'VERIFIED_BUILDER';

export const RESEARCH_LEVEL_WORDS: Readonly<Record<ResearchLevelWordsKey, { label: string; help: string }>> = {
  INDEXED: { label: 'Indexed', help: 'Recorded on Robinhood Chain. Not researched yet.' },
  RESEARCHED: { label: 'Researched', help: 'HEY has enriched this project from public sources.' },
  VERIFIED_BUILDER: { label: 'Verified Builder', help: 'HEY holds verified evidence of shipping.' },
};

/** The badge's word for a level; an unknown level reads as the lowest one, never as more research than HEY did. */
export function researchLevelWords(level: string | null | undefined): { label: string; help: string } {
  return RESEARCH_LEVEL_WORDS[level as ResearchLevelWordsKey] ?? RESEARCH_LEVEL_WORDS.INDEXED;
}

/**
 * The RESEARCHED level on a page HEY reads no builder source for (persona
 * audit PB-4, 2026-10-18): /project/bv7x wore a blue capitalised
 * "RESEARCHED" pill styled like Verified Builder, directly above "Token
 * unverified" and "No builder source linked", and a reader from X took it for
 * "HEY checked this and it's OK". There the level says what it is — a profile
 * filled from public sources — as quiet text, never a badge.
 */
export const RESEARCHED_NO_BUILDER_SOURCE_WORDS = {
  label: 'Profile from public sources',
  help: 'HEY filled this profile from public sources and reads no builder source for it yet, so the level says nothing about building, the token or whether the project can be trusted.',
} as const;

/** The level's words for one page: the RESEARCHED level without a builder source HEY reads gets its own; every other is `researchLevelWords`. */
export function researchLevelWordsFor(level: string | null | undefined, hasBuilderSource: boolean | undefined): { label: string; help: string; quiet: boolean } {
  if (level === 'RESEARCHED' && hasBuilderSource === false) return { ...RESEARCHED_NO_BUILDER_SOURCE_WORDS, quiet: true };
  return { ...researchLevelWords(level), quiet: false };
}

/**
 * The build answer when HEY has not read a project's building sources yet,
 * worded by its research level:
 *
 *  - INDEXED — "Not researched yet": HEY only indexed the record;
 *  - RESEARCHED or VERIFIED_BUILDER — "Building not checked yet": HEY
 *    researched the project and has not yet read its sources for ship events.
 *    Never "Not researched yet" beside a "Researched" badge.
 */
export function buildNotReadWords(level: string | null | undefined): { answer: string; text: string; reason: 'indexed_only' | 'building_not_read' } {
  if (level === 'RESEARCHED' || level === 'VERIFIED_BUILDER') {
    return {
      answer: 'Building not checked yet',
      text: 'HEY researched this project’s public profile and has not yet read its sources for ship events.',
      reason: 'building_not_read',
    };
  }
  return { answer: 'Not researched yet', text: 'HEY indexed this record and has not read its sources.', reason: 'indexed_only' };
}

/**
 * What the Verified Builder badge verified, in one line under the badge
 * (outsider audit, 2026-10-02). A builder read "VERIFIED BUILDER" beside
 * "nobody has yet proved they run it" and "Activity not measurable" on the
 * same page and could not tell which claim the badge made. It makes one: HEY
 * holds verified evidence of shipping from the project's own public sources.
 * It says nothing about who runs the page — that is the claim, a separate
 * check — and nothing about whether the project is shipping now.
 *
 * Undefined below VERIFIED_BUILDER: there is no badge to explain.
 */
export const VERIFIED_BUILDER_SCOPE_WORDS = {
  unclaimed: 'HEY verified shipping evidence from the project’s own public sources; ownership of this page is not claimed yet.',
  claimed: 'HEY verified shipping evidence from the project’s own public sources; the owner proved control of the project separately.',
} as const;

export function verifiedBuilderScopeWords(input: { researchLevel: string | null | undefined; isClaimed: boolean }): string | undefined {
  if (input.researchLevel !== 'VERIFIED_BUILDER') return undefined;
  return input.isClaimed ? VERIFIED_BUILDER_SCOPE_WORDS.claimed : VERIFIED_BUILDER_SCOPE_WORDS.unclaimed;
}
