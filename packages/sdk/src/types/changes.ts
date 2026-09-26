/**
 * The change ledger (`GET /api/changes`, 2026-09-26): one canonical event per
 * meaningful change HEY recorded, for mirroring and for browsing.
 *
 * Unknown is null or absent, never 0: an event with no source time has
 * `occurredAt: null` and `precision: 'OBSERVED'`. A retraction names nothing
 * but its id. These shapes are held to the API's by
 * `apps/web/src/lib/public-api-contract.changes.test.ts`.
 */

/** How much of an event's time HEY knows; one vocabulary on every surface. */
export type HeyChangePrecision = 'EXACT' | 'DATE' | 'WEEK' | 'WINDOW' | 'OBSERVED' | 'SCHEDULED';

export type HeyChangeDomain = 'build' | 'contract' | 'market' | 'token' | 'research' | 'lock' | 'market_integrity';

export type HeyChangeType =
  | 'build.release'
  | 'build.code_activity'
  | 'build.ship'
  | 'build.status_changed'
  | 'build.dormant'
  | 'build.resumed'
  | 'build.accelerating'
  | 'build.slowing'
  | 'contract.deployed'
  | 'contract.followup_deployed'
  | 'contract.implementation_changed'
  | 'contract.source_verified'
  | 'contract.source_unverified'
  | 'contract.interface_changed'
  | 'contract.usage_changed'
  | 'market.status_changed'
  | 'market.liquidity_moved'
  | 'market.volume_spike'
  | 'market.distribution_changed'
  | 'token.launch_stage_changed'
  | 'token.verification_changed'
  | 'research.published'
  | 'research.builder_verified'
  | 'research.owner_verified'
  | 'research.source_added'
  | 'research.source_unavailable'
  | 'research.source_restored'
  | 'research.narrative_assigned'
  | 'lock.unlock_due'
  | 'lock.observed'
  | 'lock.withdrawn'
  | 'market_integrity.event';

export type HeyChangeAddress = { chainId: number; address: string };

export type HeyChangeUpsert = {
  /** Stable across revisions: `ship:<uuid>`, `state:<projectUuid>:<key>:<id>`, `lock:<chainId>:<lockId>:due`, ... */
  id: string;
  /** 1 on first emission, +1 each time the event is emitted again. Keep the highest. */
  revision: number;
  op: 'upsert';
  type: HeyChangeType;
  domain: HeyChangeDomain;
  /** `live`: seen as it happened; `bootstrap`/`backfill`: history the ledger indexed later. */
  origin: 'live' | 'bootstrap' | 'backfill';
  project: { slug: string; name: string; url: string };
  token?: HeyChangeAddress;
  contract?: HeyChangeAddress;
  /** When the source dates it; null when only HEY's own observation does. */
  occurredAt: string | null;
  occurredUntil?: string;
  precision: HeyChangePrecision;
  /** When HEY first knew. */
  detectedAt: string;
  /** When this revision entered the ledger at its current visibility. */
  recordedAt: string;
  summary: string;
  before?: string | number | boolean | null;
  after?: string | number | boolean | null;
  evidence: { id: string; url?: string; label: string }[];
  source: string;
  /** Present only on events that count toward activity status. */
  countsAsBuilding?: true;
  /** Records that restate this event (a release signal on its ship), by id. */
  annotations?: { signalIds?: string[] };
  facts?: Record<string, string | number | boolean>;
  links: { project: string; evidence: string; timeline: string };
};

/** The event is no longer public: drop your copy. It names nothing else. */
export type HeyChangeRetract = { id: string; revision: number; op: 'retract'; recordedAt: string };

export type HeyChangeEvent = HeyChangeUpsert | HeyChangeRetract;

export type HeyChangesPage = {
  query: Record<string, string | number>;
  items: HeyChangeEvent[];
  /** Send as `after` (sync) or `before` (browse). In sync mode it is always set, so a poller keeps its place. */
  nextCursor: string | null;
  hasMore: boolean;
  ledger: { collectionStart: string | null; transitionsFrom: string | null; newestRecordedAt: string | null; projectorRanAt: string | null };
  disclaimer: string;
};

export type HeyChangesQuery = {
  /** A published project's slug; a hidden or unknown slug answers 404. */
  project?: string;
  /** `<chainId>:<address>`: events about that contract or token. */
  contract?: string;
  domain?: HeyChangeDomain | readonly HeyChangeDomain[];
  type?: HeyChangeType | readonly HeyChangeType[];
  /** Filters on the event's own time (`occurredAt`); events with none are left out, tombstones are kept. */
  since?: string;
  until?: string;
  /** Starts a sync at the first event recorded at or after this instant. */
  detectedSince?: string;
  /** Sync forward from this cursor (`c1.0` is the start). */
  after?: string;
  /** Browse older than this cursor. */
  before?: string;
  /** 1–100, default 50. */
  limit?: number;
};
