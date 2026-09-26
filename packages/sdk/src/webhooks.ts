import type { HeyWebhookEvent, HeyWebhookEventType } from './types/webhooks';

/**
 * Receiving HEY webhooks (2026-09-26): verify the signature, check the
 * timestamp, parse the event, and remember what was already handled. Web
 * Crypto only, so it runs in Node 18+, Deno, Bun, Workers and browsers.
 *
 * ```ts
 * import { parseWebhookEvent, isReplay } from '@hey-research/sdk';
 *
 * const seen = new Set<string>(); // use a durable store in production
 * export async function POST(request: Request) {
 *   const rawBody = await request.text(); // the exact bytes; never re-serialise
 *   const event = await parseWebhookEvent({ rawBody, header: request.headers.get('hey-signature'), secret: process.env.HEY_WEBHOOK_SECRET! });
 *   if (await isReplay(event.deliveryId, seen)) return new Response(null, { status: 200 });
 *   // ... handle event.type
 *   return new Response(null, { status: 204 });
 * }
 * ```
 *
 * The header is `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`,
 * with a second `v1=` for 24 hours after a rotation. A delivery older (or
 * newer) than the tolerance — five minutes by default — is refused, so a
 * captured request cannot be replayed later; `isReplay` catches a repeat
 * inside the window. Answer 2xx within five seconds: HEY retries anything
 * else at 1 m, 5 m, 30 m, 2 h, 6 h and 12 h, and follows no redirect.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'hey-signature';
export const WEBHOOK_EVENT_ID_HEADER = 'hey-event-id';
export const WEBHOOK_DELIVERY_ID_HEADER = 'hey-delivery-id';
export const WEBHOOK_PAYLOAD_VERSION_HEADER = 'hey-payload-version';
export const WEBHOOK_PAYLOAD_VERSION = 1 as const;
export const WEBHOOK_DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Types a subscription may ask for only where HEY publishes them (2026-09-27):
 * Market Integrity. `GET /api/webhooks` answers `eventTypes` with what the
 * deployment offers now.
 */
export const WEBHOOK_PUBLISHED_ONLY_TYPES: readonly HeyWebhookEventType[] = ['market_integrity.event'];

/** The event types a subscription may always ask for (with `WEBHOOK_PUBLISHED_ONLY_TYPES`, the runtime twin of `HeyWebhookEventType`). */
export const WEBHOOK_EVENT_TYPES: readonly HeyWebhookEventType[] = [
  'build.release',
  'build.ship',
  'build.resumed',
  'build.dormant',
  'build.accelerating',
  'build.status_changed',
  'research.builder_verified',
  'research.published',
  'research.source_added',
  'research.source_unavailable',
  'research.source_restored',
  'contract.deployed',
  'contract.followup_deployed',
  'contract.implementation_changed',
  'contract.interface_changed',
  'contract.source_verified',
  'market.status_changed',
  'token.launch_stage_changed',
  'token.verification_changed',
  'lock.unlock_due',
  'lock.observed',
  'lock.withdrawn',
];

export type VerifyWebhookSignatureInput = {
  /** The request body exactly as received: a string or its bytes. Parsing and re-serialising breaks the signature. */
  rawBody: string | Uint8Array;
  /** The `hey-signature` header. */
  header: string | null | undefined;
  /** Your subscription's secret (`whsec_…`); pass both during your own rotation if you like. */
  secret: string | readonly string[];
  /** How far the signed timestamp may be from now, either way. Default 300. */
  toleranceSeconds?: number;
  /** The clock, for tests. */
  now?: Date | number;
};

export type WebhookVerificationFailure = 'missing_header' | 'malformed_header' | 'timestamp_out_of_tolerance' | 'signature_mismatch' | 'no_secret' | 'crypto_unavailable';

export type WebhookVerification = { ok: true; timestamp: number } | { ok: false; reason: WebhookVerificationFailure };

export class HeyWebhookError extends Error {
  constructor(
    readonly reason: WebhookVerificationFailure | 'invalid_payload' | 'unsupported_version',
    message: string,
  ) {
    super(message);
    this.name = 'HeyWebhookError';
  }
}

const encoder = new TextEncoder();

function bytesOf(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Equal-length strings compared without an early exit; the length itself is public (64 hex characters). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** `t` and every `v1` of a `hey-signature` header, or undefined when it is not one. Unknown schemes are ignored. */
export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } | undefined {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  return timestamp === undefined || signatures.length === 0 ? undefined : { timestamp, signatures };
}

async function hmacHex(secret: string, timestamp: number, body: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prefix = encoder.encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix, 0);
  message.set(body, prefix.length);
  return hex(await subtle.sign('HMAC', key, message));
}

/**
 * Checks a delivery's signature and timestamp. Never throws for a bad
 * request: it says why it refused, so you can answer 400 and log the reason.
 */
export async function verifyWebhookSignature(input: VerifyWebhookSignatureInput): Promise<WebhookVerification> {
  const secrets = (typeof input.secret === 'string' ? [input.secret] : [...input.secret]).filter((secret) => secret.length > 0);
  if (secrets.length === 0) return { ok: false, reason: 'no_secret' };
  if (!input.header) return { ok: false, reason: 'missing_header' };
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) return { ok: false, reason: 'malformed_header' };
  const tolerance = Math.max(0, input.toleranceSeconds ?? WEBHOOK_DEFAULT_TOLERANCE_SECONDS);
  const nowMs = input.now === undefined ? Date.now() : typeof input.now === 'number' ? input.now : input.now.getTime();
  if (Math.abs(Math.floor(nowMs / 1000) - parsed.timestamp) > tolerance) return { ok: false, reason: 'timestamp_out_of_tolerance' };
  const body = bytesOf(input.rawBody);
  let matched = false;
  for (const secret of secrets) {
    const expected = await hmacHex(secret, parsed.timestamp, body);
    if (expected === undefined) return { ok: false, reason: 'crypto_unavailable' };
    // Every candidate is compared in full; none short-circuits the loop.
    for (const signature of parsed.signatures) if (timingSafeEqualHex(expected, signature)) matched = true;
  }
  return matched ? { ok: true, timestamp: parsed.timestamp } : { ok: false, reason: 'signature_mismatch' };
}

const TYPES: ReadonlySet<string> = new Set([...WEBHOOK_EVENT_TYPES, ...WEBHOOK_PUBLISHED_ONLY_TYPES, 'event.retracted', 'ping']);

/**
 * Verifies, then parses. Throws `HeyWebhookError` for a bad signature, a
 * stale timestamp, a payload version this SDK does not know, or a body that
 * is not a HEY delivery.
 */
export async function parseWebhookEvent(input: VerifyWebhookSignatureInput): Promise<HeyWebhookEvent> {
  const verified = await verifyWebhookSignature(input);
  if (!verified.ok) throw new HeyWebhookError(verified.reason, `The webhook was refused: ${verified.reason.replace(/_/g, ' ')}.`);
  const text = typeof input.rawBody === 'string' ? input.rawBody : new TextDecoder().decode(input.rawBody);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HeyWebhookError('invalid_payload', 'The webhook body is not JSON.');
  }
  if (typeof body !== 'object' || body === null) throw new HeyWebhookError('invalid_payload', 'The webhook body is not an object.');
  const record = body as Record<string, unknown>;
  if (record.payloadVersion !== WEBHOOK_PAYLOAD_VERSION) throw new HeyWebhookError('unsupported_version', `Payload version ${String(record.payloadVersion)} is not one this SDK reads; upgrade @hey-research/sdk.`);
  if (typeof record.type !== 'string' || !TYPES.has(record.type) || typeof record.deliveryId !== 'string' || typeof record.sentAt !== 'string') {
    throw new HeyWebhookError('invalid_payload', 'The webhook body is not a HEY delivery.');
  }
  if (record.type === 'ping' ? typeof record.subscriptionId !== 'string' : typeof record.event !== 'object' || record.event === null) {
    throw new HeyWebhookError('invalid_payload', 'The webhook body is not a HEY delivery.');
  }
  return body as HeyWebhookEvent;
}

/** Where you remember what you handled: a `Set`, or anything with `has`/`add` (Redis, a table). */
export type WebhookSeenStore = { has(id: string): boolean | Promise<boolean>; add(id: string): unknown };

/**
 * True when `id` was already handled; otherwise records it and returns false.
 * Pass `deliveryId` to ignore retries of one delivery; pass
 * `` `${event.id}#${event.revision}` `` to ignore the same revision however it arrived.
 */
export async function isReplay(id: string, seen: WebhookSeenStore): Promise<boolean> {
  if (await seen.has(id)) return true;
  await seen.add(id);
  return false;
}
