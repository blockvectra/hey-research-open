import type { ShipEventType, ShipSourceKind } from '@hey/db';

import { daysBetween, isoWeekIndex, meaningfulEvents, type ScoredEvent } from './activity';
import {
  CONSISTENCY,
  EVENT_BASE_WEIGHTS,
  HBM_WEIGHTS,
  RECENCY,
  SIGNIFICANCE,
  SIGNIFICANCE_DIMENSIONS,
  SOURCE_DIVERSITY,
  VERIFICATION_WEIGHTS,
  type SignificanceDimension,
} from './config';
import { clampScore } from './math';
import { SCORING_VERSION } from './version';

/**
 * HEY Build Momentum (PRD V4 section 11).
 *
 * Measures how consistently a project ships meaningful work. It never measures
 * price: a project can hold HBM 90 while its token is down heavily, and a token
 * can rise sharply while its project sits at HBM 10. The input type carries no
 * market field, so the two are independent by construction.
 */
export type HbmInput = {
  events: readonly ScoredEvent[];
  now: Date;
  /** Distinct classes of registered source, for the diversity component. */
  sourceClasses?: readonly string[];
};

export type HbmComponents = {
  recency: number;
  consistency: number;
  significance: number;
  verification: number;
  sourceDiversity: number;
};

export type HbmResult = {
  hbm: number;
  components: HbmComponents;
  /** User-facing explanation — HEY never shows an opaque number (PRD V4 11.2). */
  explanation: {
    activeWeeks: number;
    totalWeeks: number;
    meaningfulEvents: number;
    verifiedEvents: number;
    lastMeaningfulShipAt?: Date;
    dimensions: SignificanceDimension[];
    sourceClasses: string[];
    topEvents: { eventType: ShipEventType; publishedAt: Date; weight: number }[];
  };
  scoringVersion: string;
};


/** The widest component window: six rolling weeks (PRD V4 section 11.1). */
export const SCORING_WINDOW_DAYS = CONSISTENCY.weeks * 7;

const dimensionOf = (eventType: ShipEventType): SignificanceDimension | undefined => {
  for (const [dimension, types] of Object.entries(SIGNIFICANCE_DIMENSIONS)) {
    if ((types as readonly ShipEventType[]).includes(eventType)) {
      return dimension as SignificanceDimension;
    }
  }
  return undefined;
};

/**
 * Exponentially decayed weight of meaningful events in the recency window,
 * saturating so a burst cannot grow without bound (PRD V4 11.1).
 */
export function shippingRecency(events: readonly ScoredEvent[], now: Date): number {
  let total = 0;
  const contributions: { eventType: ShipEventType; publishedAt: Date; weight: number }[] = [];

  for (const event of events) {
    const ageDays = daysBetween(event.publishedAt, now);
    if (ageDays < 0 || ageDays > RECENCY.windowDays) continue;

    const base = EVENT_BASE_WEIGHTS[event.eventType] ?? 0;
    const weight = base * Math.exp(-ageDays / RECENCY.decayDays);
    total += weight;
    contributions.push({ eventType: event.eventType, publishedAt: event.publishedAt, weight });
  }

  return clampScore((Math.min(total, RECENCY.saturation) / RECENCY.saturation) * 100);
}

/**
 * Share of the last six calendar weeks containing meaningful activity.
 *
 * Calendar weeks are UTC ISO weeks (Monday to Sunday), the current one
 * included (2026-09-18). Buckets used to be seven-day spans measured back
 * from the rescore clock, so the same two events counted as one week at 06:00
 * and two at 18:00 — a 4.2-point HBM swing from the clock alone, and the
 * whitepaper's "calendar weeks" was not what ran. The week index lives in
 * `activity.ts`, beside the code-activity collapse that shares it (hbm-v8).
 */
export function shippingConsistency(
  events: readonly ScoredEvent[],
  now: Date,
): { score: number; activeWeeks: number } {
  const buckets = new Set<number>();
  const thisWeek = isoWeekIndex(now);

  for (const event of events) {
    if (event.publishedAt.getTime() > now.getTime()) continue;
    const week = thisWeek - isoWeekIndex(event.publishedAt);
    if (week >= 0 && week < CONSISTENCY.weeks) buckets.add(week);
  }

  return {
    score: clampScore((buckets.size / CONSISTENCY.weeks) * 100),
    activeWeeks: buckets.size,
  };
}

/**
 * Rewards substantive work and breadth. Repeated micro-updates in one dimension
 * hit a cap, so a project cannot farm the score by repeating the same thing.
 */
export function shippingSignificance(
  events: readonly ScoredEvent[],
  now: Date,
): { score: number; dimensions: SignificanceDimension[] } {
  const counts = new Map<SignificanceDimension, number>();

  for (const event of events) {
    const ageDays = daysBetween(event.publishedAt, now);
    if (ageDays < 0 || ageDays > RECENCY.windowDays) continue;
    const dimension = dimensionOf(event.eventType);
    if (!dimension) continue;
    counts.set(dimension, (counts.get(dimension) ?? 0) + 1);
  }

  let credit = 0;
  for (const [dimension, count] of counts) {
    const capped = Math.min(count, SIGNIFICANCE.dimensionCap);
    // Diminishing returns within a dimension: 1, then 0.5, then 0.25.
    let dimensionCredit = 0;
    for (let index = 0; index < capped; index += 1) dimensionCredit += 1 / 2 ** index;
    // Weight by how substantive the dimension's heaviest event type is.
    const weightFactor = dimension === 'COMMUNITY' || dimension === 'DEVTOOLING' ? 0.8 : 1;
    credit += dimensionCredit * weightFactor;
  }

  const maxCredit = SIGNIFICANCE.fullScoreDimensions * 1.75;
  return {
    score: clampScore((credit / maxCredit) * 100),
    dimensions: [...counts.keys()],
  };
}

/** Average evidence quality of meaningful events (PRD V4 11.1). */
export function verificationQuality(events: readonly ScoredEvent[]): {
  score: number;
  verifiedEvents: number;
} {
  if (events.length === 0) return { score: 0, verifiedEvents: 0 };

  let total = 0;
  let verified = 0;
  for (const event of events) {
    const weight = VERIFICATION_WEIGHTS[event.verificationStatus] ?? 0;
    total += weight;
    if (weight >= 1) verified += 1;
  }

  return { score: clampScore((total / events.length) * 100), verifiedEvents: verified };
}

/** Independent source classes, capped so breadth is not demanded of every project. */
export function sourceDiversity(
  events: readonly ScoredEvent[],
  declaredClasses: readonly string[] = [],
): { score: number; classes: string[] } {
  const classes = new Set<string>(declaredClasses);
  for (const event of events) classes.add(sourceClassOf(event.sourceKind));

  const score = clampScore(
    (Math.min(classes.size, SOURCE_DIVERSITY.fullScoreClasses) /
      SOURCE_DIVERSITY.fullScoreClasses) *
      100,
  );

  return { score, classes: [...classes] };
}

const sourceClassOf = (kind: ShipSourceKind): string => {
  switch (kind) {
    case 'GITHUB':
      return 'github';
    case 'RSS':
    case 'WEBSITE':
      return 'website';
    case 'CONTRACT':
      return 'onchain';
    case 'LAUNCHPAD':
      return 'launchpad';
    case 'BUILDER_SUBMISSION':
      return 'builder';
    default:
      return 'other';
  }
};

export function computeHbm(input: HbmInput): HbmResult {
  // `input.now` so an event dated years ahead cannot raise Build Momentum.
  const meaningful = meaningfulEvents(input.events, input.now);

  /**
   * Every component is measured inside the scoring window. Without it, evidence
   * quality and source breadth from years ago would keep propping up a project
   * that has not shipped since — Build Momentum is about now, not history.
   */
  const inWindow = meaningful.filter((event) => {
    const ageDays = daysBetween(event.publishedAt, input.now);
    return ageDays >= 0 && ageDays <= SCORING_WINDOW_DAYS;
  });

  // Nothing shipped in the window means no momentum. Registering a source must
  // never by itself earn a project a non-zero score.
  if (inWindow.length === 0) return emptyResult();

  const recency = shippingRecency(inWindow, input.now);
  const consistency = shippingConsistency(inWindow, input.now);
  const significance = shippingSignificance(inWindow, input.now);
  const verification = verificationQuality(inWindow);
  const diversity = sourceDiversity(inWindow, input.sourceClasses);

  const components: HbmComponents = {
    recency,
    consistency: consistency.score,
    significance: significance.score,
    verification: verification.score,
    sourceDiversity: diversity.score,
  };

  const hbm =
    components.recency * HBM_WEIGHTS.recency +
    components.consistency * HBM_WEIGHTS.consistency +
    components.significance * HBM_WEIGHTS.significance +
    components.verification * HBM_WEIGHTS.verification +
    components.sourceDiversity * HBM_WEIGHTS.sourceDiversity;

  const topEvents = inWindow
    .filter((event) => daysBetween(event.publishedAt, input.now) <= RECENCY.windowDays)
    .map((event) => ({
      eventType: event.eventType,
      publishedAt: event.publishedAt,
      weight:
        (EVENT_BASE_WEIGHTS[event.eventType] ?? 0) *
        Math.exp(-daysBetween(event.publishedAt, input.now) / RECENCY.decayDays),
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  return {
    hbm: Math.round(clampScore(hbm) * 10) / 10,
    components,
    explanation: {
      activeWeeks: consistency.activeWeeks,
      totalWeeks: CONSISTENCY.weeks,
      meaningfulEvents: inWindow.length,
      verifiedEvents: verification.verifiedEvents,
      dimensions: significance.dimensions,
      sourceClasses: diversity.classes,
      topEvents,
      ...(meaningful[0] ? { lastMeaningfulShipAt: meaningful[0].publishedAt } : {}),
    },
    scoringVersion: SCORING_VERSION,
  };
}

function emptyResult(): HbmResult {
  return {
    hbm: 0,
    components: {
      recency: 0,
      consistency: 0,
      significance: 0,
      verification: 0,
      sourceDiversity: 0,
    },
    explanation: {
      activeWeeks: 0,
      totalWeeks: CONSISTENCY.weeks,
      meaningfulEvents: 0,
      verifiedEvents: 0,
      dimensions: [],
      sourceClasses: [],
      topEvents: [],
    },
    scoringVersion: SCORING_VERSION,
  };
}

/** Consecutive most-recent weeks containing meaningful activity (PRD V4 section 39). */
export function shippingStreak(events: readonly ScoredEvent[], now: Date): number {
  // UTC ISO weeks (hbm-v13), like consistency: seven-day spans back from the
  // rescore clock made the streak depend on the hour it was computed.
  const thisWeek = isoWeekIndex(now);
  const weeks = new Set<number>();
  for (const event of meaningfulEvents(events, now)) {
    if (event.publishedAt.getTime() <= now.getTime()) weeks.add(thisWeek - isoWeekIndex(event.publishedAt));
  }

  // The week in progress does not break a run before it has ended.
  const start = weeks.has(0) ? 0 : 1;
  let streak = 0;
  while (weeks.has(start + streak)) streak += 1;
  return streak;
}
