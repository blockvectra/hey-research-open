import { cn } from './cn';

/**
 * Narrative category colours (UI/UX V4 section 47).
 *
 * These are data-category colours, not a second brand palette: they exist so a
 * narrative keeps the same hue wherever it appears — a legend, a chart, a list.
 * Anything unmapped falls back to neutral rather than being assigned a colour,
 * because inventing a hue for an unknown category makes the legend lie.
 */
const NARRATIVE_COLORS: Record<string, string> = {
  'ai-agents': 'var(--color-narrative-ai)',
  ai: 'var(--color-narrative-ai)',
  rwa: 'var(--color-narrative-rwa)',
  defi: 'var(--color-narrative-defi)',
  infrastructure: 'var(--color-narrative-infra)',
  infra: 'var(--color-narrative-infra)',
  meme: 'var(--color-narrative-meme)',
  'animal-meme': 'var(--color-narrative-meme)',
  trading: 'var(--color-narrative-trading)',
  stockfi: 'var(--color-narrative-trading)',
};

export function narrativeColor(slug: string | undefined | null): string {
  if (!slug) return 'var(--color-narrative-other)';
  return NARRATIVE_COLORS[slug] ?? 'var(--color-narrative-other)';
}

/** A small colour key, always paired with the narrative's name. */
export function NarrativeDot({ slug, className }: { slug?: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: narrativeColor(slug) }}
    />
  );
}
