/**
 * `@hey-research/sdk` (2026-09-19): HEY Research's public API as typed calls.
 *
 * Everything exported here is either a call the API answers, a shape it
 * answers with, or the error it throws. There is nothing that ranks by
 * price, values a token or names a wallet, because HEY does not do those.
 */
export { DEFAULT_BASE_URL, HeyClient, USER_AGENT, type FetchLike, type HeyClientOptions, type QueryParams } from './client';
export { HeyApiError, retryAfterSeconds, type HeyApiErrorCode, type HeyApiErrorOptions } from './error';
export { cursorPages, itemsOf, nextOffsetPages, totalPages } from './paging';
export { SDK_VERSION } from './version';
/* Receiving webhooks (2026-09-26): verify, parse, deduplicate. */
export {
  HeyWebhookError,
  isReplay,
  parseSignatureHeader,
  parseWebhookEvent,
  timingSafeEqualHex,
  verifyWebhookSignature,
  WEBHOOK_DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_PAYLOAD_VERSION,
  WEBHOOK_PAYLOAD_VERSION_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type VerifyWebhookSignatureInput,
  type WebhookSeenStore,
  type WebhookVerification,
  type WebhookVerificationFailure,
} from './webhooks';
/*
 * The response and query shapes, one file per family (2026-09-26). `export
 * type *` makes a type added to any of them public without an edit here.
 */
export type * from './types/projects';
export type * from './types/feeds';
export type * from './types/misc';
export type * from './types/changes';
export type * from './types/snapshot';
export type * from './types/contracts';
export type * from './types/webhooks';
