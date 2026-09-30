import type { ReactNode } from 'react';

import { cn } from './cn';

/**
 * Editorial section header (UI/UX V2 section 9).
 *
 * Each homepage section shows a limited set and offers one clear way to see the
 * rest, so the page feels complete without becoming a dashboard.
 */
export function SectionHeader({
  title,
  subtitle,
  href,
  linkLabel = 'View all',
}: {
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h2>
        {subtitle ? <p className="mt-1.5 text-[15px] text-hey-secondary">{subtitle}</p> : null}
      </div>
      {href ? (
        <a
          href={href}
          className="shrink-0 text-sm font-medium text-hey-ink underline decoration-hey-border-strong underline-offset-4 transition-colors hover:decoration-hey-ink"
        >
          {linkLabel} →
        </a>
      ) : null}
    </div>
  );
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('mt-16 sm:mt-20', className)}>{children}</section>;
}

/*
 * `FeaturedCard` was removed on 2026-09-28 (data-correctness pass). Nothing
 * rendered it, and it printed every valuation under "Market cap" — an FDV
 * included — and "Not available" for a figure withheld from a dead market.
 * The home and Radar feature rows render `ProjectCard`, which reads
 * `valuationDisplay`.
 */
