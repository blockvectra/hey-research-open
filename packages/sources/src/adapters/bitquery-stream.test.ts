import { describe, expect, it } from 'vitest';

import { readFixture } from '../testing';
import {
  bitqueryStreamUrl,
  bitqueryTriggerSubscription,
  CHAIN_TRIGGER_SOURCES,
  classifyStreamError,
  connectionInitMessage,
  isTriggerRelevant,
  normalizeTopicHash,
  parseStreamMessage,
  startMessage,
} from './bitquery-stream';

const frames = JSON.parse(readFixture('bitquery-stream-messages.json')) as Record<string, unknown>;
const frame = (name: string) => JSON.stringify(frames[name]);

const FACTORY = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const HOODLOCK_ADDRESS = '0xd0f7d8c6e9f6d80c297bebe4f7fd1b9c8125c32f';

describe('the Bitquery trigger stream (2026-10-16)', () => {
  it('watches exactly the registry’s Pons V2 factory and v4 PoolManager', () => {
    expect(CHAIN_TRIGGER_SOURCES.map((source) => [source.kind, source.sourceId, source.address])).toEqual([
      ['pons_factory', 'PONS_V2', FACTORY],
      ['v4_initialize', 'UNISWAP_V4_POOLS', POOL_MANAGER],
      ['hoodlock', 'HOODLOCK', HOODLOCK_ADDRESS],
    ]);
    // Every HoodLock log is a trigger: the sweep re-reads the locker's state.
    expect(CHAIN_TRIGGER_SOURCES[2]!.topics).toEqual([]);
    // The launch topic and the three lifecycle topics; Initialize for the PoolManager.
    expect(CHAIN_TRIGGER_SOURCES[0]!.topics).toHaveLength(4);
    expect(CHAIN_TRIGGER_SOURCES[1]!.topics).toEqual(['0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438']);
  });

  it('subscribes once, to one Events cube, with an any: OR and no argument or account field', () => {
    const document = bitqueryTriggerSubscription();
    expect(document).toContain(`{ Log: { SmartContract: { is: "${HOODLOCK_ADDRESS}" } } }`);
    // Upgraded on any contract, by the decoded name the upgrade adapter already filters on; never BeaconUpgraded.
    expect(document).toContain('{ Log: { Signature: { Name: { is: "Upgraded" } } } }');
    expect(document).not.toContain('BeaconUpgraded');
    expect(document.match(/\{ Log: \{/g)).toHaveLength(4);
    expect(document.match(/subscription/g)).toHaveLength(1);
    expect(document.match(/Events\(/g)).toHaveLength(1);
    expect(document).toContain('EVM(network: robinhood)');
    expect(document).toContain(`{ Log: { SmartContract: { is: "${FACTORY}" } } }`);
    expect(document).toContain(`{ Log: { SmartContract: { is: "${POOL_MANAGER}" }, Signature: { Name: { is: "Initialize" } } } }`);
    expect(document).toMatch(/any: \[/);
    expect(document).not.toMatch(/Arguments|Sender|From|To\b|Receiver|Owner|Balance/);
    expect(document).toContain('Log { Index SmartContract Signature { Name SignatureHash } }');
  });

  it('speaks the legacy graphql-ws messages and keeps the key in the URL only', () => {
    expect(JSON.parse(connectionInitMessage())).toEqual({ type: 'connection_init', payload: {} });
    const start = JSON.parse(startMessage()) as { id: string; type: string; payload: { query: string } };
    expect(start).toMatchObject({ id: '1', type: 'start' });
    expect(start.payload.query).toBe(bitqueryTriggerSubscription());
    expect(bitqueryStreamUrl('ory_at_a/b')).toBe('wss://streaming.bitquery.io/graphql?token=ory_at_a%2Fb');
  });

  it('parses ack, keepalive and complete frames, and calls anything else invalid', () => {
    expect(parseStreamMessage(frame('ack'))).toEqual({ kind: 'ack' });
    expect(parseStreamMessage(frame('ka'))).toEqual({ kind: 'ka' });
    expect(parseStreamMessage(frame('complete'))).toEqual({ kind: 'complete' });
    expect(parseStreamMessage('not json')).toEqual({ kind: 'invalid' });
    expect(parseStreamMessage(JSON.stringify({ type: 'next', payload: {} }))).toEqual({ kind: 'invalid' });
  });

  it('turns a data frame into positions only, dropping rows it cannot point the RPC at', () => {
    const message = parseStreamMessage(frame('data'));
    expect(message.kind).toBe('data');
    if (message.kind !== 'data') return;
    // The malformed transaction and the contract HEY does not watch are dropped, not patched.
    expect(message.dropped).toBe(2);
    expect(message.events.map((event) => [event.kind, event.blockNumber, event.logIndex, event.signatureHash?.slice(0, 10) ?? null])).toEqual([
      ['pons_factory', 89_310_412, 3, '0x8d4aad49'],
      ['pons_factory', 89_310_415, 7, '0x22222222'],
      ['v4_initialize', 89_310_420, 0, '0xdd466e67'],
      ['pons_factory', 89_310_421, 1, null],
    ]);
    expect(message.events[0]).toMatchObject({
      contract: FACTORY,
      txHash: '0x5a0f3d1e2c4b6a798877665544332211ffeeddccbbaa99887766554433221100',
      blockTime: new Date('2026-10-16T08:12:03Z'),
      signatureName: null,
    });
    expect(message.events[2]!.contract).toBe(POOL_MANAGER);
    // A launch and an Initialize are triggers; a curve trade is not; a row with no topic stays one (unknown is not irrelevant).
    expect(message.events.map(isTriggerRelevant)).toEqual([true, false, true, true]);
  });

  it('reads HoodLock logs and Upgraded on any contract, and drops topics HEY does not decode', () => {
    const message = parseStreamMessage(frame('dataMore'));
    expect(message.kind).toBe('data');
    if (message.kind !== 'data') return;
    expect(message.events.map((event) => [event.kind, event.contract.slice(0, 12), isTriggerRelevant(event)])).toEqual([
      ['hoodlock', HOODLOCK_ADDRESS.slice(0, 12), true],
      // The watched-contract filter is the caller's; both carry the EIP-1967 topic (with or without 0x).
      ['upgrade', '0x9d2ed15300', true],
      ['upgrade', '0x0000000000', true],
      // An event named Upgraded with another topic is not the EIP-1967 one.
      ['upgrade', '0x0000000000', false],
      // A Pons factory event HEY does not decode (`0x308c390e…`) is no trigger.
      ['pons_factory', FACTORY.slice(0, 12), false],
    ]);
  });

  it('reads topic hashes with or without 0x, and nothing else', () => {
    expect(normalizeTopicHash('DD466E674EA557F56295E2D0218A125EA4B4F0F6F3307B95F85E6110838D6438')).toBe('0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438');
    expect(normalizeTopicHash('0x1234')).toBeNull();
    expect(normalizeTopicHash(undefined)).toBeNull();
  });

  it('keeps the errors a frame carries, redacting a token, and classifies them', () => {
    const withErrors = parseStreamMessage(frame('dataWithErrors'));
    expect(withErrors).toEqual({ kind: 'data', events: [], dropped: 0, errors: ['Streaming time limit exceeded for your plan'] });
    const error = parseStreamMessage(frame('error'));
    expect(error.kind).toBe('error');
    const refused = parseStreamMessage(frame('connectionError'));
    expect(refused).toEqual({ kind: 'connection_error', message: 'Unauthorized: invalid token [redacted]' });

    expect(classifyStreamError('Streaming time limit exceeded for your plan')).toBe('auth');
    expect(classifyStreamError('Unauthorized')).toBe('auth');
    expect(classifyStreamError(error.kind === 'error' ? error.message : '')).toBe('document');
    expect(classifyStreamError('internal server error, try again')).toBe('transient');
    expect(classifyStreamError('read timeout exceeded')).toBe('transient');
    expect(classifyStreamError('an explanation of the outage')).toBe('transient');
  });
});
