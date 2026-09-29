import { ROBINHOOD_QUOTE_ASSETS } from '../adapters/bitquery-days';
import type { ScannableFactory } from './indexer';

/**
 * DEX pool factories (coverage audit, 2026-09-30).
 *
 * A launchpad records what it launched; a DEX factory records every token
 * somebody gave a market. HEY read launchpads and the aggregators' pool lists,
 * and nothing that asked the chain which pools exist. The census on
 * 2026-09-30 over the whole chain (blocks 0 to 75.95M):
 *
 * - Uniswap V2 factory `0x8bce…937f`: 73,709 `PairCreated` logs, 73,435
 *   distinct tokens, 15,071 of them not held by HEY in any table;
 * - Uniswap V3 factory `0x1f7d…2efa`: 437,791 `PoolCreated` logs, 435,070
 *   distinct tokens, 91,225 of them not held by HEY;
 * - 106,121 distinct tokens across the two — a token with a pool, however it
 *   was deployed, including the directly deployed projects no launchpad saw.
 *
 * These are not launchpads and never carry a `launchpad` key: a pool is where
 * a token trades, not where it was launched, and a launch record keeps its
 * own provenance (`SOURCE_RANK` puts these below every launch source). Both
 * sides of a pool are tokens; the chain's quote assets are skipped.
 */
export type DexPoolFactoryConfig = ScannableFactory & {
  name: string;
  /** Venue key, for provenance only. */
  venue: 'uniswap-v2' | 'uniswap-v3';
  startBlock: number;
  enabled: boolean;
  /** How the address and event were confirmed. */
  verification: string;
  sourceUrl: string;
};

/** Quote assets a pool pairs against: never "a token with a pool". */
export const DEX_POOL_SKIP_TOKENS: readonly string[] = [...ROBINHOOD_QUOTE_ASSETS];

export const DEX_POOL_FACTORIES: readonly DexPoolFactoryConfig[] = [
  {
    id: 'UNISWAP_V2_PAIRS',
    name: 'Uniswap V2 pairs',
    venue: 'uniswap-v2',
    chainId: 4663,
    factoryAddress: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',
    startBlock: 9_000,
    // PairCreated(address indexed token0, address indexed token1, address pair, uint256)
    eventTopic0: '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9',
    tokenTopicIndex: 1,
    pairTokenTopics: [1, 2],
    skipTokens: DEX_POOL_SKIP_TOKENS,
    enabled: true,
    verification:
      'factory() of the deepest Robinhood Chain pools HEY tracks (token_pool_venue_days) answers this address; allPairsLength() 73,726 and allPairs(0) is 0x4b26f2f3…064f whose symbol() is "UNI-V2"; its first PairCreated log (block 9,486, tx 0x5c76f72e…) pairs WETH 0x0bd7…ad73 with 0x0d6b…5688; census 2026-09-30: 73,709 logs, 73,435 distinct tokens; the log is saved as fixtures/dex-pair-created.json',
    sourceUrl: 'https://docs.uniswap.org/contracts/v2/reference/smart-contracts/factory',
  },
  {
    id: 'UNISWAP_V3_POOLS',
    name: 'Uniswap V3 pools',
    venue: 'uniswap-v3',
    chainId: 4663,
    factoryAddress: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
    startBlock: 9_000,
    // PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
    eventTopic0: '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
    tokenTopicIndex: 1,
    pairTokenTopics: [1, 2],
    skipTokens: DEX_POOL_SKIP_TOKENS,
    enabled: true,
    verification:
      'factory() of 23 of the 40 deepest Robinhood Chain pools HEY tracks answers this address, and the Pons V1 launch event names it as its dexFactory (topics[3]); feeAmountTickSpacing(3000) = 60, the Uniswap V3 schedule; census 2026-09-30: 437,791 PoolCreated logs from block 9,490, 435,070 distinct tokens; a log is saved as fixtures/dex-pool-created.json',
    sourceUrl: 'https://docs.uniswap.org/contracts/v3/reference/core/UniswapV3Factory',
  },
];

export const enabledDexPoolFactories = (chainId: number): DexPoolFactoryConfig[] =>
  DEX_POOL_FACTORIES.filter((factory) => factory.enabled && factory.chainId === chainId);

export const dexPoolFactoryById = (id: string): DexPoolFactoryConfig | undefined =>
  DEX_POOL_FACTORIES.find((factory) => factory.id === id);

/** Whether a discovery value names a DEX pool factory rather than a launch. */
export const isDexPoolDiscovery = (value: string | null | undefined): boolean =>
  typeof value === 'string' && DEX_POOL_FACTORIES.some((factory) => factory.id === value);
