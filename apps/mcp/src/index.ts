import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { HeyClient } from '@hey-research/sdk';

import { resolveBaseUrl } from './base-url';
import { createHeyMcpServer } from './server';
import { MCP_VERSION } from './version';

/**
 * `hey-research-mcp` — HEY Research over stdio (2026-09-05).
 *
 * Runs beside the assistant, not on HEY's servers: it holds no database and no
 * credentials, and reads the same public API anyone can curl. Point it at a
 * local HEY with `HEY_API_URL=http://localhost:3000` when developing; anything
 * else must be https, because the key rides on every request (`base-url.ts`).
 *
 * stdout belongs to the protocol. Anything this process wants to say to a human
 * goes to stderr, or it corrupts the stream.
 */
const apiKey = process.env.HEY_API_KEY;

async function main(): Promise<void> {
  // Before the transport: a server that came up and then leaked the key is worse than one that did not come up.
  const { baseUrl, origin } = resolveBaseUrl(process.env.HEY_API_URL);
  const server = createHeyMcpServer(new HeyClient({ baseUrl, ...(apiKey ? { apiKey } : {}), userAgent: `hey-research-mcp/${MCP_VERSION}` }));
  await server.connect(new StdioServerTransport());
  // The origin, not the configured string: it is the host the key actually goes to, and a reader can check it at a glance.
  console.error(`[hey-research-mcp] ready, reading ${baseUrl} (origin ${origin}) ${apiKey ? 'with an API key' : 'without a key'}`);
}

main().catch((error: unknown) => {
  console.error('[hey-research-mcp] failed to start:', error);
  process.exit(1);
});
