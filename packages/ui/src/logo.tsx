import { BRAND_MARKS } from './brand';
import { cn } from './cn';

/**
 * The HEY lockup.
 *
 * The mark is the project's own artwork — the Hebrew letter ה, which is what
 * the name says — served from `/hey-mark.png` (at its hashed `BRAND_MARKS` path
 * since 2026-10-17) rather than redrawn as paths.
 * A trace would drift from the real thing every time the artwork changed.
 *
 * The name is spelled out from `sm` up and hidden below it, so a phone gets the
 * mark alone instead of a wordmark competing with the menu button.
 *
 * The mark is black and lime on transparency, so it belongs on Lab Paper. The
 * dark theme swaps in `/hey-mark-dark.png` — the same artwork with the black
 * strokes turned paper-white and the lime untouched — via the `.hey-mark-*`
 * rules in the app stylesheet, so the swap follows the theme, not the system.
 * It is deliberately not placed on Midnight surfaces inside the light theme,
 * where the black strokes would disappear; those use the wordmark alone.
 */
export function HeyLogo({
  className,
  markSize = 26,
  wordmarkClassName = 'hidden sm:inline',
}: {
  className?: string;
  /** When the words show; the header drops them where the full navigation needs the room. */
  wordmarkClassName?: string;
  /** Rendered height in px. Width follows the artwork's own proportions. */
  markSize?: number;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <img
        src={BRAND_MARKS.hey}
        alt=""
        width={Math.round(markSize * 1.067)}
        height={markSize}
        className="hey-mark-light shrink-0"
        style={{ height: markSize, width: 'auto' }}
      />
      <img
        src={BRAND_MARKS.heyDark}
        alt=""
        // Only the light mark is preloaded (2026-10-24 full audit, PERF-6): React preloads every eager <img> in the shell,
        // and this twin is display:none unless the theme is dark. Low priority leaves it out of the preload; a dark reader
        // still loads it at once.
        fetchPriority="low"
        width={Math.round(markSize * 1.067)}
        height={markSize}
        className="hey-mark-dark shrink-0"
        style={{ height: markSize, width: 'auto' }}
      />
      <span className={cn('whitespace-nowrap text-[15px] font-semibold leading-none tracking-[-0.02em] text-hey-ink', wordmarkClassName)}>
        HEY Research Lab
      </span>
    </span>
  );
}
