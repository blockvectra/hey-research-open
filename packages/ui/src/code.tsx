import { GitBranch, Hammer, PackageCheck, RefreshCcw, Trophy } from 'lucide-react';
import { cn } from './cn';
import { formatRelativeTime } from './format';

/**
 * Public code activity (UI/UX V2 sections 21, 22, 44).
 *
 * A private or unmapped repository is reported as *not measurable*, never as
 * zero — missing public code is not failed development. Dimensions HEY does not
 * collect say so explicitly rather than scoring nil.
 */
export type CodeActivityData =
  | { measurable: false; reason: string }
  | {
      measurable: true;
      score: number;
      activeDevDays: number;
      windowDays: number;
      contributors: number;
      releases: number;
      lastCodeUpdate?: Date;
      dimensions: { label: string; value: number; weight: number; measured: boolean }[];
      heatmap: { day: string; commits: number }[];
    };

export function PublicCodeCard({
  data,
  className,
}: {
  data: CodeActivityData;
  className?: string;
}) {
  if (!data.measurable) {
    return (
      <div className={cn('rounded-[6px] bg-midnight-900 p-5 text-white', className)}>
        <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/50">
          <GitBranch aria-hidden="true" size={14} strokeWidth={1.9} />
          Public code activity
        </p>
        <p className="mt-2 text-[15px] font-medium text-white">Not measurable</p>
        <p className="mt-1.5 text-[13px] text-white/55">{data.reason}</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-[6px] bg-midnight-900 p-5 text-white', className)}>
      <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/50">
        <GitBranch aria-hidden="true" size={14} strokeWidth={1.9} />
        Public code activity
      </p>
      <p className="mt-2 text-[40px] font-semibold leading-none tabular-nums tracking-tight text-white">
        {data.score}
      </p>

      <dl className="mt-5 space-y-2 text-[15px]">
        {/*
          * "Days with recorded activity", not "active dev days" (2026-09-06).
          *
          * Ingestion collapses a 90-day GitHub read into one event dated at the
          * last commit, and this counts the days those events fall on — so a
          * project whose own ship line says "100 commits, 79 active days" shows
          * 3 here. The right fix is to store an aggregate per commit day with
          * its window and SHA; until that exists the number must say what it
          * actually counts rather than imply a distribution HEY never recorded.
          */}
        <Row
          label="Days with recorded activity"
          value={`${data.activeDevDays} / ${data.windowDays}`}
        />
        <Row label="Contributors" value={data.contributors > 0 ? String(data.contributors) : '—'} />
        <Row label="Releases" value={String(data.releases)} />
        <Row
          label="Last code update"
          value={data.lastCodeUpdate ? formatRelativeTime(data.lastCodeUpdate) : '—'}
        />
      </dl>

      {data.dimensions.some((dimension) => !dimension.measured) ? (
        <p className="mt-4 text-[13px] text-white/55">
          {data.dimensions
            .filter((dimension) => !dimension.measured)
            .map((dimension) => dimension.label)
            .join(', ')}{' '}
          not measured; the remaining dimensions are reweighted rather than counted as zero.
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-white/55">{label}</dt>
      <dd className="tabular-nums text-white">{value}</dd>
    </div>
  );
}

/**
 * Code contribution heatmap (UI/UX V2 section 22).
 *
 * Compact and supporting, never the central metric. Built from the capped daily
 * activity summaries HEY records, so it shows observed days rather than a
 * commit leaderboard.
 */
export function CodeHeatmap({
  days,
  weeks = 12,
  now = new Date(),
  className,
}: {
  days: readonly { day: string; commits: number }[];
  weeks?: number;
  now?: Date;
  className?: string;
}) {
  if (days.length === 0) return null;

  const byDay = new Map(days.map((entry) => [entry.day, entry.commits]));
  const cells: { day: string; commits: number }[] = [];

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let index = weeks * 7 - 1; index >= 0; index -= 1) {
    const date = new Date(end.getTime() - index * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    cells.push({ day: key, commits: byDay.get(key) ?? 0 });
  }

  const max = Math.max(...cells.map((cell) => cell.commits), 1);
  const intensity = (commits: number) => {
    if (commits === 0) return 'bg-hey-border';
    const ratio = commits / max;
    if (ratio > 0.66) return 'bg-status-shipping';
    if (ratio > 0.33) return 'bg-status-shipping/70';
    return 'bg-status-shipping/40';
  };

  return (
    <div className={className}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-hey-muted">
        Code activity
      </p>
      <div
        className="mt-2 grid grid-flow-col grid-rows-7 gap-[3px]"
        role="img"
        aria-label={`Days with observed code activity over the last ${weeks} weeks`}
      >
        {cells.map((cell) => (
          <span
            key={cell.day}
            className={cn('h-2.5 w-2.5 rounded-[2px]', intensity(cell.commits))}
            /* The attribute: `<title>` in HTML is metadata, hoisted into <head> by React 19. */
            title={cell.commits > 0 ? `${cell.day}: ${cell.commits} commits` : `${cell.day}: no observed activity`}
          />
        ))}
      </div>
      <p className="mt-2 text-[13px] text-hey-secondary">
        Observed development days. Commit volume is capped and never ranked.
      </p>
    </div>
  );
}

/** Weekly builder recognitions (UI/UX V2 section 27). */
export function AwardsRow({
  awards,
  className,
}: {
  awards: readonly {
    title: string;
    kind: 'momentum' | 'still-building' | 'shipping' | 'comeback' | 'new-builder';
    project?: { slug: string; name: string };
    detail: string;
  }[];
  className?: string;
}) {
  if (awards.length === 0) return null;

  return (
    <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {awards.map((award) => (
        <li key={award.title} className="rounded-[6px] border border-hey-border bg-hey-surface p-5">
          <p className="text-[13px] text-hey-secondary">
            <AwardIcon kind={award.kind} />
            {award.title}
          </p>
          {award.project ? (
            <a
              href={`/project/${award.project.slug}`}
              className="mt-1.5 block truncate text-lg font-semibold tracking-tight hover:underline"
            >
              {award.project.name}
            </a>
          ) : null}
          <p className="mt-1 text-[13px] text-hey-secondary">{award.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/** Award icons (V4 section 13). Vector, single library, consistent stroke. */
function AwardIcon({
  kind,
}: {
  kind: 'momentum' | 'still-building' | 'shipping' | 'comeback' | 'new-builder';
}) {
  const Icon =
    kind === 'still-building'
      ? Hammer
      : kind === 'shipping'
        ? PackageCheck
        : kind === 'comeback' || kind === 'new-builder'
          ? RefreshCcw
          : Trophy;

  return (
    <Icon
      aria-hidden="true"
      size={15}
      strokeWidth={1.9}
      className="mr-1.5 inline-block shrink-0 align-[-2px] text-gold-dark"
    />
  );
}
