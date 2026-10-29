import type { ReactNode } from 'react';

import { cn } from './cn';
import { emailSafe } from './email-safe';
import { BrandNotice } from './brand-notice';
import { cardIdentity, cardPreviewFacts, FDV_HELP, type CardPreviewFacts, type ProjectCardData } from './project-card';
import { ProjectLogo } from './project-logo';
import { ShipWeeksChart, type ShipWeekSeriesData } from './ship-weeks';
import { ActivityChip } from './status';
import { valuationDisplay } from '@hey/scoring/valuation-display';

/**
 * The builder list (V2, founder 2026-10-29: "tak payah pakai card dah pakai list just untuk builders"; CLAUDE.md UI
 * rule 14 as amended that day). Builder discovery on Explore and the Overview's Building now is a dense table — the
 * pattern of a launchpad's launches list, in HEY's own V2 tokens and words — one project a row:
 *
 *   Project               Status      Latest ship              8 weeks   Token check           Valuation   [Preview]
 *   [logo] Name $TICK     ● Shipping  SDK v0.4                 ▁▃ ▅  3   Project names this    $1.2M
 *          Narrative                  2d ago                              contract              Market cap
 *
 * Every cell reads the card's own facts (`cardPreviewFacts`, `cardIdentity`), so a row, a card and the Preview drawer
 * phrase each fact the same way, and the card-fact rules hold here too: the ticker only when the token is the
 * project's (`cardTokenNotTheProjects`), a valuation only where `cardShowsValuation` holds (R5) — otherwise the cell is
 * empty, never 0 and never a placeholder. Development, the token check and the market stay three separate cells.
 *
 * The rows arrive ordered (the listing's activity order); nothing here sorts, and the 8-week chart is context beside a
 * row, never an order (product rules 2, 3, 6). The project's name is the row's one link, stretched over the row; the
 * Preview button sits above it, so nothing interactive nests. From a narrow container up the row folds (`v2.css`,
 * container queries): on a phone a compact block — the name, then the status beside the latest ship, then the chart,
 * the check and the valuation folded under the name — with no sideways scroll. A list that holds one status
 * (`hideStatus`) draws no pill that would repeat the list's own name on every row.
 */
export type ProjectListRowProps = {
  project: ProjectCardData;
  /** The row's 8-week counted-ship series; `undefined` when the batched read did not answer (drawn "Not read"). */
  weeks?: ShipWeekSeriesData | undefined;
  now?: Date;
  /** "HEY’s own project — researched by the same rules", from the caller (the card's disclosure). */
  disclosure?: string;
  /** The Preview control, drawn only where the surface mounts the drawer; handed the facts the row printed. */
  preview?: (facts: CardPreviewFacts) => ReactNode;
  /**
   * The list already holds one activity status (Explore's Shipping list, a status filter): the row draws no status
   * pill, which would say the list's own name on every row (UI audit, 2026-10-30). `ProjectList` drops the column.
   */
  hideStatus?: boolean;
};

/** The column headers, in order; the phone layout keeps them for assistive tech only. */
export const PROJECT_LIST_COLUMNS = ['Project', 'Status', 'Latest ship', '8 weeks', 'Token check', 'Valuation', 'Preview'] as const;

/** Each column's class: the widths are set by name, so a list without its Status column keeps every other width. */
const COLUMN_CLASS: Record<(typeof PROJECT_LIST_COLUMNS)[number], string> = {
  Project: 'v2-col-project',
  Status: 'v2-col-status',
  'Latest ship': 'v2-col-ship',
  '8 weeks': 'v2-col-weeks',
  'Token check': 'v2-col-check',
  Valuation: 'v2-col-value',
  Preview: 'v2-col-preview',
};

/** The key under the list: what the bars count, what they compare, and the week still running. */
export const SHIP_WEEKS_KEY =
  '8 weeks: counted ships per UTC week, oldest first. Bars compare weeks within one project only; the last bar is this week so far, drawn lighter. A dotted week is one HEY had not read yet, never a zero; a flat tick is a week read with no counted ship.';

/**
 * A code week's line names its repository (UI audit, 2026-10-30): every running code week reads "Code changes", so a
 * list of them said one thing a row. The repository's name is what differs; its owner stays in the hover title.
 */
export function codeWeekShipWhat(what: string, latestShip: ProjectCardData['latestShip']): { what: string; title?: string } {
  const repository = latestShip?.eventType === 'CODE_ACTIVITY' ? latestShip.repository : undefined;
  if (!repository || what !== 'Code changes') return { what };
  const name = repository.split('/').pop() || repository;
  return { what: `Code changes in ${name}`, title: `Code changes in ${repository}` };
}

export function ProjectList({
  children,
  caption,
  className,
  withPreview = true,
  hideStatus = false,
}: {
  children: ReactNode;
  caption: string;
  className?: string;
  withPreview?: boolean;
  /** The list holds one status: no Status column (each row is drawn with `hideStatus` too). */
  hideStatus?: boolean;
}) {
  return (
    <div className={cn('v2-list-wrap', className)}>
      {/*
       * Explicit roles: the phone layout restyles the rows as grid blocks, and some engines drop a table's semantics
       * when its display changes; the roles keep the rows, cells and headers announced.
       */}
      <table className="v2-list" role="table" data-testid="project-list">
        <caption className="sr-only">{caption}</caption>
        <thead className="v2-list-head" role="rowgroup">
          <tr role="row">
            {PROJECT_LIST_COLUMNS.filter((column) => (withPreview || column !== 'Preview') && (!hideStatus || column !== 'Status')).map((column) => (
              <th key={column} scope="col" role="columnheader" className={COLUMN_CLASS[column]}>
                {column === 'Preview' ? <span className="sr-only">Preview</span> : column === '8 weeks' ? <span title="Counted ships per week, the last 8 weeks">8 weeks</span> : column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">{children}</tbody>
      </table>
      {/* The chart's key, once a list, in words: what a dotted week and a flat tick mean. */}
      <p className="v2-list-key" data-testid="ship-weeks-key">
        {SHIP_WEEKS_KEY}
      </p>
    </div>
  );
}

const VERIFICATION_TONE: Record<string, string> = {
  VERIFIED: 'text-hey-secondary',
  UNVERIFIED: 'text-hey-muted',
  MISMATCH: 'font-medium text-hey-warning',
};

export function ProjectListRow({ project, weeks, now, disclosure, preview, hideStatus = false }: ProjectListRowProps) {
  const facts = cardPreviewFacts(project, { ...(now ? { now } : {}), ...(disclosure ? { disclosure } : {}) });
  const identity = cardIdentity(project);
  const subline = [identity.narrative, identity.kind].filter(Boolean).join(' · ');
  const hasToken = Boolean(project.token);
  // The kind of figure, as the card names it (`valuationDisplay`): "Market cap", or "Valuation" with FDV in the title.
  const valuationKind = facts.market.value
    ? valuationDisplay({
        valueUsd: project.marketCapUsd,
        fdvUsd: project.fdvUsd,
        marketStatus: project.tokenMarketStatus,
        marketReason: project.tokenMarketReason,
        valuationImplausible: project.valuationImplausible,
      })
    : undefined;
  const isFdv = valuationKind?.shown === true && valuationKind.kind === 'fdv';
  const previewControl = preview ? preview(facts) : null;
  const shipWhat = facts.latest?.what ? codeWeekShipWhat(facts.latest.what, project.latestShip) : undefined;
  return (
    <tr
      role="row"
      className="v2-list-row"
      data-testid="project-row"
      data-slug={project.slug}
      data-has-token={hasToken ? 'true' : 'false'}
      data-activity-status={project.activityStatus}
    >
      <th scope="row" role="rowheader" className="v2-cell-project">
        <span className="v2-row-identity">
          <ProjectLogo name={identity.name} slug={project.slug} logoUrl={project.logoUrl} size={36} className="v2-row-logo shrink-0 rounded-[8px] ring-1 ring-inset ring-hey-border" />
          <span className="min-w-0">
            <span className="v2-row-name">
              {/* The row's one link; its target is stretched over the row (`.v2-row-link::after`). */}
              <a href={`/project/${project.slug}`} className="v2-row-link" data-testid="row-name">
                {identity.name}
              </a>
              {identity.ticker ? (
                <span className="v2-row-ticker" data-testid="ticker">
                  {identity.ticker}
                </span>
              ) : null}
            </span>
            {subline ? (
              <span className="v2-row-sub" data-testid="row-narrative">
                {subline}
              </span>
            ) : null}
            {/* HEY's own project, said in full: it wraps to two lines rather than cut to "researched by the same r…". */}
            {disclosure ? (
              <span className="v2-row-note" data-testid="heys-own-token">
                {disclosure}
              </span>
            ) : null}
          </span>
        </span>
        {/* Its own line at the name's edge, never squeezed beside the name into a narrow box. */}
        {project.brandNotice ? <BrandNotice notice={project.brandNotice} className="v2-row-brand px-2 py-0.5 text-[12px]" /> : null}
      </th>

      {hideStatus ? null : (
        <td role="cell" className="v2-cell-status">
          <ActivityChip status={project.activityStatus} variant="surface" unknownReason={facts.unknownReason ?? null} />
        </td>
      )}

      <td role="cell" className="v2-cell-ship" data-testid="row-latest-ship">
        {facts.latest ? (
          <>
            {shipWhat ? (
              <span className="v2-row-ship-title" title={shipWhat.title ?? shipWhat.what} {...(facts.latest.id ? { 'data-ship-id': facts.latest.id } : {})}>
                {emailSafe(shipWhat.what)}
              </span>
            ) : null}
            <time dateTime={facts.latest.at} className="v2-row-ship-age" data-testid="row-last-ship">
              {facts.latest.when}
            </time>
          </>
        ) : (
          // HEY's record holds no counted ship: a reading of the record, never "never shipped".
          <span className="v2-row-ship-age">No counted ship on record</span>
        )}
      </td>

      <td role="cell" className="v2-cell-weeks">
        {/* A folded row names the column itself (`.v2-cell-weeks::before` in v2.css): the table's headers are not drawn there. */}
        <ShipWeeksChart series={weeks} />
      </td>

      <td role="cell" className="v2-cell-check" data-testid="row-token-check">
        {!hasToken ? (
          <span className="text-hey-muted">No token tracked</span>
        ) : facts.verification ? (
          <span className={VERIFICATION_TONE[facts.verification.value] ?? 'text-hey-muted'} data-verification={facts.verification.value}>
            {facts.verification.label}
          </span>
        ) : (
          <span className="text-hey-unavailable">Not checked</span>
        )}
      </td>

      <td role="cell" className="v2-col-value v2-cell-value">
        {/* Only where the card may print a valuation (`cardShowsValuation`, R5); otherwise the cell stays empty. */}
        {facts.market.value ? (
          <span data-testid="market-cap" className="v2-row-value" {...(isFdv ? { title: FDV_HELP } : {})}>
            <span className="font-semibold tabular-nums text-hey-ink">{facts.market.value}</span>
            <span className="v2-row-value-kind">
              {facts.market.label}
              {facts.market.note ? ` · ${facts.market.note}` : ''}
            </span>
          </span>
        ) : null}
      </td>

      {preview ? (
        <td role="cell" className="v2-col-preview v2-cell-preview">
          {previewControl}
        </td>
      ) : null}
    </tr>
  );
}
