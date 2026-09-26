import { describe, expect, it } from 'vitest';

import { HeyWebhookError, isReplay, parseSignatureHeader, parseWebhookEvent, timingSafeEqualHex, verifyWebhookSignature } from './webhooks';

/**
 * Webhook verification (2026-09-26). The vectors were computed outside this
 * code, with Python's `hmac.new(secret, f"{t}.{body}", sha256).hexdigest()`,
 * so the test is not the implementation checking itself.
 */
const SECRET = 'whsec_test_secret';
const OLD = 'whsec_old_secret';
const T = 1790409600;
const EVENT = '{"type":"build.release","payloadVersion":1,"deliveryId":"d1","sentAt":"2026-09-26T12:00:00.000Z","event":{"id":"ship:x","revision":1,"op":"upsert"}}';
const PING = '{"type":"ping","payloadVersion":1,"deliveryId":"d2","sentAt":"2026-09-26T12:00:00.000Z","subscriptionId":"s1"}';
const SIG = {
  event: 'd91abc70f3f74bc4a9ff9300cea3e9d00d93246695a1aa1a89735b238f7b1e1e',
  eventOld: '443899f2259abb9cadf2f5e47c601d63266f6c552d8ddb6ecf00d85cbea8d863',
  ping: '8519376e9e57776b6efc94ea1da3148604384fa68fd7376f059ebbd05904d57a',
  pingBare: '13d2170b76441ef8d28d02c5546a5322d498d1252dd3a1ceadefb9de967df1e8',
};
const at = (seconds: number) => new Date(seconds * 1000);

describe('verifyWebhookSignature', () => {
  it('accepts a known vector, as a string or as bytes', async () => {
    expect(await verifyWebhookSignature({ rawBody: '{"type":"ping"}', header: `t=${T},v1=${SIG.pingBare}`, secret: SECRET, now: at(T) })).toEqual({ ok: true, timestamp: T });
    expect(await verifyWebhookSignature({ rawBody: new TextEncoder().encode(EVENT), header: `t=${T},v1=${SIG.event}`, secret: SECRET, now: at(T) })).toEqual({ ok: true, timestamp: T });
  });

  it('refuses a tampered body, the wrong secret, and a signature for another timestamp', async () => {
    expect(await verifyWebhookSignature({ rawBody: EVENT.replace('ship:x', 'ship:y'), header: `t=${T},v1=${SIG.event}`, secret: SECRET, now: at(T) })).toEqual({ ok: false, reason: 'signature_mismatch' });
    expect(await verifyWebhookSignature({ rawBody: EVENT, header: `t=${T},v1=${SIG.event}`, secret: 'whsec_other', now: at(T) })).toEqual({ ok: false, reason: 'signature_mismatch' });
    // Moving the timestamp to dodge the window breaks the signature: t is inside what is signed.
    expect(await verifyWebhookSignature({ rawBody: EVENT, header: `t=${T + 100},v1=${SIG.event}`, secret: SECRET, now: at(T + 100) })).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('holds the timestamp to the tolerance, either way: a replay outside it is refused', async () => {
    const check = (now: number, toleranceSeconds?: number) =>
      verifyWebhookSignature({ rawBody: EVENT, header: `t=${T},v1=${SIG.event}`, secret: SECRET, now: at(now), ...(toleranceSeconds === undefined ? {} : { toleranceSeconds }) });
    expect((await check(T + 300)).ok).toBe(true);
    expect(await check(T + 301)).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
    expect(await check(T - 301)).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
    expect((await check(T + 3_600, 3_600)).ok).toBe(true);
  });

  it('accepts either signature during a rotation, and either of the receiver\'s own secrets', async () => {
    const header = `t=${T},v1=${SIG.event},v1=${SIG.eventOld}`;
    expect((await verifyWebhookSignature({ rawBody: EVENT, header, secret: SECRET, now: at(T) })).ok).toBe(true);
    expect((await verifyWebhookSignature({ rawBody: EVENT, header, secret: OLD, now: at(T) })).ok).toBe(true);
    expect((await verifyWebhookSignature({ rawBody: EVENT, header: `t=${T},v1=${SIG.eventOld}`, secret: ['whsec_new_unknown', OLD], now: at(T) })).ok).toBe(true);
  });

  it('says why it refused a missing or malformed header, or no secret', async () => {
    expect(await verifyWebhookSignature({ rawBody: EVENT, header: null, secret: SECRET })).toEqual({ ok: false, reason: 'missing_header' });
    for (const header of ['v1=abc', `t=${T}`, `t=abc,v1=${SIG.event}`, `t=${T},v1=${SIG.event.slice(1)}`, 'garbage']) {
      expect(await verifyWebhookSignature({ rawBody: EVENT, header, secret: SECRET, now: at(T) }), header).toEqual({ ok: false, reason: 'malformed_header' });
    }
    expect(await verifyWebhookSignature({ rawBody: EVENT, header: `t=${T},v1=${SIG.event}`, secret: '' })).toEqual({ ok: false, reason: 'no_secret' });
  });

  it('ignores signature schemes it does not know, for a later version', () => {
    expect(parseSignatureHeader(`t=${T},v2=zzz,v1=${SIG.event}`)).toEqual({ timestamp: T, signatures: [SIG.event] });
  });
});

describe('timingSafeEqualHex', () => {
  it('compares in full and refuses different lengths', () => {
    expect(timingSafeEqualHex(SIG.event, SIG.event)).toBe(true);
    expect(timingSafeEqualHex(SIG.event, `${SIG.event.slice(0, 63)}0`)).toBe(false);
    expect(timingSafeEqualHex(SIG.event, `0${SIG.event.slice(1)}`)).toBe(false);
    expect(timingSafeEqualHex(SIG.event, SIG.event.slice(1))).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('returns the typed delivery once it verifies', async () => {
    const event = await parseWebhookEvent({ rawBody: PING, header: `t=${T},v1=${SIG.ping}`, secret: SECRET, now: at(T) });
    expect(event).toEqual({ type: 'ping', payloadVersion: 1, deliveryId: 'd2', sentAt: '2026-09-26T12:00:00.000Z', subscriptionId: 's1' });
    const release = await parseWebhookEvent({ rawBody: EVENT, header: `t=${T},v1=${SIG.event}`, secret: SECRET, now: at(T) });
    expect(release.type === 'build.release' && release.event.id).toBe('ship:x');
  });

  it('throws with the reason for a bad signature', async () => {
    await expect(parseWebhookEvent({ rawBody: PING, header: `t=${T},v1=${SIG.event}`, secret: SECRET, now: at(T) })).rejects.toMatchObject({ name: 'HeyWebhookError', reason: 'signature_mismatch' });
    await expect(parseWebhookEvent({ rawBody: PING, header: `t=${T},v1=${SIG.ping}`, secret: SECRET, now: at(T + 1_000) })).rejects.toBeInstanceOf(HeyWebhookError);
  });
});

describe('isReplay', () => {
  it('records the first sight and reports every repeat', async () => {
    const seen = new Set<string>();
    expect(await isReplay('d1', seen)).toBe(false);
    expect(await isReplay('d1', seen)).toBe(true);
    expect(await isReplay('ship:x#2', seen)).toBe(false);
    const asyncStore = { ids: new Set<string>(), has: async (id: string) => asyncStore.ids.has(id), add: async (id: string) => asyncStore.ids.add(id) };
    expect(await isReplay('d9', asyncStore)).toBe(false);
    expect(await isReplay('d9', asyncStore)).toBe(true);
  });
});
