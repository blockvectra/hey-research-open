import { z } from 'zod';

import { ROBINHOOD_CHAIN_ID } from './constants';

const DEFAULT_APP_URL = 'http://localhost:3000';
const DEFAULT_DEXSCREENER_BASE_URL = 'https://api.dexscreener.com';
const DEFAULT_GECKOTERMINAL_BASE_URL = 'https://api.geckoterminal.com/api/v2';
const DEFAULT_WORKER_HEARTBEAT_MS = 60_000;
const DEFAULT_WORKER_POLL_INTERVAL_MS = 5_000;
/**
 * Jobs run at once, and jobs claimed per tick (2026-09-06).
 *
 * Sequential execution capped the runner at its claim size over the poll
 * interval — sixty jobs a minute — and production sat exactly there with 401
 * due. Six lanes against a pool of ten; see `DEFAULT_JOB_CONCURRENCY`.
 */
const DEFAULT_JOB_CONCURRENCY = 6;
const DEFAULT_JOB_CLAIM_LIMIT = 24;
/** PRD V4 section 35: new market discovery every 5-10 minutes. */
const DEFAULT_DISCOVERY_INTERVAL_MS = 10 * 60_000;
/** M13: opening price of one research request, in whole HEY. */
const DEFAULT_REQUEST_RESEARCH_HEY = 1000;

/**
 * Raw `.env` values arrive as strings or `undefined`, and an empty string means
 * "not set". Every field schema below therefore accepts a raw value and coerces
 * inside the schema, so `safeParse` reports all problems at once with paths.
 */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalUrl = optionalString.pipe(z.string().url().optional());

const requiredUrlWithDefault = (fallback: string) =>
  optionalString.transform((value) => value ?? fallback).pipe(z.string().url());

const numberWithDefault = (fallback: number) =>
  optionalString
    .transform((value) => (value === undefined ? fallback : Number(value)))
    .pipe(z.number().finite());

/** Resend issues API keys prefixed `re_`; anything else is a paste of the wrong secret. */
const RESEND_KEY_PATTERN = /^re_[A-Za-z0-9_-]{8,}$/;

/**
 * `Name <local@domain>` — the display name is required, so no message ever
 * arrives as a bare address with no idea who sent it.
 */
const MAIL_FROM_PATTERN = /^[^<>@]{1,64}<[^\s<>@]{1,64}@[^\s<>@.]+(?:\.[^\s<>@.]+)+>$/;

/** A checksummed or lowercase 20-byte EVM address; anything else is refused. */
const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'expected a 0x-prefixed 20-byte address');

/**
 * Server-side environment contract.
 *
 * Rules encoded here:
 * - no paid API key is required for local development (PRD V4 section 54);
 * - AI is disabled by default and must never be required (CLAUDE.md cost rules 13-15);
 * - Redis is intentionally absent from the schema (architecture rule 11).
 */
/** Signing secrets shorter than this are refused in production; `openssl rand -hex 32` gives 64. */
export const MIN_SESSION_SECRET_LENGTH = 32;

export const serverEnvSchema = z.object({
  nodeEnv: optionalString.pipe(
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  appUrl: requiredUrlWithDefault(DEFAULT_APP_URL),
  /**
   * Where the published part of HEY's source lives (2026-09-11). Optional:
   * the developers page shows the clone URL when it is set and says the
   * repository is on its way when it is not.
   */
  publicRepoUrl: optionalUrl,
  // Roles (MODERATOR, ADMIN) live on the users table and are granted with
  // `pnpm data:grant-role`; there is no email allowlist (removed 2026-09-04).
  /**
   * Git commit the running image was built from, set by the image build
   * (`HEY_BUILD_SHA`). Reported by `/api/health` so a deploy can be verified
   * from outside; absent in local development.
   */
  buildSha: optionalString.transform((value) =>
    value && /^[0-9a-f]{7,40}$/i.test(value) ? value.toLowerCase() : undefined,
  ),

  databaseUrl: optionalString.pipe(
    z
      .string({
        required_error: 'DATABASE_URL is required. Copy .env.example to .env and run `pnpm db:up`.',
      })
      .min(1),
  ),
  /**
   * Per-process `statement_timeout` for the shared pool, in milliseconds
   * (audit fix, 2026-09-10). Nothing cancelled a runaway query before: the
   * web sets a short one, the worker a long one for the nightly sweeps. Zero
   * or unset means no timeout, which is what a migration or a one-off script
   * should run with.
   */
  databaseStatementTimeoutMs: numberWithDefault(0).pipe(z.number().int().min(0)),

  chain: z.object({
    chainId: numberWithDefault(ROBINHOOD_CHAIN_ID).pipe(z.number().int().positive()),
    /**
     * Provider-specific slugs for the same chain; configuration, not hardcoded.
     * Both DEX Screener and GeckoTerminal identify Robinhood Chain as `robinhood`,
     * verified against their live network listings.
     */
    dexscreenerSlug: optionalString.transform((value) => value ?? 'robinhood').pipe(z.string()),
    geckoterminalNetwork: optionalString
      .transform((value) => value ?? 'robinhood')
      .pipe(z.string()),
    rpcUrl: optionalUrl,
    rpcFallbackUrl: optionalUrl,
    blockscoutBaseUrl: optionalUrl,
    /**
     * A Blockscout PRO API key (2026-09-12). When set, explorer reads go to
     * api.blockscout.com with `chain_id` and `apikey`; the instance URL above
     * keeps serving explorer links. The instance's own API sits behind a bot
     * challenge for non-browser clients, so without a key those reads degrade.
     */
    blockscoutApiKey: optionalString,
  }),

  market: z.object({
    dexscreenerBaseUrl: requiredUrlWithDefault(DEFAULT_DEXSCREENER_BASE_URL),
    geckoterminalBaseUrl: requiredUrlWithDefault(DEFAULT_GECKOTERMINAL_BASE_URL),
  }),

  /** Signs builder session cookies. Required only for write flows. */
  sessionSecret: optionalString,

  github: z.object({
    clientId: optionalString,
    clientSecret: optionalString,
    publicApiToken: optionalString,
  }),

  storage: z.object({
    endpoint: optionalUrl,
    bucket: optionalString,
    accessKeyId: optionalString,
    secretAccessKey: optionalString,
  }),

  ai: z.object({
    provider: optionalString.pipe(z.enum(['disabled', 'anthropic', 'openai']).default('disabled')),
    apiKey: optionalString,
    dailyBudgetUsd: numberWithDefault(0).pipe(z.number().nonnegative()),
  }),

  /**
   * Canonical `$HEY` token configuration (M13). The one place the token's
   * identity lives: every token-aware code path reads it from here, and the
   * official contract address is never written into source.
   *
   * Before launch: `status = prelaunch`, `tokenAddress = null`. A placeholder
   * address is refused outright. After the founder's launch and on-chain
   * verification, `status = live` with the verified address.
   */
  hey: z.object({
    chainId: numberWithDefault(ROBINHOOD_CHAIN_ID).pipe(z.number().int().positive()),
    status: optionalString.pipe(z.enum(['prelaunch', 'live']).default('prelaunch')),
    tokenAddress: optionalString.pipe(evmAddress.nullable().default(null)),
    treasuryAddress: optionalString.pipe(evmAddress.nullable().default(null)),
    // V2 since 2026-09-09 (founder): bonding curve into a locked Uniswap v4 position.
    ponsVersion: optionalString.pipe(z.enum(['v1', 'v2']).default('v2')),
    ponsFactory: optionalString.pipe(evmAddress.nullable().default(null)),
    /**
     * The creator tax $HEY will launch with, in basis points (Pons V2 allows
     * 0 to 1000). Null until the founder decides (2026-09-09): the token page
     * says so, and verification records the on-chain value without enforcing one.
     */
    creatorTaxBps: optionalString.pipe(z.coerce.number().int().min(0).max(1000).nullable().default(null)),
    ponsLaunchConfigId: optionalString
      .transform((value) => (value === undefined ? null : Number(value)))
      .pipe(z.number().int().nonnegative().nullable()),
    ponsDexConfigId: optionalString
      .transform((value) => (value === undefined ? null : Number(value)))
      .pipe(z.number().int().nonnegative().nullable()),
    /** First utility. Off until the token is live and the integration is verified. */
    requestResearchEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    /**
     * WalletConnect Cloud project id — a public identifier shipped to the
     * browser, not a secret. Without it no wallet UI is rendered at all.
     */
    walletConnectProjectId: optionalString,
    /**
     * Prelaunch preview of the wallet flow: connect and network switching are
     * live on the research card, payment is disabled and says why. Allowed
     * while prelaunch precisely so the flow is tested before real funds move.
     */
    walletPreviewEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    /* Later utilities. Flags exist so each phase is switched on independently;
       nothing consumes them yet beyond the /hey page's "planned" labels. */
    bountiesEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    /** The monthly research-funding vote (M13-D). */
    holderVoteEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    /** Early access to approved research notes for tiers that carry it (M13-F). */
    earlyAccessEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    /** Bonds behind claims (M13-C): Scout claim, owner update, project submission. */
    bondsEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    /** Blocks a receipt must be buried under before a payment counts (M13-B). */
    paymentConfirmations: optionalString.pipe(z.coerce.number().int().min(0).max(10_000).default(30)),
    scoutStakingEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    evidenceChallengesEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    apiCreditsEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    /** Price of one research request in whole HEY; adjustable, never on-chain. */
    requestResearchHeyAmount: numberWithDefault(DEFAULT_REQUEST_RESEARCH_HEY).pipe(
      z.number().positive(),
    ),
  }).superRefine((hey, context) => {
    // A live token without an address, or an address without a live token,
    // is a half-configured launch; refuse to start rather than guess.
    if (hey.status === 'live' && hey.tokenAddress === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tokenAddress'],
        message: 'HEY_TOKEN_STATUS=live requires the verified HEY_TOKEN_ADDRESS',
      });
    }
    if (hey.status === 'prelaunch' && hey.tokenAddress !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tokenAddress'],
        message: 'HEY_TOKEN_ADDRESS must stay empty while HEY_TOKEN_STATUS=prelaunch',
      });
    }
    if (hey.requestResearchEnabled && hey.status !== 'live') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestResearchEnabled'],
        message: 'HEY_REQUEST_RESEARCH_ENABLED needs HEY_TOKEN_STATUS=live',
      });
    }
    if (hey.requestResearchEnabled && hey.treasuryAddress === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['treasuryAddress'],
        message: 'HEY_REQUEST_RESEARCH_ENABLED needs HEY_TREASURY_ADDRESS (the payment recipient)',
      });
    }
    // Bounties (M13-B) move real money: only with a live token and a treasury.
    if (hey.bountiesEnabled && (hey.status !== 'live' || hey.treasuryAddress === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bountiesEnabled'],
        message: 'HEY_BOUNTIES_ENABLED needs HEY_TOKEN_STATUS=live and HEY_TREASURY_ADDRESS',
      });
    }
    if (hey.holderVoteEnabled && hey.status !== 'live') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['holderVoteEnabled'], message: 'HEY_HOLDER_VOTE_ENABLED needs HEY_TOKEN_STATUS=live' });
    }
    if (hey.earlyAccessEnabled && hey.status !== 'live') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['earlyAccessEnabled'], message: 'HEY_EARLY_ACCESS_ENABLED needs HEY_TOKEN_STATUS=live' });
    }
    if (hey.apiCreditsEnabled && hey.status !== 'live') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['apiCreditsEnabled'], message: 'HEY_API_CREDITS_ENABLED needs HEY_TOKEN_STATUS=live' });
    }
    if (hey.bondsEnabled && (hey.status !== 'live' || hey.treasuryAddress === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bondsEnabled'],
        message: 'HEY_BONDS_ENABLED needs HEY_TOKEN_STATUS=live and HEY_TREASURY_ADDRESS',
      });
    }
    for (const [flag, key] of [
      [hey.scoutStakingEnabled, 'HEY_SCOUT_STAKING_ENABLED'],
      [hey.evidenceChallengesEnabled, 'HEY_EVIDENCE_CHALLENGES_ENABLED'],
    ] as const) {
      // Designed, not built (M13 economy §22). A flag that is on with nothing
      // behind it would advertise a utility that does not exist.
      if (flag) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bountiesEnabled'],
          message: `${key} has no implementation in this release and must stay false`,
        });
      }
    }
  }),

  /**
   * Outbound email (2026-09-05).
   *
   * HEY had no mail provider for its first year and promised none. Resend is
   * now configured, so the promise becomes a contract instead: three messages,
   * every one of them the consequence of something the reader did, and one
   * switch that turns the whole layer off.
   *
   * `enabled` defaults to false, so a developer checkout, CI and any
   * deployment that forgets the block send nothing at all rather than
   * accidentally mailing real people from a test database. When it is on the
   * two other values must be real: a Resend key (`re_…`) and a From address
   * that parses as `Name <local@domain>`, because a malformed From is
   * accepted by the API and then silently rejected by every receiver.
   */
  mail: z
    .object({
      enabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
      apiKey: optionalString,
      from: optionalString,
    })
    .superRefine((mail, context) => {
      if (!mail.enabled) return;
      if (!mail.apiKey) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['apiKey'],
          message: 'HEY_MAIL_ENABLED=true requires RESEND_API_KEY',
        });
      } else if (!RESEND_KEY_PATTERN.test(mail.apiKey)) {
        // Never echo the value: the message says the shape, not the secret.
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['apiKey'],
          message: 'RESEND_API_KEY does not look like a Resend key (it starts with `re_`)',
        });
      }
      if (!mail.from) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['from'],
          message: 'HEY_MAIL_ENABLED=true requires HEY_MAIL_FROM',
        });
      } else if (!MAIL_FROM_PATTERN.test(mail.from)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['from'],
          message: 'HEY_MAIL_FROM must read `Name <local@domain>`',
        });
      }
    }),

  /**
   * Ops alerts to a Telegram chat (2026-09-11). Both values or neither: a
   * token without a chat, or a chat without a token, is a deployment mistake
   * and is refused at boot rather than silently never alerting.
   */
  alerts: z
    .object({
      telegramBotToken: optionalString,
      telegramChatId: optionalString,
    })
    .superRefine((alerts, context) => {
      if (Boolean(alerts.telegramBotToken) !== Boolean(alerts.telegramChatId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['telegramChatId'],
          message: 'HEY_TELEGRAM_BOT_TOKEN and HEY_TELEGRAM_CHAT_ID must be set together',
        });
      }
      if (alerts.telegramBotToken && !/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(alerts.telegramBotToken)) {
        // Never echo the value: the message says the shape, not the secret.
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['telegramBotToken'],
          message: 'HEY_TELEGRAM_BOT_TOKEN does not look like a bot token (`<digits>:<key>`)',
        });
      }
    }),

  worker: z.object({
    heartbeatMs: numberWithDefault(DEFAULT_WORKER_HEARTBEAT_MS).pipe(z.number().int().positive()),
    /** How often the worker polls the job table. */
    pollIntervalMs: numberWithDefault(DEFAULT_WORKER_POLL_INTERVAL_MS).pipe(
      z.number().int().positive(),
    ),
    /**
     * How many claimed jobs run at once. Capped at the connection pool: more
     * lanes than connections trades a job queue for a connection queue.
     */
    jobConcurrency: numberWithDefault(DEFAULT_JOB_CONCURRENCY).pipe(
      z.number().int().positive().max(10),
    ),
    /** How many jobs a tick claims, enough to keep the lanes fed. */
    jobClaimLimit: numberWithDefault(DEFAULT_JOB_CLAIM_LIMIT).pipe(z.number().int().positive()),
    /** How often scheduled discovery is enqueued (PRD V4 section 35). */
    discoveryIntervalMs: numberWithDefault(DEFAULT_DISCOVERY_INTERVAL_MS).pipe(
      z.number().int().positive(),
    ),
    /** Set false to run the worker without the discovery scheduler. */
    discoveryEnabled: optionalString.transform((value) => value !== 'false').pipe(z.boolean()),
    /**
     * Robinhood Stock Token API prices for tokenized equities (2026-09-04).
     * Implemented and tested, off until the founder decides whether tokenized
     * stocks are a HEY surface at all (docs/SOURCE_REGISTRY.md).
     */
    stockTokenPricesEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
  }),
}).superRefine((env, context) => {
  // A short signing secret in production is a deployment mistake, not a choice (audit M10, 2026-09-11).
  if (env.nodeEnv === 'production' && env.sessionSecret !== undefined && env.sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sessionSecret'],
      message: `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters in production; generate one with: openssl rand -hex 32`,
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type RawEnv = Record<string, string | undefined>;

/** Map flat `process.env` keys onto the nested schema shape. No validation here. */
function shapeEnv(raw: RawEnv) {
  return {
    nodeEnv: raw.NODE_ENV,
    appUrl: raw.APP_URL,
    publicRepoUrl: raw.HEY_PUBLIC_REPO_URL,
    buildSha: raw.HEY_BUILD_SHA,
    databaseUrl: raw.DATABASE_URL,
    databaseStatementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
    sessionSecret: raw.SESSION_SECRET,
    chain: {
      chainId: raw.RH_CHAIN_ID,
      dexscreenerSlug: raw.RH_DEXSCREENER_CHAIN_SLUG,
      geckoterminalNetwork: raw.RH_GECKOTERMINAL_NETWORK,
      rpcUrl: raw.RH_RPC_URL,
      rpcFallbackUrl: raw.RH_RPC_FALLBACK_URL,
      blockscoutBaseUrl: raw.RH_BLOCKSCOUT_BASE_URL,
      blockscoutApiKey: raw.RH_BLOCKSCOUT_API_KEY,
    },
    market: {
      dexscreenerBaseUrl: raw.DEXSCREENER_BASE_URL,
      geckoterminalBaseUrl: raw.GECKOTERMINAL_BASE_URL,
    },
    github: {
      clientId: raw.GITHUB_CLIENT_ID,
      clientSecret: raw.GITHUB_CLIENT_SECRET,
      publicApiToken: raw.GITHUB_PUBLIC_API_TOKEN,
    },
    storage: {
      endpoint: raw.S3_ENDPOINT,
      bucket: raw.S3_BUCKET,
      accessKeyId: raw.S3_ACCESS_KEY_ID,
      secretAccessKey: raw.S3_SECRET_ACCESS_KEY,
    },
    ai: {
      provider: raw.AI_PROVIDER,
      apiKey: raw.AI_API_KEY,
      dailyBudgetUsd: raw.AI_DAILY_BUDGET_USD,
    },
    hey: {
      chainId: raw.HEY_CHAIN_ID,
      status: raw.HEY_TOKEN_STATUS,
      tokenAddress: raw.HEY_TOKEN_ADDRESS,
      treasuryAddress: raw.HEY_TREASURY_ADDRESS,
      ponsVersion: raw.HEY_PONS_VERSION,
      ponsFactory: raw.HEY_PONS_FACTORY,
      creatorTaxBps: raw.HEY_CREATOR_TAX_BPS,
      ponsLaunchConfigId: raw.HEY_PONS_LAUNCH_CONFIG_ID,
      ponsDexConfigId: raw.HEY_PONS_DEX_CONFIG_ID,
      requestResearchEnabled: raw.HEY_REQUEST_RESEARCH_ENABLED,
      requestResearchHeyAmount: raw.REQUEST_RESEARCH_HEY_AMOUNT,
      walletConnectProjectId: raw.WALLETCONNECT_PROJECT_ID,
      walletPreviewEnabled: raw.HEY_WALLET_PREVIEW_ENABLED,
      bountiesEnabled: raw.HEY_BOUNTIES_ENABLED,
      paymentConfirmations: raw.HEY_PAYMENT_CONFIRMATIONS,
      bondsEnabled: raw.HEY_BONDS_ENABLED,
      earlyAccessEnabled: raw.HEY_EARLY_ACCESS_ENABLED,
      holderVoteEnabled: raw.HEY_HOLDER_VOTE_ENABLED,
      scoutStakingEnabled: raw.HEY_SCOUT_STAKING_ENABLED,
      evidenceChallengesEnabled: raw.HEY_EVIDENCE_CHALLENGES_ENABLED,
      apiCreditsEnabled: raw.HEY_API_CREDITS_ENABLED,
    },
    mail: {
      enabled: raw.HEY_MAIL_ENABLED,
      apiKey: raw.RESEND_API_KEY,
      from: raw.HEY_MAIL_FROM,
    },
    alerts: {
      telegramBotToken: raw.HEY_TELEGRAM_BOT_TOKEN,
      telegramChatId: raw.HEY_TELEGRAM_CHAT_ID,
    },
    worker: {
      heartbeatMs: raw.WORKER_HEARTBEAT_MS,
      pollIntervalMs: raw.WORKER_POLL_INTERVAL_MS,
      jobConcurrency: raw.WORKER_JOB_CONCURRENCY,
      jobClaimLimit: raw.WORKER_JOB_CLAIM_LIMIT,
      discoveryIntervalMs: raw.DISCOVERY_INTERVAL_MS,
      discoveryEnabled: raw.DISCOVERY_ENABLED,
      stockTokenPricesEnabled: raw.HEY_STOCK_TOKEN_PRICES_ENABLED,
    },
  };
}

/** Map a nested schema path back to the `.env` key a developer has to fix. */
const ENV_KEY_BY_PATH: Record<string, string> = {
  nodeEnv: 'NODE_ENV',
  appUrl: 'APP_URL',
  publicRepoUrl: 'HEY_PUBLIC_REPO_URL',
  buildSha: 'HEY_BUILD_SHA',
  databaseUrl: 'DATABASE_URL',
  databaseStatementTimeoutMs: 'DATABASE_STATEMENT_TIMEOUT_MS',
  sessionSecret: 'SESSION_SECRET',
  'chain.chainId': 'RH_CHAIN_ID',
  'chain.dexscreenerSlug': 'RH_DEXSCREENER_CHAIN_SLUG',
  'chain.geckoterminalNetwork': 'RH_GECKOTERMINAL_NETWORK',
  'chain.rpcUrl': 'RH_RPC_URL',
  'chain.rpcFallbackUrl': 'RH_RPC_FALLBACK_URL',
  'chain.blockscoutBaseUrl': 'RH_BLOCKSCOUT_BASE_URL',
  'chain.blockscoutApiKey': 'RH_BLOCKSCOUT_API_KEY',
  'market.dexscreenerBaseUrl': 'DEXSCREENER_BASE_URL',
  'market.geckoterminalBaseUrl': 'GECKOTERMINAL_BASE_URL',
  'github.clientId': 'GITHUB_CLIENT_ID',
  'github.clientSecret': 'GITHUB_CLIENT_SECRET',
  'github.publicApiToken': 'GITHUB_PUBLIC_API_TOKEN',
  'storage.endpoint': 'S3_ENDPOINT',
  'storage.bucket': 'S3_BUCKET',
  'storage.accessKeyId': 'S3_ACCESS_KEY_ID',
  'storage.secretAccessKey': 'S3_SECRET_ACCESS_KEY',
  'ai.provider': 'AI_PROVIDER',
  'ai.apiKey': 'AI_API_KEY',
  'ai.dailyBudgetUsd': 'AI_DAILY_BUDGET_USD',
  'hey.chainId': 'HEY_CHAIN_ID',
  'hey.status': 'HEY_TOKEN_STATUS',
  'hey.tokenAddress': 'HEY_TOKEN_ADDRESS',
  'hey.treasuryAddress': 'HEY_TREASURY_ADDRESS',
  'hey.ponsVersion': 'HEY_PONS_VERSION',
  'hey.ponsFactory': 'HEY_PONS_FACTORY',
  'hey.creatorTaxBps': 'HEY_CREATOR_TAX_BPS',
  'hey.ponsLaunchConfigId': 'HEY_PONS_LAUNCH_CONFIG_ID',
  'hey.ponsDexConfigId': 'HEY_PONS_DEX_CONFIG_ID',
  'hey.requestResearchEnabled': 'HEY_REQUEST_RESEARCH_ENABLED',
  'hey.requestResearchHeyAmount': 'REQUEST_RESEARCH_HEY_AMOUNT',
  'hey.walletConnectProjectId': 'WALLETCONNECT_PROJECT_ID',
  'hey.walletPreviewEnabled': 'HEY_WALLET_PREVIEW_ENABLED',
  'hey.bountiesEnabled': 'HEY_BOUNTIES_ENABLED',
  'hey.paymentConfirmations': 'HEY_PAYMENT_CONFIRMATIONS',
  'hey.bondsEnabled': 'HEY_BONDS_ENABLED',
  'hey.earlyAccessEnabled': 'HEY_EARLY_ACCESS_ENABLED',
  'hey.holderVoteEnabled': 'HEY_HOLDER_VOTE_ENABLED',
  'hey.scoutStakingEnabled': 'HEY_SCOUT_STAKING_ENABLED',
  'hey.evidenceChallengesEnabled': 'HEY_EVIDENCE_CHALLENGES_ENABLED',
  'hey.apiCreditsEnabled': 'HEY_API_CREDITS_ENABLED',
  'mail.enabled': 'HEY_MAIL_ENABLED',
  'mail.apiKey': 'RESEND_API_KEY',
  'mail.from': 'HEY_MAIL_FROM',
  'alerts.telegramBotToken': 'HEY_TELEGRAM_BOT_TOKEN',
  'alerts.telegramChatId': 'HEY_TELEGRAM_CHAT_ID',
  'worker.heartbeatMs': 'WORKER_HEARTBEAT_MS',
  'worker.pollIntervalMs': 'WORKER_POLL_INTERVAL_MS',
  'worker.jobConcurrency': 'WORKER_JOB_CONCURRENCY',
  'worker.jobClaimLimit': 'WORKER_JOB_CLAIM_LIMIT',
  'worker.discoveryIntervalMs': 'DISCOVERY_INTERVAL_MS',
  'worker.discoveryEnabled': 'DISCOVERY_ENABLED',
  'worker.stockTokenPricesEnabled': 'HEY_STOCK_TOKEN_PRICES_ENABLED',
};

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

export type ParsedServerEnv = { ok: true; env: ServerEnv } | { ok: false; issues: string[] };

/** Parse without throwing. Used by health endpoints and diagnostics. */
export function safeParseServerEnv(raw: RawEnv = process.env): ParsedServerEnv {
  const result = serverEnvSchema.safeParse(shapeEnv(raw));
  if (result.success) return { ok: true, env: result.data };

  return {
    ok: false,
    issues: result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `${ENV_KEY_BY_PATH[path] ?? (path || 'env')}: ${issue.message}`;
    }),
  };
}

export function parseServerEnv(raw: RawEnv = process.env): ServerEnv {
  const result = safeParseServerEnv(raw);
  if (!result.ok) throw new EnvValidationError(result.issues);
  return result.env;
}

let cached: ServerEnv | undefined;

/**
 * Lazily validated, memoised server environment.
 *
 * Deliberately lazy so `next build` never requires runtime configuration.
 */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv();
  return cached;
}

/** Test-only escape hatch for the module-level cache. */
export function resetServerEnvCache(): void {
  cached = undefined;
}

/**
 * Builder sign-in and claiming need a session secret and a GitHub OAuth app.
 * Public browsing works without either, so their absence disables write flows
 * rather than breaking the site.
 */
export function isBuilderAuthConfigured(env: ServerEnv): boolean {
  return Boolean(env.sessionSecret && env.github.clientId && env.github.clientSecret);
}

/** AI must be opt-in; every caller checks this before doing enrichment work. */
export function isAiEnabled(env: ServerEnv): boolean {
  return env.ai.provider !== 'disabled' && env.ai.dailyBudgetUsd > 0 && Boolean(env.ai.apiKey);
}

/**
 * Mail is opt-in twice over: the flag, and a configuration that validated.
 * Every send path checks this and no-ops when it is false, so development and
 * CI behave exactly like production minus the message.
 */
/** Bounties are open: the flag, a live token, and a treasury to pay from (M13-B). */
export function isBountiesOpen(env: ServerEnv): boolean {
  return env.hey.bountiesEnabled && env.hey.status === 'live' && env.hey.tokenAddress !== null && env.hey.treasuryAddress !== null;
}

/** The vote is open to run: the flag and a live token (M13-D). */
export function isHolderVoteOpen(env: ServerEnv): boolean {
  return env.hey.holderVoteEnabled && env.hey.status === 'live' && env.hey.tokenAddress !== null;
}

/** Early access is open: the flag and a live token (M13-F). */
export function isEarlyAccessOpen(env: ServerEnv): boolean {
  return env.hey.earlyAccessEnabled && env.hey.status === 'live';
}

/** API keys are open: the flag and a live token (M13-E). */
export function isApiKeysOpen(env: ServerEnv): boolean {
  return env.hey.apiCreditsEnabled && env.hey.status === 'live' && env.hey.tokenAddress !== null;
}

/** Bonds are open: the flag, a live token, and a treasury to hold them (M13-C). */
export function isBondsOpen(env: ServerEnv): boolean {
  return env.hey.bondsEnabled && env.hey.status === 'live' && env.hey.tokenAddress !== null && env.hey.treasuryAddress !== null;
}

export function isMailEnabled(env: ServerEnv): boolean {
  return env.mail.enabled && Boolean(env.mail.apiKey) && Boolean(env.mail.from);
}

/** Telegram ops alerts are on when both the bot token and the chat id are set. */
export function isTelegramAlertsEnabled(env: ServerEnv): boolean {
  return Boolean(env.alerts.telegramBotToken) && Boolean(env.alerts.telegramChatId);
}

/**
 * Where explorer reads go (2026-09-12): the PRO API with the chain and key
 * when a key is configured, else the instance itself; undefined when neither
 * is configured. Explorer links for people always use `chain.blockscoutBaseUrl`.
 */
export function explorerApiFor(chain: { chainId: number; blockscoutBaseUrl?: string | undefined; blockscoutApiKey?: string | undefined }): { baseUrl: string; chainId?: number; apiKey?: string } | undefined {
  if (chain.blockscoutApiKey) return { baseUrl: 'https://api.blockscout.com', chainId: chain.chainId, apiKey: chain.blockscoutApiKey };
  if (chain.blockscoutBaseUrl) return { baseUrl: chain.blockscoutBaseUrl };
  return undefined;
}
