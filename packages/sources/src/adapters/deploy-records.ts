import { z } from 'zod';

/**
 * Deploy records in a repository (founder decision D1, 2026-09-30).
 *
 * A deploy tool writes down what it deployed, where: Foundry's
 * `broadcast/<Script>/<chainId>/run-latest.json`, hardhat-deploy's
 * `deployments/<network>/<Contract>.json` beside a `.chainId` file, Hardhat
 * Ignition's `ignition/deployments/chain-<id>/deployed_addresses.json`, and
 * the hand-kept `deployments*.json` many teams commit. When such a record sits
 * in a repository that is already a project's own and names a token contract
 * on Robinhood Chain, the project deployed that token — the founder's D1.
 *
 * This module only chooses which paths to read and parses what they say, with
 * Zod; which repository counts and what the tie changes is the domain's
 * (`packages/domain/src/token-repos/deploy-records.ts`). Rules kept here:
 *
 * - A path under a vendored or dependency tree (`node_modules`, `lib/`,
 *   `vendor`, `third_party`), a test, test-data, fixture, sample or example
 *   folder, or a Foundry `dry-run` never counts: it is not this repository's
 *   deployment. Nor does a hand-kept file more than two folders deep, or one
 *   that names another repository as its source (2026-10-02).
 * - The chain is read from the record — the broadcast's directory and its
 *   `chain` field, the network's `.chainId`, Ignition's `chain-<id>` folder,
 *   the JSON's own chain key — never guessed from a network's name.
 * - A Foundry transaction counts only when it created the contract (`CREATE`,
 *   `CREATE2`, or a contract a creation made); a call to an existing token is
 *   not deploying it. A hardhat-deploy record counts only with the
 *   transaction that deployed it: `deployments.save` of someone else's
 *   address has none.
 * - A contract named as a mock or test deployment, and a hand-kept entry
 *   whose key refers to a contract rather than deploying it (WETH, USDG, a
 *   router, `currency0`, `quote`, `settlement`), is dropped.
 */
export const ROBINHOOD_CHAIN_ID = 4663;

export const DEPLOY_RECORD_KINDS = ['FOUNDRY_BROADCAST', 'HARDHAT_DEPLOY', 'IGNITION', 'DEPLOYMENTS_JSON'] as const;
export type DeployRecordKind = (typeof DEPLOY_RECORD_KINDS)[number];

/** One file to read, and what kind of record it is. */
export type DeployRecordFile = { path: string; kind: DeployRecordKind };

/** A hardhat-deploy network folder: its `.chainId` decides whether its records are read. */
export type HardhatNetwork = { dir: string; chainIdPath: string; files: string[] };

export type DeployRecordPlan = {
  /** Records whose chain the path or the file itself names: Foundry, Ignition, a deployments JSON. */
  files: DeployRecordFile[];
  /** hardhat-deploy networks, most likely Robinhood Chain first. */
  hardhatNetworks: HardhatNetwork[];
};

/** A contract the record says was deployed on the chain asked about. */
export type DeployedContract = {
  /** Lowercase `0x…`. */
  address: string;
  contractName?: string;
  txHash?: string;
  /** The record carries the creating transaction (Foundry CREATE, hardhat-deploy, Ignition). */
  created: boolean;
};

const MAX_PATH_CHARS = 300;
/**
 * A folder of test data, fixtures, samples or specs (2026-10-02, outsider
 * re-check): KyberNetwork's `kyberswap-dex-lib` keeps another team's hook
 * deployment as `…/hooks/inverse/testdata/deployment.json` for an
 * integration test, and Go's `testdata/` was not on the list, so the
 * library's page adopted that team's $INVERSE as its own token. One spelling,
 * shared with the domain's SQL check of records already stored
 * (`deployRecordIsProofSql`), POSIX-compatible on purpose.
 */
export const TEST_DATA_PATH_PATTERN = '(^|/)(test|tests|__tests__|testdata|test[-_]data|fixtures?|__fixtures__|mocks?|examples?|samples?|demos?|specs?|e2e)/';
const EXCLUDED_SEGMENT = new RegExp(
  `(^|/)(node_modules|vendor|vendored|third[_-]?party|lib|libs|external|\\.git|dry-run|cache|artifacts|out|typechain(-types)?|solcInputs)/|${TEST_DATA_PATH_PATTERN}`,
  'i',
);
/**
 * A hand-kept deployments file is the repository's own record near its root
 * (2026-10-02): every one HEY verified a token from sits one or two folders
 * deep; the fixture above sat seven deep. Deeper, it is a file about
 * something else, unless it is the one file per chain inside a `deployments/`
 * folder at that depth.
 */
const HAND_KEPT_MAX_DEPTH = 2;
const folderDepth = (path: string): number => path.split('/').length - 1;
const FOUNDRY = (chainId: number) => new RegExp(`(^|/)broadcast/[^/]+/${chainId}/run-latest\\.json$`, 'i');
const IGNITION = (chainId: number) => new RegExp(`(^|/)ignition/deployments/chain-${chainId}/deployed_addresses\\.json$`, 'i');
const HARDHAT_FILE = /(^|\/)deployments\/([^/]+)\/([^/]+)\.json$/i;
const HARDHAT_CHAIN_ID = /(^|\/)deployments\/([^/]+)\/\.chainId$/i;
const DEPLOYMENTS_JSON = /(^|\/)deployments?[^/]*\.json$/i;
/** `deployments/4663.json`, `deployments/robinhood.json`: one hand-kept file per chain, directly in the folder. */
const DEPLOYMENTS_FOLDER_FILE = /(^|\/)deployments?\/[^/.][^/]*\.json$/i;
/** Network folder names that name this chain; read first. */
const LIKELY_NETWORK = /robin|rh|hood|4663|mainnet/i;
const LOCAL_NETWORK = /^(localhost|hardhat|local|anvil|ganache|dev)$/i;

/** The paths worth reading in a repository's tree, capped. `chainId` is the chain asked about. */
export function planDeployRecordReads(paths: readonly string[], options: { chainId?: number; maxNetworks?: number } = {}): DeployRecordPlan {
  const chainId = options.chainId ?? ROBINHOOD_CHAIN_ID;
  const foundry = FOUNDRY(chainId);
  const ignition = IGNITION(chainId);
  const files: DeployRecordFile[] = [];
  const networks = new Map<string, HardhatNetwork>();

  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/');
    // A path longer than any deploy tool writes is not one HEY reads (and never one it stores).
    if (path.length > MAX_PATH_CHARS || EXCLUDED_SEGMENT.test(`/${path}`)) continue;
    if (foundry.test(path)) {
      files.push({ path, kind: 'FOUNDRY_BROADCAST' });
      continue;
    }
    if (ignition.test(path)) {
      files.push({ path, kind: 'IGNITION' });
      continue;
    }
    const chainIdFile = HARDHAT_CHAIN_ID.exec(path);
    if (chainIdFile) {
      const dir = path.slice(0, path.length - '/.chainId'.length);
      const held = networks.get(dir) ?? { dir, chainIdPath: path, files: [] };
      held.chainIdPath = path;
      networks.set(dir, held);
      continue;
    }
    const hardhat = HARDHAT_FILE.exec(path);
    if (hardhat) {
      const name = hardhat[3] ?? '';
      if (name.startsWith('.') || /^(solcInputs|\.migrations)$/i.test(name)) continue;
      const dir = path.slice(0, path.lastIndexOf('/'));
      const held = networks.get(dir) ?? { dir, chainIdPath: '', files: [] };
      held.files.push(path);
      networks.set(dir, held);
      continue;
    }
    // A hand-kept deployments file: `deployments.json`, `deployment-rh.json`, or one file per chain in `deployments/`.
    const depth = folderDepth(path);
    if (DEPLOYMENTS_FOLDER_FILE.test(path) ? depth <= HAND_KEPT_MAX_DEPTH + 1 : DEPLOYMENTS_JSON.test(path) && depth <= HAND_KEPT_MAX_DEPTH) {
      files.push({ path, kind: 'DEPLOYMENTS_JSON' });
    }
  }

  const hardhatNetworks = [...networks.values()]
    .filter((network) => network.chainIdPath !== '' && network.files.length > 0)
    .filter((network) => !LOCAL_NETWORK.test(network.dir.split('/').pop() ?? ''))
    .sort((a, b) => Number(LIKELY_NETWORK.test(b.dir.split('/').pop() ?? '')) - Number(LIKELY_NETWORK.test(a.dir.split('/').pop() ?? '')) || a.dir.localeCompare(b.dir))
    .slice(0, options.maxNetworks ?? 6);

  const order: Record<DeployRecordKind, number> = { FOUNDRY_BROADCAST: 0, IGNITION: 1, HARDHAT_DEPLOY: 2, DEPLOYMENTS_JSON: 3 };
  files.sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path));
  return { files, hardhatNetworks };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = /^0x0{40}$/i;
const MOCK_NAME = /mock|fake|dummy|(^|[^a-z])test/i;
/**
 * Keys of a hand-kept file that *refer to* a contract rather than record
 * deploying it: an asset or venue someone else deployed (WETH, USDG, a
 * router, an oracle) or a role another contract plays in a pool or market
 * (`currency0`, `quote`, `numeraire`, `settlement`, `collateral`).
 * Measured on production repositories, 2026-09-30: every such key named a
 * quote asset or another project's token, never the builder's own. Compared
 * with case and punctuation removed. `npm` is the nonfungible position
 * manager's usual short name (2026-10-02: a deployments file named Uniswap's
 * V3 Positions NFT under it).
 */
const REFERENCE_KEY =
  /^(w?eth\d*|weth9|w?btc|usd\w*|dai|link|uni|native|wrapped\w*|globaldollar|currency\d?|token[01]|npm|(quote|base|settlement|collateral|underlying|payment|fee|reward|stake|staking|deposit|borrow|lend|margin)(token|asset|currency|coin)?s?|numeraire|assets?|\w*stable(coin|token)?s?|\w*(router|factory|oracle|pricefeed|feed|quoter|positionmanager|poolmanager|entrypoint|multicall|permit2)\d*|pool|pair|lp(token)?|uniswap\w*|univ\d\w*|v\d(router|factory|positionmanager)|pyth|chainlink\w*)$/;

export const isReferenceKey = (key: string): boolean => REFERENCE_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ''));

const normalAddress = (value: unknown): string | undefined =>
  typeof value === 'string' && ADDRESS.test(value) && !ZERO.test(value) ? value.toLowerCase() : undefined;

const txHash = (value: unknown): string | undefined => (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : undefined);

const bounded = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 120) : undefined);

const chainIs = (value: unknown, chainId: number): boolean =>
  (typeof value === 'number' && value === chainId) || (typeof value === 'string' && value.trim() === String(chainId));

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const dedupe = (contracts: DeployedContract[]): DeployedContract[] => {
  const byAddress = new Map<string, DeployedContract>();
  for (const contract of contracts) {
    if (contract.contractName && MOCK_NAME.test(contract.contractName)) continue;
    const held = byAddress.get(contract.address);
    if (!held || (!held.created && contract.created)) byAddress.set(contract.address, contract);
  }
  return [...byAddress.values()];
};

/* ------------------------------------------------------------ Foundry */

const foundrySchema = z.object({
  chain: z.union([z.number(), z.string()]).nullish(),
  transactions: z
    .array(
      z.object({
        hash: z.string().nullish(),
        transactionType: z.string().nullish(),
        contractName: z.string().nullish(),
        contractAddress: z.string().nullish(),
        additionalContracts: z
          .array(z.object({ address: z.string().nullish(), transactionType: z.string().nullish(), contractName: z.string().nullish() }).passthrough())
          .nullish(),
      }).passthrough(),
    )
    .max(5_000),
  receipts: z.array(z.object({ transactionHash: z.string().nullish(), status: z.union([z.string(), z.number()]).nullish() }).passthrough()).nullish(),
}).passthrough();

/** Contracts a Foundry broadcast created on `chainId`; null when the file is not a broadcast for that chain. */
export function parseFoundryBroadcast(text: string, chainId: number = ROBINHOOD_CHAIN_ID): DeployedContract[] | null {
  const parsed = foundrySchema.safeParse(parseJson(text));
  if (!parsed.success) return null;
  const record = parsed.data;
  // The folder named the chain; a broadcast that says otherwise is not trusted.
  if (record.chain !== undefined && record.chain !== null && !chainIs(record.chain, chainId)) return null;
  const failed = new Set(
    (record.receipts ?? [])
      .filter((receipt) => receipt.status === '0x0' || receipt.status === 0 || receipt.status === '0')
      .map((receipt) => txHash(receipt.transactionHash))
      .filter((hash): hash is string => hash !== undefined),
  );
  const out: DeployedContract[] = [];
  for (const tx of record.transactions) {
    const hash = txHash(tx.hash);
    if (hash && failed.has(hash)) continue;
    const type = (tx.transactionType ?? '').toUpperCase();
    const creates = type === 'CREATE' || type === 'CREATE2';
    const address = normalAddress(tx.contractAddress);
    if (creates && address) {
      const name = bounded(tx.contractName);
      out.push({ address, created: true, ...(name ? { contractName: name } : {}), ...(hash ? { txHash: hash } : {}) });
    }
    for (const extra of tx.additionalContracts ?? []) {
      const extraAddress = normalAddress(extra.address);
      if (!extraAddress) continue;
      const name = bounded(extra.contractName);
      out.push({ address: extraAddress, created: true, ...(name ? { contractName: name } : {}), ...(hash ? { txHash: hash } : {}) });
    }
  }
  return dedupe(out);
}

/* ------------------------------------------------------- hardhat-deploy */

/** The chain a hardhat-deploy network folder was deployed to, from its `.chainId` file. */
export function parseHardhatChainId(text: string): number | null {
  const value = text.trim();
  return /^\d{1,12}$/.test(value) ? Number(value) : null;
}

const hardhatSchema = z.object({
  address: z.string(),
  transactionHash: z.string().nullish(),
  receipt: z.object({ transactionHash: z.string().nullish(), contractAddress: z.string().nullish(), status: z.union([z.number(), z.string()]).nullish() }).passthrough().nullish(),
}).passthrough();

/** A hardhat-deploy deployment record; null when it is not one, or records no deploying transaction. */
export function parseHardhatDeployment(text: string, path: string): DeployedContract | null {
  const parsed = hardhatSchema.safeParse(parseJson(text));
  if (!parsed.success) return null;
  const address = normalAddress(parsed.data.address);
  if (!address) return null;
  const hash = txHash(parsed.data.transactionHash) ?? txHash(parsed.data.receipt?.transactionHash);
  // `deployments.save` of an address someone else deployed carries no transaction.
  if (!hash) return null;
  const status = parsed.data.receipt?.status;
  if (status === 0 || status === '0' || status === '0x0') return null;
  const name = bounded(path.split('/').pop()?.replace(/\.json$/i, ''));
  if (name && MOCK_NAME.test(name)) return null;
  return { address, created: true, txHash: hash, ...(name ? { contractName: name } : {}) };
}

/* ------------------------------------------------------------ Ignition */

const ignitionSchema = z.record(z.string(), z.unknown());

/** Hardhat Ignition's `deployed_addresses.json`: `{ "Module#Contract": "0x…" }`. The chain is its folder. */
export function parseIgnitionAddresses(text: string): DeployedContract[] | null {
  const parsed = ignitionSchema.safeParse(parseJson(text));
  if (!parsed.success) return null;
  const out: DeployedContract[] = [];
  for (const [key, value] of Object.entries(parsed.data).slice(0, 500)) {
    const address = normalAddress(value);
    if (!address) continue;
    const name = bounded(key.includes('#') ? key.split('#').pop() : key);
    if (name && isReferenceKey(name)) continue;
    out.push({ address, created: true, ...(name ? { contractName: name } : {}) });
  }
  return dedupe(out);
}

/* --------------------------------------------------- deployments*.json */

const CHAIN_KEYS = ['chainId', 'chain_id', 'chainID', 'chain', 'networkId', 'network_id'] as const;
const MAX_WALK_DEPTH = 5;
const MAX_ADDRESSES = 300;

type Named = { address: string; key?: string; txHash?: string };

/** Every address in a JSON subtree with the key that holds it, bounded in depth and count. */
function addressesIn(node: unknown, key: string | undefined, depth: number, out: Named[]): void {
  if (out.length >= MAX_ADDRESSES || depth > MAX_WALK_DEPTH) return;
  const direct = normalAddress(node);
  if (direct) {
    out.push({ address: direct, ...(key ? { key } : {}) });
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 500)) addressesIn(item, key, depth + 1, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  // `{ "Token": { "address": "0x…", "txHash": "0x…" } }`: the entry's key names the contract.
  const own = normalAddress(record.address) ?? normalAddress(record.contractAddress);
  if (own) {
    const hash = txHash(record.transactionHash) ?? txHash(record.txHash) ?? txHash(record.deploymentTx) ?? txHash(record.deployTx);
    const name = bounded(record.contractName) ?? bounded(record.name) ?? key;
    out.push({ address: own, ...(name ? { key: name } : {}), ...(hash ? { txHash: hash } : {}) });
    return;
  }
  for (const [childKey, value] of Object.entries(record).slice(0, 500)) {
    if ((CHAIN_KEYS as readonly string[]).includes(childKey)) continue;
    addressesIn(value, childKey, depth + 1, out);
  }
}

const deploymentsJsonSchema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()).max(5_000)]);

/**
 * A hand-kept `deployments*.json` for `chainId`: the file's own chain key is
 * that chain, a key named for the chain holds the entries, or each entry of a
 * list says its chain. A file that names no chain is not a record for this
 * one, whatever addresses it holds.
 */
export function parseDeploymentsJson(text: string, chainId: number = ROBINHOOD_CHAIN_ID, path?: string, repo?: RecordRepository): DeployedContract[] | null {
  const parsed = deploymentsJsonSchema.safeParse(parseJson(text));
  if (!parsed.success) return null;
  const found: Named[] = [];
  const data = parsed.data;
  // A file that says it records another repository's deployment is that repository's record, not this one's.
  if (repo && !Array.isArray(data) && namesAnotherRepository(data, repo)) return null;
  // The file's own name may be the chain: `deployments/4663.json`, `deployments.4663.json`.
  const named = path ? new RegExp(`(^|[^0-9])${chainId}([^0-9]|$)`).test(path.split('/').pop() ?? '') : false;

  const chainOf = (record: Record<string, unknown>): unknown => {
    for (const key of CHAIN_KEYS) if (key in record) return record[key];
    const network = record.network;
    if (network && typeof network === 'object' && !Array.isArray(network)) return (network as Record<string, unknown>).chainId;
    return undefined;
  };

  if (named) {
    addressesIn(data, undefined, 0, found);
  } else if (Array.isArray(data)) {
    for (const entry of data) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (!chainIs(chainOf(entry as Record<string, unknown>), chainId)) continue;
      addressesIn(entry, undefined, 0, found);
    }
  } else if (chainIs(chainOf(data), chainId)) {
    addressesIn(data, undefined, 0, found);
  } else {
    // `{ "4663": { … } }`, one level down at most: `{ "deployments": { "4663": … } }`.
    const chainKey = String(chainId);
    const holders: unknown[] = [];
    if (chainKey in data) holders.push(data[chainKey]);
    for (const value of Object.values(data).slice(0, 100)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && chainKey in (value as Record<string, unknown>)) {
        holders.push((value as Record<string, unknown>)[chainKey]);
      }
    }
    for (const holder of holders) addressesIn(holder, undefined, 0, found);
  }

  const out: DeployedContract[] = [];
  for (const named of found) {
    if (named.key && isReferenceKey(named.key)) continue;
    out.push({
      address: named.address,
      created: named.txHash !== undefined,
      ...(named.key ? { contractName: named.key } : {}),
      ...(named.txHash ? { txHash: named.txHash } : {}),
    });
  }
  return dedupe(out);
}

/** The repository a record was read from. */
export type RecordRepository = { owner: string; name: string };

const REPOSITORY_KEYS = ['sourceRepository', 'repository', 'sourceRepo', 'repo'] as const;

/**
 * The file's own top-level `sourceRepository` (or `repository`) names a
 * different GitHub repository (2026-10-02): Kyber's fixture said
 * `"sourceRepository": "https://github.com/calmdentist/inversecoin"`, the
 * repository that deployed the token. A value that names no GitHub
 * repository says nothing either way.
 */
export function namesAnotherRepository(data: Record<string, unknown>, repo: RecordRepository): boolean {
  for (const key of REPOSITORY_KEYS) {
    const raw = data[key];
    const value = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && typeof (raw as { url?: unknown }).url === 'string' ? (raw as { url: string }).url : undefined;
    if (!value) continue;
    const named = /^(?:(?:git\+)?https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|github:)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/.exec(value.trim());
    if (!named) continue;
    if (named[1]!.toLowerCase() !== repo.owner.toLowerCase() || named[2]!.toLowerCase() !== repo.name.toLowerCase()) return true;
  }
  return false;
}

/**
 * A library or SDK repository, by its name (2026-10-02): code others build
 * with, across chains. A token contract its tree names — in a fixture, an
 * address book, an integration — is one it works with, never one it issued:
 * `kyberswap-dex-lib` named $INVERSE. One spelling, shared with the domain's
 * SQL check of records already stored.
 */
export const LIBRARY_REPOSITORY_PATTERN = '([-_.](lib|libs|sdk|sdks)$|^(lib|sdk)$)';
export const isLibraryRepository = (name: string): boolean => new RegExp(LIBRARY_REPOSITORY_PATTERN, 'i').test(name.replace(/\.git$/i, ''));

/** One parsed file, by kind; null when the file is not a record for `chainId`. */
export function parseDeployRecord(kind: DeployRecordKind, path: string, text: string, chainId: number = ROBINHOOD_CHAIN_ID, repo?: RecordRepository): DeployedContract[] | null {
  switch (kind) {
    case 'FOUNDRY_BROADCAST':
      return parseFoundryBroadcast(text, chainId);
    case 'IGNITION':
      return parseIgnitionAddresses(text);
    case 'HARDHAT_DEPLOY': {
      const one = parseHardhatDeployment(text, path);
      return one ? [one] : null;
    }
    case 'DEPLOYMENTS_JSON':
      return parseDeploymentsJson(text, chainId, path, repo);
  }
}

/**
 * A repository that is a token list or an asset registry by its name: its
 * records name other people's tokens (`uniswap/default-token-list`,
 * `trustwallet/assets`). Never a project's own deploy record.
 */
export const isTokenListRepository = (name: string): boolean => /(^|[-_.])(token[-_.]?lists?|tokenlists?|assets|coin[-_.]?list|registry|chain[-_.]?registry)($|[-_.])/i.test(name);
