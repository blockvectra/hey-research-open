import { describe, expect, it } from 'vitest';

import { enabledFactories, factoryById, LAUNCH_FACTORIES } from './registry';

/**
 * The registry is data, and data drifts: a duplicated id would make two
 * factories share one sync-state row, a malformed topic would scan for
 * nothing forever, and a string index outside any plausible layout would
 * be a typo nobody notices until every launch arrives unnamed.
 */
describe('launch factory registry', () => {
  it('locks every factory to Robinhood Chain with a unique id and address', () => {
    const ids = LAUNCH_FACTORIES.map((factory) => factory.id);
    expect(new Set(ids).size).toBe(ids.length);

    // A factory that emits two creation events is two entries on one address;
    // the same event on the same address twice would double-count launches.
    const scans = LAUNCH_FACTORIES.map(
      (factory) => `${factory.factoryAddress.toLowerCase()}:${factory.eventTopic0}`,
    );
    expect(new Set(scans).size).toBe(scans.length);

    for (const factory of LAUNCH_FACTORIES) {
      expect(factory.chainId).toBe(4663);
      expect(factory.id).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(factory.factoryAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(factory.eventTopic0).toMatch(/^0x[0-9a-f]{64}$/);
      expect([1, 2, 3, 'data']).toContain(factory.tokenTopicIndex);
      if (factory.tokenTopicIndex === 'data') {
        expect(Number.isInteger(factory.tokenDataWord)).toBe(true);
      } else {
        expect(factory.tokenDataWord).toBeUndefined();
      }
      expect(factory.startBlock).toBeGreaterThanOrEqual(0);
      expect(factory.verification.length).toBeGreaterThan(40);
      expect(factory.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('uses a lowercase launchpad key the card can name', () => {
    for (const factory of LAUNCH_FACTORIES) {
      expect(factory.launchpad).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    // One key per launchpad, however many deployments it has.
    expect(LAUNCH_FACTORIES.filter((f) => f.launchpad === 'pons')).toHaveLength(5);
    expect(LAUNCH_FACTORIES.filter((f) => f.launchpad === 'robinlaunch').length).toBeGreaterThan(10);
    // hood.fun's main and community launchpads emit the same event and share one card name.
    expect(LAUNCH_FACTORIES.filter((f) => f.launchpad === 'hoodfun').map((f) => f.id)).toEqual(['HOODFUN', 'HOODFUN_COMMUNITY']);
    expect(factoryById('HOODFUN_COMMUNITY')?.eventTopic0).toBe(factoryById('HOODFUN')?.eventTopic0);
  });

  it('starts Flap at its first launch, not at the block the census happened to begin from', () => {
    // The first Flap launch is at block 4,227,932; 71,914 launches sit below the old 15M start.
    expect(factoryById('FLAP')?.startBlock).toBeLessThanOrEqual(4_227_932);
    expect(factoryById('FLAP')?.startBlock).toBeGreaterThan(4_000_000);
  });

  it('keeps event string indexes inside a plausible data layout', () => {
    for (const factory of LAUNCH_FACTORIES) {
      for (const word of Object.values(factory.eventStrings ?? {})) {
        expect(Number.isInteger(word)).toBe(true);
        expect(word).toBeGreaterThanOrEqual(0);
        expect(word).toBeLessThan(16);
      }
    }
  });

  it('still carries the five Pons deployments and the launchpads added on 2026-09-04', () => {
    for (const id of [
      'PONS_V2',
      'PONS_V2_EARLY',
      'PONS_V1',
      'PONS_V1_PUBLISHED',
      'PONS_V1_LEGACY',
      'POOLS_TRADE',
      'HOODFUN',
      'HOODFUN_COMMUNITY',
      'ROBINLAUNCH_V12',
      'PAIR_FUND',
      'CLANKER_V4',
      'BANKR',
      'EASYA_KICKSTART',
      'HOODIT',
      'ROBINPAD_FACTORY',
      'ROBINPAD_INSTANT',
      'FLAP',
    ]) {
      expect(factoryById(id)?.enabled, id).toBe(true);
    }
    expect(enabledFactories(4663).length).toBe(LAUNCH_FACTORIES.filter((f) => f.enabled).length);
    expect(enabledFactories(1)).toEqual([]);
  });

  it('reads the Pons V2 topic from the chain, not from the published declaration', () => {
    expect(factoryById('PONS_V2')?.eventTopic0).toBe(
      '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',
    );
  });
});
