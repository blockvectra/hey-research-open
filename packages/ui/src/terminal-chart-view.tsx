import { ChartNote } from './market-charts';
import {
  buildChartModel,
  type CandleDay,
  type ChartEvent,
  type ChartFamilyMeta,
  type ChartTimeframe,
  type CodeActivityInput,
} from './terminal-chart';
import { TerminalChartInteractive, type ChartLens } from './terminal-chart-client';

/**
 * The Market tab's candle chart (Terminal redesign, 2026-09-26; build ×
 * market correlation, 2026-09-29).
 *
 * Not exported from the `@hey/ui` barrel on purpose: it imports the client
 * island, and anything the barrel reaches is bundled into every page that
 * imports the barrel. The Market tab imports it from
 * `@hey/ui/terminal-chart-view`, so the island ships on `/chart` alone.
 *
 * The server half runs here — `buildChartModel` decides every direction, the
 * scale and every event's place on the time axis — and only the compact model
 * crosses to the client.
 */
export function DailyCandleChart({
  days,
  events = [],
  families = [],
  selectedFamilies,
  familiesFromUrl = false,
  lens = 'events',
  lensFromUrl = false,
  todayUtc,
  selectedDay,
  symbol,
  choiceKey,
  className,
  timeframe = '1d',
  openBucket,
  code,
}: {
  days: readonly CandleDay[];
  events?: readonly ChartEvent[];
  /** The families the caller offers, in importance order. */
  families?: readonly ChartFamilyMeta[];
  /** The families on when the page opens; absent means every family. */
  selectedFamilies?: readonly string[];
  familiesFromUrl?: boolean;
  lens?: ChartLens;
  lensFromUrl?: boolean;
  /** The current UTC day (`YYYY-MM-DD`): its candle is drawn as still open. */
  todayUtc: string;
  /** A day to open the readout on (`?day=`), when it is in range. */
  selectedDay?: string | undefined;
  symbol?: string | undefined;
  /** The project the session's family choice is kept under (its slug): never the ticker. */
  choiceKey?: string | undefined;
  className?: string;
  /**
   * The bar size (2026-09-29). Below 1D, `days` are bars keyed by their start
   * (`2026-09-29T14:00Z`), and the bar still open is `openBucket`.
   */
  timeframe?: ChartTimeframe;
  openBucket?: string | undefined;
  /** The code lane (2026-09-29): commits per bar and merged pull requests; absent draws none. */
  code?: CodeActivityInput | undefined;
}) {
  const built = buildChartModel(days, events, { todayUtc, selectedDay, families, timeframe, openBucket, code });
  if (!built) {
    return (
      <ChartNote
        message="Not enough days indexed for a chart yet."
        hint="HEY reads the market daily; the chart appears from the second day."
        className={className}
      />
    );
  }
  return (
    <TerminalChartInteractive
      /*
       * A new axis is a new chart (2026-09-29): a client navigation to another
       * timeframe or range keeps this component, and its pinned column from the
       * old axis could point past the new one's last bar. Keyed by the axis,
       * the island starts fresh on each.
       */
      key={`${timeframe}:${built.model.rows[0]?.[0] ?? ''}:${built.model.rows.length}`}
      model={built.model}
      summary={built.summary}
      initialLens={lens}
      familiesFromUrl={familiesFromUrl}
      lensFromUrl={lensFromUrl}
      {...(selectedFamilies ? { initialFamilies: selectedFamilies } : {})}
      {...(symbol ? { symbol } : {})}
      {...(choiceKey ? { choiceKey } : {})}
      {...(className ? { className } : {})}
    />
  );
}
