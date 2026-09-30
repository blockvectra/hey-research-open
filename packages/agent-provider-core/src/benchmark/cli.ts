import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { runLatency } from './latency';
import { runBenchmark } from './run';
import { BENCH_BINDINGS, BENCH_SUITE } from './suite';
import { BENCH_USER_AGENT, httpTransport } from './transport';

/**
 * `pnpm --filter @hey/agent-provider-core bench -- --base-url https://heyresearch.xyz`
 *
 * The agent benchmark against a deployed HEY (2026-09-30). Read-only and
 * paced: one request at a time, public reads ≥550 ms apart (≈1.8 a second,
 * inside the anonymous 120 a minute), MCP and A2A ≥1.1 s apart; no key; the
 * user agent `hey-internal/agent-benchmark`, which HEY counts as its own
 * traffic, never as a caller's.
 *
 *   --base-url <url>     required; the deployment to ask
 *   --bindings <name>    production (default) or demo: which subjects the questions name
 *   --mode <mode>        quality (default), latency, or all
 *   --samples <n>        latency samples per series (default 100)
 *   --out <file>         where to write the JSON report (default: stdout summary only)
 */
type Args = { baseUrl: string; bindings: 'production' | 'demo'; mode: 'quality' | 'latency' | 'all'; samples: number; out: string | null };

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { baseUrl: '', bindings: 'production', mode: 'quality', samples: 100, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--') continue;
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--base-url') args.baseUrl = value;
    else if (flag === '--bindings' && (value === 'production' || value === 'demo')) args.bindings = value;
    else if (flag === '--mode' && (value === 'quality' || value === 'latency' || value === 'all')) args.mode = value;
    else if (flag === '--samples' && /^\d{1,4}$/.test(value)) args.samples = Math.max(1, Number(value));
    else if (flag === '--out') args.out = value;
    else throw new Error(`unknown or invalid argument: ${flag} ${value}`);
    index += 1;
  }
  if (!/^https?:\/\/[^\s/]+/.test(args.baseUrl)) throw new Error('--base-url is required, e.g. --base-url https://heyresearch.xyz');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const transport = httpTransport({ baseUrl: args.baseUrl });
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const output: Record<string, unknown> = {};

  if (args.mode !== 'latency') {
    log(`quality: ${BENCH_SUITE.length} questions against ${args.baseUrl} (${args.bindings} subjects)`);
    const report = await runBenchmark({
      suite: BENCH_SUITE,
      bindings: BENCH_BINDINGS[args.bindings],
      transport,
      target: args.baseUrl,
      userAgent: BENCH_USER_AGENT,
      onResult: (result) => log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.transport} ${result.httpStatus} ${Math.round(result.ms)} ms${result.pass ? '' : ` — ${result.checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`).join('; ')}`}`),
    });
    const m = report.metrics;
    log(`passed ${m.passed.passed}/${m.passed.total}; intent ${m.intentAccuracy.rate}; schema ${m.schemaValidity.rate}; evidence traceable ${m.evidenceCoverage.traceable.rate}, resolved ${m.evidenceCoverage.resolved.passed}/${m.evidenceCoverage.resolved.total}; unknowns ${m.unknownCorrectness.rate}; freshness ${m.staleDataHandling.rate}; boundaries ${m.boundaries.rate}; p50 ${m.latencyMs.p50} ms p95 ${m.latencyMs.p95} ms`);
    output.quality = report;
  }
  if (args.mode !== 'quality') {
    log(`latency: ${args.samples} samples per series against ${args.baseUrl}`);
    output.latency = await runLatency({ transport, target: args.baseUrl, samples: args.samples, onProgress: log });
  }
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(output, null, 1)}\n`);
    log(`wrote ${args.out}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
