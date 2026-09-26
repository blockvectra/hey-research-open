/**
 * The version the server reports (2026-09-19): in `McpServer`'s handshake and
 * in the user-agent HEY's traffic console reads.
 *
 * The stdio build (`apps/mcp`) bundles this package, and tsup stamps
 * `__MCP_VERSION__` from its package.json. The web app compiles this package
 * with Next, where nothing defines the identifier (2026-09-26): the hosted
 * `/mcp` then reports `MCP_PACKAGE_VERSION`, which a test in `apps/mcp` holds
 * equal to that package's own version. A checkout run with `tsx` reports the
 * same constant; the handshake and the user-agent say which one they are.
 */
declare const __MCP_VERSION__: string | undefined;

/** Kept equal to `apps/mcp/package.json` by `apps/mcp/src/version.test.ts`. */
export const MCP_PACKAGE_VERSION = '0.1.0';

export const MCP_VERSION: string =
  typeof __MCP_VERSION__ === 'string' && __MCP_VERSION__ !== '' ? __MCP_VERSION__ : MCP_PACKAGE_VERSION;
