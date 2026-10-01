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
  INDEXED: { label: 'Indexed', help: 'Verified on Robinhood Chain. Not researched yet.' },
  RESEARCHED: { label: 'Researched', help: 'HEY has enriched this project from public sources.' },
  VERIFIED_BUILDER: { label: 'Verified Builder', help: 'HEY holds verified evidence of shipping.' },
};

/** The badge's word for a level; an unknown level reads as the lowest one, never as more research than HEY did. */
export function researchLevelWords(level: string | null | undefined): { label: string; help: string } {
  return RESEARCH_LEVEL_WORDS[level as ResearchLevelWordsKey] ?? RESEARCH_LEVEL_WORDS.INDEXED;
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
