import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import {
  BITQUERY_DEPLOYMENT_QUERY,
  deploymentQuery,
  createBitqueryDeploymentAdapter,
  normalizeBitqueryDeployment,
} from './bitquery-deployment';

/** The real response for a Pons launch, probed on 2026-09-15. */
const TOKEN = '0xb3e85603c2430ed3d1695bce748879de4900bf50';
/** The inner deployer Pons runs every creation through. */
const FACTORY = '0x3711cea4feade896c913c68f01eda97cb06d1a42';
/** The contract the account actually called — Pons V2's public factory. */
const ENTRY = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const DEPLOYER = '0xe8c0daa9f9a9b7a2c1e5d0f3b6a8c4d2e1f09b7a';

const probed = [
  {
    Block: { Time: '2026-09-15T09:46:28Z', Number: '4821993' },
    Call: { From: FACTORY, To: TOKEN, Create: true },
    Transaction: { From: DEPLOYER, Hash: '0xaa11', To: ENTRY },
  },
];

describe('bitquery deployment', () => {
  it('asks for the creating call only, oldest first', () => {
    // A `Create` call whose `To` is the contract is the creation. Without
    // `Create: true` the cube answers every call ever made to the address.
    expect(BITQUERY_DEPLOYMENT_QUERY).toContain('Create: true');
    expect(BITQUERY_DEPLOYMENT_QUERY).toContain('To: { is: $address }');
    expect(BITQUERY_DEPLOYMENT_QUERY).toContain('orderBy: { ascending: Block_Time }');
    /*
     * The default document spans the archive (2026-09-22).
     *
     * This asserted `realtime`, which was true when it was written — the
     * archive answered 403 on the plan HEY had. The founder then bought the
     * historical add-on and this assertion quietly kept the code on a dataset
     * that reaches back about four days, so /scan could not find the creating
     * call for any contract older than that. Probed on 2026-09-22: realtime
     * returned nothing for early August, archive and combined returned the
     * trades.
     */
    expect(BITQUERY_DEPLOYMENT_QUERY).toContain('dataset: combined');
    expect(deploymentQuery('realtime')).toContain('dataset: realtime');
    expect(deploymentQuery('archive')).toContain('dataset: archive');
  });

  it('separates what executed the creation from the account that sent it', () => {
    // The distinction the explorer collapses: a launchpad token is created by
    // a factory on behalf of somebody, and "who built it" means the somebody.
    expect(normalizeBitqueryDeployment(probed, TOKEN)).toEqual({
      address: TOKEN,
      creator: FACTORY,
      origin: DEPLOYER,
      entryPoint: ENTRY,
      txHash: '0xaa11',
      blockNumber: 4_821_993,
      createdAt: new Date('2026-09-15T09:46:28Z'),
    });
  });

  it('carries the contract the account called, which is where a launchpad is named', () => {
    // Probed 2026-09-15: every Pons launch creates through an inner deployer,
    // and the factory HEY's registry watches appears only as `Transaction.To`.
    expect(BITQUERY_DEPLOYMENT_QUERY).toContain('Transaction { From Hash To }');
    expect(normalizeBitqueryDeployment(probed, TOKEN)?.entryPoint).toBe(ENTRY);
  });

  it('leaves the origin off a direct deploy, where it is the creator', () => {
    const row = {
      Block: { Time: '2026-09-15T09:46:28Z', Number: 12 },
      Call: { From: DEPLOYER.toUpperCase(), To: TOKEN.toUpperCase() },
      Transaction: { From: DEPLOYER, Hash: '0xbb' },
    };
    const result = normalizeBitqueryDeployment([row], TOKEN);
    expect(result?.creator).toBe(DEPLOYER);
    expect(result?.origin).toBeUndefined();
  });

  it('drops a row for another address rather than reporting its creator', () => {
    const other = [{ ...probed[0]!, Call: { From: FACTORY, To: DEPLOYER } }];
    expect(normalizeBitqueryDeployment(other, TOKEN)).toBeUndefined();
  });

  it('answers nothing for a contract older than the window, not a guess', () => {
    // An empty cube means "outside the ~4 days realtime holds", never "never
    // deployed" — the caller has to say so, so the adapter must not invent one.
    expect(normalizeBitqueryDeployment([], TOKEN)).toBeUndefined();
    expect(normalizeBitqueryDeployment(undefined, TOKEN)).toBeUndefined();
  });

  it('declines an address it cannot ask about, and a missing key', () => {
    const adapter = createBitqueryDeploymentAdapter();
    expect(adapter.canHandle({ address: TOKEN, apiKey: 'k' })).toBe(true);
    expect(adapter.canHandle({ address: 'nope', apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ address: TOKEN, apiKey: '' })).toBe(false);
  });

  it('fetches the creation and surfaces a GraphQL error as an error', async () => {
    const adapter = createBitqueryDeploymentAdapter();
    const ctx = {
      timeoutMs: 1_000,
      retry: { attempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
      now: () => new Date('2026-09-15T12:00:00Z'),
      fetchImpl: async (_url: string | URL, init?: { body?: unknown }) =>
        new Response(
          JSON.stringify(
            String(init?.body ?? '').includes(TOKEN)
              ? { data: { EVM: { Calls: probed } } }
              : { errors: [{ message: 'bad query' }] },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    };

    const ok = await adapter.fetch({ address: TOKEN.toUpperCase(), apiKey: 'k' }, ctx as never);
    expect(ok.status).toBe('fresh');
    expect(ok.status === 'fresh' ? ok.data?.origin : undefined).toBe(DEPLOYER);

    const bad = await adapter.fetch(
      { address: '0x0000000000000000000000000000000000000001', apiKey: 'k' },
      ctx as never,
    );
    expect(bad.status).toBe('error');
  });
});

/*
 * The cases above hand typed literals to the normaliser, so the Zod schema
 * never ran (round 9, 2026-09-19) — architecture rule 16 on the one paid
 * source. The fixture is the shape the 2026-09-15 probe returned, hand-built
 * from the adapter's own schema; Bitquery is keyed and metered and is never
 * called from a test.
 */
const json = (body: string) => ({ status: 200, body, headers: { 'content-type': 'application/json' } });
const fixture = () => JSON.parse(readFixture('bitquery-deployment.json')) as {
  data: { EVM: { Calls: Record<string, unknown>[] } };
};

describe('bitquery deployment, through the schema', () => {
  const adapter = createBitqueryDeploymentAdapter();
  const input = { address: TOKEN, apiKey: 'test-token' };

  it('validates the saved envelope and separates the factory from the deployer', async () => {
    const stub = stubFetch(json(readFixture('bitquery-deployment.json')));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    expect(result.data).toEqual({
      address: TOKEN,
      creator: FACTORY,
      origin: DEPLOYER,
      entryPoint: ENTRY,
      txHash: '0xaa11',
      blockNumber: 4_821_993,
      createdAt: new Date('2026-09-15T09:46:28Z'),
    });
  });

  it('refuses an account that arrives as an object instead of an address', async () => {
    // A plausible reshape: `Call.From` becoming `{ Address }` like the holders
    // cube. Nothing downstream would notice — `address()` would read undefined
    // and the creation would silently become "HEY could not read it".
    const body = fixture();
    body.data.EVM.Calls[0]!.Call = { From: { Address: FACTORY }, To: TOKEN };
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('refuses a `Calls` that is no longer a list', async () => {
    const body = fixture();
    (body.data.EVM as Record<string, unknown>).Calls = { edges: [] };
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
