/**
 * The agent benchmark (2026-09-30, readiness §11–§12): a checked-in question
 * suite, the judge, the metrics, and the doors it runs through. A subpath of
 * the package (`@hey/agent-provider-core/benchmark`) so the contract itself
 * stays what an adapter imports.
 */
export * from './suite';
export * from './evaluate';
export * from './metrics';
export * from './transport';
export * from './run';
export * from './latency';
