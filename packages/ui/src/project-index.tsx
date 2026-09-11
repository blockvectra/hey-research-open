import { BuilderActivityStrip } from './builder-activity';
import { cn } from './cn';
import { formatRelativeTime, formatUsdCompact } from './format';
import { ProjectLogo } from './project-logo';
import {
  ActivityChip,
  ResearchLevelBadge,
  StillBuildingBadge,
  type ActivityStatusValue,
  type ResearchLevelValue,
} from './status';

/**
 * The Index (UI/UX V5 sections 20-21).
 *
 * Replaces the card wall. A catalogue of thousands of records is an index, and
 * an index is a list with columns — identical rounded cards make every project
 * look equally important and waste most of the width on padding.
 *
 * Desktop is a real table so the columns line up and can be scanned down;
 * mobile becomes stacked dossier rows, because forcing a six-column table onto
 * 390px is how tables become unreadable.
 */
export type IndexRecord = {
  slug: string;
  name: string;
  symbol?: string;
  narrative?: string;
  activityStatus: ActivityStatusValue;
  researchLevel: ResearchLevelValue;
  stillBuilding?: boolean;
  lastMeaningfulShipAt?: Date;
  marketCapUsd?: number;
  activeWeeks?: number;
  totalWeeks?: number;
};

const weeksOf = (record: IndexRecord): boolean[] => {
  if (!record.totalWeeks || record.activeWeeks === undefined) return [];
  const shown = Math.min(record.totalWeeks, 6);
  const active = Math.min(record.activeWeeks, shown);
  // Stored scores carry counts, not a per-week series; the strip shows the most
  // recent weeks as active rather than inventing a shape.
  return Array.from({ length: shown }, (_, index) => index >= shown - active);
};

export function ProjectIndex({
  records,
  now,
  className,
}: {
  records: readonly IndexRecord[];
  now?: Date;
  className?: string;
}) {
  if (records.length === 0) return null;

  return (
    <div className={className}>
      {/* Desktop: a real table. */}
      <table className="hidden w-full border-collapse text-left md:table">
        <thead>
          <tr className="border-y border-hey-border">
            <Th className="w-[34%]">Project</Th>
            <Th>Status</Th>
            <Th>Research</Th>
            <Th>Last ship</Th>
            <Th>Active weeks</Th>
            <Th className="text-right">Market cap</Th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.slug}
              className="group border-b border-hey-border transition-colors hover:bg-paper-deep/40"
            >
              <td className="py-4 pr-4 align-middle">
                <a href={`/project/${record.slug}`} className="flex items-center gap-3">
                  <ProjectLogo name={record.name} slug={record.slug} size={34} />
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-medium text-hey-ink group-hover:underline">
                      {record.name}
                      {record.symbol ? (
                        <span className="ml-2 font-mono text-[12px] text-hey-muted">
                          ${record.symbol}
                        </span>
                      ) : null}
                    </span>
                    {record.narrative ? (
                      <span className="block truncate text-[13px] text-hey-secondary">
                        {record.narrative}
                      </span>
                    ) : null}
                  </span>
                </a>
              </td>
              <td className="py-4 pr-4 align-middle">
                <ActivityChip status={record.activityStatus} />
              </td>
              <td className="py-4 pr-4 align-middle">
                <ResearchLevelBadge level={record.researchLevel} />
              </td>
              <td className="py-4 pr-4 align-middle font-mono text-[13px] text-hey-secondary">
                {record.lastMeaningfulShipAt
                  ? formatRelativeTime(record.lastMeaningfulShipAt, now)
                  : '—'}
              </td>
              <td className="py-4 pr-4 align-middle">
                {weeksOf(record).length > 0 ? (
                  <span className="flex items-center gap-2.5">
                    <BuilderActivityStrip weeks={weeksOf(record)} size="sm" />
                    <span className="font-mono text-[12px] text-hey-secondary">
                      {record.activeWeeks}/{Math.min(record.totalWeeks ?? 0, 6)}
                    </span>
                  </span>
                ) : (
                  <span className="font-mono text-[13px] text-hey-muted">—</span>
                )}
              </td>
              <td className="py-4 text-right align-middle font-mono text-[13px] text-hey-ink">
                {record.marketCapUsd ? formatUsdCompact(record.marketCapUsd) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: dossier rows separated by rules, never a squeezed table. */}
      <ul className="md:hidden">
        {records.map((record) => (
          <li key={record.slug} className="border-b border-hey-border py-5">
            <a href={`/project/${record.slug}`} className="block">
              <div className="flex items-center gap-3">
                <ProjectLogo name={record.name} slug={record.slug} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-medium text-hey-ink">
                    {record.name}
                    {record.symbol ? (
                      <span className="ml-2 font-mono text-[12px] text-hey-muted">
                        ${record.symbol}
                      </span>
                    ) : null}
                  </p>
                  {record.narrative ? (
                    <p className="hey-eyebrow mt-0.5 text-hey-muted">{record.narrative}</p>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <ActivityChip status={record.activityStatus} />
                <ResearchLevelBadge level={record.researchLevel} />
                {record.stillBuilding ? <StillBuildingBadge /> : null}
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-3 font-mono text-[12px]">
                <Cell label="Last ship">
                  {record.lastMeaningfulShipAt
                    ? formatRelativeTime(record.lastMeaningfulShipAt, now)
                    : '—'}
                </Cell>
                <Cell label="Active">
                  {record.totalWeeks && record.activeWeeks !== undefined
                    ? `${record.activeWeeks}/${Math.min(record.totalWeeks, 6)}`
                    : '—'}
                </Cell>
                <Cell label="Mkt cap">
                  {record.marketCapUsd ? formatUsdCompact(record.marketCapUsd) : '—'}
                </Cell>
              </dl>

              {weeksOf(record).length > 0 ? (
                <BuilderActivityStrip weeks={weeksOf(record)} className="mt-3" />
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('hey-eyebrow py-2.5 pr-4 text-hey-muted', className)}>
      {children}
    </th>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="hey-eyebrow text-hey-muted">{label}</dt>
      <dd className="mt-0.5 text-hey-ink">{children}</dd>
    </div>
  );
}
