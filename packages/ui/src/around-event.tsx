import type { JSX } from 'react';

import { cn } from './cn';
import { MarketChange } from './market-change';

/**
 * Around one build event, drawn (2026-10-01, product-usefulness pass §13):
 * the rows the Terminal chart's event panel and the public project page print
 * — what HEY measured in the days before an event, on its day, and after it.
 *
 * Presentation only. The caller builds the model from the domain's canonical
 * read (`aroundEvents` in `@hey/domain`); this file decides nothing about what
 * was measured. Server-safe: no state, no effects, so the chart's client
 * island and a server page draw the same rows.
 *
 * Colour (CLAUDE.md UI rule 13): only a measured market move — the price, or
 * a market level's change against the before side — takes the market green
 * or red, through `MarketChange`, always with its arrow and sign. A usage
 * figure is never a market colour, and an unknown, partial-less or withheld
 * cell is never coloured: it prints a dash or "Withheld" with its reason.
 */
export type AroundCell =
  /**
   * A measured move in per cent; `partial` names the shorter span ("5 of 7
   * days"). `window` is the span the move is over, as `MarketChange` reads it
   * ("3D"): the screen-reader sentence says "over 3 days" for a three-day
   * span, never a fixed "over 7 days" (2026-10-09 outsider audit AOP-08).
   */
  | { kind: 'move'; pct: number; partial?: string | undefined; window?: string | undefined; dates?: string | undefined }
  /**
   * A measured level, already in words ("$1.2K/day", "1,240/day"). `dates`
   * (both kinds, RT2-10, 2026-10-09) names the days a cell covers where no
   * column heading does: the event's own move ("27 Sep–4 Oct closes").
   */
  | { kind: 'value'; text: string; partial?: string | undefined; dates?: string | undefined }
  /** Nothing to print: `reason` in words; `withheld` when HEY holds a figure it will not state. */
  | { kind: 'missing'; reason: string; withheld?: boolean | undefined };

export type AroundRow = {
  key: string;
  label: string;
  dimension: 'market' | 'usage';
  before: AroundCell;
  after: AroundCell;
  /** The after side against the before side for a level; `market` decides whether it may take a direction colour. */
  change?: { pct: number; market: boolean } | undefined;
  /** The event's own day or week: the price move only. */
  around?: AroundCell | undefined;
  /** "provider archive" when the row's figures are wholly or partly the provider's daily archive, not HEY's own readings. */
  basisLabel?: string | undefined;
};

export type AroundPanel = {
  eventId: string;
  title: string;
  /** "Release", "Implementation change", … */
  kindLabel?: string | undefined;
  /** "on 10 Sep", "in the week of 7 Sep (week precision)". */
  when: string;
  /** The event's own record. */
  evidenceHref?: string | undefined;
  /** The answer first (UI rule 15), the domain's sentence. */
  answer?: string | undefined;
  headings: { before: string; around: string; after: string };
  /** The spans in words, by how much is observed: "3–9 Sep", "5–6 Oct so far", "starts 5 Oct, not yet observed". */
  spans: { before: string; around: string; after: string };
  /** Each heading with its span, in the domain's words: "Observed after — starts 5 Oct, not yet observed". */
  spanHeadings: { before: string; around: string; after: string };
  rows: AroundRow[];
  /**
   * Whether the "observed after" column is drawn (2026-10-09 outsider audit
   * AOP-07): false when the after span has not started, so a ship from this
   * week does not print a column of "not measured". Default true.
   */
  showAfter?: boolean | undefined;
  /** Fields with nothing to show, and why: "Valuation: not measured — market too thin". */
  notShown: string[];
  /** Where an archive-sourced price or volume came from, in the domain's words (2026-10-02); absent when none did. */
  basisNote?: string | undefined;
  caveat: string;
};

function Cell({ cell, testId }: { cell: AroundCell; testId: string }): JSX.Element {
  if (cell.kind === 'missing') {
    return (
      <span className="text-hey-secondary" data-testid={testId} data-state={cell.withheld ? 'withheld' : 'not-measured'} title={cell.reason}>
        <span aria-hidden="true">{cell.withheld ? 'Withheld' : '—'}</span>
        <span className="sr-only">{cell.withheld ? `Withheld: ${cell.reason}` : `Not measured: ${cell.reason}`}</span>
      </span>
    );
  }
  return (
    <span className="grid justify-items-end gap-0" data-testid={testId} data-state={cell.partial ? 'partial' : 'measured'}>
      {cell.kind === 'move' ? (
        <MarketChange pct={cell.pct} window={cell.window ?? '7D'} showWindow={false} size="meta" />
      ) : (
        <span className="font-medium tabular-nums text-hey-ink">{cell.text}</span>
      )}
      {cell.partial ? <span className="text-t-micro text-hey-muted">{cell.partial}</span> : null}
    </span>
  );
}

/** The rows: measure, observed before, observed after; the event's own move beside the price. */
export function AroundEventRows({ panel, className }: { panel: AroundPanel; className?: string }): JSX.Element {
  const showAfter = panel.showAfter !== false;
  return (
    <div className={cn('grid gap-2', className)} data-testid="around-event-rows">
      <table className="w-full table-fixed border-collapse text-t-meta">
        <caption className="sr-only">
          {showAfter ? `${panel.spanHeadings.before} and ${panel.spanHeadings.after}` : panel.spanHeadings.before}: {panel.title}
        </caption>
        <thead>
          <tr className="text-left text-hey-secondary">
            <th scope="col" className="w-[38%] pb-1 font-normal">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              {panel.headings.before}
              <span className="block text-t-micro text-hey-muted">{panel.spans.before}</span>
            </th>
            {showAfter ? (
              <th scope="col" className="pb-1 text-right font-normal">
                {panel.headings.after}
                <span className="block text-t-micro text-hey-muted">{panel.spans.after}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="align-top">
          {panel.rows.map((row) => (
            <tr key={row.key} className="border-t border-hey-border" data-testid="around-event-row" data-field={row.key}>
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-hey-secondary">
                {row.label}
                {row.basisLabel ? (
                  <span className="mt-0.5 block text-t-micro text-hey-muted" data-testid="around-event-basis-label">
                    {row.basisLabel}
                  </span>
                ) : null}
                {row.around ? (
                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-t-micro text-hey-muted" data-testid="around-event-day">
                    <span>{panel.headings.around}:</span>
                    {row.around.kind === 'move' ? (
                      <MarketChange pct={row.around.pct} window={row.around.window ?? '1D'} showWindow={false} size="meta" />
                    ) : row.around.kind === 'value' ? (
                      <span>{row.around.text}</span>
                    ) : (
                      <span title={row.around.reason}>—</span>
                    )}
                    {row.around.kind !== 'missing' && row.around.dates ? <span data-testid="around-event-day-dates">· {row.around.dates}</span> : null}
                  </span>
                ) : null}
              </th>
              <td className="py-1.5 text-right">
                <Cell cell={row.before} testId="around-event-before" />
              </td>
              {showAfter ? (
              <td className="py-1.5 text-right">
                <Cell cell={row.after} testId="around-event-after" />
                {row.change ? (
                  <span className="mt-0.5 flex justify-end gap-1 text-t-micro text-hey-muted" data-testid="around-event-change">
                    {row.change.market ? (
                      <MarketChange pct={row.change.pct} window="vs before" showWindow={false} size="meta" />
                    ) : (
                      <span className="tabular-nums text-hey-secondary">{row.change.pct >= 0 ? '+' : '−'}{Math.abs(Math.round(row.change.pct * 10) / 10).toFixed(1)}%</span>
                    )}
                    <span className="hidden sm:inline">vs before</span>
                    <span className="sr-only sm:hidden">against before</span>
                  </span>
                ) : null}
              </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {panel.basisNote ? (
        <p className="text-t-micro text-hey-secondary" data-testid="around-event-basis">
          {panel.basisNote}
        </p>
      ) : null}
      {panel.notShown.length > 0 ? (
        <p className="text-t-micro text-hey-muted" data-testid="around-event-not-shown">
          Not shown: {panel.notShown.join(' · ')}
        </p>
      ) : null}
      <p className="text-t-micro text-hey-secondary" data-testid="around-event-caveat">
        {panel.caveat}
      </p>
    </div>
  );
}
