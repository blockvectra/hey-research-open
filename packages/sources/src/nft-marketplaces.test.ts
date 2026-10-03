import { describe, expect, it } from 'vitest';

import { normalizeBitqueryTradedTokens, normalizeBitqueryTrades } from './adapters/bitquery';
import { isNftMarketplaceVenue } from './nft-marketplaces';

const PIGGY = '0xf39d4c50a08e0fdafc51d37fc92bd2c25191da6a';
const HEY = '0xb33eb16782776b4d738c0fd643577cb0284db610';

describe('NFT marketplaces are never a DEX (2026-10-03, full audit)', () => {
  it('names the marketplaces, in the shapes providers write them', () => {
    for (const name of ['seaport_v1.4', 'Seaport V1.4', 'seaport', 'OpenSea', 'blur_marketplace', 'looksrare_v2', 'sudoswap', 'magic_eden']) {
      expect(isNftMarketplaceVenue(name)).toBe(true);
    }
    expect(isNftMarketplaceVenue('uniswap_v4', 'Seaport')).toBe(true);
  });

  it('leaves DEXs and unknowns alone', () => {
    for (const name of ['uniswap_v4', 'uniswap_v3', 'pons', 'ponsswap', 'clanker', 'virtuals', 'hoodfun', 'elementswap', undefined, null, '']) {
      expect(isNftMarketplaceVenue(name)).toBe(false);
    }
  });

  it('drops Seaport fills from the trade reading, so an NFT collection gets no price', () => {
    const rows = [
      {
        Trade: { Currency: { SmartContract: PIGGY, Symbol: 'PIGGY', Name: 'Piggy Banks', Decimals: 0 }, Dex: { ProtocolName: 'seaport_v1.4', ProtocolFamily: 'Seaport' }, last_price: 20.62 },
        Block: { last_time: '2026-10-03T06:00:00Z' },
        trades: 3,
        volume_usd: 221.44,
        week_trades: 9,
      },
      {
        Trade: { Currency: { SmartContract: HEY, Symbol: 'HEY', Name: 'Hey', Decimals: 18 }, Dex: { ProtocolName: 'uniswap_v4', ProtocolFamily: 'Uniswap' }, last_price: 0.001 },
        Block: { last_time: '2026-10-03T06:00:00Z' },
        trades: 40,
        volume_usd: 5_000,
        week_trades: 300,
      },
    ];
    const readings = normalizeBitqueryTrades(rows);
    expect(readings.map((reading) => reading.contractAddress)).toEqual([HEY]);
  });

  it('never discovers a collection from its marketplace sales', () => {
    const rows = [
      { Trade: { Currency: { SmartContract: PIGGY, Symbol: 'PIGGY', Decimals: 0 }, Dex: { ProtocolName: 'seaport_v1.4', ProtocolFamily: 'Seaport' } }, trades: 30, volume_usd: 900, traders: 25 },
      { Trade: { Currency: { SmartContract: HEY, Symbol: 'HEY', Decimals: 18 }, Dex: { ProtocolName: 'uniswap_v4', ProtocolFamily: 'Uniswap' } }, trades: 40, volume_usd: 5_000, traders: 30 },
    ];
    expect(normalizeBitqueryTradedTokens(rows).map((token) => token.contractAddress)).toEqual([HEY]);
  });
});
