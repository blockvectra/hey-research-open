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

/** The model providers HEY can call (2026-09-27): `disabled`, or the one wired adapter. */
export const AI_PROVIDERS = ['disabled', 'anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Resend issues API keys prefixed `re_`; anything else is a paste of the wrong secret. */
const RESEND_KEY_PATTERN = /^re_[A-Za-z0-9_-]{8,}$/;
/** A Bot API token: the bot's numeric id, a colon, and its key (docs/TELEGRAM.md). */
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
/** Telegram accepts 1-256 of these characters as `secret_token`; HEY asks for at least 16. */
const TELEGRAM_WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
/** A bot username: 5-32 characters, ending in "bot". */
const TELEGRAM_BOT_USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,28}[Bb][Oo][Tt]$/;

/**
 * `Name <local@domain>` — the display name is required, so no message ever
 * arrives as a bare address with no idea who sent it.
 */
const MAIL_FROM_PATTERN = /^[^<>@]{1,64}<[^\s<>@]{1,64}@[^\s<>@.]+(?:\.[^\s<>@.]+)+>$/;

/** A checksummed or lowercase 20-byte EVM address; anything else is refused. */
const evmAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'expected a 0x-prefixed 20-byte address');

/**
 * Server-side environment contract.
 *
 * Rules encoded here:
 * - no paid API key is required for local development (PRD V4 section 54);
 * - AI is disabled by default and must never be required (CLAUDE.md cost rules 13-15);
 * - Redis is intentionally absent from the schema (architecture rule 11).
 */
const PEM_BLOCK = /^-----BEGIN (?:RSA )?PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END (?:RSA )?PRIVATE KEY-----\n?$/;

/**
 * The GitHub App's private key as one PEM block (2026-10-05). An env file
 * holds one line, so the key may arrive as the PEM with its newlines escaped
 * (`\n`), or as the whole PEM base64-encoded — what HEY's setup page prints.
 * Anything that is not a private-key PEM after either reading is refused.
 */
export function normaliseGithubAppPrivateKey(raw: string): string | undefined {
  const trimmed = raw.trim();
  const candidates = [trimmed.replace(/\\n/g, '\n').replace(/\r\n/g, '\n')];
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    try {
      candidates.push(atob(trimmed).replace(/\r\n/g, '\n').trim());
    } catch {
      // Not base64: the PEM reading above is the only one.
    }
  }
  for (const candidate of candidates) {
    const pem = `${candidate.trim()}\n`;
    if (PEM_BLOCK.test(pem)) return pem;
  }
  return undefined;
}

/** Signing secrets shorter than this are refused in production; `openssl rand -hex 32` gives 64. */
export const MIN_SESSION_SECRET_LENGTH = 32;

export const serverEnvSchema = z
  .object({
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
    /**
     * The legal entity behind HEY, as `/about` states it (outsider audit,
     * 2026-10-02). Free text the founder sets ("<name>, registered in
     * <place>"); null means not stated, and `/about` then omits the line
     * entirely — never a placeholder. No person is ever named on the site.
     */
    legalEntity: optionalString.transform((value) => value ?? null),
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
          required_error:
            'DATABASE_URL is required. Copy .env.example to .env and run `pnpm db:up`.',
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
      /** CoinGecko demo API key (2026-09-12): raises the keyless limits; sent as a header. */
      coingeckoApiKey: optionalString,
      /**
       * Bitquery API token (Market Lens, 2026-09-12). When set, the worker reads
       * DEX and launchpad trades for tokens no aggregator lists a pool for;
       * without it that job never runs. Worker only; a page never sees it.
       */
      bitqueryApiKey: optionalString,
      /**
       * Lowers the daily request ceiling of the function-level contract
       * collection (founder decision F9, 2026-09-27). Absent means the cap,
       * which keeps the collection under five per cent of the plan's points;
       * zero turns it off. A higher figure is clamped to the cap by the worker.
       */
      bitqueryMethodDailyRequests: optionalString
        .transform((value) => (value === undefined ? undefined : Number(value)))
        .pipe(z.number().finite().nonnegative().optional()),
    }),

    /*
     * The Uniswap integration (2026-09-30, docs/UNISWAP_INTEGRATION.md). All
     * three default off. "View on Uniswap" is a plain link and needs none of
     * them; these govern the one thing that calls Uniswap — the indicative
     * quote a Terminal reader asks for — and the swap-form handoff after it.
     *
     *  - UNISWAP_ENABLED: the quote may be asked at all (a kill switch that
     *    leaves the key in place).
     *  - UNISWAP_API_KEY: the Trading API key from the Uniswap Developer
     *    Platform. Server only; never sent to a browser, never logged.
     *  - UNISWAP_SWAP_ENABLED: after a quote, offer "Continue on Uniswap" to
     *    Uniswap's own swap form with the reader's amount. HEY builds no
     *    transaction and embeds no swap either way.
     */
    uniswap: z.object({
      enabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
      swapEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
      apiKey: optionalString,
    }),

    /** Signs builder session cookies. Required only for write flows. */
    sessionSecret: optionalString,

    github: z.object({
      clientId: optionalString,
      clientSecret: optionalString,
      publicApiToken: optionalString,
    }),

    /*
     * The HEY GitHub App (2026-10-05, docs/GITHUB_APP.md). Off unless all four
     * are set: with any missing, the install paths are hidden, the webhook
     * answers 404 and the worker reads with the plain token as before.
     *
     *  - GITHUB_APP_ID: the app's numeric id (the JWT issuer).
     *  - GITHUB_APP_SLUG: the app's URL name, for `github.com/apps/<slug>`.
     *  - GITHUB_APP_PRIVATE_KEY: the app's private key, as the PEM GitHub
     *    gives or that PEM base64-encoded on one line. Worker only in use;
     *    never logged, never stored, never sent to a browser.
     *  - GITHUB_APP_WEBHOOK_SECRET: the HMAC secret GitHub signs deliveries
     *    with. At least 20 characters.
     *  - HEY_GITHUB_APP_BADGE_PR_ENABLED: the opt-in README badge pull
     *    request. Off by default; it also needs the app's contents and pull
     *    request write permissions, which the default manifest does not ask for.
     */
    githubApp: z.object({
      appId: optionalString.pipe(z.string().regex(/^\d{1,12}$/, 'GITHUB_APP_ID must be the app’s numeric id.').optional()),
      slug: optionalString.pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, 'GITHUB_APP_SLUG must be the app’s URL name (lowercase letters, digits, dashes).').optional()),
      privateKey: optionalString.transform((value, ctx) => {
        if (value === undefined) return undefined;
        const pem = normaliseGithubAppPrivateKey(value);
        if (!pem) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GITHUB_APP_PRIVATE_KEY must be the app’s PEM private key, or that PEM base64-encoded on one line.' });
          return z.NEVER;
        }
        return pem;
      }),
      webhookSecret: optionalString.pipe(z.string().min(20, 'GITHUB_APP_WEBHOOK_SECRET must be at least 20 characters.').optional()),
      badgePrEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
    }),

    storage: z.object({
      endpoint: optionalUrl,
      bucket: optionalString,
      accessKeyId: optionalString,
      secretAccessKey: optionalString,
    }),

    ai: z.object({
      /*
       * One wired provider (2026-09-27). `openai` used to be accepted here and
       * then did nothing: only the Anthropic adapter exists, so a deployment
       * that set it believed it had a model layer and had none. A provider HEY
       * cannot call is now a configuration error, said at boot.
       */
      provider: optionalString.pipe(
        z
          .enum(AI_PROVIDERS, {
            errorMap: () => ({ message: `AI_PROVIDER must be one of ${AI_PROVIDERS.join(', ')}. Only the Anthropic adapter is wired; any other provider would silently do nothing (docs/AI_RESEARCH.md).` }),
          })
          .default('disabled'),
      ),
      apiKey: optionalString,
      dailyBudgetUsd: numberWithDefault(0).pipe(z.number().nonnegative()),
      /** The model Ask HEY composes with when AI is on (2026-09-24). */
      model: optionalString.pipe(z.string().default('claude-sonnet-5')),
      /**
       * Per-model prices in USD per million tokens, overriding or extending the
       * built-in table (`ai-research/pricing.ts`), as JSON:
       * `{"claude-sonnet-5":{"inputPerMTok":2,"outputPerMTok":10}}`.
       */
      modelPrices: optionalString
        .transform((value, ctx) => {
          if (value === undefined) return undefined;
          try {
            return JSON.parse(value) as unknown;
          } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AI_MODEL_PRICES must be JSON: {"model":{"inputPerMTok":n,"outputPerMTok":n}}.' });
            return z.NEVER;
          }
        })
        .pipe(
          z
            .record(z.string().min(1).max(80), z.object({ inputPerMTok: z.number().nonnegative().max(1000), outputPerMTok: z.number().nonnegative().max(1000) }).strict())
            .optional(),
        ),
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
    hey: z
      .object({
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
        creatorTaxBps: optionalString.pipe(
          z.coerce.number().int().min(0).max(1000).nullable().default(null),
        ),
        ponsLaunchConfigId: optionalString
          .transform((value) => (value === undefined ? null : Number(value)))
          .pipe(z.number().int().nonnegative().nullable()),
        ponsDexConfigId: optionalString
          .transform((value) => (value === undefined ? null : Number(value)))
          .pipe(z.number().int().nonnegative().nullable()),
        /** First utility. Off until the token is live and the integration is verified. */
        requestResearchEnabled: optionalString
          .transform((value) => value === 'true')
          .pipe(z.boolean()),
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
        walletPreviewEnabled: optionalString
          .transform((value) => value === 'true')
          .pipe(z.boolean()),
        /*
         * Later utilities, one flag per phase so each is switched on on its own.
         * A flag alone opens nothing: bounties, the vote, early access, API keys
         * and bonds are each read through their `is*Open` helper below, which
         * also requires a live token (and a treasury, where money is held).
         * The domain layer's `earlyAccessFor` repeats the same live-token check.
         */
        /** Research bounties (M13-B). */
        bountiesEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
        /** The monthly research-funding vote (M13-D). */
        holderVoteEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
        /** Early access to approved research notes for tiers that carry it (M13-F). */
        earlyAccessEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
        /**
         * The Research Terminal, phase 01 (2026-09-21). Off by default and read on
         * the server: the route reads real project data, so it must not resolve at
         * all until the beta gate exists. Hiding a link is not access control.
         */
        terminalBetaEnabled: optionalString
          .transform((value) => value === 'true')
          .pipe(z.boolean()),
        /**
         * Market Integrity exposure (2026-09-25), fail closed. The worker always
         * evaluates and stores it; this decides who sees it. Unset or anything
         * unrecognised is `internal` (the admin review only); `terminal` adds the
         * Terminal beta; `public` adds the project page, the API and the MCP
         * server. The rollout order the founder set: internal, admin, Terminal,
         * then public once the false-positive rate is known.
         */
        marketIntegrityExposure: optionalString.transform((value): 'internal' | 'terminal' | 'public' =>
          value === 'terminal' || value === 'public' ? value : 'internal',
        ),
        /**
         * Whether an exit-pattern classification is named outside the admin
         * review (2026-09-25). Off unless exactly "true": no page labels an exit
         * pattern until the evidence model has been audited.
         */
        marketIntegrityExitLabels: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
        /**
         * Kill switches for three reader features (2026-09-24): Ask HEY, the
         * comparison, and the watchlist. On unless set to exactly "false", so a
         * missing value never switches a shipped feature off; off answers 404
         * on the pages and the API rather than hiding a link.
         */
        askEnabled: optionalString.transform((value) => value !== 'false').pipe(z.boolean()),
        compareEnabled: optionalString.transform((value) => value !== 'false').pipe(z.boolean()),
        watchlistEnabled: optionalString.transform((value) => value !== 'false').pipe(z.boolean()),
        /** Alerts (2026-09-28): rules over the change ledger, the inbox and alert mail. On unless "false"; off answers 404 and hides the entry points. */
        alertsEnabled: optionalString.transform((value) => value !== 'false').pipe(z.boolean()),
        /** Research boards (2026-09-28): saved, private arrangements of projects and panels in the Terminal. On unless "false"; off answers 404. */
        boardsEnabled: optionalString.transform((value) => value !== 'false').pipe(z.boolean()),
        /** Research Desks (2026-09-30): the public view of a board its owner published, at /desk/{slug}. On unless "false"; off answers 404 and hides publishing. */
        desksEnabled: optionalString.transform((value) => value !== 'false').pipe(z.boolean()),
        /** Bonds behind claims (M13-C): Scout claim, owner update, project submission. */
        bondsEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
        /** Blocks a receipt must be buried under before a payment counts (M13-B). */
        paymentConfirmations: optionalString.pipe(
          z.coerce.number().int().min(0).max(10_000).default(30),
        ),
        scoutStakingEnabled: optionalString
          .transform((value) => value === 'true')
          .pipe(z.boolean()),
        evidenceChallengesEnabled: optionalString
          .transform((value) => value === 'true')
          .pipe(z.boolean()),
        apiCreditsEnabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
        /** Price of one research request in whole HEY; adjustable, never on-chain. */
        requestResearchHeyAmount: numberWithDefault(DEFAULT_REQUEST_RESEARCH_HEY).pipe(
          z.number().positive(),
        ),
      })
      .superRefine((hey, context) => {
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
            message:
              'HEY_REQUEST_RESEARCH_ENABLED needs HEY_TREASURY_ADDRESS (the payment recipient)',
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
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['holderVoteEnabled'],
            message: 'HEY_HOLDER_VOTE_ENABLED needs HEY_TOKEN_STATUS=live',
          });
        }
        if (hey.earlyAccessEnabled && hey.status !== 'live') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['earlyAccessEnabled'],
            message: 'HEY_EARLY_ACCESS_ENABLED needs HEY_TOKEN_STATUS=live',
          });
        }
        if (hey.apiCreditsEnabled && hey.status !== 'live') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['apiCreditsEnabled'],
            message: 'HEY_API_CREDITS_ENABLED needs HEY_TOKEN_STATUS=live',
          });
        }
        if (hey.bondsEnabled && (hey.status !== 'live' || hey.treasuryAddress === null)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['bondsEnabled'],
            message: 'HEY_BONDS_ENABLED needs HEY_TOKEN_STATUS=live and HEY_TREASURY_ADDRESS',
          });
        }
        for (const [flag, path, key] of [
          [hey.scoutStakingEnabled, 'scoutStakingEnabled', 'HEY_SCOUT_STAKING_ENABLED'],
          [
            hey.evidenceChallengesEnabled,
            'evidenceChallengesEnabled',
            'HEY_EVIDENCE_CHALLENGES_ENABLED',
          ],
        ] as const) {
          // Designed, not built (M13 economy §22). A flag that is on with nothing
          // behind it would advertise a utility that does not exist.
          if (flag) {
            // The path is the flag's own (2026-09-15). It read `bountiesEnabled`
            // for both, so the issue named a variable the operator had not set.
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [path],
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
        if (
          alerts.telegramBotToken &&
          !/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(alerts.telegramBotToken)
        ) {
          // Never echo the value: the message says the shape, not the secret.
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['telegramBotToken'],
            message: 'HEY_TELEGRAM_BOT_TOKEN does not look like a bot token (`<digits>:<key>`)',
          });
        }
      }),

    /**
     * The HEY Telegram bot (2026-09-30, docs/TELEGRAM.md): a reader's alert
     * channel and a read-only lookup in chats and groups. Separate from the ops
     * alerts above, which post to one founder chat with their own bot.
     *
     * Off unless `HEY_TELEGRAM_BOT_ENABLED=true` and all three values are set:
     * the token (from @BotFather), the webhook secret Telegram echoes in
     * `X-Telegram-Bot-Api-Secret-Token` (1-256 of A-Z a-z 0-9 _ -), and the
     * bot's username, which the account page links to. Turning the flag on
     * without one of them is refused at boot. The values are never echoed.
     */
    telegram: z
      .object({
        enabled: optionalString.transform((value) => value === 'true').pipe(z.boolean()),
        botToken: optionalString,
        webhookSecret: optionalString,
        botUsername: optionalString,
      })
      .superRefine((telegram, context) => {
        if (telegram.botToken && !TELEGRAM_BOT_TOKEN_PATTERN.test(telegram.botToken)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['botToken'], message: 'TELEGRAM_BOT_TOKEN does not look like a bot token (`<digits>:<key>`)' });
        }
        if (telegram.webhookSecret && !TELEGRAM_WEBHOOK_SECRET_PATTERN.test(telegram.webhookSecret)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['webhookSecret'], message: 'TELEGRAM_WEBHOOK_SECRET is 16-256 characters of A-Z, a-z, 0-9, _ and -' });
        }
        if (telegram.botUsername && !TELEGRAM_BOT_USERNAME_PATTERN.test(telegram.botUsername)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['botUsername'], message: 'TELEGRAM_BOT_USERNAME is the bot\'s username without @, ending in "bot"' });
        }
        if (!telegram.enabled) return;
        for (const [key, name] of [
          ['botToken', 'TELEGRAM_BOT_TOKEN'],
          ['webhookSecret', 'TELEGRAM_WEBHOOK_SECRET'],
          ['botUsername', 'TELEGRAM_BOT_USERNAME'],
        ] as const) {
          if (!telegram[key]) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `HEY_TELEGRAM_BOT_ENABLED=true requires ${name}` });
        }
      }),

    /**
     * Google Search Console (2026-09-18, docs/ANALYTICS.md). Both optional:
     * without them the `GSC_SYNC` job records "not configured" and the console
     * shows its own coverage views. `credentialsJson` is the service-account
     * key file as one value; it is parsed by the client, never here, so a
     * malformed key surfaces as a job error and not as a boot failure.
     */
    searchConsole: z.object({
      credentialsJson: optionalString,
      site: optionalString,
    }),

    /**
     * Webhook delivery (2026-09-26, docs/WEBHOOKS.md). `masterKey` derives
     * every subscription's signing secret, which is never stored; without it
     * no subscription can be made and nothing is sent. Web (to show a secret
     * once) and worker (to sign) both need it. `denyAddresses` are addresses a
     * callback may never resolve to — the origin behind the CDN — on top of
     * HEY's own hostnames, which are always refused.
     */
    webhooks: z.object({
      masterKey: optionalString,
      denyAddresses: optionalString.transform((value) =>
        (value ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
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
      stockTokenPricesEnabled: optionalString
        .transform((value) => value === 'true')
        .pipe(z.boolean()),
    }),
  })
  .superRefine((env, context) => {
    // A short signing secret in production is a deployment mistake, not a choice (audit M10, 2026-09-11).
    if (
      env.nodeEnv === 'production' &&
      env.sessionSecret !== undefined &&
      env.sessionSecret.length < MIN_SESSION_SECRET_LENGTH
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sessionSecret'],
        message: `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters in production; generate one with: openssl rand -hex 32`,
      });
    }
    // A short webhook master key would make every subscriber's secret guessable; refused anywhere it is set (2026-09-26).
    if (env.webhooks.masterKey !== undefined && env.webhooks.masterKey.length < MIN_SESSION_SECRET_LENGTH) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['webhooks', 'masterKey'],
        message: `WEBHOOK_MASTER_KEY must be at least ${MIN_SESSION_SECRET_LENGTH} characters; generate one with: openssl rand -hex 32`,
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
    legalEntity: raw.HEY_LEGAL_ENTITY,
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
      coingeckoApiKey: raw.COINGECKO_API_KEY,
      bitqueryApiKey: raw.BITQUERY_API_KEY,
      bitqueryMethodDailyRequests: raw.BITQUERY_METHOD_DAYS_DAILY_REQUESTS,
      geckoterminalBaseUrl: raw.GECKOTERMINAL_BASE_URL,
    },
    uniswap: {
      enabled: raw.UNISWAP_ENABLED,
      swapEnabled: raw.UNISWAP_SWAP_ENABLED,
      apiKey: raw.UNISWAP_API_KEY,
    },
    github: {
      clientId: raw.GITHUB_CLIENT_ID,
      clientSecret: raw.GITHUB_CLIENT_SECRET,
      publicApiToken: raw.GITHUB_PUBLIC_API_TOKEN,
    },
    githubApp: {
      appId: raw.GITHUB_APP_ID,
      slug: raw.GITHUB_APP_SLUG,
      privateKey: raw.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: raw.GITHUB_APP_WEBHOOK_SECRET,
      badgePrEnabled: raw.HEY_GITHUB_APP_BADGE_PR_ENABLED,
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
      model: raw.AI_MODEL,
      modelPrices: raw.AI_MODEL_PRICES,
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
      terminalBetaEnabled: raw.HEY_TERMINAL_BETA_ENABLED,
      marketIntegrityExposure: raw.HEY_MARKET_INTEGRITY,
      marketIntegrityExitLabels: raw.HEY_MARKET_INTEGRITY_EXIT_LABELS,
      askEnabled: raw.HEY_ASK_ENABLED,
      compareEnabled: raw.HEY_COMPARE_ENABLED,
      watchlistEnabled: raw.HEY_WATCHLIST_ENABLED,
      alertsEnabled: raw.HEY_ALERTS_ENABLED,
      boardsEnabled: raw.HEY_BOARDS_ENABLED,
      desksEnabled: raw.HEY_DESKS_ENABLED,
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
    telegram: {
      enabled: raw.HEY_TELEGRAM_BOT_ENABLED,
      botToken: raw.TELEGRAM_BOT_TOKEN,
      webhookSecret: raw.TELEGRAM_WEBHOOK_SECRET,
      botUsername: raw.TELEGRAM_BOT_USERNAME,
    },
    searchConsole: {
      credentialsJson: raw.GOOGLE_SEARCH_CONSOLE_CREDENTIALS,
      site: raw.GOOGLE_SEARCH_CONSOLE_SITE,
    },
    webhooks: {
      masterKey: raw.WEBHOOK_MASTER_KEY,
      denyAddresses: raw.WEBHOOK_DENY_ADDRESSES,
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
export const ENV_KEY_BY_PATH: Record<string, string> = {
  nodeEnv: 'NODE_ENV',
  appUrl: 'APP_URL',
  publicRepoUrl: 'HEY_PUBLIC_REPO_URL',
  legalEntity: 'HEY_LEGAL_ENTITY',
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
  'market.coingeckoApiKey': 'COINGECKO_API_KEY',
  'market.bitqueryApiKey': 'BITQUERY_API_KEY',
  'market.bitqueryMethodDailyRequests': 'BITQUERY_METHOD_DAYS_DAILY_REQUESTS',
  'market.geckoterminalBaseUrl': 'GECKOTERMINAL_BASE_URL',
  'uniswap.enabled': 'UNISWAP_ENABLED',
  'uniswap.swapEnabled': 'UNISWAP_SWAP_ENABLED',
  'uniswap.apiKey': 'UNISWAP_API_KEY',
  'github.clientId': 'GITHUB_CLIENT_ID',
  'github.clientSecret': 'GITHUB_CLIENT_SECRET',
  'github.publicApiToken': 'GITHUB_PUBLIC_API_TOKEN',
  'githubApp.appId': 'GITHUB_APP_ID',
  'githubApp.slug': 'GITHUB_APP_SLUG',
  'githubApp.privateKey': 'GITHUB_APP_PRIVATE_KEY',
  'githubApp.webhookSecret': 'GITHUB_APP_WEBHOOK_SECRET',
  'githubApp.badgePrEnabled': 'HEY_GITHUB_APP_BADGE_PR_ENABLED',
  'storage.endpoint': 'S3_ENDPOINT',
  'storage.bucket': 'S3_BUCKET',
  'storage.accessKeyId': 'S3_ACCESS_KEY_ID',
  'storage.secretAccessKey': 'S3_SECRET_ACCESS_KEY',
  'ai.provider': 'AI_PROVIDER',
  'ai.apiKey': 'AI_API_KEY',
  'ai.dailyBudgetUsd': 'AI_DAILY_BUDGET_USD',
  'ai.model': 'AI_MODEL',
  'ai.modelPrices': 'AI_MODEL_PRICES',
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
  'hey.terminalBetaEnabled': 'HEY_TERMINAL_BETA_ENABLED',
  'hey.marketIntegrityExposure': 'HEY_MARKET_INTEGRITY',
  'hey.marketIntegrityExitLabels': 'HEY_MARKET_INTEGRITY_EXIT_LABELS',
  'hey.askEnabled': 'HEY_ASK_ENABLED',
  'hey.compareEnabled': 'HEY_COMPARE_ENABLED',
  'hey.watchlistEnabled': 'HEY_WATCHLIST_ENABLED',
  'hey.alertsEnabled': 'HEY_ALERTS_ENABLED',
  'hey.boardsEnabled': 'HEY_BOARDS_ENABLED',
  'hey.desksEnabled': 'HEY_DESKS_ENABLED',
  'hey.holderVoteEnabled': 'HEY_HOLDER_VOTE_ENABLED',
  'hey.scoutStakingEnabled': 'HEY_SCOUT_STAKING_ENABLED',
  'hey.evidenceChallengesEnabled': 'HEY_EVIDENCE_CHALLENGES_ENABLED',
  'hey.apiCreditsEnabled': 'HEY_API_CREDITS_ENABLED',
  'mail.enabled': 'HEY_MAIL_ENABLED',
  'mail.apiKey': 'RESEND_API_KEY',
  'mail.from': 'HEY_MAIL_FROM',
  'alerts.telegramBotToken': 'HEY_TELEGRAM_BOT_TOKEN',
  'alerts.telegramChatId': 'HEY_TELEGRAM_CHAT_ID',
  'telegram.enabled': 'HEY_TELEGRAM_BOT_ENABLED',
  'telegram.botToken': 'TELEGRAM_BOT_TOKEN',
  'telegram.webhookSecret': 'TELEGRAM_WEBHOOK_SECRET',
  'telegram.botUsername': 'TELEGRAM_BOT_USERNAME',
  'searchConsole.credentialsJson': 'GOOGLE_SEARCH_CONSOLE_CREDENTIALS',
  'searchConsole.site': 'GOOGLE_SEARCH_CONSOLE_SITE',
  'webhooks.masterKey': 'WEBHOOK_MASTER_KEY',
  'webhooks.denyAddresses': 'WEBHOOK_DENY_ADDRESSES',
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

export type ParsedServerEnv =
  | { ok: true; env: ServerEnv }
  /**
   * `issues` carries the full Zod message and belongs in a log. `variables` is
   * the names alone, safe to answer an unauthenticated probe with: an operator
   * reading a 503 needs to know which variable to look at, and nobody else
   * needs to know what value it currently holds (2026-09-15).
   */
  | { ok: false; issues: string[]; variables: string[] };

/** Parse without throwing. Used by health endpoints and diagnostics. */
export function safeParseServerEnv(raw: RawEnv = process.env): ParsedServerEnv {
  const result = serverEnvSchema.safeParse(shapeEnv(raw));
  if (result.success) return { ok: true, env: result.data };

  const named = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return { variable: ENV_KEY_BY_PATH[path] ?? (path || 'env'), message: issue.message };
  });
  return {
    ok: false,
    issues: named.map((issue) => `${issue.variable}: ${issue.message}`),
    variables: [...new Set(named.map((issue) => issue.variable))],
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

/**
 * The HEY GitHub App is configured (2026-10-05, docs/GITHUB_APP.md): its id,
 * URL name, private key and webhook secret are all set. Off, every install
 * path is hidden, `/api/github/webhook` answers 404 and nothing changes for
 * the worker's reads.
 */
export function isGithubAppConfigured(env: ServerEnv): boolean {
  return Boolean(env.githubApp.appId && env.githubApp.slug && env.githubApp.privateKey && env.githubApp.webhookSecret);
}

/** The opt-in README badge pull request: the app configured and the founder's flag on. Off by default. */
export function isGithubAppBadgePrEnabled(env: ServerEnv): boolean {
  return isGithubAppConfigured(env) && env.githubApp.badgePrEnabled;
}

/** Where a builder installs the app, with HEY's single-use state; undefined while the app is not configured. */
export function githubAppInstallUrl(env: ServerEnv, state: string): string | undefined {
  if (!isGithubAppConfigured(env)) return undefined;
  const url = new URL(`https://github.com/apps/${env.githubApp.slug as string}/installations/new`);
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Whether a surface may show Market Integrity (2026-09-25). The admin review
 * always may; the Terminal from `terminal`; the project page, the API and the
 * MCP server only at `public`. Fail closed: the default is `internal`.
 */
export function marketIntegrityVisible(env: ServerEnv, surface: 'admin' | 'terminal' | 'public'): boolean {
  if (surface === 'admin') return true;
  const level = env.hey.marketIntegrityExposure;
  return surface === 'terminal' ? level === 'terminal' || level === 'public' : level === 'public';
}

/** Whether an exit-pattern classification may be named on that surface: the admin review, or a visible surface with the labels flag on. */
export function marketIntegrityExitLabelsVisible(env: ServerEnv, surface: 'admin' | 'terminal' | 'public'): boolean {
  return surface === 'admin' || (env.hey.marketIntegrityExitLabels && marketIntegrityVisible(env, surface));
}

/** AI must be opt-in; every caller checks this before doing enrichment work. */
export function isAiEnabled(env: ServerEnv): boolean {
  return env.ai.provider !== 'disabled' && env.ai.dailyBudgetUsd > 0 && Boolean(env.ai.apiKey);
}

/** Bounties are open: the flag, a live token, and a treasury to pay from (M13-B). */
export function isBountiesOpen(env: ServerEnv): boolean {
  return (
    env.hey.bountiesEnabled &&
    env.hey.status === 'live' &&
    env.hey.tokenAddress !== null &&
    env.hey.treasuryAddress !== null
  );
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
  return (
    env.hey.bondsEnabled &&
    env.hey.status === 'live' &&
    env.hey.tokenAddress !== null &&
    env.hey.treasuryAddress !== null
  );
}

/**
 * Mail is opt-in twice over: the flag, and a configuration that validated.
 * Every send path checks this and no-ops when it is false, so development and
 * CI behave exactly like production minus the message.
 */
export function isMailEnabled(env: ServerEnv): boolean {
  return env.mail.enabled && Boolean(env.mail.apiKey) && Boolean(env.mail.from);
}

/**
 * The HEY Telegram bot (2026-09-30, docs/TELEGRAM.md) is on when the flag is
 * set and the token, the webhook secret and the username are all present.
 * Off, the account page says Telegram is not available yet, the webhook
 * answers 404 and nothing is delivered.
 */
export function isTelegramBotEnabled(env: ServerEnv): boolean {
  return env.telegram.enabled && Boolean(env.telegram.botToken) && Boolean(env.telegram.webhookSecret) && Boolean(env.telegram.botUsername);
}

/** The bot's public link, `https://t.me/<username>`, or undefined while the bot is off. */
export function telegramBotUrl(env: ServerEnv): string | undefined {
  return isTelegramBotEnabled(env) ? `https://t.me/${env.telegram.botUsername as string}` : undefined;
}

/** Telegram ops alerts are on when both the bot token and the chat id are set. */
export function isTelegramAlertsEnabled(env: ServerEnv): boolean {
  return Boolean(env.alerts.telegramBotToken) && Boolean(env.alerts.telegramChatId);
}

/** Both Search Console values are set; the key itself is only parsed by the client that uses it. */
export function isSearchConsoleConfigured(env: ServerEnv): boolean {
  return Boolean(env.searchConsole.credentialsJson && env.searchConsole.site);
}

/**
 * Where explorer reads go (2026-09-12; keyed only since 2026-09-30): the PRO
 * API with the chain and key, and nowhere without a key. The instance itself
 * is no longer read — its CDN challenges non-browser clients, and the founder
 * ruled on 2026-09-30 that HEY does not rely on an agent string getting past
 * it — so without `RH_BLOCKSCOUT_API_KEY` every explorer read is "not read".
 * Explorer links for people always use `chain.blockscoutBaseUrl`.
 */
export function explorerApiFor(chain: {
  chainId: number;
  blockscoutBaseUrl?: string | undefined;
  blockscoutApiKey?: string | undefined;
}): { baseUrl: string; chainId: number; apiKey: string } | undefined {
  if (!chain.blockscoutApiKey) return undefined;
  return { baseUrl: 'https://api.blockscout.com', chainId: chain.chainId, apiKey: chain.blockscoutApiKey };
}
