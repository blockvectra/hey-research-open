/**
 * The version the server reports (2026-09-19): in `McpServer`'s handshake and
 * in the user-agent HEY's traffic console reads. tsup stamps it from
 * package.json; a checkout run with `tsx` says `0.0.0-dev`, so a development
 * server is never mistaken for a release.
 */
declare const __MCP_VERSION__: string | undefined;

export const MCP_VERSION: string = typeof __MCP_VERSION__ === 'string' && __MCP_VERSION__ !== '' ? __MCP_VERSION__ : '0.0.0-dev';
