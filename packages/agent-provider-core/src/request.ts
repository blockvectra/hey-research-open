import { z } from 'zod';

import { AGENT_CAPABILITIES, type AgentCapability } from './capabilities';
import { AGENT_LIMITS } from './schema';

/**
 * One request validator for every transport (2026-09-30): the REST route's
 * query string, an A2A data part and the MCP tool's arguments all become an
 * `AgentCapabilityRequest` here, so a malformed request is refused with the
 * same words wherever it arrives. Tight on purpose: slugs, 0x addresses,
 * bounded numbers and lists — no free text reaches a read.
 */
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, 'a project slug (lower-case letters, digits and hyphens)');
const address = z.string().trim().regex(/^0[xX][0-9a-fA-F]{40}$/, 'a 0x contract address (40 hex characters)').transform((value) => value.toLowerCase());
const changeType = z.string().regex(/^[a-z_]+\.[a-z_]+$/, 'a change type such as build.release');
const chainId = z.number().int().positive().optional();

export const agentRequestSchema = z.discriminatedUnion('capability', [
  z.object({ capability: z.literal('research_project'), project: slug, chainId }).strict(),
  z
    .object({
      capability: z.literal('what_changed'),
      project: slug.optional(),
      days: z.number().int().min(1).max(30).default(7),
      types: z.array(changeType).min(1).max(20).optional(),
      limit: z.number().int().min(1).max(AGENT_LIMITS.changes).default(AGENT_LIMITS.changesDefault),
      /** `only` (2026-09-30, additive): events that count toward activity status, by the ledger's own `countsAsBuilding` flag. */
      building: z.literal('only').optional(),
      chainId,
    })
    .strict(),
  z.object({ capability: z.literal('builder_status'), project: slug, chainId }).strict(),
  z.object({ capability: z.literal('verify_project'), address, project: slug.optional(), chainId }).strict(),
  z
    .object({
      capability: z.literal('compare_builders'),
      projects: z
        .array(slug)
        .min(2)
        .max(AGENT_LIMITS.compareProjects)
        .refine((list) => new Set(list).size === list.length, 'each project once'),
      chainId,
    })
    .strict(),
  // Exactly one of project or address: checked in `parseAgentRequest`, since a discriminated union takes plain objects only.
  z.object({ capability: z.literal('unknowns'), project: slug.optional(), address: address.optional(), chainId }).strict(),
]);

export type AgentCapabilityRequest = z.infer<typeof agentRequestSchema>;
export type AgentCapabilityRequestOf<C extends AgentCapability> = Extract<AgentCapabilityRequest, { capability: C }>;

export type ParsedAgentRequest = { ok: true; request: AgentCapabilityRequest } | { ok: false; code: 'unknown_capability' | 'invalid_request'; message: string };

export function parseAgentRequest(raw: unknown): ParsedAgentRequest {
  const capability = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { capability?: unknown }).capability : undefined;
  if (typeof capability !== 'string' || !(AGENT_CAPABILITIES as readonly string[]).includes(capability)) {
    return { ok: false, code: 'unknown_capability', message: `capability must be one of: ${AGENT_CAPABILITIES.join(', ')}.` };
  }
  const parsed = agentRequestSchema.safeParse(raw);
  if (parsed.success) {
    if (parsed.data.capability === 'unknowns' && Boolean(parsed.data.project) === Boolean(parsed.data.address)) return { ok: false, code: 'invalid_request', message: 'unknowns: name either project or address.' };
    return { ok: true, request: parsed.data };
  }
  const issue = parsed.error.issues[0];
  /*
   * Never the caller's own words (2026-09-30, adversarial review): a refusal
   * is read back to an agent as HEY's answer, so an unknown parameter's name
   * — which a crafted URL can make any sentence — is not repeated. The
   * message names what the capability does take; the other issues name only
   * HEY's own field names.
   */
  if (!issue || issue.code === 'unrecognized_keys') {
    return { ok: false, code: 'invalid_request', message: `${capability}: an unknown parameter. It takes ${takes(capability as AgentCapability)}.` };
  }
  const field = issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number').map(String);
  const known = field.length > 0 && KNOWN_PARAMS.has(field[0]!) ? field.join('.') : capability;
  return { ok: false, code: 'invalid_request', message: `${known}: ${issue.message}.` };
}

const KNOWN_PARAMS: ReadonlySet<string> = new Set(['capability', 'project', 'projects', 'address', 'days', 'types', 'limit', 'building', 'chainId']);

const TAKES: Readonly<Record<AgentCapability, string>> = {
  research_project: 'project and chainId',
  what_changed: 'project, days, types, limit, building and chainId',
  builder_status: 'project and chainId',
  verify_project: 'address, project and chainId',
  compare_builders: 'projects and chainId',
  unknowns: 'project or address, and chainId',
};
const takes = (capability: AgentCapability): string => TAKES[capability];

const LIST = /[\s,]+/;

/**
 * A REST query string as a request: `project`, `projects` and `types` as
 * comma-separated lists, `days`, `limit` and `chainId` as integers. A
 * parameter the capability does not take is refused, never dropped in
 * silence.
 */
export function agentRequestFromQuery(capability: string, params: URLSearchParams): ParsedAgentRequest {
  const raw: Record<string, unknown> = { capability };
  for (const [key, value] of params.entries()) {
    if (key in raw) return { ok: false, code: 'invalid_request', message: KNOWN_PARAMS.has(key) ? `${key}: give it once.` : 'A parameter was given twice: give each once.' };
    if (key === 'projects' || key === 'types') raw[key] = value.split(LIST).filter(Boolean).slice(0, 24);
    else if (key === 'days' || key === 'limit' || key === 'chainId') raw[key] = /^\d{1,6}$/.test(value) ? Number(value) : value;
    else raw[key] = value;
  }
  return parseAgentRequest(raw);
}

/** The request as the response's `query` echoes it. */
export function queryEcho(request: AgentCapabilityRequest, chainId: number) {
  return {
    chainId,
    ...('project' in request && request.project ? { project: request.project } : {}),
    ...('projects' in request ? { projects: request.projects } : {}),
    ...('address' in request && request.address ? { address: request.address } : {}),
    ...('days' in request ? { days: request.days } : {}),
    ...('types' in request && request.types ? { types: request.types } : {}),
    ...('limit' in request ? { limit: request.limit } : {}),
    ...('building' in request && request.building ? { building: request.building } : {}),
  };
}

/** The canonical REST URL of a request: what `links.self` and the receipt citation carry. */
export function agentRequestUrl(baseUrl: string, request: AgentCapabilityRequest): string {
  const params = new URLSearchParams();
  if ('project' in request && request.project) params.set('project', request.project);
  if ('projects' in request) params.set('projects', request.projects.join(','));
  if ('address' in request && request.address) params.set('address', request.address);
  if ('days' in request) params.set('days', String(request.days));
  if ('types' in request && request.types) params.set('types', request.types.join(','));
  if ('limit' in request) params.set('limit', String(request.limit));
  if ('building' in request && request.building) params.set('building', request.building);
  const query = params.toString();
  return `${baseUrl}/api/agent/${request.capability}${query ? `?${query}` : ''}`;
}
