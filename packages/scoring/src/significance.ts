import type { ShipEventType, VerificationStatus } from '@hey/db';

/**
 * Meaningful vs non-meaningful activity (PRD V4 sections 10.2, 26).
 *
 * This is the anti-gaming boundary of the whole product. Marketing volume must
 * never look like building: a project can post every day and still have no
 * meaningful shipping activity.
 *
 * For meme projects, creative and community deliverables count as real output —
 * a game, tool, bot, art drop or event is concrete work. A meme is never required
 * to pretend it has software utility.
 */
export type Significance = 'STRONG' | 'SUPPORTING' | 'NOT_MEANINGFUL';

const STRONG: readonly ShipEventType[] = [
  'PRODUCT_LAUNCH',
  'APP_RELEASE',
  'FEATURE_RELEASE',
  'GITHUB_RELEASE',
  'CONTRACT_UPGRADE',
  'INTEGRATION',
  'API_RELEASE',
  'SDK_RELEASE',
  'ROADMAP_MILESTONE',
  'GAME_RELEASE',
  'COMMUNITY_TOOL',
];

const SUPPORTING: readonly ShipEventType[] = [
  'DOCS_UPDATE',
  'DEMO_RELEASE',
  'DESIGN_RELEASE',
  'CREATIVE_DROP',
  'COMMUNITY_EVENT',
  'FOUNDER_BUILD_UPDATE',
  'CODE_ACTIVITY',
];

/**
 * Launching is not building (2026-09-06).
 *
 * `CONTRACT_DEPLOY` was STRONG, so a token that deployed and did nothing else
 * read as a project with strong build evidence: 433 published projects held
 * nothing but their own deploy and every one of them carried an activity
 * status other than UNKNOWN. Qualification had already stopped counting the
 * deploy toward the verified-builder badge, and this list disagreeing with it
 * is what left 454 projects whose research level still said VERIFIED_BUILDER
 * after their catalogue status had been withdrawn.
 *
 * `CONTRACT_UPGRADE` stays strong: changing a contract that is already live is
 * work done after the launch, which is exactly what the question asks about.
 * The deploy itself is kept as a ship event with its provenance — it is what
 * proves the token is real and chain-native — it simply is not evidence that
 * anyone is still building.
 */
const LAUNCH_NOT_BUILDING: readonly ShipEventType[] = ['CONTRACT_DEPLOY'];

/** Announcements, launches and anything uncategorised are not building. */
export function significanceOf(eventType: ShipEventType): Significance {
  if (LAUNCH_NOT_BUILDING.includes(eventType)) return 'NOT_MEANINGFUL';
  if (STRONG.includes(eventType)) return 'STRONG';
  if (SUPPORTING.includes(eventType)) return 'SUPPORTING';
  return 'NOT_MEANINGFUL';
}

/**
 * Verification states that count as independently corroborated (PRD V4 9.2).
 * `DISPUTED` and `RETRACTED` are deliberately score-neutral rather than deleted:
 * the record stays, its weight does not.
 */
const CORROBORATED: readonly VerificationStatus[] = [
  'SOURCE_LINKED',
  'PUBLICLY_VERIFIED',
  'ADMIN_VERIFIED',
];

export function isCorroborated(status: VerificationStatus): boolean {
  return CORROBORATED.includes(status);
}

export type MeaningfulInput = {
  eventType: ShipEventType;
  verificationStatus: VerificationStatus;
  moderationStatus?: string;
};

/**
 * A ShipEvent counts as meaningful activity only when it is both a real build
 * signal and backed by something better than an unverified claim.
 *
 * PRD V4 section 10 requires `SOURCE_LINKED` or higher for SHIPPING/ACTIVE, so a
 * self-reported marketing post cannot move a project's status on its own.
 */
export function isMeaningful(input: MeaningfulInput): boolean {
  if (input.moderationStatus && input.moderationStatus !== 'APPROVED') return false;
  if (significanceOf(input.eventType) === 'NOT_MEANINGFUL') return false;
  return isCorroborated(input.verificationStatus);
}

/** Strong signals only — used where "did they actually ship a thing" is the question. */
export function isStrongShip(input: MeaningfulInput): boolean {
  return isMeaningful(input) && significanceOf(input.eventType) === 'STRONG';
}

/**
 * The event types that are evidence of building, as data (2026-09-06).
 *
 * Queries cannot call `significanceOf` row by row, so the same judgement was
 * written out by hand in SQL — and the copies drifted. After a contract deploy
 * stopped counting here, `pulse.ts` still counted one as a ship this week,
 * because its own list named only ANNOUNCEMENT and OTHER.
 *
 * Stated as what does count rather than what does not, deliberately: a new
 * event type added to the enum is then not building until someone classifies
 * it, in the queries exactly as in `significanceOf`. The opposite phrasing
 * would silently treat every new type as a ship. It is also what keeps this
 * package free of the database — the full enum lives there, these two lists
 * live here.
 */
export const BUILDING_EVENT_TYPES: readonly ShipEventType[] = [...STRONG, ...SUPPORTING];

/**
 * Verification states that withdraw a claim. A retracted event keeps its row
 * for the audit trail and must stop being counted or shown: leaving it visible
 * is the half of a correction nobody can see.
 */
export const WITHDRAWN_VERIFICATION_STATUSES = ['RETRACTED', 'DISPUTED'] as const;
