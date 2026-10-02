import { formatProjectKind } from './format';

/**
 * The category a project is shown under: its primary narrative, then its kind
 * (OA-G, 2026-10-02) — the one rule the project card, the public compare page
 * and `/api/compare` print, so a project cannot read "Infrastructure" on the
 * homepage and "Other" on the comparison (the outsider analyst's finding on
 * Chit, whose primary narrative is the catch-all).
 *
 *   - The catch-all narrative "Other" is a data state, not a category
 *     (ux-data audit, 2026-10-01): it is never printed as one.
 *   - The kind is dropped when the narrative already names it
 *     ("Infrastructure · Infrastructure" says it once).
 *   - Kind OTHER ("Uncategorised") is a data state too: it is never printed
 *     beside a narrative. `label` falls back on it only when nothing else
 *     names the project; the card shows it only when its line would otherwise
 *     be empty (no ticker either).
 *
 * Pure and dependency-free, so the API layer imports it as well as the card.
 */
export const CATCH_ALL_NARRATIVE_SLUG = 'other';

export type ProjectCategoryInput = {
  primaryNarrative?: { slug: string; name: string } | null | undefined;
  projectKind: string;
};

export type ProjectCategory = {
  /** The primary narrative, absent when the project has none or only the catch-all. */
  narrative?: { slug: string; name: string };
  /** The kind's label, when it names something the narrative does not (never "Uncategorised"). */
  kindLabel?: string;
  /** False when neither names a category: `label` is then "Uncategorised". */
  categorised: boolean;
  /** What a reader sees: "AI Agents · Application", "Infrastructure", or "Uncategorised". */
  label: string;
};

export function projectCategory(project: ProjectCategoryInput): ProjectCategory {
  const narrative = project.primaryNarrative && project.primaryNarrative.slug !== CATCH_ALL_NARRATIVE_SLUG ? project.primaryNarrative : undefined;
  const kind = formatProjectKind(project.projectKind);
  const kindNamed = project.projectKind !== 'OTHER' && narrative?.name.toLowerCase() !== kind.toLowerCase();
  const words = [narrative?.name, kindNamed ? kind : undefined].filter((word): word is string => Boolean(word));
  return {
    ...(narrative ? { narrative: { slug: narrative.slug, name: narrative.name } } : {}),
    ...(kindNamed ? { kindLabel: kind } : {}),
    categorised: words.length > 0,
    label: words.length > 0 ? words.join(' · ') : formatProjectKind('OTHER'),
  };
}
