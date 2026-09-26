import type {
  HeyAccelerating,
  HeyAskAnswer,
  HeyBuildMarket,
  HeyBuildersPage,
  HeyChain,
  HeyChangesPage,
  HeyCompare,
  HeyContract,
  HeyDiff,
  HeyEvidenceReceipt,
  HeyExplainedFact,
  HeyExplainIndex,
  HeyMarketIntegrity,
  HeyMarketMoves,
  HeyPage,
  HeyProject,
  HeyProjectContracts,
  HeyProjectCoverage,
  HeyProjectSnapshot,
  HeySilentBuilders,
  HeyTimeline,
  HeyTokenLookup,
  HeyTokenMarket,
  HeyUnlocks,
  HeyWeeklyReport,
} from '@hey-research/sdk';

/**
 * One API-shaped answer per route the MCP tools read (2026-09-26).
 *
 * Typed against the SDK, whose types the web app's contract tests hold equal
 * to the serialisers, so a fixture that stops matching the API stops
 * compiling. The values follow production shapes observed during the
 * 2026-09-26 audit (M2) — the names are HEY's demo fixtures, never a real
 * wallet. `this-week.json` is the one payload captured verbatim.
 */
const DISCLAIMER = 'HEY reports public building activity. It is not investment advice.';
const BASE = 'https://heyresearch.xyz';

export const agentos: HeyProject = {
  slug: 'agentos',
  name: 'AgentOS',
  symbol: 'AOS',
  projectKind: 'UTILITY',
  activityStatus: 'SHIPPING',
  researchLevel: 'VERIFIED_BUILDER',
  catalogStatus: 'VERIFIED_BUILDER',
  stillBuilding: true,
  stillBuildingEvidence: { drawdownPercent: -62.4, shipsSinceDecline: 5 },
  lastShippedAt: '2026-09-24T10:00:00.000Z',
  primaryNarrative: { slug: 'ai-agents', name: 'AI Agents' },
  token: { chainId: 4663, contractAddress: '0xcab100000000000000000000000000000000cb07' },
  tokenMarket: { status: 'ACTIVE_MARKET' },
  marketCap: { usd: 208_594, source: 'dexscreener', observedAt: '2026-09-25T20:00:00.000Z', kind: 'fdv' },
  liquidity: { usd: 41_000, source: 'dexscreener', observedAt: '2026-09-25T20:00:00.000Z', kind: 'market' },
  hasBuilderSource: true,
  url: `${BASE}/project/agentos`,
};

export const projectsPage: HeyPage<HeyProject> = {
  query: { limit: 2, offset: 0, tab: 'still-building', sort: 'activity' },
  total: 17,
  nextOffset: 2,
  items: [
    agentos,
    { ...agentos, slug: 'quiet-token', name: 'Quiet Token', symbol: 'QT', stillBuilding: false, stillBuildingEvidence: undefined, activityStatus: 'UNKNOWN', hasBuilderSource: false, lastShippedAt: undefined, marketCap: { usd: 9_000, source: 'geckoterminal' }, url: `${BASE}/project/quiet-token` },
  ],
  disclaimer: DISCLAIMER,
};

export const silence: HeySilentBuilders = {
  items: [{ slug: 'darkroute', name: 'DarkRoute', symbol: 'DARK', activityStatus: 'SHIPPING', lastShipAt: '2026-09-23T00:00:00.000Z', url: `${BASE}/project/darkroute`, meaningfulShips30d: 4, marketAttention: 'VERY_LOW' }],
  total: 8,
  truncated: false,
  method: 'Under the Radar and below the 40th market-attention percentile.',
  disclaimer: DISCLAIMER,
};

export const accelerating: HeyAccelerating = {
  items: [
    { slug: 'faster', name: 'Faster', activityStatus: 'SHIPPING', lastShipAt: '2026-09-22T00:00:00.000Z', url: `${BASE}/project/faster`, velocity: { windowDays: 30, current: 5, previous: 1, changePct: 400 } },
    { slug: 'newer', name: 'Newer', activityStatus: 'SHIPPING', url: `${BASE}/project/newer`, velocity: { windowDays: 30, current: 3, previous: null, changePct: null } },
  ],
  method: 'Build velocity ACCELERATING by the project page’s rule.',
  disclaimer: DISCLAIMER,
};

export const builders: HeyBuildersPage = {
  day: '2026-09-25',
  ranked: 715,
  total: 715,
  query: { filter: 'most-improved', limit: 1, offset: 0 },
  method: 'Ranked by verified development, on-chain use of the project’s own contracts and research standing.',
  items: [{ rank: 3, rank7d: 9, slug: 'agentos', name: 'AgentOS', symbol: 'AOS', activityStatus: 'SHIPPING', catalogStatus: 'VERIFIED_BUILDER', firstSeenAt: '2026-06-01T00:00:00.000Z', lastShippedAt: '2026-09-24T10:00:00.000Z', scores: { overall: 81.2, development: 88, onchain: 64, research: 90 }, inputs: {}, url: `${BASE}/project/agentos` }],
  disclaimer: DISCLAIMER,
};

export const lookupPublished: HeyTokenLookup = {
  chainId: 4663,
  contractAddress: '0xcab100000000000000000000000000000000cb07',
  status: 'published',
  project: {
    slug: 'agentos',
    name: 'AgentOS',
    symbol: 'AOS',
    url: `${BASE}/project/agentos`,
    activityStatus: 'SHIPPING',
    activityLabel: 'Shipping',
    activityHelp: 'Shipped in the last 7 days.',
    researchLevel: 'VERIFIED_BUILDER',
    shipsLast30Days: 8,
    activityMeasured: true,
    meaningfulShipsLast30Days: 4,
    asOf: '2026-09-25T20:00:00.000Z',
    lastShip: { title: 'v0.4', publishedAt: '2026-09-24T10:00:00.000Z', sourceUrl: 'https://github.com/agentos/sdk/releases/tag/v0.4' },
    tokenVerification: { status: 'VERIFIED' },
    activityAppliesToToken: true,
    badgeUrl: `${BASE}/badge/agentos.svg`,
  },
  scanUrl: `${BASE}/scan?address=0xcab100000000000000000000000000000000cb07`,
  disclaimer: DISCLAIMER,
};

export const lookupUnknown: HeyTokenLookup = { chainId: 4663, contractAddress: '0x' + 'a'.repeat(40), status: 'unknown', scanUrl: `${BASE}/scan?address=0x${'a'.repeat(40)}`, disclaimer: DISCLAIMER };

export const snapshot: HeyProjectSnapshot = {
  identity: {
    slug: 'agentos',
    name: 'AgentOS',
    symbol: 'AOS',
    projectKind: 'UTILITY',
    researchLevel: 'VERIFIED_BUILDER',
    catalogStatus: 'VERIFIED_BUILDER',
    primaryNarrative: { slug: 'ai-agents', name: 'AI Agents' },
    token: { chainId: 4663, contractAddress: '0xcab100000000000000000000000000000000cb07' },
    firstRecordedByHeyAt: '2026-06-01T00:00:00.000Z',
    externalListedAt: '2022-10-19T00:00:00.000Z',
    externalListedSource: 'defillama',
    url: `${BASE}/project/agentos`,
  },
  build: {
    activityStatus: 'SHIPPING',
    activityMeasured: true,
    lastShippedAt: '2026-09-24T10:00:00.000Z',
    buildMomentum: 67.4,
    stillBuilding: true,
    stillBuildingEvidence: { drawdownPercent: -62.4, shipsSinceDecline: 5 },
    velocity: { state: 'ACCELERATING', current: 9, previous: 4, windowDays: 30 },
    cadence: { state: 'INSUFFICIENT_RELEASES' },
    hasBuilderSource: true,
  },
  market: {
    valuationWithheld: 'liquidity_removed',
    tokenMarket: { status: 'LIQUIDITY_REMOVED', reason: 'liquidity_below_floor' },
    url: `${BASE}/api/projects/agentos/market`,
  },
  onchain: { calls24h: 1_204, daysCovered: 7, daysMeasured: 0, observedAt: '2026-09-25T18:00:00.000Z' },
  contracts: { url: `${BASE}/api/projects/agentos/contracts` },
  verification: { token: { status: 'VERIFIED', verifiedAt: '2026-09-11T00:00:00.000Z' }, ownerVerified: false, submitted: true, sources: { total: 5, own: 4, verified: 2, contextOnly: 1 } },
  locks: { coverage: { state: 'NO_SOURCE', reason: 'hoodlock_only_none_found' } },
  integrity: { state: 'WITHHELD', reason: 'Market Integrity is not published on public surfaces yet.' },
  latestChanges: {
    available: true,
    items: [
      { id: 'ship:2ac87a66-0000-0000-0000-000000000001', revision: 1, op: 'upsert', type: 'build.release', domain: 'build', occurredAt: '2026-09-24T10:00:00.000Z', precision: 'EXACT', detectedAt: '2026-09-24T11:00:00.000Z', recordedAt: '2026-09-24T11:05:00.000Z', summary: 'Released v0.4', evidence: [{ id: 'ship:2ac87a66-0000-0000-0000-000000000001', label: 'GitHub release', url: 'https://github.com/agentos/sdk/releases/tag/v0.4' }], source: 'github' },
      { id: 'ship:2ac87a66-0000-0000-0000-000000000002', revision: 1, op: 'upsert', type: 'build.code_activity', domain: 'build', occurredAt: '2026-09-14T00:00:00.000Z', precision: 'WEEK', detectedAt: '2026-09-21T00:00:00.000Z', recordedAt: '2026-09-21T00:05:00.000Z', summary: '42 commits by 3 contributors', evidence: [], source: 'github' },
    ],
    url: `${BASE}/api/changes?project=agentos`,
  },
  freshness: [
    { source: 'code', label: 'Code activity', state: 'fresh', observedAt: '2026-09-25T12:00:00.000Z', staleAfterHours: 48 },
    { source: 'locks', label: 'HoodLock', state: 'unknown', staleAfterHours: 24 },
  ],
  coverage: {
    identity: { state: 'MEASURED' },
    builderEvidence: { state: 'MEASURED', asOf: '2026-09-25T12:00:00.000Z' },
    repositories: { state: 'MEASURED' },
    releases: { state: 'MEASURED' },
    marketCurrent: { state: 'WITHHELD', reason: 'liquidity_removed' },
    marketHistory: { state: 'MEASURED', since: '2026-06-18' },
    contractDeployment: { state: 'MEASURED' },
    contractActivity: { state: 'NOT_ENOUGH_YET', reason: 'decoder_blind_spot' },
    contractSource: { state: 'MEASURED' },
    contractInterface: { state: 'MEASURED', since: '2026-09-24' },
    distribution: { state: 'STALE' },
    locks: { state: 'NO_SOURCE', reason: 'hoodlock_only_none_found' },
    marketIntegrity: { state: 'WITHHELD' },
    timeline: { state: 'MEASURED' },
  },
  evidenceSummary: { sources: { total: 5, own: 4, verified: 2, contextOnly: 1 }, meaningfulEvents30d: 9, explainUrl: `${BASE}/api/projects/agentos/explain` },
  links: {
    page: `${BASE}/project/agentos`,
    detail: `${BASE}/api/projects/agentos`,
    market: `${BASE}/api/projects/agentos/market`,
    timeline: `${BASE}/api/projects/agentos/timeline`,
    intelligence: `${BASE}/api/projects/agentos/intelligence`,
    changes: `${BASE}/api/changes?project=agentos`,
    coverage: `${BASE}/api/projects/agentos/coverage`,
    explain: `${BASE}/api/projects/agentos/explain`,
    contracts: `${BASE}/api/projects/agentos/contracts`,
  },
  asOf: '2026-09-25T20:00:00.000Z',
  scoringVersion: 'hbm-v15',
  disclaimer: DISCLAIMER,
};

export const changes: HeyChangesPage = {
  query: { mode: 'browse', project: 'agentos', limit: 2 },
  items: [
    {
      id: 'ship:2ac87a66-0000-0000-0000-000000000001',
      revision: 1,
      op: 'upsert',
      type: 'build.release',
      domain: 'build',
      origin: 'live',
      project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
      occurredAt: '2026-09-24T10:00:00.000Z',
      precision: 'EXACT',
      detectedAt: '2026-09-24T11:00:00.000Z',
      recordedAt: '2026-09-24T11:05:00.000Z',
      summary: 'Released v0.4',
      evidence: [{ id: 'ship:2ac87a66-0000-0000-0000-000000000001', label: 'GitHub release', url: 'https://github.com/agentos/sdk/releases/tag/v0.4' }],
      source: 'github',
      countsAsBuilding: true,
      links: { project: `${BASE}/project/agentos`, evidence: `${BASE}/api/evidence/ship:2ac87a66-0000-0000-0000-000000000001`, timeline: `${BASE}/api/projects/agentos/timeline` },
    },
    { id: 'signal:0b0b0000-0000-0000-0000-000000000009', revision: 2, op: 'retract', recordedAt: '2026-09-24T12:00:00.000Z' },
  ],
  nextCursor: 'YzEuMTIzNDU',
  hasMore: true,
  ledger: { collectionStart: '2026-09-26T00:00:00.000Z', transitionsFrom: '2026-09-26T00:00:00.000Z', newestRecordedAt: '2026-09-26T10:00:00.000Z', projectorRanAt: '2026-09-26T10:00:00.000Z' },
  disclaimer: DISCLAIMER,
};

export const timeline: HeyTimeline = {
  project: { slug: 'equifold', name: 'Equifold', url: `${BASE}/project/equifold` },
  lens: 'everything',
  items: [
    { id: 'ship:1', kind: 'release', at: '2026-09-01T10:00:00.000Z', precision: 'EXACT', title: 'v1.2', countsAsBuilding: true, source: 'https://github.com/equifold/core/releases/tag/v1.2' },
    { id: 'ship:2', kind: 'code_activity', at: '2026-08-24T00:00:00.000Z', precision: 'WEEK', title: '12 commits', countsAsBuilding: true },
    { id: 'lock:4663:17', kind: 'unlock', at: '2026-10-01T00:00:00.000Z', precision: 'SCHEDULED', title: 'Lock #17 unlocks', countsAsBuilding: false },
  ],
  totals: { ships: 408, contractSource: 2, locks: 1, resumed: 0, marketIntegrity: 0, verification: 1 },
  total: 412,
  truncated: true,
  nextCursor: 'T2',
  disclaimer: DISCLAIMER,
};

export const coverage: HeyProjectCoverage = {
  project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  dimensions: snapshot.coverage!,
  freshness: snapshot.freshness,
  computedAt: '2026-09-25T20:00:00.000Z',
  states: {
    MEASURED: 'HEY measured this; figures elsewhere are measurements, zeros included.',
    NO_SOURCE: 'HEY holds no source it could measure this from.',
    NOT_ENOUGH_YET: 'HEY has not watched long enough.',
    STALE: 'The last reading is older than it should be.',
    SOURCE_UNAVAILABLE: 'The source could not be read.',
    NOT_APPLICABLE: 'This does not apply to the project.',
    NOT_RESEARCHED: 'HEY has not researched the project.',
    ERROR: 'The read failed.',
    WITHHELD: 'Measured and deliberately not published on this surface.',
  },
  disclaimer: DISCLAIMER,
};

export const explained: HeyExplainedFact = {
  project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  fact: 'market.valuation',
  value: null,
  state: 'DERIVED',
  classification: 'withheld: the market is not live',
  canonicalRule: { id: 'valuation-kind', version: 'v1', text: 'Market cap when a circulating figure exists, else the fully diluted valuation; withheld when the market is not live.' },
  source: 'dexscreener',
  observedAt: '2026-09-25T20:00:00.000Z',
  freshness: { state: 'fresh', staleAfterHours: 24 },
  inputs: [{ name: 'marketStatus', value: 'LIQUIDITY_REMOVED' }, { name: 'fdvUsd', value: 208594, source: 'dexscreener', observedAt: '2026-09-25T20:00:00.000Z' }],
  lineage: [
    { step: 'source', text: 'DEX Screener reported an FDV.' },
    { step: 'sanitation', text: 'The market status is LIQUIDITY_REMOVED.' },
    { step: 'public', text: 'Withheld.' },
  ],
  evidence: [{ id: 'state:9b1c:market_status:4', url: `${BASE}/api/evidence/state:9b1c:market_status:4` }],
  unknownInputs: ['circulatingSupply'],
  reason: 'A market that is not live has its valuation withheld.',
  disclaimer: DISCLAIMER,
};

export const explainIndex: HeyExplainIndex = {
  project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  facts: [
    { fact: 'market.valuation', description: 'The valuation, its kind and why it is shown or withheld.', url: `${BASE}/api/projects/agentos/explain?fact=market.valuation` },
    { fact: 'activity.status', description: 'The activity status and the ships behind it.', url: `${BASE}/api/projects/agentos/explain?fact=activity.status` },
  ],
  disclaimer: DISCLAIMER,
};

export const evidence: HeyEvidenceReceipt = {
  id: 'ship:2ac87a66-0000-0000-0000-000000000001',
  withdrawn: false,
  project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  domain: 'build',
  claimType: 'GITHUB_RELEASE',
  summary: 'Released v0.4',
  sourceType: 'github_release',
  sourceUrl: 'https://github.com/agentos/sdk/releases/tag/v0.4',
  publishedAt: '2026-09-24T10:00:00.000Z',
  detectedAt: '2026-09-24T11:00:00.000Z',
  precision: 'EXACT',
  verification: 'PUBLICLY_VERIFIED',
  countsAsBuilding: true,
  recordedAt: '2026-09-24T11:05:00.000Z',
  metadata: { tag: 'v0.4' },
  sources: [{ evidenceRowId: 'e1', sourceType: 'github_release', sourceUrl: 'https://github.com/agentos/sdk/releases/tag/v0.4', observedAt: '2026-09-24T11:00:00.000Z', metadata: {} }],
  disclaimer: DISCLAIMER,
};

export const evidenceWithdrawn: HeyEvidenceReceipt = { id: 'ship:dead', withdrawn: true, withdrawalReason: 'not_public', disclaimer: DISCLAIMER };

export const tokenMarket: HeyTokenMarket = {
  slug: 'agentos',
  name: 'AgentOS',
  symbol: 'AOS',
  token: { chainId: 4663, contractAddress: '0xcab100000000000000000000000000000000cb07' },
  marketStatus: 'ACTIVE_MARKET',
  verification: 'VERIFIED',
  contract: { deployer: '0xdep0000000000000000000000000000000000001', deployerShared: true, createdAt: '2026-08-01T12:00:00.000Z', creationTx: '0xtx' },
  pools: { day: '2026-09-24', observedAt: '2026-09-24T23:00:00Z', pools: 2, liquidityUsd: 40_000, depthOnePctUsd: 350, dominantPoolShare: 0.82 },
  distribution: { day: '2026-09-24', observedAt: '2026-09-24T20:00:00Z', holdersTotal: 1_830, top10SharePct: 41.24, top50SharePct: 63.9, burnedSharePct: 5, pooledSharePct: 12.4 },
  current: { priceUsd: 0.000208, marketCapUsd: 208_594, valuationKind: 'fdv', fdvUsd: 208_594, liquidityUsd: 41_000, liquidityKind: 'market', volume24hUsd: 3_800, source: 'dexscreener', observedAt: '2026-09-25T20:00:00.000Z' },
  days: [
    { day: '2026-09-23', priceCloseUsd: 0.0002, liquidityCloseUsd: 40_000, trades: 12, buys: 7, sells: 5, buyVolumeUsd: 100, sellVolumeUsd: 80, source: 'bitquery' },
    { day: '2026-09-24', priceCloseUsd: 0.00021, liquidityCloseUsd: 41_000, trades: 9, source: 'bitquery' },
  ],
  lifecycle: { deployedAt: '2026-08-01T12:00:00.000Z', launchpadLaunchAt: { at: '2026-08-01T13:00:00.000Z', source: 'virtuals', basis: 'launchpad_claim' }, launchStage: 'DEX', launchStageObservedAt: '2026-08-03T00:00:00.000Z', firstTradeDay: '2026-08-02', tradeIndexFrom: '2026-06-18', firstTradeCensored: false },
  checks: [{ key: 'proxy', label: 'Proxy', finding: 'No proxy pattern detected at the last check.', tone: 'plain', provenance: 'RPC storage read' }],
  onchainDays: [{ day: '2026-09-24', events: null, truncated: false, calls: 1204, source: 'bitquery', window: 'utc_day' }],
  tvlDays: [],
  url: `${BASE}/project/agentos/market`,
  disclaimer: DISCLAIMER,
};

export const marketMoves: HeyMarketMoves = {
  project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  threshold: { minChangePct: 25, lookbackDays: 7, windowDays: 30 },
  daysRead: 30,
  items: [{ day: '2026-09-14', previousDay: '2026-09-13', changePct: 50, marketCapUsd: 156_000, previousMarketCapUsd: 104_000, eventsBefore: [{ title: 'v0.3 released', eventType: 'GITHUB_RELEASE', publishedAt: '2026-09-11T10:00:00.000Z', verification: 'PUBLICLY_VERIFIED', source: 'https://github.com/agentos/sdk/releases/tag/v0.3' }] }],
  method: 'Day-on-day moves in the recorded valuation close.',
  disclaimer: DISCLAIMER,
};

export const contract: HeyContract = {
  chainId: 4663,
  address: '0xcab100000000000000000000000000000000cb07',
  name: 'AgentOS Token',
  associatedProject: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  role: 'token',
  token: { symbol: 'AOS' },
  watched: true,
  creation: { tx: '0xtx', at: '2026-08-01T12:00:00.000Z', block: 1_200_000, precision: 'EXACT' },
  deployer: { address: '0xdep0000000000000000000000000000000000001', sharedAcrossTrackedProjects: true, otherProjectsCount: 12 },
  verifiedSource: { state: 'MEASURED', verified: true, compiler: 'v0.8.24', contractName: 'ClonableBeaconProxy', checkedAt: '2026-09-24T00:00:00.000Z' },
  proxy: {
    state: 'MEASURED',
    status: 'PROXY',
    kind: 'BEACON',
    implementation: '0x1111000000000000000000000000000000000001',
    beacon: '0x2222000000000000000000000000000000000002',
    checkedAt: '2026-09-25T00:00:00.000Z',
    history: [{ id: 'impl:4663:0xcab100000000000000000000000000000000cb07:1200001:3', implementation: '0x1111000000000000000000000000000000000001', previousImplementation: null, beacon: '0x2222000000000000000000000000000000000002', event: 'BeaconUpgraded', occurredAt: '2026-08-01T12:05:00.000Z', precision: 'EXACT', detectedAt: '2026-09-26T00:00:00.000Z', blockNumber: 1_200_001, txHash: '0xtx2', source: 'onchain_logs' }],
  },
  interface: { state: 'MEASURED', functionCount: 24, eventCount: 6, baselineSince: '2026-09-24T00:00:00.000Z', changes: [] },
  activity: {
    state: 'MEASURED',
    daysMeasured: 7,
    calls7d: 8_400,
    events7d: null,
    newestDay: '2026-09-24',
    methods: {
      state: 'MEASURED',
      source: 'decoded_calls',
      collectedFrom: '2026-07-01',
      collectedThrough: '2026-09-26',
      window: { from: '2026-09-20', to: '2026-09-26', days: 7 },
      calls: 8_400,
      buckets: { erc20Standard: 8_000, named: 390, undecoded: 10 },
      distinctFunctions: 4,
      top: [
        { rank: 1, bucket: 'erc20_standard', calls: 8_000 },
        { rank: 2, bucket: 'named', calls: 300 },
        { rank: 3, bucket: 'named', calls: 90 },
        { rank: 4, bucket: 'undecoded', calls: 10 },
      ],
      names: 'WITHHELD',
    },
  },
  freshness: { proxyCheckedAt: '2026-09-25T00:00:00.000Z' },
  evidence: ['impl:4663:0xcab100000000000000000000000000000000cb07:1200001:3'],
  url: `${BASE}/api/contracts/4663/0xcab100000000000000000000000000000000cb07`,
  disclaimer: DISCLAIMER,
};

export const projectContracts: HeyProjectContracts = {
  project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  chainId: 4663,
  items: [
    { ...contract, role: 'token' },
    { ...contract, address: '0x3333000000000000000000000000000000000003', name: undefined, role: 'followup', watched: false, proxy: { state: 'NOT_READ', history: [] }, verifiedSource: { state: 'NOT_READ' }, interface: { state: 'NOT_READ', changes: [] }, activity: { state: 'NOT_READ', daysMeasured: 0, calls7d: null, events7d: null, methods: { state: 'NOT_READ', source: 'decoded_calls', names: 'WITHHELD' } }, evidence: [] },
  ],
  total: 2,
  truncated: false,
  method: 'The token, contracts the project declares, and follow-up deployments by its deployer (listed, not watched).',
  disclaimer: DISCLAIMER,
};

export const diff: HeyDiff = {
  project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  from: '2026-09-01',
  to: '2026-09-25',
  build: {
    clock: 'published',
    releasesAdded: 3,
    meaningfulShips: 9,
    status: { then: { value: 'ACTIVE', day: '2026-09-01', basis: 'knowledge', scoringVersion: 'hbm-v14' }, now: { value: 'SHIPPING', day: '2026-09-25', basis: 'knowledge', scoringVersion: 'hbm-v15' } },
    momentum: { then: { value: null, reason: 'no persisted point on or before 2026-09-01' }, now: { value: 67.4, day: '2026-09-25', basis: 'knowledge' } },
  },
  market: { state: 'MEASURED', valuation: { then: { value: 104_000, day: '2026-09-01', basis: 'observed' }, now: { value: 208_594, day: '2026-09-25', basis: 'observed' } }, liquidity: { then: { value: null, reason: 'withheld' }, now: { value: 41_000, day: '2026-09-25', basis: 'observed' } } },
  changes: { state: 'MEASURED', clock: 'recorded', total: 14, byType: { 'build.release': 3, 'build.code_activity': 4 }, truncated: false, url: `${BASE}/api/changes?project=agentos` },
  method: 'Then and now are the nearest persisted points at or before each bound.',
  disclaimer: DISCLAIMER,
};

export const compare: HeyCompare = {
  projects: [
    { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos`, activityStatus: 'SHIPPING', lastMeaningfulShipAt: '2026-09-24T10:00:00.000Z', buildMomentum: 67.4, verifiedBuilder: true, sources: { verified: 2, total: 5 }, marketCapUsd: 208_594, valuationKind: 'fdv', velocity: { state: 'ACCELERATING', current: 9, previous: 4 } },
    { slug: 'quiet-token', name: 'Quiet Token', url: `${BASE}/project/quiet-token`, activityStatus: 'UNKNOWN', verifiedBuilder: false, sources: { verified: 0, total: 1 }, marketCapUsd: 9_000 },
  ],
  missing: ['ghost'],
  ignoredSlugs: [],
  method: 'Side by side; no winner.',
  disclaimer: DISCLAIMER,
};

export const ask: HeyAskAnswer = {
  project: { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` },
  question: 'what shipped this month?',
  fallback: false,
  sections: [{ question: 'What releases occurred?', lines: [{ tag: 'FACT', text: '2026-09-24 · v0.4', source: 'https://github.com/agentos/sdk/releases/tag/v0.4' }, { tag: 'UNKNOWN', text: 'Release cadence: not enough releases yet.' }] }],
  disclaimer: DISCLAIMER,
};

export const chain: HeyChain = {
  chainId: 4663,
  days: Array.from({ length: 40 }, (_, i) => ({ day: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, dexTrades: 1_000 + i, ships: 10, buildersShipping: 5, ...(i === 39 ? { buildersVerified: 2 } : {}) })),
  lastFullDay: '2026-09-25',
  today: '2026-09-26',
  volumeNote: 'Volume counts decoded DEX trades against the known quote assets.',
  disclaimer: DISCLAIMER,
};

export const weeklyReport: HeyWeeklyReport = {
  week: '2026-W38',
  window: { start: '2026-09-14T00:00:00Z', end: '2026-09-21T00:00:00Z' },
  final: true,
  generatedAt: '2026-09-21T01:00:00Z',
  headline: 'A week of releases.',
  overview: { published: 10, verifiedBuilders: 5, ships: 9, projectsShipping: 4, newBuilders: 1, backToShipping: 0, stillBuilding: 4, underTheRadar: 6 },
  chain: { days: 7, dexTrades: 12_000 },
  shipped: [{ slug: 'agentos', name: 'AgentOS', ships: 3, latest: 'v0.4', latestAt: '2026-09-20T00:00:00Z' }],
  newBuilders: [],
  backToShipping: [],
  stillBuilding: [],
  underTheRadar: [],
  topBuilders: [],
  movers: [],
  signals: [],
  signalCounts: [],
  url: `${BASE}/reports/weekly/2026-W38`,
  disclaimer: DISCLAIMER,
};

export const unlocks: HeyUnlocks = {
  days: 30,
  items: [{ project: { slug: 'agentos', name: 'AgentOS', activityStatus: 'SHIPPING', url: `${BASE}/project/agentos` }, lockId: 17, unlockAt: '2026-10-01T00:00:00.000Z', assetKind: 'TOKEN', lockedTokens: 1_000, shareOfSupplyPct: 10, proof: 'https://hoodlock.tech/proof/lock/17', precision: 'SCHEDULED', id: 'lock:4663:17' }],
  scope: 'hoodlock',
  total: 3,
  truncated: true,
  disclaimer: DISCLAIMER,
};

export const buildMarket: HeyBuildMarket = {
  items: Array.from({ length: 35 }, (_, i) => ({ slug: `p${i}`, name: `Project ${i}`, activityStatus: 'SHIPPING', url: `${BASE}/project/p${i}`, buildMomentum: 50 + i, marketAttentionPercentile: 30 })),
  method: 'Build Momentum against the market-attention percentile.',
  disclaimer: DISCLAIMER,
};

export const marketIntegrity: HeyMarketIntegrity = {
  slug: 'drained',
  url: `${BASE}/project/drained`,
  builderActivity: { status: 'SHIPPING', lastMeaningfulShipAt: '2026-09-24T10:00:00Z' },
  note: 'Market integrity describes the tracked token market, not whether development has stopped.',
  marketIntegrity: {
    rulesVersion: 'mi-v4',
    evaluatedAt: '2026-09-25T00:00:00Z',
    state: 'LIQUIDITY_REMOVED',
    marketActive: false,
    established: true,
    collapse: 'SEVERE',
    liquidityPeakUsd: 82_000,
    liquidityPeakDay: '2026-09-10',
    liquidityPeakSource: 'dexscreener',
    liquidityNowUsd: 1_129,
    liquidityNowDay: '2026-09-24',
    liquidityNowSource: 'onchain',
    liquidityChangePct: -98.6,
    deteriorationStartDay: '2026-09-20',
    collapseDay: '2026-09-21',
    lastTradeDay: '2026-09-20',
    migrationDetected: false,
    migration: null,
    lockState: 'NONE',
    sourcesDisagree: false,
  },
  conflicts: [{ type: 'BUILDER_ACTIVE_MARKET_GONE', text: 'HEY observed recent builder activity while the tracked token market had already lost most of its liquidity.' }],
  events: [
    {
      id: 'integrity:00000000-0000-4000-8000-000000000001:collapse:2026-09-21',
      kind: 'LIQUIDITY_COLLAPSE',
      label: 'Liquidity fell far below the level it held',
      summary: "Liquidity fell from the $82.0K it held (2026-09-10) to $1.1K (2026-09-24), on two consecutive daily readings of HEY's market index. Readings: DEX Screener and on-chain trades.",
      source: 'hey_market_index',
      at: '2026-09-21',
      precision: 'day',
      until: null,
      detectedAt: '2026-09-23T06:00:00Z',
      confidence: 'high',
      facts: { kind: 'LIQUIDITY_COLLAPSE', confidence: 'high', peakDay: '2026-09-10', currentDay: '2026-09-24' },
    },
    {
      id: 'integrity:00000000-0000-4000-8000-000000000001:builder_active_market_gone:2026-09-21',
      kind: 'BUILDER_ACTIVE_MARKET_GONE',
      label: 'HEY observed recent builder activity while the tracked token market had already lost most of its liquidity.',
      summary: 'HEY observed recent builder activity while the tracked token market had already lost most of its liquidity. Token market status: liquidity removed. This describes the token market, not whether development has stopped.',
      source: 'hey_market_index',
      at: null,
      precision: 'observed',
      until: null,
      detectedAt: '2026-09-24T06:00:00Z',
      confidence: 'medium',
      facts: { kind: 'BUILDER_ACTIVE_MARKET_GONE', confidence: 'medium' },
    },
  ],
};
