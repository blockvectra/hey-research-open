import { ChartNote } from './market-charts';
import { buildChartModel, type CandleDay, type ChartEvent } from './terminal-chart';
import { TerminalChartInteractive } from './terminal-chart-client';

/**
 * The Market tab's candle chart (Terminal redesign, 2026-09-26).
 *
 * Not exported from the `@hey/ui` barrel on purpose: it imports the client
 * island, and anything the barrel reaches is bundled into every page that
 * imports the barrel. The Market tab imports it from
 * `@hey/ui/terminal-chart-view`, so the island ships on `/chart` alone.
 *
 * The server half runs here — `buildChartModel` decides every direction and
 * the scale — and only the compact model crosses to the client.
 */
export function DailyCandleChart({
  days,
  events = [],
  todayUtc,
  selectedDay,
  symbol,
  className,
}: {
  days: readonly CandleDay[];
  events?: readonly ChartEvent[];
  /** The current UTC day (`YYYY-MM-DD`): its candle is drawn as still open. */
  todayUtc: string;
  /** A day to open the readout on (`?day=`), when it is in range. */
  selectedDay?: string | undefined;
  symbol?: string | undefined;
  className?: string;
}) {
  const built = buildChartModel(days, events, { todayUtc, selectedDay });
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
      model={built.model}
      summary={built.summary}
      {...(symbol ? { symbol } : {})}
      {...(className ? { className } : {})}
    />
  );
}
