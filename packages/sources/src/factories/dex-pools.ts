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
 *
 * Since 2026-09-30 the same list carries every *unlabelled intake* — a chain
 * record that proves a token exists without saying which launchpad made it:
 * the Uniswap v4 PoolManager and Doppler's Airlock. Each writes only tokens
 * HEY holds nowhere, carries no launchpad key, and yields to any launch
 * record of the same token.
 */
export type DexPoolFactoryConfig = ScannableFactory & {
  name: string;
  /** Venue or protocol key, for provenance only: never a launchpad label. */
  venue: 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4' | 'doppler';
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
  /**
   * Uniswap v4 (2026-09-30, coordinator under founder delegation): v4 has no
   * factory, every pool is an `Initialize` on the singleton PoolManager. Both
   * currencies are indexed (`topics[2]`, `topics[3]`; `topics[1]` is the pool
   * id); native ETH is the zero address and is skipped with the other quote
   * assets. About a third of the tokens in new v4 pools were unknown to HEY in
   * a sample of 40 windows — launches from frontends HEY has no factory for.
   */
  {
    id: 'UNISWAP_V4_POOLS',
    name: 'Uniswap v4 pools',
    venue: 'uniswap-v4',
    chainId: 4663,
    factoryAddress: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    startBlock: 9_000,
    // Initialize(PoolId indexed id, Currency indexed currency0, Currency indexed currency1, uint24 fee, int24 tickSpacing, IHooks hooks, uint160 sqrtPriceX96, int24 tick)
    eventTopic0: '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438',
    tokenTopicIndex: 2,
    pairTokenTopics: [2, 3],
    // The hook (2026-10-01): data words are fee, tickSpacing, hooks, sqrtPriceX96, tick.
    hookDataWord: 2,
    skipTokens: DEX_POOL_SKIP_TOKENS,
    enabled: true,
    verification:
      'Uniswap/docs content/protocols/v4/deployments.mdx lists this address as the Robinhood Chain (4663) PoolManager; 24,009 bytes of code; its first Initialize log is at block 9,505 (tx 0x9ac26a1d…), pairing WETH (topics[2]) with SMK4 (0x42bcdf8d…, topics[3]); read 2026-09-30; the log is saved as fixtures/dex-v4-initialize.json',
    sourceUrl: 'https://developers.uniswap.org/contracts/v4/deployments',
  },
  /**
   * Doppler's Airlock (2026-09-30, coordinator under founder delegation): the
   * launch *protocol* behind Long.xyz, Bankr and other frontends, many of
   * them reached through ERC-4337 EntryPoints with no nameable frontend. It is
   * read as an unlabelled intake, exactly like a pool factory, never as a
   * launchpad: it writes only tokens HEY holds nowhere, never a launchpad
   * key, and a real launchpad's record of the same token takes the row over
   * (`CandidateService.upsert`, launch over pool) — so a Long.xyz launch stays
   * Long.xyz, whichever scan reads it first. `Create(address asset, address
   * indexed numeraire, address initializer, address poolOrHook)`: the token is
   * data word 0; the indexed numeraire is the quote side and is never read.
   */
  {
    id: 'DOPPLER_AIRLOCK',
    name: 'Doppler Airlock',
    venue: 'doppler',
    chainId: 4663,
    factoryAddress: '0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862',
    startBlock: 730_000,
    eventTopic0: '0x68ff1cfcdcf76864161555fc0de1878d8f83ec6949bf351df74d8a4a1a2679ab',
    tokenTopicIndex: 'data',
    tokenDataWord: 0,
    /*
     * The v4 hook the launch used (2026-10-01): Airlock.sol emits
     * `Create(asset, numeraire, address(poolInitializer), pool)`, so word 1 is
     * the initializer and word 2 what it returned. See `decodeLaunchHookClaim`.
     */
    launchHook: { protocol: 'doppler', assetWord: 0, initializerWord: 1, poolOrHookWord: 2 },
    skipTokens: DEX_POOL_SKIP_TOKENS,
    enabled: true,
    verification:
      'docs.doppler.lol/reference/contract-addresses lists this address as the Airlock on Robinhood Chain; 5,695 bytes of code; its first Create log is at block 734,616 (tx 0x8d32b9dd…) with the token test (0xa61b14c2…) in data word 0, which answers symbol(); nothing in the 100,000 blocks before; 187,183 Create logs, 152,191 tokens not in HEY (census 2026-09-30); the log is saved as fixtures/doppler-airlock-create.json',
    sourceUrl: 'https://docs.doppler.lol/reference/contract-addresses',
  },
];

export const enabledDexPoolFactories = (chainId: number): DexPoolFactoryConfig[] =>
  DEX_POOL_FACTORIES.filter((factory) => factory.enabled && factory.chainId === chainId);

export const dexPoolFactoryById = (id: string): DexPoolFactoryConfig | undefined =>
  DEX_POOL_FACTORIES.find((factory) => factory.id === id);

/** Whether a discovery value names a DEX pool factory rather than a launch. */
export const isDexPoolDiscovery = (value: string | null | undefined): boolean =>
  typeof value === 'string' && DEX_POOL_FACTORIES.some((factory) => factory.id === value);
