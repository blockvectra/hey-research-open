/**
 * `GET /api/hey/profile` (2026-09-28): `$HEY` as research data, held equal to
 * its serialiser by `public-api-contract.misc.test.ts`. Absent or null means
 * HEY does not know, and every null carries a reason. Not investment advice.
 */

import type { HeyProjectSnapshot } from './snapshot';

/** LIVE on this deployment now, PLANNED (built but not open, or not built), RETIRED, or UNKNOWN (a setting HEY could not read). */
export type HeyTokenUtilityStatus = 'LIVE' | 'PLANNED' | 'RETIRED' | 'UNKNOWN';

export type HeyTokenUtility = {
  id: string;
  name: string;
  what: string;
  status: HeyTokenUtilityStatus;
  /** Why, as a code: `open_on_this_deployment`, `token_not_launched`, `built_not_open_on_this_deployment`, `designed_not_built`, … */
  statusReason: string;
  /** When HEY holds the date as data; null otherwise, with `effectiveDateReason`. */
  effectiveDate: string | null;
  effectiveDateReason?: string;
  /** The gate or console setting that decides the status. */
  decidedBy: string;
  docs: string;
};

export type HeyHolderTier = {
  id: 'free' | 'member' | 'member_plus';
  label: string;
  /** Null for the free tier: it needs no balance. */
  enabled: boolean | null;
  minHey: string | null;
  apiMonthlyRequests: number | null;
  discountBps: number;
  earlyAccess: boolean;
};

export type HeyTreasuryAsset = 'ETH' | 'HEY';

export type HeyReconciledAsset = {
  asset: HeyTreasuryAsset;
  /** Base units (18 decimals), as text. */
  first: { amount: string; block: string; observedAt: string };
  high: { amount: string; observedAt: string };
  latest: { amount: string; block: string; observedAt: string };
  /** latest − first, signed, base units. */
  change: string;
  ledger: { inflow: string; outflow: string; net: string; rows: number };
  /** change − ledger net, signed, base units. */
  unexplained: string;
  movedBeyondLedger: boolean;
};

export type HeyTreasuryReconciliation =
  | {
      reconciled: boolean;
      state: 'measured';
      firstReadAt: string;
      lastReadAt: string;
      assets: HeyReconciledAsset[];
      creatorTaxRowsRecorded: number;
      statement: string;
      basis: 'chain_read_and_ledger';
    }
  | {
      reconciled: boolean;
      state: 'not_read';
      reason: string;
      statement: string;
    };

export type HeyLiquidityLock =
  | {
      available: true;
      kind: 'launchpad_locked_position';
      launchpad: 'Pons';
      version: 'v2';
      position: 'full_range_uniswap_v4';
      locker: string | null;
      lockerReason?: string;
      graduated: boolean | null;
      graduatedReason?: string;
      phaseObservedAt: string | null;
      heldPermanentlyByDesign: true;
      verification: {
        check: 'position_locked';
        method: string;
        recorded: 'at_launch';
        checkedAt: null;
        checkedAtReason: 'verification_printed_not_stored';
      };
      relationToPairLocked: string;
      statement: string;
      basis: 'launch_verification';
    }
  | { available: false; reason: string; relationToPairLocked: string };

export type HeyUtilityReceiptRow = {
  id: string;
  label: string;
  /** A count, or HEY in base units (18 decimals) as text; null with `reason` when not read. */
  value: number | string | null;
  unit: 'count' | 'hey_base_units';
  reason?: string;
  asOf: string;
  source: string;
};

export type HeyUtilityReceipts = { rows: HeyUtilityReceiptRow[]; asOf: string; note: string };

export type HeyTokenProfile = {
  schema: 'hey.token-profile/v1';
  subject: {
    kind: 'token';
    ticker: string;
    symbol: string;
    chain: { name: string; chainId: number };
    /** Null before launch, with `contractReason`. */
    contract: string | null;
    contractReason?: string;
    status: 'live' | 'prelaunch';
    explorerUrl: string | null;
  };
  /** HEY's own project, researched by the same rules as every other project. */
  project: { slug: string; name: string; url: string; snapshotUrl: string; sameRulesAsEveryProject: true } | { slug: null; reason: string };
  identity: {
    product: {
      /** The brand ("HEY Research Lab"). */
      name: string;
      shortName: string;
      /** How HEY's own project record spells the name ("Hey Research Lab"); `nameNote` says which is which (added 2026-09-28). */
      projectRecordName: string;
      nameNote: string;
      description: string;
      shortDescription: string;
      whenToUse: string;
    };
    domain: string;
    baseUrl: string;
    repository: string;
    machineInterfaces: {
      base: string;
      docs: string;
      openapi: string;
      changes: string;
      shipsRss: string;
      webhooksDocs: string;
      heyProfile: string;
      receiptValidator: string;
      mcp: string;
      a2aAgentCard: string;
      llmsTxt: string;
      sdk: string;
      mcpPackage: string;
    };
  };
  supply: { totalSupply: string; decimals: number | null; observedAt: string | null; basis: 'chain_read' } | { totalSupply: null; reason: string };
  launch: {
    launchpad: 'Pons';
    version: string;
    factory: string | null;
    curve: { phase: 'curve' | 'graduated'; raisedEth: number; graduationEth: number; observedAt: string } | null;
    curveReason?: string;
    /** When HEY first recorded the token: knowledge time, not launch time. */
    firstRecordedByHeyAt: string | null;
  };
  /** The snapshot's market block: valuation `kind` (marketCap or fdv), provider and `observedAt` on every figure. Context only. */
  market:
    | { available: true; figures: NonNullable<HeyProjectSnapshot['market']>; freshness: { state: 'fresh' | 'stale' | 'unknown'; observedAt: string | null; staleAfterHours: number | null }; contextOnly: true }
    | { available: false; reason: string };
  locks: HeyProjectSnapshot['locks'] | { available: false; reason: string };
  builderEvidence:
    | { available: true; build: HeyProjectSnapshot['build']; verification: HeyProjectSnapshot['verification']; evidenceSummary: HeyProjectSnapshot['evidenceSummary']; links: HeyProjectSnapshot['links'] }
    | { available: false; reason: string };
  recentChanges: HeyProjectSnapshot['latestChanges'] | { available: false; reason: string; url: string };
  coverage: HeyProjectSnapshot['coverage'] | null;
  treasury: {
    address: string | null;
    balances: { asset: 'ETH' | 'HEY'; amount: string; block: string; observedAt: string; basis: 'chain_read' }[] | null;
    balancesReason?: string;
    creatorTaxBps: number | null;
    allocation: { statement: string; basis: 'documented_policy'; docs: string };
    /** Never part of the design; stated so an agent does not have to infer it. */
    buyback: { partOfDesign: false; statement: string; basis: 'documented_policy'; docs: string };
    ledger: { statement: string; docs: string };
    /** Whether the daily balance reads reconcile with the ledger (added 2026-10-10): figures computed from both, or `not_read` with its reason. */
    reconciliation: HeyTreasuryReconciliation;
  };
  /** The launch liquidity position in the Pons V2 locker (added 2026-10-10). `locks.tokenLock.pairLocked` reads HoodLock only. */
  liquidityLock: HeyLiquidityLock;
  /** What each use has actually done, one aggregate per row (added 2026-10-10). A null value was not read, never zero. */
  receipts: HeyUtilityReceipts | { rows: null; reason: string };
  holderTiers: { tiers: HeyHolderTier[]; basis: 'console_settings'; note: string } | { tiers: null; reason: string };
  utility: HeyTokenUtility[];
  risksAndUnknowns: string[];
  neutrality: string;
  disclaimer: string;
  asOf: string;
};
