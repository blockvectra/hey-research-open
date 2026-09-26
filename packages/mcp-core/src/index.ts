/**
 * `@hey/mcp-core` (2026-09-26): HEY's MCP server with no transport attached.
 *
 * One definition of the tools, their renderers, resources and prompts, used
 * twice: `apps/mcp` bundles it behind stdio for a local assistant, and the web
 * app mounts it at `/mcp` for a remote one. Importing it has no side effect;
 * the caller builds a server with `createHeyMcpServer` and connects a
 * transport of its own.
 */
export * from './server';
export * from './render';
export * from './render-machine';
export * from './tools';
export { MCP_PACKAGE_VERSION, MCP_VERSION } from './version';
