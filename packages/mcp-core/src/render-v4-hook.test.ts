import { describe, expect, it } from 'vitest';

import type { HeyContractV4Hook } from '@hey-research-lab/sdk';

import * as fx from './fixtures/api';
import { renderContract, renderEvidence } from './render-machine';

/**
 * A Uniswap v4 hook in the MCP's words (2026-10-11): no stronger than the
 * contract read's `uniswapV4Hook` section. A project only when listed; "not
 * read yet" is UNKNOWN, never "not tied"; callbacks are what the PoolManager
 * will call; the hooklist is a listing; a receipt that does not stand is not
 * cited.
 */
const HOOK = '0x4e3468951d49f2eea976ed0d6e75ffcb44a900c0';
const NO_GARBAGE = /undefined|\[object|NaN/;

const notRead: HeyContractV4Hook = {
  hookAddress: HOOK,
  permissions: ['beforeSwap', 'afterSwap'],
  capabilities: 'Called before each swap and after each swap.',
  permissionsBasis: 'What the PoolManager will call, decoded from the hook’s address — not what the hook does.',
  attribution: 'NOT_READ',
  attributionWords: 'HEY has not read who created this hook yet.',
  attributionDetail: null,
  project: null,
  basis: null,
  basisLabel: null,
  creationState: 'not_read',
  deployedAt: null,
  deployedBlock: null,
  deployedAtReason: 'creation_not_read',
  firstPoolInitBlock: 76_905_184,
  firstPoolInitAt: null,
  firstPoolInitAtReason: 'block_time_not_read',
  poolsOnTrackedTokens: 0,
  poolsOnTrackedTokensBasis: 'Pools initialised with this hook whose currency is a token HEY tracks. Not every pool that uses it, and not usage.',
  hooklist: null,
  hooklistState: 'not_listed',
  evidenceId: `v4hook:4663:${HOOK}`,
  receiptStands: false,
  firstSeenAt: '2026-10-01T12:00:00.000Z',
  observedAt: '2026-10-09T12:00:00.000Z',
  checkedAt: null,
};

const bare = { ...fx.contract, address: HOOK, name: undefined, associatedProject: null, role: undefined, watched: false, evidence: [] };

describe('get_contract: a Uniswap v4 hook', () => {
  it('says "not read yet" as UNKNOWN and never cites a receipt that does not stand', () => {
    const text = renderContract({ ...bare, uniswapV4Hook: notRead });
    expect(text).toContain('a Uniswap v4 hook HEY stores; not watched by its contract reads');
    expect(text).toContain('- UNKNOWN Uniswap v4 hook: who created it — HEY has not read who created this hook yet. Never read this as "tied to no project"');
    expect(text).toContain('its receipt does not stand: do not cite it');
    expect(text).toContain('what the PoolManager will call, not what the hook does: beforeSwap, afterSwap');
    expect(text).toContain('- UNKNOWN hook creation time: HEY has not read its creation record yet');
    expect(text).toContain("(the block's time not read); 0 pools on tokens HEY tracks use it — not every pool, and not usage");
    expect(text).not.toMatch(NO_GARBAGE);
  });

  it('names the project, its basis and the hooklist as a listing when the hook is listed', () => {
    const listed: HeyContractV4Hook = {
      ...notRead,
      attribution: 'LISTED',
      attributionWords: 'Listed on HEY under HookTeam (Listed by the project).',
      attributionDetail: 'the project’s own contract listing names it',
      project: { slug: 'hookteam', name: 'HookTeam', url: 'https://heyresearch.xyz/project/hookteam' },
      basis: 'project',
      basisLabel: 'Listed by the project',
      creationState: 'read',
      deployedAt: '2026-09-30T19:24:08.000Z',
      deployedBlock: 76_883_441,
      deployedAtReason: null,
      poolsOnTrackedTokens: 2,
      hooklist: { listedAs: 'HookTeamHook', verifiedSourceAsListed: true, listedPermissions: ['beforeSwap', 'afterSwap'], disagreement: null, url: 'https://github.com/Uniswap/hooklist/blob/abc/hooks/x.json', readAt: '2026-10-09T12:00:00.000Z', label: 'A third-party listing' },
      hooklistState: 'listed',
      receiptStands: true,
    };
    const text = renderContract({ ...bare, uniswapV4Hook: listed });
    expect(text).toContain('- FACT Uniswap v4 hook listed under «HookTeam» — https://heyresearch.xyz/project/hookteam (Listed by the project: the project’s own contract listing names it; evidence v4hook:4663:');
    expect(text).toContain('- FACT hook created 2026-09-30, block 76883441');
    expect(text).toContain("- FACT listed in Uniswap's hooklist as «HookTeamHook» — a third-party listing, not a verification and not a tie");
    expect(text).not.toMatch(NO_GARBAGE);
  });

  it('tells a not-read hook’s receipt from a withdrawn one', () => {
    const text = renderEvidence({ id: `v4hook:4663:${HOOK}`, withdrawn: true, withdrawalReason: 'not_read', disclaimer: 'd' });
    expect(text).toContain('not read yet');
    expect(text).toContain('UNKNOWN HEY has not read who created this hook yet');
    expect(text).not.toContain('HEY no longer makes this claim');
    expect(renderEvidence({ id: `v4hook:4663:${HOOK}`, withdrawn: true, withdrawalReason: 'not_attributed', disclaimer: 'd' })).toContain('HEY no longer makes this claim (not attributed)');
  });
});
