import { heyText, type AgentText } from './text';

/**
 * The freshness contract (2026-09-30, Robinhood Agent Apps readiness §13).
 *
 * An agent must know how current an answer is without reading HEY's code.
 * Each data family says, for the subject it describes:
 *
 * - `observedAt` — when HEY last read the source behind it (null: never);
 * - `dataAsOf` — the moment the value describes (a scoring run, the ledger's
 *   newest arrival), when the canonical read carries one;
 * - `freshnessStatus` — the age of that reading in HEY's own words:
 *   `live` (within 15 minutes), `recent` (within 6 hours), `daily` (within
 *   36 hours), `weekly` (older, still inside the family's limit), `stale`
 *   (past the family's own staleness limit, whatever its age bucket) or
 *   `unknown` (HEY holds no reading). Age buckets, never a quality grade;
 *   `live` means a recent reading, not a stream;
 * - `refresh` — the production schedule that re-reads it: the worker job,
 *   and the fastest and slowest cadence the schedule allows;
 * - `nextExpectedRefresh` — `observedAt` plus the cadence, only when that
 *   is a single known interval still ahead. A tiered cadence whose tier the
 *   caller did not know, a batched job whose order decides the next read, or
 *   an overdue reading says so in `nextExpectedRefreshReason` instead of a
 *   guessed time.
 *
 * The cadences restate the schedules in `apps/worker` and the tier table in
 * the domain (`refresh/tier.ts`); the staleness limits restate the domain's
 * `staleAfterHoursFor` and each family's own limit. A parity test in the
 * web app holds these numbers to those constants, so the contract cannot
 * promise a schedule production does not run.
 *
 * v2 (2026-09-30, readiness audit F5): a limit is at least `AGENT_STALE_MARGIN`
 * (1.5) × the cadence the subject is read on. In v1 the COLD cadences equalled
 * the limits — market 24 h against 24 h, builder sources 72 h against 72 h,
 * contracts 7 days against 7 days — so a reading on schedule read `stale`
 * just before its refresh. A tiered family's limit now follows the subject's
 * tier (`staleAfterHoursByTier`); without a tier it is the slowest tier's.
 */
export const AGENT_FRESHNESS_VERSION = 'agent-freshness-v2' as const;

/** A limit is at least this many cadences: on schedule is never stale, one missed refresh is. */
export const AGENT_STALE_MARGIN = 1.5;

export const AGENT_FRESHNESS_STATUSES = ['live', 'recent', 'daily', 'weekly', 'stale', 'unknown'] as const;
export type AgentFreshnessStatus = (typeof AGENT_FRESHNESS_STATUSES)[number];

export const AGENT_DATA_FAMILIES = ['builder_sources', 'activity_score', 'change_ledger', 'market', 'contracts', 'locks', 'usage', 'peers', 'protocol_economics'] as const;
export type AgentDataFamily = (typeof AGENT_DATA_FAMILIES)[number];

export type RefreshTier = 'HOT' | 'WARM' | 'COOL' | 'COLD';

export type FamilySchedule = {
  job: string;
  /** Minutes between refreshes: one number, one per refresh tier, or a range when the job works through batches. */
  cadence: number | Readonly<Record<RefreshTier, number>> | { readonly fastest: number; readonly slowest: number };
  /** The limit when the subject's tier is not known: the slowest cadence's. */
  staleAfterHours: number;
  /** A tiered family's limit per tier: the family's floor, lifted to `AGENT_STALE_MARGIN` × that tier's cadence. */
  staleAfterHoursByTier?: Readonly<Record<RefreshTier, number>>;
  basis: string;
};

const HOUR = 60;
const DAY = 24 * HOUR;

/** Market refresh per tier: HOT 10 min, WARM 1 h, COOL 6 h, COLD 24 h (`MARKET_REFRESH_INTERVAL_MS`). */
export const MARKET_CADENCE_MINUTES: Readonly<Record<RefreshTier, number>> = { HOT: 10, WARM: HOUR, COOL: 6 * HOUR, COLD: DAY };
/** Builder-source refresh per tier: HOT 1 h, WARM 6 h, COOL 24 h, COLD 72 h (`SOURCE_REFRESH_INTERVAL_MS`). */
export const SOURCE_CADENCE_MINUTES: Readonly<Record<RefreshTier, number>> = { HOT: HOUR, WARM: 6 * HOUR, COOL: DAY, COLD: 3 * DAY };

/** A floor lifted to `AGENT_STALE_MARGIN` × each tier's cadence, in hours: the domain's `staleAfterHoursFor`, restated. */
const byTier = (floorHours: number, cadence: Readonly<Record<RefreshTier, number>>): Readonly<Record<RefreshTier, number>> => ({
  HOT: Math.max(floorHours, (cadence.HOT * AGENT_STALE_MARGIN) / HOUR),
  WARM: Math.max(floorHours, (cadence.WARM * AGENT_STALE_MARGIN) / HOUR),
  COOL: Math.max(floorHours, (cadence.COOL * AGENT_STALE_MARGIN) / HOUR),
  COLD: Math.max(floorHours, (cadence.COLD * AGENT_STALE_MARGIN) / HOUR),
});
/** Market: 24 h on HOT, WARM and COOL; 36 h on COLD (a 24 h cadence). */
export const MARKET_STALE_HOURS_BY_TIER = byTier(24, MARKET_CADENCE_MINUTES);
/** Builder sources: 72 h on HOT, WARM and COOL; 108 h on COLD (a 72 h cadence). */
export const SOURCE_STALE_HOURS_BY_TIER = byTier(72, SOURCE_CADENCE_MINUTES);
/** Contracts: each is re-read within 7 days, so stale after 10.5 days. */
const CONTRACT_SLOWEST_MINUTES = 7 * DAY;

export const FAMILY_SCHEDULES: Readonly<Record<AgentDataFamily, FamilySchedule>> = {
  builder_sources: {
    job: 'REFRESH_GITHUB',
    cadence: SOURCE_CADENCE_MINUTES,
    staleAfterHours: SOURCE_STALE_HOURS_BY_TIER.COLD,
    staleAfterHoursByTier: SOURCE_STALE_HOURS_BY_TIER,
    basis: 'Repositories, release feeds and changelogs are re-read by refresh tier (HOT hourly, WARM every 6 hours, COOL daily, COLD every 3 days); the tier follows the activity status and the last meaningful ship. A failing source backs off. A reading is stale after 72 hours, or one and a half cadences of its tier where that is longer (108 hours on COLD).',
  },
  activity_score: {
    job: 'RECALCULATE_SCORES',
    cadence: 12 * HOUR,
    staleAfterHours: 24,
    basis: 'A project is due for rescoring once its score is 12 hours old (RESCORE_MIN_INTERVAL_HOURS); a newly recorded ship queues a rescore within the quarter hour. The next refresh is the latest expected time, not a promise: a backlog can delay it.',
  },
  change_ledger: {
    job: 'PROJECT_CHANGE_EVENTS',
    cadence: 5,
    staleAfterHours: 1,
    basis: 'The ledger projector runs every 5 minutes and indexes what HEY recorded since its last run.',
  },
  market: {
    job: 'REFRESH_MARKET_BATCH',
    cadence: MARKET_CADENCE_MINUTES,
    staleAfterHours: MARKET_STALE_HOURS_BY_TIER.COLD,
    staleAfterHoursByTier: MARKET_STALE_HOURS_BY_TIER,
    basis: 'Market readings are refreshed by tier (HOT every 10 minutes, WARM hourly, COOL every 6 hours, COLD daily); a token priced only by the paced fallback waits at least 2 hours, and one with no reading backs off up to 14 days. A reading is stale after 24 hours, or one and a half cadences of its tier where that is longer (36 hours on COLD).',
  },
  contracts: {
    job: 'CONTRACT_ABI_WATCH',
    cadence: { fastest: HOUR, slowest: CONTRACT_SLOWEST_MINUTES },
    staleAfterHours: Math.max(7 * 24, (CONTRACT_SLOWEST_MINUTES * AGENT_STALE_MARGIN) / HOUR),
    basis: 'The contract upgrade and interface watches run hourly over batches of watched contracts; how soon one contract is read again depends on the batch, within 7 days. A reading is stale after one and a half of those.',
  },
  locks: {
    job: 'SYNC_HOODLOCK',
    cadence: 6 * HOUR,
    staleAfterHours: 48,
    basis: 'HoodLock locks and unlocks are synced every 6 hours. Only HoodLock is read; other lockers are not.',
  },
  usage: {
    job: 'ROLLUP_USAGE_DAYS',
    cadence: 6 * HOUR,
    staleAfterHours: 72,
    basis: 'Product usage is rolled up from decoded calls every 6 hours, per UTC day, for contracts in the method watch.',
  },
  peers: {
    job: 'REFRESH_PEER_CONTEXT',
    cadence: DAY,
    staleAfterHours: 36,
    basis: 'Peer cohorts are recomputed once a day.',
  },
  protocol_economics: {
    job: 'DEFI_TVL_SNAPSHOT',
    cadence: DAY,
    staleAfterHours: 72,
    basis: 'DefiLlama TVL, fees, revenue and volume are read once a day for matched protocols.',
  },
};

const MINUTE_MS = 60_000;

/** The age bucket of a reading, before the family's staleness limit is applied. */
export function ageBucket(ageMs: number): Exclude<AgentFreshnessStatus, 'stale' | 'unknown'> {
  if (ageMs <= 15 * MINUTE_MS) return 'live';
  if (ageMs <= 6 * HOUR * MINUTE_MS) return 'recent';
  if (ageMs <= 36 * HOUR * MINUTE_MS) return 'daily';
  return 'weekly';
}

export function freshnessStatusOf(observedAt: string | Date | null | undefined, staleAfterHours: number, now: Date): AgentFreshnessStatus {
  if (!observedAt) return 'unknown';
  const at = typeof observedAt === 'string' ? Date.parse(observedAt) : observedAt.getTime();
  if (!Number.isFinite(at)) return 'unknown';
  const age = Math.max(0, now.getTime() - at);
  if (age > staleAfterHours * HOUR * MINUTE_MS) return 'stale';
  return ageBucket(age);
}

export type AgentFreshnessEntry = {
  family: AgentDataFamily;
  observedAt: string | null;
  dataAsOf: string | null;
  freshnessStatus: AgentFreshnessStatus;
  staleAfterHours: number;
  refresh: { job: string; everyMinutes: number; slowestMinutes: number; basis: AgentText };
  nextExpectedRefresh: string | null;
  nextExpectedRefreshReason?: 'overdue' | 'variable_cadence' | 'never_read';
};

/**
 * One family's freshness for one subject. `tier` is the subject's refresh
 * tier, when the caller knows it from the domain's own tier rule; without it
 * a tiered family gives the range and no guessed next refresh.
 */
export function familyFreshness(family: AgentDataFamily, input: { observedAt: string | Date | null | undefined; dataAsOf?: string | Date | null; now: Date; tier?: RefreshTier; staleAfterHours?: number }): AgentFreshnessEntry {
  const schedule = FAMILY_SCHEDULES[family];
  const staleAfterHours = input.staleAfterHours ?? (input.tier && schedule.staleAfterHoursByTier ? schedule.staleAfterHoursByTier[input.tier] : schedule.staleAfterHours);
  const toIso = (value: string | Date | null | undefined): string | null => {
    if (!value) return null;
    const date = typeof value === 'string' ? new Date(value) : value;
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  const observedAt = toIso(input.observedAt);
  const dataAsOf = toIso(input.dataAsOf === undefined ? input.observedAt : input.dataAsOf);
  const cadence = schedule.cadence;
  const range = typeof cadence === 'number' ? { fastest: cadence, slowest: cadence } : 'fastest' in cadence ? cadence : { fastest: Math.min(...Object.values(cadence)), slowest: Math.max(...Object.values(cadence)) };
  const everyMinutes = range.fastest;
  const slowestMinutes = range.slowest;
  const interval = typeof cadence === 'number' ? cadence : 'fastest' in cadence ? undefined : input.tier ? cadence[input.tier] : undefined;
  let nextExpectedRefresh: string | null = null;
  let nextExpectedRefreshReason: AgentFreshnessEntry['nextExpectedRefreshReason'];
  if (!observedAt) nextExpectedRefreshReason = 'never_read';
  else if (interval === undefined) nextExpectedRefreshReason = 'variable_cadence';
  else {
    const next = Date.parse(observedAt) + interval * MINUTE_MS;
    if (next > input.now.getTime()) nextExpectedRefresh = new Date(next).toISOString();
    else nextExpectedRefreshReason = 'overdue';
  }
  return {
    family,
    observedAt,
    dataAsOf,
    freshnessStatus: freshnessStatusOf(observedAt, staleAfterHours, input.now),
    staleAfterHours,
    refresh: { job: schedule.job, everyMinutes, slowestMinutes, basis: heyText(schedule.basis) },
    nextExpectedRefresh,
    ...(nextExpectedRefreshReason ? { nextExpectedRefreshReason } : {}),
  };
}

/** The families the snapshot's per-source freshness restates (`code`, `market`, `contracts`, `locks`, `score`). */
export const SNAPSHOT_SOURCE_FAMILY: Readonly<Record<'code' | 'market' | 'contracts' | 'locks' | 'score', AgentDataFamily>> = {
  code: 'builder_sources',
  market: 'market',
  contracts: 'contracts',
  locks: 'locks',
  score: 'activity_score',
};
