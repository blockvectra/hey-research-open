import type { HeyChangeRetract, HeyChangeUpsert } from './changes';

/**
 * Webhooks (2026-09-26): the subscriptions an API account manages at
 * `/api/webhooks`, and what HEY POSTs to them. Held to the API's shapes by
 * `apps/web/src/lib/public-api-contract.webhooks.test.ts`.
 *
 * Every delivery is a public ChangeEvent exactly as `GET /api/changes`
 * serves it, a retraction of one this subscription was sent, or a ping.
 * Nothing Terminal-only, no Market Integrity, no holder-derived or market
 * movement alerts.
 */

/** The event types a subscription may ask for. */
export type HeyWebhookEventType =
  | 'build.release'
  | 'build.ship'
  | 'build.resumed'
  | 'build.dormant'
  | 'build.accelerating'
  | 'build.status_changed'
  | 'research.builder_verified'
  | 'research.published'
  | 'research.source_added'
  | 'research.source_unavailable'
  | 'research.source_restored'
  | 'contract.deployed'
  | 'contract.followup_deployed'
  | 'contract.implementation_changed'
  | 'contract.interface_changed'
  | 'contract.source_verified'
  | 'market.status_changed'
  | 'token.launch_stage_changed'
  | 'token.verification_changed'
  | 'lock.unlock_due'
  | 'lock.observed'
  | 'lock.withdrawn'
  /** Only where HEY publishes Market Integrity; `GET /api/webhooks` lists what the deployment offers (2026-09-27). */
  | 'market_integrity.event';

type HeyWebhookEnvelope = {
  payloadVersion: 1;
  /** The `hey-delivery-id` header: the same on every retry of one delivery. Deduplicate on it. */
  deliveryId: string;
  /** When this attempt was made; the signature's timestamp is the same instant. */
  sentAt: string;
};

/** A change, exactly as `/api/changes` serves it. Keep the highest `revision` per `event.id`. */
export type HeyWebhookEventPayload = HeyWebhookEnvelope & { type: HeyWebhookEventType; event: HeyChangeUpsert & { type: HeyWebhookEventType } };

/** An event this subscription was sent is no longer public: drop your copy. It names nothing else. */
export type HeyWebhookRetractPayload = HeyWebhookEnvelope & { type: 'event.retracted'; event: HeyChangeRetract };

/** The signed check a new or re-pointed endpoint must answer with a 2xx. */
export type HeyWebhookPingPayload = HeyWebhookEnvelope & { type: 'ping'; subscriptionId: string };

/** Everything HEY may POST to a subscriber, told apart by `type`. */
export type HeyWebhookEvent = HeyWebhookEventPayload | HeyWebhookRetractPayload | HeyWebhookPingPayload;

export type HeyWebhookSubscription = {
  id: string;
  url: string;
  description: string | null;
  eventTypes: HeyWebhookEventType[];
  /** Null: every published project. */
  projects: { slug: string; name: string }[] | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';
  disabledReason: string | null;
  secretVersion: number;
  /** While in the future, deliveries carry a second `v1=` signed with the previous secret. */
  previousSecretValidUntil: string | null;
  /** Every matching event up to this ledger position has been queued; `/api/changes?after=` resumes from it. */
  cursor: string;
  consecutiveFailedDeliveries: number;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  links: { self: string; deliveries: string; changes: string };
};

export type HeyWebhookList = { items: HeyWebhookSubscription[]; eventTypes: HeyWebhookEventType[]; limit: number };

export type HeyWebhookCreated = {
  subscription: HeyWebhookSubscription;
  /** Shown once; HEY keeps no copy. */
  secret: string;
  verification: 'ping_queued';
};

export type HeyWebhookRotated = { subscription: HeyWebhookSubscription; secret: string; previousSecretValidUntil: string };

export type HeyWebhookDelivery = {
  id: string;
  kind: 'event' | 'ping';
  eventId: string | null;
  eventType: string;
  status: 'PENDING' | 'RETRYING' | 'SUCCEEDED' | 'DEAD' | 'CANCELLED';
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  latencyMs: number | null;
  responseExcerpt: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

export type HeyWebhookDeliveries = { items: HeyWebhookDelivery[]; nextBefore: string | null };

export type HeyWebhookPingQueued = { delivery: HeyWebhookDelivery };
