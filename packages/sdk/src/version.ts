/**
 * The version the SDK reports in its user-agent (2026-09-19).
 *
 * tsup defines `__SDK_VERSION__` from package.json at build time, so the
 * published bundle names itself exactly. Inside the workspace — vitest, the
 * web app importing the source, the MCP server bundled from source without
 * its own define — the identifier does not exist, and `typeof` on an
 * undeclared identifier is the one safe way to ask. `0.0.0-dev` then, so a
 * request from a development checkout is never mistaken for a release.
 */
declare const __SDK_VERSION__: string | undefined;

export const DEV_VERSION = '0.0.0-dev';

/** What the bundle was told, or the development placeholder. */
export function sdkVersionFrom(defined: unknown): string {
  return typeof defined === 'string' && defined.trim() !== '' ? defined : DEV_VERSION;
}

export const SDK_VERSION: string = sdkVersionFrom(typeof __SDK_VERSION__ === 'undefined' ? undefined : __SDK_VERSION__);
