import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { HeyClient, type HeyV4HookDetail } from '@hey-research-lab/sdk';

import { renderV4Hook } from './render-v4-hooks';
import { createHeyMcpServer } from './server';

/**
 * `get_v4_hook` (2026-10-11): reads `GET /api/v4-hooks/{address}` through the
 * SDK, names a project only when the API does, and says every unknown as
 * UNKNOWN with its reason — never stronger than the API.
 */
const HOOK = '0x3ad87f5b9cf8f17ed39d787eef3d9d19053d28cc';

const detail = (listed: boolean): HeyV4HookDetail => ({
  id: `v4hook:4663:${HOOK}`,
  chainId: 4663,
  address: HOOK,
  explorer: `https://robinhoodchain.blockscout.com/address/${HOOK}`,
  receipt: `https://heyresearch.xyz/evidence/v4hook:4663:${HOOK}`,
  page: `https://heyresearch.xyz/integrations/uniswap/hooks/${HOOK}`,
  answer: listed ? 'Hook Lister — HEY ties this Uniswap v4 hook to it: listed by the project as its own contract.' : 'HEY holds this Uniswap v4 hook but does not tie it to a published project.',
  listed,
  project: listed
    ? { slug: 'hook-lister', name: 'Hook Lister', url: 'https://heyresearch.xyz/project/hook-lister', activityStatus: 'SHIPPING', activityLabel: 'Shipping', latestShip: null, latestShipReason: 'no_counted_ship' }
    : null,
  tie: listed ? { basis: 'project', basisLabel: 'Listed by the project', tie: 'Listed by the project as its own contract', tieDetail: 'the project’s own contract listing names it', deploymentEvidenceId: null, reviewedAt: null, factory: null } : null,
  creation: listed
    ? { state: 'TIED', words: 'read; tied to a published project', checked: true, checkedAt: '2026-10-02T06:00:00.000Z', deployedAt: '2026-09-30T10:00:00.000Z', deployedBlock: 76640000 }
    : { state: 'LAUNCH_INSTANCE', words: 'created through a launch protocol’s factory; not tied to a published project', checked: true, checkedAt: '2026-10-02T06:00:00.000Z', deployedAt: null, deployedBlock: null },
  permissions: ['beforeSwap', 'afterSwap'],
  capabilities: 'Called before each swap and after each swap.',
  source: {
    verifiedSource: { state: 'NOT_READ', verified: null, contractName: null, checkedAt: null, words: 'Not read: HEY has not read the explorer’s source record for this hook.' },
    proxy: { state: 'NOT_READ', status: null, kind: null, clonedFrom: null, checkedAt: null, words: 'Not read: HEY’s contract watch has not checked this address for a proxy.' },
  },
  hooklist: { state: 'NOT_READ', words: 'HEY has not read Uniswap’s public hooklist yet, so it cannot say whether the list carries this hook.', readAt: null, listing: null },
  pools: {
    onTrackedTokens: 3,
    firstInitBlock: 76700001,
    lastInitBlock: 76700003,
    weekly: {
      basis: 'observed',
      collectedFrom: '2026-10-01T09:00:00.000Z',
      weeks: [
        { isoWeek: '2026-W39', start: '2026-09-21', pools: null, reason: 'before_collection', complete: true, includesBackfill: false },
        { isoWeek: '2026-W40', start: '2026-09-28', pools: 2, reason: null, complete: true, includesBackfill: true },
        { isoWeek: '2026-W41', start: '2026-10-05', pools: 1, reason: null, complete: false, includesBackfill: false },
      ],
    },
  },
  when: { firstPoolInitBlock: 76644461, firstPoolInitAt: null, lastPoolInitBlock: 76900000, firstRecordedAt: '2026-10-01T09:00:00.000Z', lastRecordedAt: '2026-10-07T09:00:00.000Z' },
  relatedShip: { deployment: null, deploymentReason: listed ? 'not_a_ship' : 'not_listed' },
  unknowns: [
    { key: 'routing_allowlist', label: 'Routing allowlist', value: null, reason: 'not_read', words: 'Whether a router or aggregator routes swaps through this hook: HEY reads no routing allowlist.' },
    { key: 'audit', label: 'Audit', value: null, reason: 'not_read', words: 'Whether its code was reviewed by an auditor: HEY reads no audit report for this hook, and a callback list is never a safety verdict.' },
  ],
  definitions: { pools: 'p', weekly: 'w', basis: 'b', hooklist: 'h', marketContext: 'm' },
  trademark: 'Uniswap is a trademark of Uniswap Labs.',
  disclaimer: 'Research data, not investment advice.',
});

describe('renderV4Hook', () => {
  it('names the listed project quoted as data, and every unknown as UNKNOWN with its reason', () => {
    const text = renderV4Hook(detail(true));
    expect(text).toContain('Answer: HEY ties this hook to «Hook Lister» (hook-lister) — Listed by the project: Listed by the project as its own contract');
    expect(text).toContain('UNKNOWN: routing allowlist — ');
    expect(text).toContain('UNKNOWN: verified source — Not read');
    expect(text).toContain('2026-W40 2, 2026-W41 1 (so far)');
    expect(text).not.toMatch(/\baudited\b|endorse|\bsafe to\b/i);
  });

  it('names no project for a hook HEY does not list, and says its receipt does not stand', () => {
    const text = renderV4Hook(detail(false));
    expect(text).toContain('Answer: HEY holds this Uniswap v4 hook but does not tie it to a published project.');
    expect(text).toContain('created through a launch protocol’s factory');
    expect(text).toContain('no standing receipt');
    expect(text).not.toContain('Hook Lister');
  });

  it('is a tool that reads the hook through the SDK, at the API’s own path', async () => {
    const asked: string[] = [];
    const client = new HeyClient({
      baseUrl: 'https://hey.test',
      fetchImpl: async (input) => {
        asked.push(new URL(input).pathname);
        return new Response(JSON.stringify(detail(true)), { headers: { 'content-type': 'application/json' } });
      },
    });
    const server = createHeyMcpServer(client, undefined, { profile: 'research' });
    const mcp = new Client({ name: 'v4-hook-test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), mcp.connect(a)]);
    const result = (await mcp.callTool({ name: 'get_v4_hook', arguments: { address: HOOK.toUpperCase().replace('0X', '0x') } })) as { content: { type: string; text?: string }[]; structuredContent?: { api?: string } };
    expect(asked).toEqual([`/api/v4-hooks/${HOOK}`]);
    expect(result.content[0]!.text).toContain('«Hook Lister»');
    expect(result.structuredContent?.api).toBe(`https://heyresearch.xyz/api/v4-hooks/${HOOK}`);
    expect((await mcp.callTool({ name: 'get_v4_hook', arguments: { address: '0x1234' } })).isError).toBe(true);
  });
});
