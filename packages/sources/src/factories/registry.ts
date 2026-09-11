/**
 * Launch factory registry (Discovery Coverage V2 §12).
 *
 * Every on-chain launch source HEY indexes is declared here and nowhere else.
 * Scattering factory addresses through adapters is how a chain-locked product
 * ends up indexing the wrong chain: one stale constant in one service and the
 * mistake is invisible.
 *
 * **Only verified addresses belong here.** Each entry records how it was
 * confirmed, and every address below was checked against chain 4663 — the
 * contract exists, its logs decode to a token this chain actually holds, and
 * the event topic was read from a live log rather than computed from a source
 * declaration (the Pons V2 registry once carried a computed topic that did not
 * match the deployed bytecode).
 */
export type LaunchEventStrings = {
  /**
   * Word index (32-byte slot) in the event data that holds the offset of the
   * dynamic string. Read from a decoded live log, never from an ABI alone.
   */
  name?: number;
  symbol?: number;
  metadataUri?: number;
  imageUri?: number;
};

export type LaunchFactoryConfig = {
  id: string;
  name: string;
  /** Candidate `launchpad` key; the card looks the display name up by it. */
  launchpad: string;
  version?: string;
  chainId: number;
  factoryAddress: `0x${string}`;
  /**
   * Where scanning starts. Robinhood Chain produces ~880k blocks/day, so a
   * genesis-first rescan every run is thousands of wasted requests; sync state
   * persists the resume point separately.
   */
  startBlock: number;
  /** `topics[0]` of the launch event. */
  eventTopic0: `0x${string}`;
  /**
   * Which indexed topic carries the token address, or `'data'` when the event
   * does not index it and it sits in a data word instead (Flap). Verified
   * empirically by reading the contract at that address and confirming it
   * answers `symbol()`.
   */
  tokenTopicIndex: 1 | 2 | 3 | 'data';
  /** Word index of the token address in the data when `tokenTopicIndex` is `'data'`. */
  tokenDataWord?: number;
  /** Creator-supplied strings the event carries, when it carries any. */
  eventStrings?: LaunchEventStrings;
  enabled: boolean;
  /** How the address and event were confirmed. */
  verification: string;
  sourceUrl: string;
};

/**
 * Pons launch events.
 *
 * Re-verified 2026-09-03 against chain 4663 and the ponsfamily.com frontend
 * bundle, which ships its own deployment list. Two generations, two event
 * signatures:
 *
 * - V1 `TokenLaunched(address indexed token, address indexed deployer, address
 *   indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256
 *   launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256
 *   initialBuyAmount)` → topic `0xdb51ea9a…`, token in `topics[1]`.
 * - V2 launch event → topic `0x8d4aad49…`, three indexed fields, token in
 *   `topics[1]`. Read from live logs; the published declaration hashes to a
 *   different value (see the constant below).
 *
 * The earlier registry looked for the wrong topic on the published V1 address
 * and concluded it emitted no launch event, and pointed V2 at a superseded
 * deployment; the factory that carries essentially all current launches
 * (`0x7eD598…`, roughly forty launches per thousand blocks) was not indexed
 * at all.
 */
const PONS_V1_LAUNCH_TOPIC0 =
  '0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a' as const;
/**
 * Read from the chain, not computed from the published source: the deployed
 * factory's launch event hashes differently from the repository's
 * `TokenLaunched` declaration (the source is newer than the bytecode). It is
 * the event with three indexed fields whose `topics[1]` is a token that
 * answers `launchFactory()` with this factory — 127 of them in one 3,000-block
 * window on 2026-09-03.
 */
const PONS_V2_LAUNCH_TOPIC0 =
  '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607' as const;
/** The event an earlier V2 deployment emitted; kept for the history it holds. */
const PONS_V2_EARLY_LAUNCH_TOPIC0 =
  '0xbd886f85b7731f66269f57707414d435bf8df930d3357a10becc48a69377f6d5' as const;

/**
 * Robinlaunch (robinlaunch.fun) — bonding-curve memecoin launcher graduating
 * to Uniswap V3. Its bundle (`7274d007107e.js`, `ALL_FACTORY_VERSIONS` /
 * `ALL_DIRECT_FACTORY_VERSIONS`) lists every deployment; each was censused on
 * 2026-09-03 and only the ones that emitted a launch are enabled.
 *
 * - Bonding factories emit `TokenCreated(address indexed creator, address
 *   indexed token, address indexed curve, string name, string symbol, string
 *   metadataURI, uint256 index)` → topic `0x463df9e0…`, token in `topics[2]`,
 *   name/symbol/URI in data words 0/1/2.
 * - Direct-pool and boost factories emit `TokenLaunched(address indexed
 *   creator, address indexed token, address indexed pool, string name, string
 *   symbol, string metadataURI, uint256 index, uint256 initialEth, uint256
 *   tokenId)` → topic `0x88401197…`, same positions.
 * - Presale factories emit `PresaleCreated` with no token in the topics (the
 *   token exists only once a presale finalises) and are not indexed.
 */
const ROBINLAUNCH_CREATED_TOPIC0 =
  '0x463df9e040f1a9181ece2287496672134faffc6e35d4118f691d4280c8a68ee1' as const;
const ROBINLAUNCH_LAUNCHED_TOPIC0 =
  '0x8840119748b379f269aa727e75743406d8d9d5ea147b94d8f9a3dee251ff15eb' as const;
const ROBINLAUNCH_STRINGS: LaunchEventStrings = { name: 0, symbol: 1, metadataUri: 2 };
const ROBINLAUNCH_SOURCE = 'https://robinlaunch.fun/';

const robinlaunch = (
  entry: Pick<LaunchFactoryConfig, 'id' | 'version' | 'factoryAddress' | 'startBlock' | 'verification'> & {
    kind: 'bonding' | 'direct';
  },
): LaunchFactoryConfig => ({
  id: entry.id,
  name: 'Robinlaunch',
  launchpad: 'robinlaunch',
  ...(entry.version ? { version: entry.version } : {}),
  chainId: 4663,
  factoryAddress: entry.factoryAddress,
  startBlock: entry.startBlock,
  eventTopic0: entry.kind === 'bonding' ? ROBINLAUNCH_CREATED_TOPIC0 : ROBINLAUNCH_LAUNCHED_TOPIC0,
  tokenTopicIndex: 2,
  eventStrings: ROBINLAUNCH_STRINGS,
  enabled: true,
  verification: entry.verification,
  sourceUrl: ROBINLAUNCH_SOURCE,
});

/**
 * hood.fun's launch event, emitted by its main launchpad and by the
 * "community" launchpad the board's `launchpad` field names for two launches.
 * Read from live logs on 2026-09-03 (CLIMB) and 2026-09-05 (Robin, FEATHER).
 */
const HOODFUN_LAUNCH_TOPIC0 =
  '0x91de26bc430b3a4f1d6cfb11d72f2e5ca75d7622d37b2a88a8998ec28e747a11' as const;

/**
 * Flap's first launch is at block 4,227,932 (tx 0x4d662a37…, token
 * 0xd7b1a493…7777 answering name() "TestToken"), found on 2026-09-05 by an
 * `eth_getLogs` census walking back from 30M in 250k-block windows until one
 * was empty and forward again from genesis: no launch in 0–4.2M, one in the
 * 4.0–4.25M window, then a trickle to ~5.2M and ~1,800 per 250k blocks from
 * there. 71,914 launches sit between 5.19M and 15M — the range the earlier
 * 15M start never covered — and ~177,600 between 5.19M and 30M.
 */
const FLAP_START_BLOCK = 4_220_000;

export const LAUNCH_FACTORIES: readonly LaunchFactoryConfig[] = [
  {
    id: 'PONS_V2',
    name: 'Pons',
    launchpad: 'pons',
    version: 'V2',
    chainId: 4663,
    factoryAddress: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
    startBlock: 0,
    eventTopic0: PONS_V2_LAUNCH_TOPIC0,
    tokenTopicIndex: 1,
    enabled: true,
    verification:
      'ponsfamily.com bundle (getPonsV2BrowserFactoryAddress) and official README; 24,177 bytes on 4663; launch topic read from live logs (127 launches in 3,000 blocks on 2026-09-03), and their tokens answer launchFactory() with this address',
    sourceUrl: 'https://github.com/ponsdotdev/ponsfamily',
  },
  {
    id: 'PONS_V2_EARLY',
    name: 'Pons',
    launchpad: 'pons',
    version: 'V2',
    chainId: 4663,
    factoryAddress: '0x7E1EAbd52Ae29598e6483F72dCf1a70b14284dB8',
    startBlock: 0,
    eventTopic0: PONS_V2_EARLY_LAUNCH_TOPIC0,
    tokenTopicIndex: 1,
    enabled: true,
    verification:
      'earlier V2 deployment listed in the ponsfamily.com bundle; 22,757 bytes; topics[1] of a sample event answered symbol() as RYAN; no launches after 2026-09',
    sourceUrl: 'https://github.com/ponsdotdev/ponsfamily',
  },
  {
    id: 'PONS_V1',
    name: 'Pons',
    launchpad: 'pons',
    version: 'V1',
    chainId: 4663,
    factoryAddress: '0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75',
    startBlock: 0,
    eventTopic0: PONS_V1_LAUNCH_TOPIC0,
    tokenTopicIndex: 1,
    enabled: true,
    verification:
      'the V1 factory the ponsfamily.com v1 tab launches through (bundle: getPonsV15LaunchpadDeployment); EIP-1967 proxy, launchEnabled() true; launched tokens answer launchFactory() with this address',
    sourceUrl: 'https://ponsfamily.com/launchpad/create',
  },
  {
    id: 'PONS_V1_PUBLISHED',
    name: 'Pons',
    launchpad: 'pons',
    version: 'V1',
    chainId: 4663,
    factoryAddress: '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB',
    startBlock: 0,
    eventTopic0: PONS_V1_LAUNCH_TOPIC0,
    tokenTopicIndex: 1,
    enabled: true,
    verification:
      'the V1 address in the official repository; 24,353 bytes; launchEnabled() false since 2026-08; TokenLaunched logs around block 34.79M decode to ERC-20s (TOAD) whose position NFT the locker owns',
    sourceUrl: 'https://github.com/ponsdotdev/ponsfamily',
  },
  {
    id: 'PONS_V1_LEGACY',
    name: 'Pons',
    launchpad: 'pons',
    version: 'V1',
    chainId: 4663,
    factoryAddress: '0x0c37a24F5D23A486FA692d1500881d698B1F77a4',
    startBlock: 0,
    eventTopic0: PONS_V1_LAUNCH_TOPIC0,
    tokenTopicIndex: 1,
    enabled: true,
    verification:
      'legacy V1 factory in the ponsfamily.com bundle; 24,192 bytes; the $PONS token itself answers getLaunchedToken() here',
    sourceUrl: 'https://github.com/ponsdotdev/ponsfamily',
  },

  /* ------------------------------------------------------------ 2026-09-04 */

  /**
   * Pools (pools.trade) — Uniswap Labs' Robinhood Chain launchpad. Every launch
   * goes through one `LiquidityLauncher`, whichever strategy (instant launch or
   * a Continuous Clearing Auction) the creator picked, and the launcher emits a
   * one-topic event with the token address once the token is minted to it. The
   * event carries no name: identity comes from the token's own `name()` /
   * `symbol()` in a bounded pass.
   */
  {
    id: 'POOLS_TRADE',
    name: 'Pools',
    launchpad: 'poolstrade',
    chainId: 4663,
    factoryAddress: '0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0',
    startBlock: 28_520_000,
    eventTopic0: '0x2e2b3f61b70d2d131b2a807371103cc98d51adcaa5e9a8f9c32658ad8426e74e',
    tokenTopicIndex: 1,
    enabled: true,
    verification:
      'the LiquidityLauncher in the pools.trade bundle (assets/080771da48f7.js, the "full 4663 stack redeploy, current" strategies point at it); 4,127 bytes on 4663; launch tx 0x4a78f10a… mints TACOS (0x78c59d4c…) to it and it emits this topic with the token in topics[1]; 40,306 such logs from the first at block 28,520,117 to 40M and 10,382 from 40M to 53.1M on 2026-09-03; sampled topics[1] answer symbol() TACOS, UNIFROG, CTHUWU',
    sourceUrl: 'https://pools.trade/',
  },

  /**
   * hood.fun — fair-launch bonding curves. One launchpad contract emits the
   * launch event with the token in `topics[1]`, the creator in `topics[2]`, and
   * the name, ticker and an inline-JSON `metadataURI` (description, links,
   * sometimes a base64 image) in the data.
   */
  {
    id: 'HOODFUN',
    name: 'hood.fun',
    launchpad: 'hoodfun',
    chainId: 4663,
    factoryAddress: '0x8c529f0a77c07ce0e6796f153d292501ee6f66f6',
    startBlock: 6_150_000,
    eventTopic0: HOODFUN_LAUNCH_TOPIC0,
    tokenTopicIndex: 1,
    eventStrings: { name: 0, symbol: 1, metadataUri: 2 },
    enabled: true,
    verification:
      'LAUNCHPAD_ADDRESS in the hood.fun bundle (38b2c66fdda9.js); 23,208 bytes on 4663; the launch of CLIMB (block 52,848,167, tx 0x7005bca9…) emits this topic with the token in topics[1] and "Climb Net" / "CLIMB" / inline JSON in data words 0/1/2; hood.fun/api/board lists 352 launches through it (first at block 6,151,910) on 2026-09-03',
    sourceUrl: 'https://hood.fun/',
  },
  {
    id: 'HOODFUN_COMMUNITY',
    name: 'hood.fun',
    launchpad: 'hoodfun',
    version: 'community',
    chainId: 4663,
    factoryAddress: '0x5Fcc1DF0dC020CF454e742E9a8Ae2554C37A452C',
    startBlock: 6_150_000,
    eventTopic0: HOODFUN_LAUNCH_TOPIC0,
    tokenTopicIndex: 1,
    eventStrings: { name: 0, symbol: 1, metadataUri: 2 },
    enabled: true,
    verification:
      'the second launchpad hood.fun/api/board names (`launchpad` on its two community launches, isCommunity); 20,518 bytes on 4663; censused 2026-09-05 with eth_getLogs around each launch\'s createdAtBlock: block 6,151,910 (tx 0xc280d098…) and block 7,523,403 (tx 0xd015d2ef…) each emit the main launchpad\'s topic with the token in topics[1] and name / symbol / inline-JSON metadata in data words 0/1/2; the tokens answer symbol() "robin" (name "Robin", 0x67AF360b…) and "FEATHER" (0x72081aDC…); the FEATHER log is saved as fixtures/hoodfun-community-launch.json',
    sourceUrl: 'https://hood.fun/',
  },

  /* Robinlaunch bonding-curve factories, oldest first; each censused 2026-09-03. */
  robinlaunch({
    id: 'ROBINLAUNCH_V4',
    version: 'V4',
    kind: 'bonding',
    factoryAddress: '0x0889B4Cbbb5A8cA2A722734c147fD5A8d956D863',
    startBlock: 5_420_000,
    verification:
      'ALL_FACTORY_VERSIONS version 4 in the bundle; 14,287 bytes; 5 TokenCreated logs (blocks 5.42M–6.35M); the first names ROBINLAUNC (0xC3F6c203…), which the curve API also lists',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_V5',
    version: 'V5',
    kind: 'bonding',
    factoryAddress: '0x511CF20f3c794bDf95be18d93a0F1539919Ba8Fa',
    startBlock: 6_890_000,
    verification: 'version 5 in the bundle; 6 TokenCreated logs (6.90M–7.80M), e.g. CASHBACK',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_V6',
    version: 'V6',
    kind: 'bonding',
    factoryAddress: '0xB6eB41B28bd96461D9a97954920823a8b7042Af0',
    startBlock: 8_010_000,
    verification: 'version 6 in the bundle; 1 TokenCreated log (BANG, block 8,012,969)',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_V7',
    version: 'V7',
    kind: 'bonding',
    factoryAddress: '0xa4552a787ea97649568adcf82e258b714d8affd4',
    startBlock: 8_390_000,
    verification: 'version 7 in the bundle; 1 TokenCreated log (SIRIUS, block 8,393,442)',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_V8',
    version: 'V8',
    kind: 'bonding',
    factoryAddress: '0x108eB6D67c079bEb1EF328850a88c2BbDB4617ea',
    startBlock: 9_200_000,
    verification: 'version 8 in the bundle; 9 TokenCreated logs (9.20M–12.90M), e.g. SOONBRO',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_V9',
    version: 'V9',
    kind: 'bonding',
    factoryAddress: '0xaA9DcD9e246B710723eBE8D3ee947Ff04A29C3D1',
    startBlock: 14_740_000,
    verification: 'version 9 in the bundle; 3 TokenCreated logs (14.75M–15.12M), e.g. RHMCP',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_V10',
    version: 'V10',
    kind: 'bonding',
    factoryAddress: '0xB28c17B72538741590a3374127f84F79B59bBF30',
    startBlock: 15_430_000,
    verification: 'version 10 in the bundle; 4 TokenCreated logs (15.44M–15.54M), e.g. NEXTBETY',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_V11',
    version: 'V11',
    kind: 'bonding',
    factoryAddress: '0x4FB5057634f3CAE0B400E753852ea12B5d6278e2',
    startBlock: 17_610_000,
    verification: 'version 11 in the bundle; 4 TokenCreated logs (17.62M–33.37M), e.g. BLINDPIG',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_V12',
    version: 'V12',
    kind: 'bonding',
    factoryAddress: '0x700Da3295617Ec0c856CF303f77145298c1D4994',
    startBlock: 33_500_000,
    verification:
      'version 12, the bonding factory the app launches through today (NEXT_PUBLIC_MAINNET_FACTORY_V12); 20,438 bytes; 3 TokenCreated logs (33.50M–51.52M), e.g. HORACE',
  }),
  /* Robinlaunch direct-pool and boost factories: TokenLaunched. */
  robinlaunch({
    id: 'ROBINLAUNCH_DIRECT_V4',
    version: 'direct V4',
    kind: 'direct',
    factoryAddress: '0x52afeBDb95Cda3C221eB415Abb9cEE051E3Ca082',
    startBlock: 9_260_000,
    verification: 'direct factory in the bundle; 4 TokenLaunched logs (9.26M–12.15M), e.g. TWEWU',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_DIRECT_V6',
    version: 'direct V6',
    kind: 'direct',
    factoryAddress: '0x45E213F086d721Ac8BAacF6875940a278399c994',
    startBlock: 9_100_000,
    verification: 'direct factory in the bundle; 1 TokenLaunched log (GOLDFISH, block 9,105,474)',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_DIRECT_V7',
    version: 'direct V7',
    kind: 'direct',
    factoryAddress: '0xFE9868fB08D4AF99f37C83839F87183B6Ea1783a',
    startBlock: 15_670_000,
    verification: 'direct factory in the bundle; 2 TokenLaunched logs (15.67M–15.69M), e.g. FCAT',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_DIRECT_V8',
    version: 'direct V8',
    kind: 'direct',
    factoryAddress: '0xB76bd3a49e46399Df323DC06BebCEe2DBd346230',
    startBlock: 15_710_000,
    verification: 'direct factory in the bundle; 13 TokenLaunched logs (15.71M–30.61M), e.g. DEV',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_DIRECT_V9',
    version: 'direct V9',
    kind: 'direct',
    factoryAddress: '0xF3b3E2A751f5891B42B31B0c0044ee90bb2FE079',
    startBlock: 33_520_000,
    verification:
      'the current direct factory (NEXT_PUBLIC_DIRECT_FACTORY_V9); 3 TokenLaunched logs (33.52M–42.25M), e.g. FAUX0N',
  }),
  robinlaunch({
    id: 'ROBINLAUNCH_BOOST',
    version: 'boost',
    kind: 'direct',
    factoryAddress: '0x9F1A2556015c29d8853A6289Afa840359abaC6fF',
    startBlock: 27_730_000,
    verification:
      'BOOST_FACTORY_ADDRESS in the bundle; 16 TokenLaunched logs (27.74M–43.15M), e.g. KO; token in topics[2]',
  }),

  /**
   * PAIR (pair.fund) — multipool RWA launchpad pairing a new token with a
   * basket of tokenized stocks. The launcher's per-launch event carries the
   * token in `topics[1]`, the creator in `topics[2]` and a metadata URL in the
   * data, but no name or ticker; those come from the `pairfund` API adapter or
   * the token contract.
   */
  {
    id: 'PAIR_FUND',
    name: 'PAIR',
    launchpad: 'pairfund',
    chainId: 4663,
    factoryAddress: '0x8660A7F019C7943b0b0A91B8E39AFf3b6DB6Ae62',
    startBlock: 45_580_000,
    eventTopic0: '0x82a616e6f1d0903efaaacd5eb1b62949412287562a5d8fee347dff4b1775f7cf',
    tokenTopicIndex: 1,
    eventStrings: { metadataUri: 3 },
    enabled: true,
    verification:
      'the launcher the pair.fund bundle calls launchTokenMulti on (Qr in 7a3dac3dff82.js); 145-byte proxy on 4663; the RICHCAT launch (tx 0xca70bc3d…, the launchTxHash the API reports) emits this topic with the token in topics[1] and the metadata URL in data word 3; 1,474 such logs from block 45,583,639 to 53.14M on 2026-09-03 against 1,446 tokens in /api/tokens',
    sourceUrl: 'https://pair.fund/',
  },

  /**
   * Clanker on Robinhood Chain. `TokenCreated(address msgSender, address
   * indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string
   * tokenName, string tokenSymbol, string tokenMetadata, string tokenContext,
   * …)`: the metadata string is JSON with a description and social URLs.
   */
  {
    id: 'CLANKER_V4',
    name: 'Clanker',
    launchpad: 'clanker',
    version: 'v4',
    chainId: 4663,
    factoryAddress: '0xD3f2cC1731b7Fd17f28798835C2E02f0a1839A94',
    startBlock: 4_576_000,
    eventTopic0: '0x9299d1d1a88d8e1abdc591ae7a167a6bc63a8f17d695804e9091ee33aa89fb67',
    tokenTopicIndex: 1,
    eventStrings: { imageUri: 1, name: 2, symbol: 3, metadataUri: 4 },
    enabled: true,
    verification:
      'factory_address reported by clanker.world/api/tokens?chainId=4663 for CATARM, whose launch tx 0x1664f046… emits this topic with the token in topics[1] and image / "CATARM" / "CATARM" / metadata JSON in data words 1–4; 14,898 TokenCreated logs from block 4,576,116 to 52.95M on 2026-09-03 (the API counts 5,954)',
    sourceUrl: 'https://www.clanker.world/',
  },

  /**
   * Bankr on Robinhood Chain: tokens paired with tokenized stocks. The launch
   * event carries the token twice in the topics, the paired stock third, and
   * only the ticker in the data (word 5); the name is read from the contract.
   */
  {
    id: 'BANKR',
    name: 'Bankr',
    launchpad: 'bankr',
    chainId: 4663,
    factoryAddress: '0x22e99278308b393ea1260859b181ad7e78f5eeed',
    startBlock: 8_658_000,
    eventTopic0: '0xadc6f1f726f7c710f77ec06adc75f3bb964e5be19581b072c67f7b9b4039267b',
    tokenTopicIndex: 1,
    eventStrings: { symbol: 5 },
    enabled: true,
    verification:
      'the contract JOHNDOG (0x64bcf4aa…, GeckoTerminal dex bankr-robinhood) was launched through (tx 0x6773a589…): it emits this topic with the token in topics[1] and "JOHNDOG" in data word 5; 17,629 such logs from block 8,658,626 to 53.15M on 2026-09-03 (lower bound: some windows were rate-limited)',
    sourceUrl: 'https://bankr.bot/',
  },

  /**
   * EasyA Kickstart on Robinhood Chain. The launch event carries the token in
   * `topics[1]`, the creator in `topics[2]`, and name / symbol / an `ipfs://`
   * image in data words 2/3/4.
   */
  {
    id: 'EASYA_KICKSTART',
    name: 'EasyA Kickstart',
    launchpad: 'easya-kickstart',
    chainId: 4663,
    factoryAddress: '0x519fd71f5df8242fb8bccaa346ea5b20c336273e',
    startBlock: 44_090_000,
    eventTopic0: '0x7b3d31f5a245ede42482550606e43f2e8a15d059c4f7fb1480d8ed15f1e3318a',
    tokenTopicIndex: 1,
    eventStrings: { name: 2, symbol: 3, imageUri: 4 },
    enabled: true,
    verification:
      'the contract SUMI (0x81b8a79e…, GeckoTerminal dex easya-kickstart-robinhood) was launched through (tx 0x5fb7cb36…, block 52,455,103): it emits this topic with the token in topics[1] and "SUMI" / "SUMI" / ipfs://… in data words 2–4; 227 such logs from block 44,093,336 to 52.89M on 2026-09-03',
    sourceUrl: 'https://www.easya.io/',
  },

  /**
   * Hoodit — the chain's earliest launcher, a Pons-V1-style factory under
   * another name (GeckoTerminal dex `hoodit`). Same `TokenLaunched` signature
   * as Pons V1; 21,443 launches between blocks 61,869 and 6,718,684 and none
   * since, so once backfilled it costs one request an hour.
   */
  {
    id: 'HOODIT',
    name: 'Hoodit',
    launchpad: 'hoodit',
    chainId: 4663,
    factoryAddress: '0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb',
    startBlock: 61_000,
    eventTopic0: PONS_V1_LAUNCH_TOPIC0,
    tokenTopicIndex: 1,
    enabled: true,
    verification:
      'the contract CASHCAT (0x020bfc65…, GeckoTerminal dex hoodit) was launched through (tx 0x0e6d23f0…, block 88,836): it emits the Pons V1 TokenLaunched topic with the token in topics[1] and the Uniswap V3 factory in topics[3]; 21,443 such logs from block 61,869 to 6,718,684 on 2026-09-03 (some windows rate-limited)',
    sourceUrl: 'https://www.geckoterminal.com/robinhood/hoodit/pools',
  },

  /**
   * Robinpad (robinpad.app) — "AI, RWA & perp backed launchpad". No public
   * read API; its bundle (`eba139d710a8.js`, `RH4663`) names every factory
   * on 4663 and each was censused on 2026-09-03. Four creation events, none
   * carrying a name: `TokenCreated(address indexed token, address indexed
   * creator, address rewardToken, uint256 threshold)` on the reflection
   * factories, `InstantTokenCreated(address indexed token, address indexed
   * creator, …)` on the instant ones, and two on the main factory. Sampled
   * `topics[1]` all answer `symbol()` (ROBIN, VLAD, APPO, FATVLAD, TESTYSPY).
   */
  ...robinpadFactories(),

  /**
   * Flap (flap.sh) on Robinhood Chain — the launcher its bundle points every
   * chain-4663 launch at. Its launch event indexes nothing: the token address
   * is data word 3 (every Flap token ends in `7777`), the name and ticker are
   * words 4 and 5, and word 6 is a bare IPFS CID for the artwork.
   */
  {
    id: 'FLAP',
    name: 'Flap',
    launchpad: 'flap',
    chainId: 4663,
    factoryAddress: '0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09',
    startBlock: FLAP_START_BLOCK,
    eventTopic0: '0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603',
    tokenTopicIndex: 'data',
    tokenDataWord: 3,
    eventStrings: { name: 4, symbol: 5 },
    enabled: true,
    verification:
      'the contract the launch of doginhood (0xFDdaC5e0…7777, DEX Screener dexId flapsh) was sent to (tx 0x1b0b178e…, block 52,846,989): it emits this topic with the token in data word 3 and "DUCKYY" / "DUCKYY" / a CID in words 4–6 on a sampled launch; 79,505 such logs between blocks 30M and 44M and 10,477 between 44M and 53.13M on 2026-09-03; the first launch is at block 4,227,932 (census 2026-09-05, see FLAP_START_BLOCK)',
    sourceUrl: 'https://flap.sh/',
  },
];


function robinpadFactories(): LaunchFactoryConfig[] {
  const entry = (
    id: string,
    version: string,
    factoryAddress: `0x${string}`,
    eventTopic0: `0x${string}`,
    startBlock: number,
    verification: string,
  ): LaunchFactoryConfig => ({
    id,
    name: 'Robinpad',
    launchpad: 'robinpad',
    version,
    chainId: 4663,
    factoryAddress,
    startBlock,
    eventTopic0,
    tokenTopicIndex: 1,
    enabled: true,
    verification,
    sourceUrl: 'https://www.robinpad.app/docs',
  });
  const MAIN = '0xEb3FeeD2716cF0eEAda05B22e67424794e1f5a80' as const;
  const CREATED = '0xa52263eeb2ea349365a35c006fc978b0b85eb109fe50959959c829b329bebf9e' as const;
  const CREATED_ALT = '0x096627c8a73b9cd80e060634e86d64ccb00710637ab5b294c82d1ce416a23c8d' as const;
  const REFLECTION_CREATED = '0x71fc7051f6ff796b0915a433ad35f46d780c8a1a8251ab26bee71fb838abab90' as const;
  const INSTANT_CREATED = '0xa2a5ae17f394d0d1eef41cd8a3100f216ea25bf15bd748edd53d97b56ede0061' as const;
  const INSTANT_ROBIN_CREATED = '0xf774d599306b1180c554a93c21ec973bab3380f00b27d44600f0699b62f081ae' as const;
  return [
    entry('ROBINPAD_FACTORY', 'factory', MAIN, CREATED, 980_000,
      'FACTORY in the bundle; 704-byte proxy; the ROBIN token itself (0xfB4729…) was created through it (tx 0x74685f12…, block 983,265) and it emits this topic with the token in topics[1]; 51 such logs (0.98M–13.03M)'),
    entry('ROBINPAD_FACTORY_ALT', 'factory', MAIN, CREATED_ALT, 2_750_000,
      'the same factory\'s second creation event: 28 logs (2.75M–10.53M) whose topics[1] answer symbol() VLAD ("The Hood Bull"), CAPYHOOD'),
    entry('ROBINPAD_LEGACY', 'legacy', '0xAf9f3ce1d34909F59E88c23027f89d5807B0F915', CREATED, 361_000,
      'LEGACY_FACTORY in the bundle; 23,504 bytes; 3 creation logs (361,903–364,180)'),
    entry('ROBINPAD_REFLECTION', 'reflection', '0x6Ce85c4b7cE12903E5867652C265bCcce57f935F', REFLECTION_CREATED, 3_870_000,
      'REFLECTION_FACTORY in the bundle; TokenCreated(token, creator, rewardToken, threshold); 19 logs (3.87M–44.61M) whose topics[1] answer symbol() APPO, RSMOKE'),
    entry('ROBINPAD_REFLECTION_LEGACY', 'reflection legacy', '0x2110f111d2776eF53366B9eAEf8c5619Fde09EEf', REFLECTION_CREATED, 3_590_000,
      'LEGACY_REFLECTION_FACTORY in the bundle; 1 TokenCreated log (block 3,598,418)'),
    entry('ROBINPAD_REFLECTION_PAIR', 'reflection pair', '0x2A9D79B28D506B209511792795a182e726975C76', REFLECTION_CREATED, 13_550_000,
      'REFLECTION_PAIR_FACTORY in the bundle; 7 TokenCreated logs (13.56M–14.91M)'),
    entry('ROBINPAD_INSTANT', 'instant', '0xD7601cEe401306fdea5833c6898181D9c770F800', INSTANT_CREATED, 11_960_000,
      'INSTANT_FACTORY in the bundle; InstantTokenCreated(token, creator, backingWallet, isMeme, isMargin, isRwa, pool, positionId, dexId); 27 logs (11.97M–49.27M) whose topics[1] answer symbol() FATVLAD'),
    entry('ROBINPAD_INSTANT_GOLD', 'instant gold', '0x346c46CF7D8DfeD2c614c38570C697ac948FeEEc', INSTANT_CREATED, 17_980_000,
      'INSTANT_GOLD_FACTORY in the bundle; 2 InstantTokenCreated logs (17.98M–17.99M)'),
    entry('ROBINPAD_INSTANT_ROBIN', 'instant robin', '0x6bfab86122842eb6e8602124dcebf6a373498ffc', INSTANT_ROBIN_CREATED, 10_890_000,
      'INSTANT_ROBIN_FACTORY in the bundle; 3 creation logs (10.89M–11.00M) whose topics[1] answer symbol() TESTYSPY, TTTEST'),
  ];
}

export const enabledFactories = (chainId: number): LaunchFactoryConfig[] =>
  LAUNCH_FACTORIES.filter((factory) => factory.enabled && factory.chainId === chainId);

export const factoryById = (id: string): LaunchFactoryConfig | undefined =>
  LAUNCH_FACTORIES.find((factory) => factory.id === id);
