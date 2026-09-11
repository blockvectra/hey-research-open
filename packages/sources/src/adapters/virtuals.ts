import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * Virtuals agents on Robinhood Chain.
 *
 * Verified 2026-09-01: the public API exposes a `chain` filter, and
 * `filters[chain]=ROBINHOOD` returns 25,253 agents against 82,401 globally.
 * Sampled `preToken` addresses resolve to real 45-byte contracts (EIP-1167
 * minimal proxies) on chain 4663.
 *
 * Paginated **oldest-first**. The catalogue grows while a backfill runs, and
 * newest-first ordering would shift every page each time an agent is created —
 * a resumed scan would then re-read what it had already seen and skip what it
 * had not. Ascending order appends new agents at the end and leaves earlier
 * pages stable, which is what makes resuming from a stored page correct.
 *
 * **Only the Robinhood Chain slice is ever requested.** Pulling the global
 * ecosystem would put 57,000 agents that live on other chains into a
 * chain-locked product, and no amount of later filtering makes that safe —
 * the filter belongs in the request, not in the cleanup.
 */
export const VIRTUALS_DEFAULT_BASE_URL = 'https://api.virtuals.io/api';
export const VIRTUALS_CHAIN_FILTER = 'ROBINHOOD';
/** The API caps page size; 100 keeps the 25k catalogue to ~253 requests. */
export const VIRTUALS_PAGE_SIZE = 100;

const agentSchema = z.object({
  id: z.number().nullish(),
  uid: z.string().nullish(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  description: z.string().nullish(),
  chain: z.string().nullish(),
  status: z.string().nullish(),
  category: z.string().nullish(),
  role: z.string().nullish(),
  createdAt: z.string().nullish(),
  /** Set once an agent graduates from its bonding curve. */
  tokenAddress: z.string().nullish(),
  /**
   * Links Virtuals itself marked verified.
   *
   * This is the qualification evidence the adapter previously discarded: an
   * external site the project owns is identity a launchpad page cannot supply.
   */
  socials: z
    .object({
      VERIFIED_LINKS: z
        .object({ WEBSITE: z.string().nullish(), TWITTER: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
  /** A registered ACP service — supporting evidence of substance. */
  acpAgentId: z.union([z.string(), z.number()]).nullish(),
  v3AcpAgentId: z.union([z.string(), z.number()]).nullish(),
  /** The bonding-curve token, which is what most agents have. */
  preToken: z.string().nullish(),
  /** The artwork the team uploaded, served from the Virtuals CDN. */
  image: z.object({ url: z.string().nullish() }).nullish(),
});

const responseSchema = z.object({
  data: z.array(agentSchema).nullish(),
  meta: z
    .object({
      pagination: z.object({ page: z.number().nullish(), total: z.number().nullish() }).nullish(),
    })
    .nullish(),
});

export type VirtualsInput = {
  chainId: number;
  page: number;
  pageSize?: number;
  baseUrl?: string;
};

export type VirtualsAgent = {
  chainId: number;
  contractAddress: string;
  agentId: string;
  name?: string;
  symbol?: string;
  description?: string;
  officialUrl?: string;
  agentStatus?: string;
  category?: string;
  /** Verified external site, distinct from the agent's page on Virtuals. */
  verifiedWebsite?: string;
  verifiedTwitter?: string;
  serviceId?: string;
  /** Logo the team uploaded to Virtuals; absolute https URL. */
  imageUrl?: string;
  createdAt?: Date;
  /** True when the agent graduated and has a full token rather than a pre-token. */
  graduated: boolean;
};

export type VirtualsPage = { agents: VirtualsAgent[]; total?: number };

const CACHE_TTL_SECONDS = 3_600;

/** Accepts only absolute http(s) links; the API stores empty strings freely. */
const cleanLink = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
};
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function createVirtualsAdapter(): SourceAdapter<VirtualsInput, VirtualsPage> {
  return {
    name: 'virtuals',

    canHandle(input) {
      return input.page >= 1 && input.chainId > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<VirtualsPage>> {
      const base = (input.baseUrl ?? VIRTUALS_DEFAULT_BASE_URL).replace(/\/$/, '');
      const size = Math.min(input.pageSize ?? VIRTUALS_PAGE_SIZE, VIRTUALS_PAGE_SIZE);
      const url =
        `${base}/virtuals?filters%5Bchain%5D=${VIRTUALS_CHAIN_FILTER}` +
        `&pagination%5BpageSize%5D=${size}&pagination%5Bpage%5D=${input.page}&sort=createdAt%3Aasc`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): VirtualsPage => {
            const agents: VirtualsAgent[] = [];

            for (const agent of raw.data ?? []) {
              // Defence in depth: the filter is in the request, but a provider
              // that ignores it must not slip a foreign chain into a locked product.
              if (agent.chain && agent.chain.toUpperCase() !== VIRTUALS_CHAIN_FILTER) continue;

              const graduated = Boolean(agent.tokenAddress);
              const address = (agent.tokenAddress ?? agent.preToken ?? '').toLowerCase();
              if (!ADDRESS_PATTERN.test(address)) continue;

              const createdAt = agent.createdAt ? new Date(agent.createdAt) : undefined;

              agents.push({
                chainId: input.chainId,
                contractAddress: address,
                agentId: String(agent.uid ?? agent.id ?? address),
                graduated,
                ...opt('name', agent.name ?? undefined),
                ...opt('symbol', agent.symbol ?? undefined),
                ...opt('description', agent.description ?? undefined),
                ...opt('agentStatus', agent.status ?? undefined),
                ...opt('category', agent.category ?? undefined),
                ...opt('verifiedWebsite', cleanLink(agent.socials?.VERIFIED_LINKS?.WEBSITE)),
                ...opt('verifiedTwitter', cleanLink(agent.socials?.VERIFIED_LINKS?.TWITTER)),
                ...opt('imageUrl', cleanLink(agent.image?.url)),
                ...opt(
                  'serviceId',
                  agent.acpAgentId || agent.v3AcpAgentId
                    ? String(agent.acpAgentId ?? agent.v3AcpAgentId)
                    : undefined,
                ),
                ...opt(
                  'officialUrl',
                  agent.uid
                    ? `https://app.virtuals.io/virtuals/${agent.id ?? agent.uid}`
                    : undefined,
                ),
                ...opt(
                  'createdAt',
                  createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined,
                ),
              });
            }

            return {
              agents,
              ...opt('total', raw.meta?.pagination?.total ?? undefined),
            };
          },
        },
      );
    },
  };
}
