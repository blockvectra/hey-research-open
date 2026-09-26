import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, bitqueryAnswerError } from './bitquery';

/**
 * Every proxy upgrade the chain recorded for a set of contracts, from genesis
 * (2026-09-26).
 *
 * HEY's upgrade watch reads a proxy's implementation once a day and can say
 * only that it moved between two reads. The chain says more: an EIP-1967 proxy
 * emits `Upgraded(address implementation)` each time its implementation is
 * set, and a beacon proxy `BeaconUpgraded(address beacon)` when its beacon is.
 * Each log carries its block, its position and its transaction, which is the
 * evidence a reader can open.
 *
 * `Events` is in the archive grant (see `BITQUERY_ARCHIVE_CUBES`), and this
 * document reads no USD field, so `combined` answers for the whole chain back
 * to 2026-04-30 at the cost of one request per `BITQUERY_UPGRADE_BATCH`
 * contracts. Probed on 2026-09-26 (M4 P5): 56 contracts with `Upgraded` and 11
 * with `BeaconUpgraded` among the published tokens and their follow-ups.
 *
 * The event's own argument (the new implementation or beacon) is read when the
 * cube decodes it and left out when it does not; a missing argument is an
 * unknown, never a zero address. No account is read: the addresses are the
 * proxy, its implementation and its beacon, all contracts.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = /^0x0{40}$/;
const CACHE_TTL_SECONDS = 6 * 60 * 60;

/** Contracts per request; the probe answered 1,200 in about five seconds. */
export const BITQUERY_UPGRADE_BATCH = 1_200;

export const UPGRADE_EVENT_NAMES = ['Upgraded', 'BeaconUpgraded'] as const;
export type UpgradeEventName = (typeof UPGRADE_EVENT_NAMES)[number];

export const BITQUERY_UPGRADES_QUERY = `query HeyUpgradeEvents($addresses: [String!]) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: combined) {
    Events(
      where: { Log: { SmartContract: { in: $addresses }, Signature: { Name: { in: ["Upgraded", "BeaconUpgraded"] } } } }
      limit: { count: 5000 }
      orderBy: { ascending: Block_Number }
    ) {
      Block { Time Number }
      Transaction { Hash }
      Log { SmartContract Index Signature { Name } }
      Arguments { Name Value { ... on EVM_ABI_Address_Value_Arg { address } } }
    }
  }
}`;

const numberish = z.union([z.string(), z.number()]).nullish();

const rowSchema = z.object({
  Block: z.object({ Time: z.string().nullish(), Number: numberish }).nullish(),
  Transaction: z.object({ Hash: z.string().nullish() }).nullish(),
  Log: z
    .object({
      SmartContract: z.string().nullish(),
      Index: numberish,
      Signature: z.object({ Name: z.string().nullish() }).nullish(),
    })
    .nullish(),
  Arguments: z
    .array(z.object({ Name: z.string().nullish(), Value: z.object({ address: z.string().nullish() }).passthrough().nullish() }))
    .nullish(),
});

const responseSchema = z.object({
  data: z.object({ EVM: z.object({ Events: z.array(rowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryUpgradesInput = { addresses: readonly string[]; apiKey: string; baseUrl?: string };

export type BitqueryUpgradeEvent = {
  /** The proxy that emitted the log, lower-cased. */
  address: string;
  event: UpgradeEventName;
  /** The implementation an `Upgraded` names; absent when the cube did not decode it. */
  implementation?: string;
  /** The beacon a `BeaconUpgraded` names; absent when the cube did not decode it. */
  beacon?: string;
  blockNumber: number;
  logIndex: number;
  txHash?: string;
  occurredAt: Date;
};

const lower = (value: string | null | undefined): string | undefined => {
  const out = value?.toLowerCase();
  return out && ADDRESS.test(out) && !ZERO.test(out) ? out : undefined;
};
const int = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/**
 * One row per log, in chain order. A row missing its block, its position, its
 * time or its contract is dropped rather than patched: without them it is not
 * evidence anyone can open.
 */
export function normalizeBitqueryUpgrades(rows: readonly z.infer<typeof rowSchema>[] | null | undefined, addresses: readonly string[]): BitqueryUpgradeEvent[] {
  const wanted = new Set(addresses.map((address) => address.toLowerCase()));
  const out: BitqueryUpgradeEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    const address = lower(row.Log?.SmartContract);
    const name = row.Log?.Signature?.Name;
    const blockNumber = int(row.Block?.Number);
    const logIndex = int(row.Log?.Index);
    const occurredAt = row.Block?.Time ? new Date(row.Block.Time) : undefined;
    if (!address || !wanted.has(address)) continue;
    if (name !== 'Upgraded' && name !== 'BeaconUpgraded') continue;
    if (blockNumber === undefined || logIndex === undefined || !occurredAt || Number.isNaN(occurredAt.getTime())) continue;
    const key = `${address}:${blockNumber}:${logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const argument = (wantedName: string) => lower(row.Arguments?.find((arg) => arg.Name === wantedName)?.Value?.address ?? undefined);
    const implementation = name === 'Upgraded' ? argument('implementation') : undefined;
    const beacon = name === 'BeaconUpgraded' ? argument('beacon') : undefined;
    out.push({
      address,
      event: name,
      ...(implementation ? { implementation } : {}),
      ...(beacon ? { beacon } : {}),
      blockNumber,
      logIndex,
      ...(row.Transaction?.Hash && /^0x[0-9a-fA-F]{64}$/.test(row.Transaction.Hash) ? { txHash: row.Transaction.Hash.toLowerCase() } : {}),
      occurredAt,
    });
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

export function createBitqueryUpgradesAdapter(): SourceAdapter<BitqueryUpgradesInput, BitqueryUpgradeEvent[]> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      input.addresses.length > 0 && input.addresses.length <= BITQUERY_UPGRADE_BATCH && input.addresses.every((address) => ADDRESS.test(address)) && input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryUpgradeEvent[]>> {
      const addresses = [...new Set(input.addresses.map((address) => address.toLowerCase()))];
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({ query: BITQUERY_UPGRADES_QUERY, variables: { addresses } }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw bitqueryAnswerError(response.errors);
            return normalizeBitqueryUpgrades(response.data?.EVM?.Events, addresses);
          },
        },
      );
    },
  };
}
