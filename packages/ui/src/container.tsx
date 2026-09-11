import type { ReactNode } from 'react';

import { cn } from './cn';

/**
 * Page shell (UI/UX V2 section 6).
 *
 * 1320px, because the previous 768px left most of a desktop viewport empty and
 * made every page read like a wireframe. Side padding scales with the viewport
 * so mobile stays comfortable and desktop stays intentional.
 */
export type ContainerProps = {
  children: ReactNode;
  className?: string;
};

export function Container({ children, className }: ContainerProps) {
  return (
    <div className={cn('mx-auto w-full max-w-shell px-5 sm:px-8 lg:px-12 xl:px-16', className)}>
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
