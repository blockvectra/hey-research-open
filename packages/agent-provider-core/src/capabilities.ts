/**
 * The six agent capabilities (2026-09-30, Robinhood Agent Apps readiness §2).
 *
 * HEY's agent product is small on purpose: six questions an agent working
 * for a person can ask about Robinhood Chain projects, each answered from
 * one or two canonical reads HEY already serves. Nothing here is a new
 * measurement; each capability names the canonical reads it restates.
 *
 * One definition, read by the REST route (`/api/agent/{capability}`), the
 * MCP tool (`research_answer`), the A2A skills (the `contract` option) and
 * the docs. A test holds every surface to this list.
 */
export const AGENT_CAPABILITIES = ['research_project', 'what_changed', 'builder_status', 'verify_project', 'compare_builders', 'unknowns'] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const isAgentCapability = (value: string): value is AgentCapability => (AGENT_CAPABILITIES as readonly string[]).includes(value);

export type AgentCapabilityParam = {
  name: 'project' | 'projects' | 'address' | 'days' | 'types' | 'limit' | 'chainId';
  required: boolean;
  description: string;
};

export type AgentCapabilityInfo = {
  id: AgentCapability;
  /** The question, in a person's words. */
  question: string;
  /** What the answer holds. */
  returns: string;
  params: readonly AgentCapabilityParam[];
  /** The canonical reads it restates (public API paths); nothing else. */
  canonicalReads: readonly string[];
  /** The A2A skill that answers it when the message asks for `"contract": "agent-intelligence-v1"`. */
  a2aSkill: 'research_project' | 'what_changed' | 'explain_fact' | 'investigate_contract' | 'compare_projects' | 'check_project_coverage';
  /** What it never does. */
  never: string;
};

const PROJECT: AgentCapabilityParam = { name: 'project', required: true, description: 'A published project slug, e.g. "agentos".' };
const CHAIN: AgentCapabilityParam = { name: 'chainId', required: false, description: 'Default and only accepted value: 4663, Robinhood Chain.' };

export const AGENT_CAPABILITY_INFO: Readonly<Record<AgentCapability, AgentCapabilityInfo>> = {
  research_project: {
    id: 'research_project',
    question: "What is HEY's current research view of this project?",
    returns: 'Identity, builder state, the latest meaningful change and recent changes, contract identity, market and usage context (context only), tagged claims from the Research Summary, unknowns, freshness and evidence ids.',
    params: [PROJECT, CHAIN],
    canonicalReads: ['/api/projects/{slug}/snapshot'],
    a2aSkill: 'research_project',
    never: 'A price view, a ranking by return or a recommendation.',
  },
  what_changed: {
    id: 'what_changed',
    question: 'What changed with this project, or on Robinhood Chain, in the last N days?',
    returns: 'Canonical change-ledger events in the window, newest first, with the true total by type, each event with its own time, precision, when HEY knew and its evidence.',
    params: [
      { name: 'project', required: false, description: 'A project slug; omit for the whole chain (projects building on Robinhood Chain).' },
      { name: 'days', required: false, description: '1–30; default 7. The window is on when the event happened, or when HEY detected it where no source dates it.' },
      { name: 'types', required: false, description: 'Change types to keep, comma-separated (build.release, build.ship, build.resumed …).' },
      { name: 'limit', required: false, description: '1–50 events shown; default 25. The total is always the whole window.' },
      CHAIN,
    ],
    canonicalReads: ['/api/changes'],
    a2aSkill: 'what_changed',
    never: 'A cause: an event beside a market move is a sequence.',
  },
  builder_status: {
    id: 'builder_status',
    question: 'Is this project still building, and why does HEY say so?',
    returns: 'The activity status with its methodology version, the inputs it read, the lineage from source to public value, the supporting evidence, the context the rule excludes (price, market cap, liquidity, volume, holders, usage, paid promotion, $HEY), freshness and unknown inputs.',
    params: [PROJECT, CHAIN],
    canonicalReads: ['/api/projects/{slug}/explain?fact=activity.status', '/api/projects/{slug}/explain?fact=build.momentum', '/api/projects/{slug}/explain?fact=still_building'],
    a2aSkill: 'explain_fact',
    never: 'Investment advice: a building status is a record of development, not a view on the token.',
  },
  verify_project: {
    id: 'verify_project',
    question: 'Does this contract or token appear to belong to this project?',
    returns: 'VERIFIED, UNVERIFIED, CONTRACT_MISMATCH or UNKNOWN, with the reason code, the reasons in words, the project HEY records the contract under and how.',
    params: [
      { name: 'address', required: true, description: 'A 0x contract address on Robinhood Chain.' },
      { name: 'project', required: false, description: 'The project slug the caller believes it belongs to.' },
      CHAIN,
    ],
    canonicalReads: ['/api/token/{chainId}/{address}', '/api/contracts/{chainId}/{address}'],
    a2aSkill: 'investigate_contract',
    never: 'A safety verdict: VERIFIED means the project itself names the contract, never that it is safe.',
  },
  compare_builders: {
    id: 'compare_builders',
    question: "How do these projects' building records compare over 30 days?",
    returns: 'Two to four projects side by side on factual builder metrics (status, last meaningful ship, meaningful events this 30 days and the 30 before, release cadence, active weeks, Build Momentum, verification) with each one’s peer cohort; no winner, no order but the one asked.',
    params: [{ name: 'projects', required: true, description: 'Two to four project slugs, comma-separated.' }, CHAIN],
    canonicalReads: ['/api/compare', '/api/projects/{slug}/snapshot (peer context)'],
    a2aSkill: 'compare_projects',
    never: 'A better investment, a winner or a combined score.',
  },
  unknowns: {
    id: 'unknowns',
    question: 'What does HEY not know about this project or token?',
    returns: 'Every gap as UNKNOWN, NOT_MEASURED, NOT_VERIFIED, STALE or INSUFFICIENT_EVIDENCE, with the dimension, a reason code, what HEY lacks and what an agent must not conclude from it; and the dimensions HEY did measure.',
    params: [
      { name: 'project', required: false, description: 'A project slug (this or address).' },
      { name: 'address', required: false, description: 'A token or contract address, when the caller holds no slug.' },
      CHAIN,
    ],
    canonicalReads: ['/api/projects/{slug}/coverage', '/api/projects/{slug}/snapshot'],
    a2aSkill: 'check_project_coverage',
    never: 'Negative evidence: a gap is what HEY does not hold, never a finding about the project.',
  },
};
