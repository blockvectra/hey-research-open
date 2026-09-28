/**
 * Product usage (2026-09-28): is what a project shipped being used? The
 * snapshot's `usage` and `GET /api/projects/{slug}/usage`.
 *
 * Its own dimension: never an input to activity status, Build Momentum, the
 * Discovery Gap or the Radar. Unknown is absent or null with a reason, never
 * zero. `callerAddresses` counts distinct transaction-sender addresses per
 * UTC day — addresses, never people — and a window-wide distinct figure is
 * always `null` (`distinct_across_days_not_measured`): per-day counts cannot
 * be added without counting one address many times. Function names are
 * withheld on the public API (they stay on the Terminal).
 */
export type HeyUsageCallerFigure = { day: string; count: number; basis: 'EXACT' | 'FLOOR' };

export type HeyUsageSummary = {
  dimension: 'usage';
  /** `MEASURED`, `PARTIAL` (some days of the window), `STALE`, `NOT_WATCHED`, `NOT_APPLICABLE` (no contract) or `NOT_READ`. */
  state: 'MEASURED' | 'PARTIAL' | 'STALE' | 'NOT_WATCHED' | 'NOT_APPLICABLE' | 'NOT_READ';
  /** A machine code for the state (`measured`, `collection_started_in_window`, `contract_not_in_method_watch`, `no_contract`, `rollup_not_run`, …). */
  reason: string;
  source: 'decoded_calls';
  window?: { days: 1 | 7 | 30; from: string; to: string };
  /** The project's collection start and newest rolled-up day. Nothing earlier is known. */
  collectedFrom?: string;
  collectedThrough?: string;
  observedAt?: string;
  watchedContracts: number;
  /** Present only when at least one day of the window is covered. */
  daysCovered?: number;
  activeContracts?: number;
  calls?: number;
  erc20Calls?: number;
  otherCalls?: number;
  functionsCalled?: number;
  callerAddresses?: {
    latestDay: HeyUsageCallerFigure | null;
    peakDay: HeyUsageCallerFigure | null;
    /** Always null: not measured across days. */
    window: null;
    windowReason: 'distinct_across_days_not_measured';
    daysWithoutCount: number;
    unit: 'addresses';
  };
  events?: number | null;
  eventsReason?: string;
  basis?: { observed: number; reconstructedFromChain: number };
  topMethods: { rank: number; contract: string; bucket: 'erc20_standard' | 'named' | 'undecoded'; calls: number }[];
  names: 'WITHHELD';
  /** The change ledger's `method:` ids for functions first called, or called again after 30+ silent days, in the window. */
  methodEvents: { firstObserved: number; resumed: number; ids: string[] };
  contextOnly: true;
  url: string;
};

export type HeyUsageSeriesDay = {
  day: string;
  watchedContracts: number;
  activeContracts: number;
  calls: number;
  erc20Calls: number;
  functionsCalled: number;
  callerAddresses: number | null;
  callerBasis: 'EXACT' | 'FLOOR' | null;
  events: number | null;
  basis: 'observed' | 'reconstructed_from_chain';
};

/** A release, deployment or implementation change dated near the series: context, never a cause. */
export type HeyUsageMarker = {
  kind: 'release' | 'deployment' | 'implementation_change';
  day: string;
  evidenceId: string;
  label: string;
  relation: 'context_only_not_a_cause';
};

/** `GET /api/projects/{slug}/usage?window=1|7|30`. */
export type HeyProjectUsage = {
  project: { slug: string; name: string; url: string };
  usage: HeyUsageSummary;
  /** Up to thirty rolled-up days, oldest first; a day not held is absent, never zero. */
  series: HeyUsageSeriesDay[];
  seriesWindow?: { from: string; to: string };
  markers: HeyUsageMarker[];
  methodology: { calls: string; callerAddresses: string; events: string; coverage: string; neutrality: string };
  computedAt: string;
  disclaimer: string;
};
