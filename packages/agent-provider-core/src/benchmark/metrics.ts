import type { BenchCheckKind, BenchQuestionResult } from './evaluate';
import { BENCH_CATEGORIES, type BenchCategory } from './suite';

/**
 * The benchmark's metrics (2026-09-30, readiness §11), computed from the
 * judged answers and nothing else. Each is a count over checks the report
 * lists, never a weighted score: a reader can trace every rate to the
 * questions behind it.
 */
export type Rate = { passed: number; total: number; rate: number | null };
export type Distribution = { n: number; p50: number | null; p95: number | null; p99: number | null; max: number | null; mean: number | null };

const rate = (passed: number, total: number): Rate => ({ passed, total, rate: total === 0 ? null : Math.round((passed / total) * 10_000) / 10_000 });

/** Nearest-rank percentile of a sorted list; null for an empty one. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
  return {
    n: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1) ?? null),
    mean: round(sorted.length === 0 ? null : sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
  };
}

const checksOf = (results: readonly BenchQuestionResult[], kind: BenchCheckKind) => results.flatMap((result) => result.checks.filter((entry) => entry.kind === kind));

export type BenchMetrics = {
  questions: number;
  passed: Rate;
  /** The capability served and the outcome both as the question expects. */
  intentAccuracy: Rate;
  evidenceCoverage: {
    /** FACT and DERIVED claims in JSON answers. */
    claims: number;
    /** Those citing at least one typed evidence id. */
    withEvidenceId: Rate;
    /** Those citing an id, an explain path, or a named source with its read time. */
    traceable: Rate;
    /** Every evidence check (listed ids, receipt URLs, required evidence). */
    checks: Rate;
    /** Cited ids fetched back from `/api/evidence/{id}`. */
    resolved: Rate;
  };
  unknownCorrectness: Rate;
  staleDataHandling: Rate & { families: number; stale: number; unknown: number };
  schemaValidity: Rate & { notApplicable: number };
  boundaries: Rate & { violations: string[] };
  answerChecks: Rate;
  latencyMs: Distribution & { byTransport: Record<string, Distribution> };
  responseBytes: Distribution & { overLimit: number };
  byCategory: Record<BenchCategory, Rate>;
};

export function benchMetrics(results: readonly BenchQuestionResult[], resolution: { attempted: number; resolved: number }, freshnessCounts: { families: number; stale: number; unknown: number }): BenchMetrics {
  const kindRate = (kind: BenchCheckKind) => {
    const list = checksOf(results, kind);
    return rate(list.filter((entry) => entry.ok).length, list.length);
  };
  const intent = results.filter((result) => result.checks.filter((entry) => entry.kind === 'intent').every((entry) => entry.ok)).length;
  const claims = results.reduce((sum, result) => sum + result.evidence.claims, 0);
  const schemaResults = results.filter((result) => result.schema !== 'not_applicable');
  const boundaryChecks = checksOf(results, 'boundary');
  const byTransport: Record<string, number[]> = {};
  for (const result of results) (byTransport[result.transport] ??= []).push(result.ms);
  const sizeChecks = checksOf(results, 'size');
  return {
    questions: results.length,
    passed: rate(results.filter((result) => result.pass).length, results.length),
    intentAccuracy: rate(intent, results.length),
    evidenceCoverage: {
      claims,
      withEvidenceId: rate(results.reduce((sum, result) => sum + result.evidence.withEvidenceId, 0), claims),
      traceable: rate(results.reduce((sum, result) => sum + result.evidence.traceable, 0), claims),
      checks: kindRate('evidence'),
      resolved: rate(resolution.resolved, resolution.attempted),
    },
    unknownCorrectness: kindRate('unknowns'),
    staleDataHandling: { ...kindRate('freshness'), ...freshnessCounts },
    schemaValidity: { ...rate(schemaResults.filter((result) => result.schema === 'valid').length, schemaResults.length), notApplicable: results.length - schemaResults.length },
    boundaries: {
      ...rate(boundaryChecks.filter((entry) => entry.ok).length, boundaryChecks.length),
      violations: results.flatMap((result) => result.checks.filter((entry) => entry.kind === 'boundary' && !entry.ok).map((entry) => `${result.id}: ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`)),
    },
    answerChecks: kindRate('answer'),
    latencyMs: { ...distribution(results.map((result) => result.ms)), byTransport: Object.fromEntries(Object.entries(byTransport).map(([transport, values]) => [transport, distribution(values)])) },
    responseBytes: { ...distribution(results.map((result) => result.bytes)), overLimit: sizeChecks.filter((entry) => !entry.ok).length },
    byCategory: Object.fromEntries(
      BENCH_CATEGORIES.map((category) => {
        const inCategory = results.filter((result) => result.category === category);
        return [category, rate(inCategory.filter((result) => result.pass).length, inCategory.length)];
      }),
    ) as Record<BenchCategory, Rate>,
  };
}
