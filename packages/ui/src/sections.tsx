import type { ReactNode } from 'react';

import { cn } from './cn';
import { formatRelativeTime, formatUsdCompact } from './format';
import { ActivityChip, type ActivityStatusValue } from './status';

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
          className="shrink-0 text-sm font-medium text-hey-accent hover:underline underline-offset-4"
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

/**
 * Under the Radar feature card (UI/UX V2 section 13).
 *
 * States the two facts side by side — how much the team is building, and how
 * little the market is currently paying attention — and nothing more. It is a
 * discovery signal, never a recommendation, so no wording here may imply value.
 */
export type FeaturedProject = {
  slug: string;
  name: string;
  symbol?: string;
  activityStatus: ActivityStatusValue;
  hbm?: number;
  activeWeeks?: number;
  totalWeeks?: number;
  lastMeaningfulShipAt?: Date;
  marketCapUsd?: number;
};

export function FeaturedCard({ project, now }: { project: FeaturedProject; now?: Date }) {
  return (
    <article className="group relative flex h-full min-w-0 flex-col rounded-[6px] border border-hey-border bg-hey-surface p-6 hover:border-hey-border-strong">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 text-lg font-semibold tracking-tight">
          <a
            href={`/project/${project.slug}`}
            className="block min-w-0 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            <span className="block truncate">{project.name}</span>
          </a>
        </h3>
        {project.symbol ? (
          <span className="max-w-[40%] shrink-0 truncate text-sm text-hey-secondary">
            ${project.symbol}
          </span>
        ) : null}
      </div>

      <div className="mt-2">
        <ActivityChip status={project.activityStatus} />
      </div>

      <dl className="mt-5 space-y-2.5 text-[15px]">
        {project.hbm !== undefined ? (
          <Row label="Build Momentum" value={String(Math.round(project.hbm))} strong />
        ) : null}
        {project.activeWeeks !== undefined && project.totalWeeks ? (
          <Row label="Active weeks" value={`${project.activeWeeks} / ${project.totalWeeks}`} />
        ) : null}
        {project.lastMeaningfulShipAt ? (
          <Row label="Last ship" value={formatRelativeTime(project.lastMeaningfulShipAt, now)} />
        ) : null}
        <Row label="Market cap" value={formatUsdCompact(project.marketCapUsd) ?? 'Not available'} />
      </dl>

      <p className="mt-6 text-sm font-medium text-hey-accent">View project →</p>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-hey-secondary">{label}</dt>
      <dd className={strong ? 'text-lg font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}

/** Small, subtle ecosystem counts for the hero (UI/UX V2 section 8). */
export function EcosystemCounts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[13px] text-hey-secondary">{item.label}</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
