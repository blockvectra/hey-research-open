import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * HoodLock, the token and LP locker on Robinhood Chain (2026-09-22).
 *
 * A locker answers one question a reader keeps asking about a launch: is the
 * team's supply free to move today. HEY already held the answer and was
 * drawing it wrong — the locker contract appears in `token_holder_days` 22
 * times with a null label, once at rank 1 holding 17.33% of a token's supply,
 * which on the bubble map reads as "one unnamed address holds a sixth of
 * this" when the truth is "that sixth is locked".
 *
 * Everything below was read from the deployed contract on 2026-09-22 rather
 * than from documentation, and two of the readings contradict the docs:
 *
 *   - `getLock(id).amount` is the ORIGINAL deposit, not the balance. Lock #1
 *     reports 100,000 there while `lockedAmount(1)` is 0, because it has been
 *     withdrawn. A reader of `amount` alone would print released supply as
 *     locked, so this adapter always reads both and the live figure wins.
 *   - `isUnlocked(id)` is TIME-based, not withdrawal-based. Lock #0 still
 *     holds 2,000,000 tokens and `isUnlocked` is true, because its unlock
 *     time has passed and nobody has claimed it. It is deliberately not read
 *     here: "claimable" and "gone" are different facts and the pair
 *     (`withdrawn`, `unlockAt`) states both without the ambiguity.
 *
 * Context, never a verdict. A lock is market context in the sense of CLAUDE.md
 * product rule 3 — it is never an input to activity status, Build Momentum,
 * the Discovery Gap or any ranking, and the absence of a lock is never
 * presented as a finding about a project.
 */
export const HOODLOCK = {
  chainId: 4663,
  /**
   * Verified live: 4,941 bytes of code at this address, and every function
   * this adapter calls was confirmed present by scanning the deployed
   * bytecode for its selector before a single call was written.
   */
  address: '0xd0f7d8c6e9f6d80c297bebe4f7fd1b9c8125c32f',
  /** Where a reader can see the lock itself. 200 for a live lock, 404 for an id the locker never issued. */
  proofUrl: (lockId: number) => `https://hoodlock.tech/proof/lock/${lockId}`,
} as const;

/** `keccak(signature)[0:4]`, each derived with viem and checked against the deployed bytecode. */
const SELECTORS = {
  totalLocks: '0xd2d18eac',
  getLock: '0xd68f4dd1',
  lockedAmount: '0xcf1cb351',
  token0: '0x0dfe1681',
  token1: '0xd21220a7',
} as const;

const envelopeSchema = z.object({
  id: z.union([z.number(), z.string()]).nullish(),
  result: z.string().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});
const batchSchema = z.array(envelopeSchema);

const resultFor = (rows: readonly z.infer<typeof envelopeSchema>[], id: number): string | undefined =>
  rows.find((row) => Number(row.id) === id)?.result;

/** A batch whose first result is not one readable uint256 is a response HEY does not understand. */
const totalSchema = batchSchema.superRefine((rows, context) => {
  const parts = words(rows.find((row) => Number(row.id) === 1)?.result);
  if (parts === undefined || parts.length !== 1) {
    context.addIssue({ code: 'custom', message: 'missing totalLocks result' });
    return;
  }
  if (BigInt(`0x${parts[0]!}`) > BigInt(Number.MAX_SAFE_INTEGER)) {
    context.addIssue({ code: 'custom', message: 'totalLocks beyond a safe integer' });
  }
});

/** A uint256 argument as its 32-byte calldata word. */
const word = (value: number | bigint): string => BigInt(value).toString(16).padStart(64, '0');

/** Split an `eth_call` return into 32-byte words, or `undefined` if it is not a whole number of them. */
function words(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (hex.length === 0 || hex.length % 64 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return undefined;
  return Array.from({ length: hex.length / 64 }, (_, index) => hex.slice(index * 64, index * 64 + 64));
}

/** The low 20 bytes of a word, as a lower-cased address. */
const addressFrom = (value: string): string => `0x${value.slice(24)}`.toLowerCase();

const uintFrom = (value: string): bigint => BigInt(`0x${value}`);

export type HoodlockTotalInput = { rpcUrl: string };
export type HoodlockTotal = { totalLocks: number };

/**
 * How many locks the contract has ever issued — the reconciliation figure.
 *
 * Never cached: it is the one read that tells a sweep whether it has seen
 * everything, and a stale answer would make the sweep believe it was complete
 * while new locks sat unread.
 */
export function createHoodlockTotalLocksAdapter(): SourceAdapter<HoodlockTotalInput, HoodlockTotal> {
  return {
    name: 'hoodlock-total',

    canHandle(input) {
      return /^https?:\/\//.test(input.rpcUrl);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<HoodlockTotal>> {
      const body = JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: HOODLOCK.address, data: SELECTORS.totalLocks }, 'latest'] },
      ]);
      return performSourceFetch(
        ctx,
        { url: input.rpcUrl, method: 'POST', body, headers: { 'content-type': 'application/json' }, conditional: false },
        {
          /*
           * The count is refined on the schema rather than in `normalize`, so
           * an answer HEY cannot read becomes an `INVALID_RESPONSE` the
           * caller can act on — not a zero that would read as "no locks".
           */
          schema: totalSchema,
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: 0,
          normalize: (rows): HoodlockTotal => ({ totalLocks: Number(uintFrom(words(resultFor(rows, 1))![0]!)) }),
        },
      );
    },
  };
}

/**
 * Locks per batched request (2026-09-22).
 *
 * Each lock costs two `eth_call`s and this node counts the calls inside a
 * batch rather than the batches — the same ceiling `ERC20_SUPPLY_BATCH`
 * records. Twenty locks is forty calls, which answered in 544 ms across the
 * whole 515-lock universe when measured, and leaves margin for the other jobs
 * sharing the node.
 */
export const HOODLOCK_LOCK_BATCH = 20;

export type HoodlockLockInput = {
  rpcUrl: string;
  /** At most `HOODLOCK_LOCK_BATCH` lock ids; the caller chunks. */
  lockIds: readonly number[];
};

export type HoodlockLock = {
  lockId: number;
  /** The locked asset — an ERC-20 or a v2-style LP token. Lower-cased. */
  tokenAddress: string;
  /** The deposit as it was made, raw units. Kept because a reader asking "how much was locked" means this. */
  originalAmount: string;
  /** What the locker holds for this lock right now, raw units. This is the figure the page prints. */
  lockedAmount: string;
  /** When the lock's time expires. Not a claim that anything was withdrawn. */
  unlockAt: Date;
  /** Whether the deposit has been taken back out. */
  withdrawn: boolean;
};

/**
 * Several locks at once, each read twice so the live balance is never
 * inferred from the original deposit.
 *
 * A lock the node answers nothing usable for is absent from the result rather
 * than guessed at, so the caller can tell which ids it asked about and never
 * heard back — an unread lock must never be written as a released one.
 */
export function createHoodlockLockBatchAdapter(): SourceAdapter<HoodlockLockInput, HoodlockLock[]> {
  return {
    name: 'hoodlock-locks',

    canHandle(input) {
      return (
        /^https?:\/\//.test(input.rpcUrl) &&
        input.lockIds.length > 0 &&
        input.lockIds.length <= HOODLOCK_LOCK_BATCH &&
        input.lockIds.every((id) => Number.isInteger(id) && id >= 0)
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<HoodlockLock[]>> {
      const lockIds = [...input.lockIds];
      const body = JSON.stringify(
        lockIds.flatMap((lockId, index) => [
          {
            jsonrpc: '2.0',
            id: 2 * index + 1,
            method: 'eth_call',
            params: [{ to: HOODLOCK.address, data: `${SELECTORS.getLock}${word(lockId)}` }, 'latest'],
          },
          {
            jsonrpc: '2.0',
            id: 2 * index + 2,
            method: 'eth_call',
            params: [{ to: HOODLOCK.address, data: `${SELECTORS.lockedAmount}${word(lockId)}` }, 'latest'],
          },
        ]),
      );

      return performSourceFetch(
        ctx,
        { url: input.rpcUrl, method: 'POST', body, headers: { 'content-type': 'application/json' }, conditional: false },
        {
          schema: batchSchema,
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: 0,
          normalize: (rows): HoodlockLock[] => {
            const out: HoodlockLock[] = [];
            lockIds.forEach((lockId, index) => {
              /*
               * `getLock` returns (owner, token, amount, unlockTime, withdrawn).
               * The owner word is read past deliberately and never returned: the
               * page never shows it, and not carrying it keeps this feature clear
               * of the wallet boundary in CLAUDE.md product rule 1 by construction
               * rather than by discipline.
               */
              const lock = words(resultFor(rows, 2 * index + 1));
              const live = words(resultFor(rows, 2 * index + 2));
              if (lock === undefined || lock.length !== 5 || live === undefined || live.length !== 1) return;

              const tokenAddress = addressFrom(lock[1]!);
              if (!/^0x[0-9a-f]{40}$/.test(tokenAddress) || tokenAddress === '0x0000000000000000000000000000000000000000') return;

              const unlockSeconds = uintFrom(lock[3]!);
              /* Outside what a Date can hold is a read HEY does not understand, not a lock with a strange date. */
              if (unlockSeconds <= 0n || unlockSeconds > 100_000_000_000n) return;

              out.push({
                lockId,
                tokenAddress,
                originalAmount: uintFrom(lock[2]!).toString(),
                lockedAmount: uintFrom(live[0]!).toString(),
                unlockAt: new Date(Number(unlockSeconds) * 1000),
                withdrawn: uintFrom(lock[4]!) !== 0n,
              });
            });
            return out;
          },
        },
      );
    },
  };
}

export type HoodlockAssetKindInput = {
  rpcUrl: string;
  /** At most `HOODLOCK_LOCK_BATCH` locked asset contracts; the caller chunks. */
  addresses: readonly string[];
};

/** What a locked asset turned out to be when HEY asked it. */
export type HoodlockAssetKind = {
  address: string;
  /** `lp` when the contract answers both `token0()` and `token1()`; `token` otherwise. */
  kind: 'lp' | 'token';
  /** The pair's two sides, present only for `lp`. */
  token0?: string;
  token1?: string;
};

/**
 * Whether a locked asset is a plain token or a liquidity pair, asked of the
 * asset itself (2026-09-22).
 *
 * HEY cannot answer this from its own tables and must not try. `venue` is a
 * free-text provider label with 24 spellings in production, the largest
 * bucket of which ("uniswap", 585 rows) carries no version at all; and
 * `pair_address` is not always an address — for a Uniswap v4 pool it is a
 * 32-byte pool id, because a v4 pool has no ERC-20 LP token for anyone to
 * lock. Matching locked assets against that column found nothing and would
 * have kept finding nothing.
 *
 * Asking the contract works: of the 301 distinct assets locked across
 * HoodLock, exactly one answers `token0()`/`token1()`. That is the honest
 * present state of LP locking on this chain, and it is why a project with no
 * LP lock is shown as "not applicable" rather than as something missing.
 */
export function createHoodlockAssetKindAdapter(): SourceAdapter<HoodlockAssetKindInput, HoodlockAssetKind[]> {
  return {
    name: 'hoodlock-asset-kind',

    canHandle(input) {
      return (
        /^https?:\/\//.test(input.rpcUrl) &&
        input.addresses.length > 0 &&
        input.addresses.length <= HOODLOCK_LOCK_BATCH &&
        input.addresses.every((address) => /^0x[a-fA-F0-9]{40}$/.test(address))
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<HoodlockAssetKind[]>> {
      const addresses = input.addresses.map((address) => address.toLowerCase());
      const body = JSON.stringify(
        addresses.flatMap((address, index) => [
          { jsonrpc: '2.0', id: 2 * index + 1, method: 'eth_call', params: [{ to: address, data: SELECTORS.token0 }, 'latest'] },
          { jsonrpc: '2.0', id: 2 * index + 2, method: 'eth_call', params: [{ to: address, data: SELECTORS.token1 }, 'latest'] },
        ]),
      );

      return performSourceFetch(
        ctx,
        { url: input.rpcUrl, method: 'POST', body, headers: { 'content-type': 'application/json' }, conditional: false },
        {
          schema: batchSchema,
          parse: (raw) => JSON.parse(raw) as unknown,
          /* What a contract is does not change; a day is short enough to pick up a redeploy at a new address. */
          cacheTtlSeconds: 86_400,
          normalize: (rows): HoodlockAssetKind[] =>
            addresses.map((address, index) => {
              const zero = words(resultFor(rows, 2 * index + 1));
              const one = words(resultFor(rows, 2 * index + 2));
              if (zero?.length !== 1 || one?.length !== 1) return { address, kind: 'token' as const };
              const token0 = addressFrom(zero[0]!);
              const token1 = addressFrom(one[0]!);
              if (!/^0x[0-9a-f]{40}$/.test(token0) || !/^0x[0-9a-f]{40}$/.test(token1)) return { address, kind: 'token' as const };
              return { address, kind: 'lp' as const, token0, token1 };
            }),
        },
      );
    },
  };
}
