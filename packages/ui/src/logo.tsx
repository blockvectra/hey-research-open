import { cn } from './cn';

/**
 * The HEY lockup.
 *
 * The mark is the project's own artwork — the Hebrew letter ה, which is what
 * the name says — served from `/hey-mark.png` rather than redrawn as paths.
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
}: {
  className?: string;
  /** Rendered height in px. Width follows the artwork's own proportions. */
  markSize?: number;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <img
        src="/hey-mark.png"
        alt=""
        width={Math.round(markSize * 1.067)}
        height={markSize}
        className="hey-mark-light shrink-0"
        style={{ height: markSize, width: 'auto' }}
      />
      <img
        src="/hey-mark-dark.png"
        alt=""
        width={Math.round(markSize * 1.067)}
        height={markSize}
        className="hey-mark-dark shrink-0"
        style={{ height: markSize, width: 'auto' }}
      />
      <span className="hidden text-[15px] font-semibold leading-none tracking-[-0.02em] text-hey-ink sm:inline">
        HEY Research Lab
      </span>
    </span>
  );
}
