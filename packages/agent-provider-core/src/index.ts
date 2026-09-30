/**
 * `@hey/agent-provider-core` (2026-09-30): HEY's agent-facing contract.
 *
 * One domain response — AgentIntelligenceResponse v1 — composed purely from
 * the canonical public API objects, and thin adapters that carry it over
 * REST, MCP and A2A. Importing it has no side effect and reads nothing: the
 * web app does the canonical reads and hands their JSON to a composer.
 */
export * from './capabilities';
export * from './schema';
export * from './evidence-kinds';
export * from './disclosures';
export * from './text';
export * from './words';
export * from './freshness';
export * from './unknowns';
export * from './records';
export * from './request';
export * from './compose/common';
export * from './compose/gaps';
export * from './compose/research';
export * from './compose/changes';
export * from './compose/status';
export * from './compose/verify';
export * from './compose/compare';
export * from './compose/unknowns';
export * from './adapters/text';
export * from './adapters/provider';
export * from './adapters/robinhood';
