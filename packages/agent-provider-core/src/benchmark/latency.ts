import { looksLikeEvidenceId } from '../compose/common';
import type { BenchObservation } from './evaluate';
import { distribution, type Distribution } from './metrics';
import type { BenchTransport } from './transport';

/**
 * Agent performance (2026-09-30, readiness §12): latency of the reads an
 * agent makes, measured against a deployed HEY from outside, paced like the
 * quality run.
 *
 * Two series per read:
 * - **cold**: each sample a URL (or message) the run has not asked before —
 *   a different project, contract, pair or evidence id — so a GET misses
 *   the edge cache and is answered by the origin;
 * - **warm**: one URL asked again and again, which is what a repeating agent
 *   sees: a GET is then usually served from the edge (60 s), while an MCP or
 *   A2A POST, never cached, measures the origin with its caches warm.
 * Every sample keeps its HTTP status and edge cache status, so "origin only"
 * percentiles are computed from the samples the origin answered.
 */
export type LatencySubjects = {
  projects: { slug: string; address: string | null }[];
  evidenceIds: string[];
};

type Request = { kind: 'get'; path: string } | { kind: 'agent'; capability: string; query: Record<string, string> } | { kind: 'mcp'; tool: string; args: Record<string, unknown> } | { kind: 'a2a'; data: Record<string, unknown> };

export type LatencyTarget = {
  id: string;
  /** What the read answers, in the report's words. */
  label: string;
  /** Whether it needs a project with a token, a pair of projects, or an evidence id. */
  needs: 'project' | 'token' | 'pair' | 'evidence';
  request: (subjects: LatencySubjects, index: number) => Request | null;
};

const withToken = (subjects: LatencySubjects) => subjects.projects.filter((project) => project.address);

export const LATENCY_TARGETS: readonly LatencyTarget[] = [
  { id: 'lookup.search', label: 'Project lookup (search suggest)', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'get', path: `/api/search/suggest?q=${encodeURIComponent(s.projects[i]!.slug.replace(/-/g, ' '))}` } : null) },
  { id: 'lookup.token', label: 'Contract lookup (token)', needs: 'token', request: (s, i) => (withToken(s)[i] ? { kind: 'get', path: `/api/token/4663/${withToken(s)[i]!.address}` } : null) },
  { id: 'snapshot', label: 'Research Summary / snapshot', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'get', path: `/api/projects/${s.projects[i]!.slug}/snapshot` } : null) },
  { id: 'changes', label: 'Recent changes (ledger)', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'get', path: `/api/changes?project=${s.projects[i]!.slug}&limit=20` } : null) },
  { id: 'explain.status', label: 'Builder status (explain)', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'get', path: `/api/projects/${s.projects[i]!.slug}/explain?fact=activity.status` } : null) },
  { id: 'compare', label: 'Compare', needs: 'pair', request: (s, i) => (s.projects[i + 1] ? { kind: 'get', path: `/api/compare?slugs=${s.projects[i]!.slug},${s.projects[i + 1]!.slug}` } : null) },
  { id: 'coverage', label: 'Unknowns (coverage)', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'get', path: `/api/projects/${s.projects[i]!.slug}/coverage` } : null) },
  { id: 'evidence', label: 'Evidence receipt', needs: 'evidence', request: (s, i) => (s.evidenceIds[i] ? { kind: 'get', path: `/api/evidence/${encodeURIComponent(s.evidenceIds[i]!)}` } : null) },
  { id: 'agent.research_project', label: '/api/agent research_project', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'agent', capability: 'research_project', query: { project: s.projects[i]!.slug } } : null) },
  { id: 'agent.what_changed', label: '/api/agent what_changed (project, 7 days)', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'agent', capability: 'what_changed', query: { project: s.projects[i]!.slug, days: '7' } } : null) },
  { id: 'agent.builder_status', label: '/api/agent builder_status', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'agent', capability: 'builder_status', query: { project: s.projects[i]!.slug } } : null) },
  { id: 'agent.verify_project', label: '/api/agent verify_project', needs: 'token', request: (s, i) => (withToken(s)[i] ? { kind: 'agent', capability: 'verify_project', query: { address: withToken(s)[i]!.address! } } : null) },
  { id: 'agent.compare_builders', label: '/api/agent compare_builders', needs: 'pair', request: (s, i) => (s.projects[i + 1] ? { kind: 'agent', capability: 'compare_builders', query: { projects: `${s.projects[i]!.slug},${s.projects[i + 1]!.slug}` } } : null) },
  { id: 'agent.unknowns', label: '/api/agent unknowns', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'agent', capability: 'unknowns', query: { project: s.projects[i]!.slug } } : null) },
  { id: 'mcp.research_answer', label: 'MCP research_answer (research_project)', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'mcp', tool: 'research_answer', args: { capability: 'research_project', project: s.projects[i]!.slug } } : null) },
  { id: 'a2a.research_project', label: 'A2A research_project (agent-intelligence-v1)', needs: 'project', request: (s, i) => (s.projects[i] ? { kind: 'a2a', data: { skill: 'research_project', project: s.projects[i]!.slug, contract: 'agent-intelligence-v1' } } : null) },
];

const send = (transport: BenchTransport, request: Request): Promise<BenchObservation> => {
  switch (request.kind) {
    case 'get':
      return transport.get(request.path);
    case 'agent':
      return transport.agent(request.capability, new URLSearchParams(Object.entries(request.query)));
    case 'mcp':
      return transport.mcp(request.tool, request.args);
    case 'a2a':
      return transport.a2a(request.data);
  }
};

/** One sample: milliseconds, HTTP status, edge cache status, bytes. */
export type LatencySample = [ms: number, status: number, cache: string, bytes: number];

export type LatencySeries = {
  samples: LatencySample[];
  all: Distribution;
  /** Samples the origin answered (edge MISS, EXPIRED, DYNAMIC, BYPASS or no edge status). */
  origin: Distribution;
  cache: Record<string, number>;
  status: Record<string, number>;
  bytes: Distribution;
};

export type LatencyTargetReport = { id: string; label: string; cold: LatencySeries; warm: LatencySeries };

export type LatencyReport = {
  schema: 'hey.agent-latency-report';
  version: 1;
  target: string;
  startedAt: string;
  finishedAt: string;
  samplesPerSeries: number;
  method: string;
  targets: LatencyTargetReport[];
};

const ORIGIN_CACHE = new Set(['MISS', 'EXPIRED', 'DYNAMIC', 'BYPASS', 'none', 'REVALIDATED']);

function series(samples: LatencySample[]): LatencySeries {
  const count = (values: string[]) => values.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});
  return {
    samples,
    all: distribution(samples.map(([ms]) => ms)),
    origin: distribution(samples.filter(([, , cache]) => ORIGIN_CACHE.has(cache)).map(([ms]) => ms)),
    cache: count(samples.map(([, , cache]) => cache)),
    status: count(samples.map(([, status]) => String(status))),
    bytes: distribution(samples.map(([, , , bytes]) => bytes)),
  };
}

const sampleOf = (observation: BenchObservation): LatencySample => [observation.ms, observation.httpStatus, observation.headers['cf-cache-status'] ?? 'none', observation.bytes];

/** Published projects and evidence ids to spread the cold samples over, read from HEY's own public listings. */
export async function gatherLatencySubjects(transport: BenchTransport, wanted: number): Promise<LatencySubjects> {
  const projects: LatencySubjects['projects'] = [];
  const seen = new Set<string>();
  for (let offset = 0; projects.length < wanted + 2 && offset < 48 * 20; offset += 48) {
    const page = await transport.get(`/api/projects?limit=48&offset=${offset}`);
    const items = (page.body as { items?: { slug?: string; token?: { contractAddress?: string } | null }[] } | null)?.items ?? [];
    if (items.length === 0) break;
    for (const item of items) {
      if (!item.slug || seen.has(item.slug)) continue;
      seen.add(item.slug);
      projects.push({ slug: item.slug, address: item.token?.contractAddress?.toLowerCase() ?? null });
    }
  }
  const evidenceIds: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; evidenceIds.length < wanted && page < 10; page += 1) {
    const response = await transport.get(`/api/changes?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
    const body = response.body as { items?: { evidence?: { id?: string }[] }[]; nextCursor?: string | null } | null;
    for (const item of body?.items ?? []) for (const entry of item.evidence ?? []) if (entry.id && looksLikeEvidenceId(entry.id) && !evidenceIds.includes(entry.id)) evidenceIds.push(entry.id);
    cursor = body?.nextCursor ?? null;
    if (!cursor) break;
  }
  return { projects, evidenceIds };
}

export type LatencyOptions = {
  transport: BenchTransport;
  target: string;
  samples: number;
  targets?: readonly LatencyTarget[];
  clock?: () => Date;
  onProgress?: (line: string) => void;
};

export async function runLatency(options: LatencyOptions): Promise<LatencyReport> {
  const clock = options.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
  const subjects = await gatherLatencySubjects(options.transport, options.samples);
  const reports: LatencyTargetReport[] = [];
  for (const target of options.targets ?? LATENCY_TARGETS) {
    const cold: LatencySample[] = [];
    for (let index = 0; cold.length < options.samples; index += 1) {
      const request = target.request(subjects, index);
      if (!request) break;
      cold.push(sampleOf(await send(options.transport, request)));
    }
    const first = target.request(subjects, 0);
    const warm: LatencySample[] = [];
    if (first) {
      // The cold series already asked this once; each repeat is a warm read.
      for (let index = 0; index < options.samples; index += 1) warm.push(sampleOf(await send(options.transport, first)));
    }
    const report = { id: target.id, label: target.label, cold: series(cold), warm: series(warm) };
    reports.push(report);
    options.onProgress?.(`${target.id}: cold p50 ${report.cold.all.p50} p95 ${report.cold.all.p95} (n ${report.cold.all.n}); warm p50 ${report.warm.all.p50} p95 ${report.warm.all.p95} (n ${report.warm.all.n})`);
  }
  return {
    schema: 'hey.agent-latency-report',
    version: 1,
    target: options.target,
    startedAt,
    finishedAt: clock().toISOString(),
    samplesPerSeries: options.samples,
    method: 'Sequential, one request at a time, paced (public API ≥550 ms apart, MCP and A2A ≥1.1 s), keep-alive connections, measured from request start to the last body byte on the client. Cold: a URL or message the run has not sent before. Warm: the first cold request repeated. Origin: samples not served from the edge cache.',
    targets: reports,
  };
}
