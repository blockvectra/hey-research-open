import type { HeyChangeUpsert } from './changes';
import type { HeyWebhookEventType } from './webhooks';

/**
 * Alerts (2026-09-28): an account's rules over HEY's change ledger, managed at
 * `/api/alerts` with an API key, and the inbox of what they matched. Held to
 * the API's shapes by `apps/web/src/lib/public-api-contract.alerts.test.ts`.
 *
 * An alert is a change HEY recorded, exactly as `/api/changes` serves it —
 * never a price or trading alert, never anything derived from holder data.
 */

/**
 * The types a rule may name: the webhook types, plus a contract's functions first called or called again after a silence,
 * and a week of code activity (2026-10-09, additive) — those three shown in the inbox only; never emailed or sent to a webhook.
 */
export type HeyAlertEventType = HeyWebhookEventType | 'contract.method_first_observed' | 'contract.method_resumed' | 'build.code_activity';

/** `deploy` and `status` added 2026-10-03; `ship` and `code` 2026-10-09 (additive). */
export type HeyAlertPresetId = 'release' | 'ship' | 'code' | 'deploy' | 'implementation' | 'resumed' | 'status' | 'unlock' | 'docs' | 'integrity' | 'usage';

/** Conditions narrow only the types they apply to, on facts the event itself carries. */
export type HeyAlertConditions = {
  /** Transition types: the `after` state must be one of these. */
  statusTo?: string[];
  /** Transition types: the `before` state must be one of these. */
  statusFrom?: string[];
  /** `lock.unlock_due`: shown when the unlock date is at most this many days away (1–7). */
  unlockWithinDays?: number;
  /** `contract.method_resumed`: the event's own `longestSilenceDays` must be at least this; an event without it does not match. */
  minSilenceDays?: number;
};

export type HeyAlertRule = {
  id: string;
  name: string;
  enabled: boolean;
  scope: 'projects' | 'watchlist' | 'all';
  /** For `projects`: the ones still published. Null for `watchlist` and `all`. */
  projects: { slug: string; name: string }[] | null;
  eventTypes: HeyAlertEventType[];
  conditions: HeyAlertConditions;
  preset: HeyAlertPresetId | null;
  channels: {
    inApp: true;
    email: boolean;
    /** One of the account's own webhook subscriptions, by host; null when none. */
    webhook: { id: string; host: string; status: string } | null;
    /** Sent to the account's linked Telegram chat (2026-09-30, additive). The chat is never named. */
    telegram: boolean;
  };
  origin: 'site' | 'api';
  createdAt: string;
  updatedAt: string;
  lastMatchedAt: string | null;
  links: { self: string; notifications: string };
};

export type HeyAlertPreset = { id: HeyAlertPresetId; label: string; detail: string; eventTypes: HeyAlertEventType[]; conditions: HeyAlertConditions; inAppOnly: boolean };

export type HeyAlertList = { items: HeyAlertRule[]; eventTypes: HeyAlertEventType[]; presets: HeyAlertPreset[]; limit: number };

export type HeyAlertNotification = {
  /** The ledger event's id; send it back to mark it read. */
  eventId: string;
  eventType: string;
  rules: { id: string; name: string }[];
  notifyAt: string;
  read: boolean;
  /** Withdrawn by the ledger: nothing else about it is said. */
  retracted: boolean;
  /** The event exactly as `/api/changes` serves it; null when withdrawn. */
  event: HeyChangeUpsert | null;
};

export type HeyAlertNotifications = { items: HeyAlertNotification[]; nextBefore: string | null; unread: number };

export type HeyAlertsMarkedRead = { marked: number; unread: number };
