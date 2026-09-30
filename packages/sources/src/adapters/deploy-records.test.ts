import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  isReferenceKey,
  isTokenListRepository,
  parseDeploymentsJson,
  parseDeployRecord,
  parseFoundryBroadcast,
  parseHardhatChainId,
  parseHardhatDeployment,
  parseIgnitionAddresses,
  planDeployRecordReads,
} from './deploy-records';
import { createGithubFileAdapter, createGithubTreeAdapter, GITHUB_FILE_MAX_BYTES, GITHUB_RECORD_MAX_BYTES } from './github-contents';

/**
 * Deploy records (founder decision D1, 2026-09-30): which paths are read,
 * and what each kind of record says, from saved fixtures. No network.
 */
describe('the repository tree', () => {
  it('reads every blob path of the default branch in one request, keeping GitHub’s truncation flag', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-tree-deploy-records.json'), headers: { 'content-type': 'application/json' } });
    const result = await createGithubTreeAdapter().fetch({ owner: 'neon-labs', repo: 'neon-contracts', token: 't' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(stub.requests[0]?.url).toBe('https://api.github.com/repos/neon-labs/neon-contracts/git/trees/HEAD?recursive=1');
    expect((stub.requests[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer t');
    // Folders and submodules are not files.
    expect(result.data?.files.some((file) => file.path === 'broadcast' || file.path === 'lib/forge-std')).toBe(false);
    expect(result.data?.files).toContainEqual({ path: 'broadcast/Deploy.s.sol/4663/run-latest.json', size: 9000 });
    expect(result.data?.truncated).toBe(false);
  });

  it('refuses an owner or repository name that is not one', () => {
    expect(createGithubTreeAdapter().canHandle({ owner: '../x', repo: 'r' })).toBe(false);
    expect(createGithubTreeAdapter().canHandle({ owner: 'o', repo: 'r/../../x' })).toBe(false);
  });

  it('lets a parsed record file be larger than a README, within a ceiling', async () => {
    const stub = stubFetch({ status: 200, body: 'x'.repeat(GITHUB_FILE_MAX_BYTES + 10) });
    const adapter = createGithubFileAdapter();
    expect((await adapter.fetch({ owner: 'o', repo: 'r', path: 'a.json' }, testContext({ fetchImpl: stub.fetchImpl }))).errorCode).toBe('TOO_LARGE');
    const bigger = await adapter.fetch({ owner: 'o', repo: 'r', path: 'a.json', maxBytes: GITHUB_RECORD_MAX_BYTES }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(bigger)).toBe(true);
    const beyond = stubFetch({ status: 200, body: 'x'.repeat(GITHUB_RECORD_MAX_BYTES + 10) });
    const capped = await adapter.fetch({ owner: 'o', repo: 'r', path: 'a.json', maxBytes: 50 * 1024 * 1024 }, testContext({ fetchImpl: beyond.fetchImpl }));
    expect(capped.errorCode).toBe('TOO_LARGE');
  });
});

describe('which files are deploy records for Robinhood Chain', () => {
  const tree = (JSON.parse(readFixture('github-tree-deploy-records.json')) as { tree: { path: string; type: string }[] }).tree
    .filter((entry) => entry.type === 'blob')
    .map((entry) => entry.path);

  it('picks the Foundry broadcast for chain 4663, Ignition’s chain-4663 folder and a hand-kept deployments file', () => {
    const plan = planDeployRecordReads(tree);
    expect(plan.files).toEqual([
      { path: 'broadcast/Deploy.s.sol/4663/run-latest.json', kind: 'FOUNDRY_BROADCAST' },
      { path: 'ignition/deployments/chain-4663/deployed_addresses.json', kind: 'IGNITION' },
      { path: 'deployments.json', kind: 'DEPLOYMENTS_JSON' },
    ]);
  });

  it('never reads a dry run, another chain, a timestamped run, or a vendored, test or dependency path', () => {
    const paths = planDeployRecordReads(tree).files.map((file) => file.path);
    for (const refused of [
      'broadcast/Deploy.s.sol/4663/dry-run/run-latest.json',
      'broadcast/Deploy.s.sol/1/run-latest.json',
      'broadcast/Deploy.s.sol/4663/run-1790700000.json',
      'lib/openzeppelin-contracts/broadcast/Deploy.s.sol/4663/run-latest.json',
      'test/fixtures/deployments.json',
      'node_modules/pkg/deployments.json',
      'ignition/deployments/chain-46630/deployed_addresses.json',
    ]) {
      expect(paths).not.toContain(refused);
    }
  });

  it('keeps a hardhat-deploy network with its .chainId, drops local networks and solc inputs', () => {
    const plan = planDeployRecordReads(tree);
    expect(plan.hardhatNetworks).toEqual([
      { dir: 'packages/app/deployments/robinhood', chainIdPath: 'packages/app/deployments/robinhood/.chainId', files: ['packages/app/deployments/robinhood/Rig.json'] },
    ]);
  });

  it('ignores a hardhat network folder without a .chainId: the chain is never guessed from a name', () => {
    const plan = planDeployRecordReads(['deployments/robinhood/Token.json']);
    expect(plan.hardhatNetworks).toEqual([]);
  });

  it('never reads a path longer than a deploy tool writes', () => {
    expect(planDeployRecordReads([`${'a/'.repeat(200)}broadcast/Deploy.s.sol/4663/run-latest.json`]).files).toEqual([]);
  });

  it('reads a per-chain file in a deployments folder as a hand-kept record', () => {
    expect(planDeployRecordReads(['deployments/4663.json']).files).toEqual([{ path: 'deployments/4663.json', kind: 'DEPLOYMENTS_JSON' }]);
  });
});

describe('what a record says', () => {
  it('Foundry: only contracts a transaction created — never a call, a failed deploy or a mock', () => {
    const contracts = parseFoundryBroadcast(readFixture('foundry-broadcast-run-latest.json'));
    expect(contracts).toEqual([
      { address: '0x4a7c1e5d9b3f2a6c8e0d1b3a5c7e9f1d3b5a7c90', created: true, contractName: 'NeonToken', txHash: '0x5b0c2f0f6e7d6f3b8d4f1b5e2c1a9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c' },
      // A contract a launch call created is created by this deployment too.
      { address: '0x6b8d2f4a6c8e0a2c4e6f8a0b2d4f6a8c0e2b4d61', created: true, txHash: '0x9a8b7c6d5e4f30211203a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9' },
    ]);
  });

  it('Foundry: a broadcast that says it is for another chain is not trusted', () => {
    const other = JSON.stringify({ ...(JSON.parse(readFixture('foundry-broadcast-run-latest.json')) as object), chain: 1 });
    expect(parseFoundryBroadcast(other)).toBeNull();
    expect(parseFoundryBroadcast('not json')).toBeNull();
    expect(parseFoundryBroadcast(JSON.stringify({ transactions: 'x' }))).toBeNull();
  });

  it('hardhat-deploy: the network’s .chainId decides the chain, and a record needs its deploying transaction', () => {
    expect(parseHardhatChainId('4663\n')).toBe(4663);
    expect(parseHardhatChainId('robinhood')).toBeNull();
    expect(parseHardhatDeployment(readFixture('hardhat-deploy-token.json'), 'deployments/robinhood/Rig.json')).toEqual({
      address: '0x5e8c1a3b7d9f2c4e6a8b0d2f4a6c8e0b2d4f6a81',
      created: true,
      txHash: '0x3c5e7a9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c',
      contractName: 'Rig',
    });
    // `deployments.save` of an address someone else deployed carries no transaction.
    expect(parseHardhatDeployment(JSON.stringify({ address: '0x5E8c1A3b7D9f2C4e6A8b0D2F4a6C8e0B2d4F6a81', abi: [] }), 'deployments/robinhood/USDG.json')).toBeNull();
    expect(parseHardhatDeployment(readFixture('hardhat-deploy-token.json'), 'deployments/robinhood/MockToken.json')).toBeNull();
  });

  it('Ignition: a module’s contracts, never a reference to an asset', () => {
    expect(parseIgnitionAddresses(JSON.stringify({ 'TokenModule#Rig': '0x5E8c1A3b7D9f2C4e6A8b0D2F4a6C8e0B2d4F6a81', 'TokenModule#WETH': '0x0bd7473cbbf81d9dd936c61117ed230d95006ca2' }))).toEqual([
      { address: '0x5e8c1a3b7d9f2c4e6a8b0d2f4a6c8e0b2d4f6a81', created: true, contractName: 'Rig' },
    ]);
  });

  it('a hand-kept file: its own chain key, its entries, never a reference key or the zero address', () => {
    expect(parseDeploymentsJson(readFixture('deployments-robinhood.json'))).toEqual([
      { address: '0x9f1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e71', created: true, contractName: 'RamenToken', txHash: '0x1f3e5d7c9b1a3f5e7d9c1b3a5f7e9d1c3b5a7f9e1d3c5b7a9f1e3d5c7b9a1f3e' },
      { address: '0xa1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c2', created: false, contractName: 'RamenPad' },
    ]);
  });

  it('a hand-kept file for another chain, or naming no chain, is not a record for this one', () => {
    const fixture = JSON.parse(readFixture('deployments-robinhood.json')) as Record<string, unknown>;
    expect(parseDeploymentsJson(JSON.stringify({ ...fixture, chainId: 8453 }))).toEqual([]);
    const { chainId: _dropped, ...noChain } = fixture;
    expect(parseDeploymentsJson(JSON.stringify(noChain))).toEqual([]);
  });

  it('a hand-kept file keyed by chain, a list of entries, or a file named for the chain', () => {
    const keyed = { '4663': { Token: '0x9F1b3D5f7A9c1E3b5D7f9A1c3E5b7D9f1A3c5E71' }, '1': { Token: '0x1111111111111111111111111111111111111112' } };
    expect(parseDeploymentsJson(JSON.stringify(keyed))).toEqual([{ address: '0x9f1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e71', created: false, contractName: 'Token' }]);
    const nested = { deployments: keyed };
    expect(parseDeploymentsJson(JSON.stringify(nested))?.map((c) => c.address)).toEqual(['0x9f1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e71']);
    const list = [
      { name: 'Token', chainId: 4663, address: '0x9F1b3D5f7A9c1E3b5D7f9A1c3E5b7D9f1A3c5E71' },
      { name: 'Token', chainId: 1, address: '0x1111111111111111111111111111111111111112' },
    ];
    expect(parseDeploymentsJson(JSON.stringify(list))?.map((c) => c.address)).toEqual(['0x9f1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e71']);
    const flat = { Token: '0x9F1b3D5f7A9c1E3b5D7f9A1c3E5b7D9f1A3c5E71' };
    expect(parseDeployRecord('DEPLOYMENTS_JSON', 'deployments/4663.json', JSON.stringify(flat))?.map((c) => c.address)).toEqual(['0x9f1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e71']);
    expect(parseDeployRecord('DEPLOYMENTS_JSON', 'deployments/46630.json', JSON.stringify(flat))).toEqual([]);
  });

  it('reads a key that refers to an asset or venue as a reference, not a deployment', () => {
    for (const key of ['currency0', 'quote', 'numeraire', 'settlement', 'Global Dollar', 'WETH9', 'usdg', 'SwapRouter02', 'baseToken', 'canonicalStable', 'PositionManager']) {
      expect(isReferenceKey(key), key).toBe(true);
    }
    for (const key of ['token', 'coin', 'RamenToken', 'OrynthLaunchTokenV2', 'Materials', 'HiveOFT']) {
      expect(isReferenceKey(key), key).toBe(false);
    }
  });

  it('knows a token-list or asset-registry repository by its name', () => {
    expect(isTokenListRepository('default-token-list')).toBe(true);
    expect(isTokenListRepository('assets')).toBe(true);
    expect(isTokenListRepository('robinhood-tokenlist')).toBe(true);
    expect(isTokenListRepository('neon-contracts')).toBe(false);
  });
});
