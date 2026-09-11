import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { DEFAULT_BASE_URL, HeyClient } from './client';
import { createHeyMcpServer } from './server';

/**
 * `hey-research-mcp` — HEY Research over stdio (2026-09-05).
 *
 * Runs beside the assistant, not on HEY's servers: it holds no database and no
 * credentials, and reads the same public API anyone can curl. Point it at a
 * local HEY with `HEY_API_URL=http://localhost:3000` when developing.
 *
 * stdout belongs to the protocol. Anything this process wants to say to a human
 * goes to stderr, or it corrupts the stream.
 */
const baseUrl = process.env.HEY_API_URL ?? DEFAULT_BASE_URL;
const apiKey = process.env.HEY_API_KEY;

async function main(): Promise<void> {
  const server = createHeyMcpServer(new HeyClient({ baseUrl, ...(apiKey ? { apiKey } : {}) }));
  await server.connect(new StdioServerTransport());
  console.error(`[hey-research-mcp] ready, reading ${baseUrl} ${apiKey ? 'with an API key' : 'without a key'}`);
}

main().catch((error: unknown) => {
  console.error('[hey-research-mcp] failed to start:', error);
  process.exit(1);
});
