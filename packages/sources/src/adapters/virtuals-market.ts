import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { opt } from '../optional';
import { VIRTUALS_CHAIN_FILTER, VIRTUALS_DEFAULT_BASE_URL } from './virtuals';

/**
 * Virtuals — the launchpad's own market figures for a batch of agents.
 *
 * Every Virtuals agent carries `mcapInVirtual`, `fdvInVirtual` and
 * `liquidityUsd` from the moment it is launched, bonding curve included. For
 * the ~2,100 published HEY projects that are Virtuals agents without a DEX
 * pair, this is the only market figure that exists — so it is recorded as
 * what it is: the launchpad's curve/pool valuation, denominated in VIRTUAL,
 * with source `virtuals`. The caller converts to USD with a VIRTUAL/USD
 * reading taken in the same run; the adapter never does, and no rate is ever
 * written into code.
 *
 * Verified 2026-09-03: the Strapi filter `filters[$or][0][preToken][$in][i]`
 * + `filters[$or][1][tokenAddress][$in][i]` matches lowercase addresses
 * case-insensitively and returns one agent per address; 25 addresses is a
 * ~5 KB URL and a ~110 KB body. `fields[]` and `filters[status]` are not
 * honoured by the API, so the whole agent record arrives and the schema below
 * keeps only the market fields.
 *
 * `holderCount`, `top10HolderPercentage`, `devHoldingPercentage` and the
 * per-window price changes are present in the payload and deliberately not
 * declared here: HEY stores no holder data (CLAUDE.md product rule 1).
 */
export const VIRTUALS_MARKET_BATCH_SIZE = 25;

const CACHE_TTL_SECONDS = 60 * 60;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const agentSchema = z.object({
  id: z.number().nullish(),
  uid: z.string().nullish(),
  chain: z.string().nullish(),
  status: z.string().nullish(),
  preToken: z.string().nullish(),
  tokenAddress: z.string().nullish(),
  mcapInVirtual: z.number().nullish(),
  fdvInVirtual: z.number().nullish(),
  liquidityUsd: z.number().nullish(),
});

const responseSchema = z.object({ data: z.array(agentSchema).nullish() });

export type VirtualsMarketInput = {
  chainId: number;
  /** Lowercase contract addresses, at most `VIRTUALS_MARKET_BATCH_SIZE`; the caller chunks. */
  addresses: readonly string[];
  baseUrl?: string;
};

export type VirtualsMarketReading = {
  chainId: number;
  contractAddress: string;
  agentId: string;
  /** The agent's page on Virtuals — provenance for the figure, never the project's site. */
  pageUrl: string;
  graduated: boolean;
  /** Curve/pool market cap and FDV, in VIRTUAL. */
  mcapInVirtual?: number;
  fdvInVirtual?: number;
  liquidityUsd?: number;
};

export function virtualsMarketUrl(base: string, addresses: readonly string[]): string {
  const root = base.replace(/\/$/, '');
  const parts = [
    `filters%5Bchain%5D=${VIRTUALS_CHAIN_FILTER}`,
    `pagination%5BpageSize%5D=${Math.max(VIRTUALS_MARKET_BATCH_SIZE * 2, 50)}`,
  ];
  addresses.forEach((address, index) => {
    const value = address.toLowerCase();
    parts.push(`filters%5B%24or%5D%5B0%5D%5BpreToken%5D%5B%24in%5D%5B${index}%5D=${value}`);
    parts.push(`filters%5B%24or%5D%5B1%5D%5BtokenAddress%5D%5B%24in%5D%5B${index}%5D=${value}`);
  });
  return `${root}/virtuals?${parts.join('&')}`;
}

const positive = (value: number | null | undefined): number | undefined => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

export function createVirtualsMarketAdapter(): SourceAdapter<
  VirtualsMarketInput,
  VirtualsMarketReading[]
> {
  return {
    name: 'virtuals-market',

    canHandle(input) {
      return (
        input.chainId > 0 &&
        input.addresses.length > 0 &&
        input.addresses.length <= VIRTUALS_MARKET_BATCH_SIZE &&
        input.addresses.every((address) => ADDRESS_PATTERN.test(address))
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<VirtualsMarketReading[]>> {
      const url = virtualsMarketUrl(input.baseUrl ?? VIRTUALS_DEFAULT_BASE_URL, input.addresses);

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): VirtualsMarketReading[] => {
            const requested = new Set(input.addresses.map((address) => address.toLowerCase()));
            const readings: VirtualsMarketReading[] = [];
            const seen = new Set<string>();

            for (const agent of raw.data ?? []) {
              // The chain filter is in the request; a provider ignoring it must
              // not slip a foreign chain into a chain-locked product.
              if (agent.chain && agent.chain.toUpperCase() !== VIRTUALS_CHAIN_FILTER) continue;

              const graduated = Boolean(agent.tokenAddress);
              const address = (agent.tokenAddress ?? agent.preToken ?? '').toLowerCase();
              if (!ADDRESS_PATTERN.test(address) || !requested.has(address) || seen.has(address)) {
                continue;
              }
              seen.add(address);

              readings.push({
                chainId: input.chainId,
                contractAddress: address,
                agentId: String(agent.uid ?? agent.id ?? address),
                pageUrl: `https://app.virtuals.io/virtuals/${agent.id ?? agent.uid ?? ''}`,
                graduated,
                ...opt('mcapInVirtual', positive(agent.mcapInVirtual)),
                ...opt('fdvInVirtual', positive(agent.fdvInVirtual)),
                ...opt('liquidityUsd', positive(agent.liquidityUsd)),
              });
            }

            return readings;
          },
        },
      );
    },
  };
}
