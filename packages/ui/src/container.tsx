import type { ReactNode } from 'react';

import { cn } from './cn';

/**
 * Page shell (UI/UX V2 section 6).
 *
 * `--spacing-shell` (1280px), because the previous 768px left most of a
 * desktop viewport empty and made every page read like a wireframe. Side
 * padding scales with the viewport so mobile stays comfortable and desktop
 * stays intentional.
 *
 * The width is its own prop rather than a baked class (layout audit,
 * 2026-09-22). `cn` is a plain joiner, not tailwind-merge, so
 * `cn('… max-w-shell', className)` emitted both the shell width and whatever
 * the caller asked for, and the winner was whichever Tailwind happened to
 * write later into the stylesheet. Measured in the shipped sheet:
 * `max-w-2xl`, `max-w-3xl` and `max-w-4xl` all lost to `max-w-shell` — so
 * twenty-two pages that asked for a reading column rendered at 1280px — while
 * `max-w-xl` won, because `xl` sorts after `shell`. Two callers writing the
 * same override got opposite results, and neither could tell.
 */
export type ContainerProps = {
  children: ReactNode;
  className?: string;
  /** The width utility. Pass one instead of putting it in `className`. */
  width?: string;
};

export function Container({ children, className, width = 'max-w-shell' }: ContainerProps) {
  return (
    <div className={cn('mx-auto w-full px-5 sm:px-8 lg:px-12 xl:px-16', width, className)}>
      {children}
    </div>
  );
}

/**
 * A narrower column for prose, inside the wide shell. Long text stays readable
 * even when the page itself is wide.
 */
export function Prose({ children, className }: ContainerProps) {
  return <div className={cn('max-w-2xl', className)}>{children}</div>;
}
