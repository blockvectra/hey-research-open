import type { AgentProviderAdapter } from './provider';

/**
 * Robinhood Agent Apps (2026-09-30): **Adapter pending official Robinhood
 * Agent Apps provider specification.**
 *
 * Robinhood announced Agent Apps — third-party subscriptions whose datasets
 * and tools Robinhood-hosted agents use — and HEY's research of 2026-09-30
 * found no published provider specification on Robinhood's own pages: no
 * transport, request or response schema, authentication, billing or
 * discovery contract a provider could build against
 * (`docs/ROBINHOOD_AGENT_APPS_RESEARCH_2026_09_30.md`). HEY does
 * not guess one, does not treat the public Robinhood trading MCP as that
 * contract, and serves no endpoint claiming compatibility.
 *
 * What exists is the boundary: when the specification is published, this
 * interface is implemented with `status: 'live'`, mapping the platform's
 * request to an `AgentCapabilityRequest` and HEY's `AgentIntelligenceResponse`
 * to the platform's response. The research logic, the six capabilities and
 * the contract stay as they are. HEY is not a Robinhood Agent App and has no
 * Robinhood partnership.
 */
export const ROBINHOOD_AGENT_APPS_ADAPTER_NOTE = 'Adapter pending official Robinhood Agent Apps provider specification.' as const;

/** What the adapter will need from Robinhood's published specification, and does not have. */
export const ROBINHOOD_AGENT_APPS_PENDING = ['transport', 'request_schema', 'response_schema', 'authentication', 'billing_and_entitlements', 'discovery_metadata', 'rate_limits', 'error_contract'] as const;

export const ROBINHOOD_AGENT_APPS_ADAPTER = {
  id: 'robinhood-agent-apps',
  status: 'pending_official_specification',
  implemented: false,
  note: ROBINHOOD_AGENT_APPS_ADAPTER_NOTE,
  pendingSpecification: ROBINHOOD_AGENT_APPS_PENDING,
  /** What HEY would need from a Robinhood user to answer: nothing. The query is a project, a contract or a window. */
  userDataRequired: [] as const,
} as const;

/**
 * The shape a Robinhood Agent Apps adapter will take. The request and
 * response types are `unknown` because Robinhood has not published them.
 */
export type RobinhoodAgentAppsAdapter = AgentProviderAdapter<unknown, unknown> & { readonly status: 'pending_official_specification' | 'live'; readonly id: 'robinhood-agent-apps' };
