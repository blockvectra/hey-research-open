import { evaluate, readObservation, type BenchObservation, type BenchQuestionResult } from './evaluate';
import { benchMetrics, type BenchMetrics } from './metrics';
import type { BenchBindings, BenchCall, BenchQuestion } from './suite';
import type { BenchTransport } from './transport';

/**
 * Running the suite (2026-09-30): bind each question to its subjects, send
 * its one call, judge the answer, then fetch a sample of the cited evidence
 * ids back from `/api/evidence/{id}`. Sequential by design — the HTTP door
 * paces itself, and in-process doors need no concurrency to be fast.
 */
export const BENCH_REPORT_SCHEMA = 'hey.agent-benchmark-report' as const;
export const BENCH_REPORT_VERSION = 1 as const;

const PLACEHOLDER = /\{([a-zA-Z]+(?:\.[a-zA-Z]+)*)\}/g;

function lookup(bindings: BenchBindings, path: string): string {
  let current: unknown = bindings;
  for (const part of path.split('.')) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined;
  if (typeof current !== 'string') throw new Error(`benchmark binding "${path}" is not set for ${bindings.label}`);
  return current;
}

/** A value with every `{slot.path}` replaced by its binding; throws on an unbound slot. */
export function bindValue<T>(value: T, bindings: BenchBindings): T {
  if (typeof value === 'string') return value.replace(PLACEHOLDER, (_, path: string) => lookup(bindings, path)) as T;
  if (Array.isArray(value)) return value.map((item) => bindValue(item, bindings)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindValue(item, bindings)])) as T;
  return value;
}

export function bindQuestion(question: BenchQuestion, bindings: BenchBindings): BenchQuestion {
  return { ...question, question: bindValue(question.question, bindings), call: bindValue(question.call, bindings), expect: bindValue(question.expect, bindings) };
}

export function sendCall(transport: BenchTransport, call: BenchCall): Promise<BenchObservation> {
  switch (call.transport) {
    case 'rest':
      return transport.agent(call.capability, new URLSearchParams(Object.entries(call.query)));
    case 'get':
      return transport.get(call.path);
    case 'mcp':
      return transport.mcp(call.tool, { ...call.arguments });
    case 'a2a':
      return transport.a2a({ ...call.data });
  }
}

export type BenchReport = {
  schema: typeof BENCH_REPORT_SCHEMA;
  version: typeof BENCH_REPORT_VERSION;
  mode: BenchBindings['label'];
  target: string;
  userAgent: string | null;
  startedAt: string;
  finishedAt: string;
  suite: { questions: number; categories: number; mapping: 'checked-in, deterministic, no language model' };
  metrics: BenchMetrics;
  evidenceResolution: { attempted: number; resolved: number; failures: { id: string; httpStatus: number }[] };
  results: BenchQuestionResult[];
};

export type RunOptions = {
  suite: readonly BenchQuestion[];
  bindings: BenchBindings;
  transport: BenchTransport;
  target: string;
  userAgent?: string;
  /** How many distinct cited evidence ids to fetch back (default 20). */
  resolveEvidence?: number;
  clock?: () => Date;
  onResult?: (result: BenchQuestionResult) => void;
};

export async function runBenchmark(options: RunOptions): Promise<BenchReport> {
  const clock = options.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
  const results: BenchQuestionResult[] = [];
  const freshness = { families: 0, stale: 0, unknown: 0 };
  for (const raw of options.suite) {
    const question = bindQuestion(raw, options.bindings);
    const observation = await sendCall(options.transport, question.call);
    const result = evaluate(question, observation);
    const envelope = readObservation(question.call, observation).envelope;
    for (const entry of envelope?.freshness ?? []) {
      freshness.families += 1;
      if (entry.freshnessStatus === 'stale') freshness.stale += 1;
      if (entry.freshnessStatus === 'unknown') freshness.unknown += 1;
    }
    results.push(result);
    options.onResult?.(result);
  }

  // Evidence resolves: a spread of the ids the answers cite, fetched back from the receipt route.
  const cited = [...new Set(results.flatMap((result) => result.evidence.ids))];
  const wanted = options.resolveEvidence ?? 20;
  const step = Math.max(1, Math.floor(cited.length / Math.max(1, wanted)));
  const sample = cited.filter((_, index) => index % step === 0).slice(0, wanted);
  const failures: { id: string; httpStatus: number }[] = [];
  for (const id of sample) {
    const observation = await options.transport.get(`/api/evidence/${encodeURIComponent(id)}`);
    const body = observation.body as { id?: unknown } | null;
    if (observation.httpStatus !== 200 || !body || typeof body !== 'object') failures.push({ id, httpStatus: observation.httpStatus });
  }
  const resolution = { attempted: sample.length, resolved: sample.length - failures.length };

  return {
    schema: BENCH_REPORT_SCHEMA,
    version: BENCH_REPORT_VERSION,
    mode: options.bindings.label,
    target: options.target,
    userAgent: options.userAgent ?? null,
    startedAt,
    finishedAt: clock().toISOString(),
    suite: { questions: options.suite.length, categories: new Set(options.suite.map((question) => question.category)).size, mapping: 'checked-in, deterministic, no language model' },
    metrics: benchMetrics(results, resolution, freshness),
    evidenceResolution: { ...resolution, failures },
    results,
  };
}
