import { describe, expect, it } from 'vitest';

import { curveMarketCapNative, padAddress } from './hoodfun-curve';

/**
 * Pricing a token no aggregator can see (2026-09-05).
 *
 * The arithmetic here decides what a card prints, so the cases that matter are
 * the ones where a wrong number is worse than none: a token the curve has not
 * priced, and a price so small that a careless conversion rounds it to zero.
 */
describe('curveMarketCapNative', () => {
  it('multiplies the launchpad price by the token supply', () => {
    // robinbull-inu, read from the chain on 2026-09-05: 100M tokens at
    // 24,541,484,716 wei each — 2.454 ETH, about $6,034 at $2,458.92.
    const supply = 100_000_000n * 10n ** 18n;
    const price = 24_541_484_716n;

    const native = curveMarketCapNative(supply, price);
    expect(native).toBeCloseTo(2.4541, 3);
  });

  it('refuses to call an unpriced token worth zero', () => {
    const supply = 100_000_000n * 10n ** 18n;
    // A curve that has not traded reports no price; that is unknown, not zero.
    expect(curveMarketCapNative(supply, 0n)).toBeUndefined();
    expect(curveMarketCapNative(0n, 24_541_484_716n)).toBeUndefined();
  });

  it('keeps a very small price from rounding away', () => {
    // A token barely off its seed price still has a real, tiny valuation.
    const native = curveMarketCapNative(1_000_000_000n * 10n ** 18n, 1_000n);
    expect(native).toBeGreaterThan(0);
  });

  it('pads an address to a 32-byte argument, lowercased', () => {
    expect(padAddress('0xE62bEafF79E79EEf9F08f7fD47FEB6b96A04600D')).toBe(
      '000000000000000000000000e62beaff79e79eef9f08f7fd47feb6b96a04600d',
    );
    expect(padAddress('0xE62bEafF79E79EEf9F08f7fD47FEB6b96A04600D')).toHaveLength(64);
  });
});
