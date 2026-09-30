import type { AgentCapabilityRequest, ParsedAgentRequest } from '../request';
import type { AgentIntelligenceResponse } from '../schema';
import { quoteForTransport } from '../text';

/**
 * The provider boundary (2026-09-30, readiness §6).
 *
 *   canonical HEY reads (snapshot, explain, ledger, coverage, peers, contracts)
 *        ↓  pure composers (`../compose`)
 *   AgentIntelligenceResponse v1
 *        ↓  thin adapters (this folder)
 *   REST · MCP · A2A · a future platform adapter
 *
 * An adapter moves a request in and an answer out. It never reads HEY's
 * database, never computes a research value, and never receives or stores a
 * platform user's account, portfolio, positions, orders or prompts: the only
 * input HEY needs is the research query (a project, a contract, a window).
 * When a platform publishes its provider contract, supporting it means
 * writing one of these — transport, authentication and billing — and no
 * change to the research logic.
 */
export interface AgentProviderAdapter<PlatformRequest, PlatformResponse> {
  /** A stable id for the adapter. */
  readonly id: string;
  /** `live` only for an adapter serving a published interface. */
  readonly status: 'live' | 'pending_official_specification';
  /** The platform's request as a capability request. Nothing else from the request is kept. */
  toCapabilityRequest(request: PlatformRequest): ParsedAgentRequest;
  /** HEY's answer in the platform's shape. It must keep the answer, each claim's FACT/DERIVED/UNKNOWN, the unknowns, freshness, evidence ids and the boundaries. */
  fromResponse(response: AgentIntelligenceResponse): PlatformResponse;
}

/** The fields no adapter may drop: what makes a HEY answer HEY's. */
export const ADAPTER_REQUIRED_FIELDS = ['answer', 'answerStatus', 'claims', 'unknowns', 'freshness', 'evidence', 'boundaries', 'asOf', 'schemaVersion'] as const;

/* ------------------------------------------------------------------ REST */

/** The HTTP status a REST answer carries: the body is the same envelope in every case. */
export function restStatusOf(response: Pick<AgentIntelligenceResponse, 'status'>): number {
  switch (response.status) {
    case 'ok':
      return 200;
    case 'moved':
      return 308;
    case 'invalid_request':
      return 400;
    case 'not_found':
    case 'unavailable':
      return 404;
  }
}

/* ------------------------------------------------------------------- A2A */

/** The A2A skill a capability arrives through, when a message asks for this contract. */
export const A2A_CONTRACT_OPTION = 'agent-intelligence-v1' as const;

export type A2aAgentParts = {
  parts: [{ text: string; mediaType: 'text/plain' }, { data: AgentIntelligenceResponse; mediaType: 'application/json' }];
  metadata: { contract: typeof A2A_CONTRACT_OPTION; capability: AgentCapabilityRequest['capability']; status: AgentIntelligenceResponse['status']; canonicalUrl: string; evidenceIds: string[]; notAdvice: true };
};

/**
 * An A2A message's parts: the answer sentence as text — HEY's words, a
 * source's words quoted and labelled — and the whole answer as data.
 */
export function toA2aParts(response: AgentIntelligenceResponse): A2aAgentParts {
  return {
    parts: [
      { text: `${quoteForTransport(response.answer)} (${response.answerStatus}; as of ${response.asOf}; not investment advice.)`, mediaType: 'text/plain' },
      { data: response, mediaType: 'application/json' },
    ],
    metadata: {
      contract: A2A_CONTRACT_OPTION,
      capability: response.capability,
      status: response.status,
      canonicalUrl: response.links.self,
      evidenceIds: response.evidence.map((ref) => ref.id),
      notAdvice: true,
    },
  };
}
