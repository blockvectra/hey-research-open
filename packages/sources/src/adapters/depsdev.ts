import { z } from 'zod';

import { type SourceAdapter, type SourceContext } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { keepToProviderHost, printableToken } from './provider-host';

/**
 * deps.dev (Open Source Insights) — keyless, v3 (2026-09-27, brief §32, §34).
 *
 * Four reads, all GETs against one configured host:
 *
 * - `projects/{github.com/o/r}:packageversions` — every package version that
 *   names this repository, with how deps.dev knows it: `SLSA_ATTESTATION`
 *   (a verified build provenance), `GO_ORIGIN` (the Go module path is the
 *   repository), or `UNVERIFIED_METADATA` (the publisher typed the link —
 *   anyone can name any repository). A 404 means no package names it.
 * - `systems/{s}/packages/{name}` — the versions with their publication times
 *   and which one the registry calls the default.
 * - `systems/{s}/packages/{name}/versions/{v}` — one version's links (homepage,
 *   source repository), verified SLSA provenances and related projects.
 * - `projects/{github.com/o/r}` — only for its OpenSSF Scorecard block, when
 *   deps.dev holds one. Stars, forks and the aggregate score are deliberately
 *   not declared, so they never leave the parser: HEY shows the published
 *   checks with their date and never a verdict.
 *
 * Measured on 2026-09-27: `cache-control: public, max-age=3600`, no ETag, a
 * plain-text 404 body for an unknown project. Nothing here is a ship and
 * nothing here is scored.
 */
export const DEPSDEV_BASE_URL = 'https://api.deps.dev';

/** deps.dev's package systems, as its API spells them. */
export const DEPSDEV_SYSTEMS = ['NPM', 'PYPI', 'GO', 'CARGO', 'MAVEN', 'NUGET', 'RUBYGEMS'] as const;
export type DepsDevSystem = (typeof DEPSDEV_SYSTEMS)[number];

const CACHE_TTL_SECONDS = 3_600;
const TIMEOUT_MS = 20_000;
/** A repository with hundreds of versions across several packages runs to a few hundred KB. */
const PACKAGE_VERSIONS_MAX_BYTES = 3 * 1024 * 1024;
const PACKAGE_MAX_BYTES = 2 * 1024 * 1024;
const VERSION_MAX_BYTES = 512 * 1024;
/** MetaMask's project answer, with its Scorecard, was 64 KB. */
const PROJECT_MAX_BYTES = 512 * 1024;

const OWNER_REPO = /^[A-Za-z0-9_.-]{1,100}$/;
/** Registry names: printable, no whitespace or control characters, bounded. */
const packageName = (value: string): boolean => printableToken(value, 300);
const versionToken = (value: string): boolean => printableToken(value, 200) && !value.includes('/');

const systemSchema = z.enum(DEPSDEV_SYSTEMS);
const versionKeySchema = z.object({ system: z.string(), name: z.string(), version: z.string() });
const slsaSchema = z.object({ sourceRepository: z.string().nullish(), verified: z.boolean().nullish() });

export const depsDevPackageVersionsSchema = z.object({
  versions: z
    .array(
      z.object({
        versionKey: versionKeySchema,
        relationType: z.string().nullish(),
        relationProvenance: z.string().nullish(),
        slsaProvenances: z.array(slsaSchema).nullish(),
      }),
    )
    .nullish(),
});

export const depsDevPackageSchema = z.object({
  packageKey: z.object({ system: z.string(), name: z.string() }),
  versions: z
    .array(
      z.object({
        versionKey: versionKeySchema,
        publishedAt: z.string().nullish(),
        isDefault: z.boolean().nullish(),
        isDeprecated: z.boolean().nullish(),
      }),
    )
    .nullish(),
});

export const depsDevVersionSchema = z.object({
  versionKey: versionKeySchema,
  publishedAt: z.string().nullish(),
  links: z.array(z.object({ label: z.string(), url: z.string() })).nullish(),
  slsaProvenances: z.array(slsaSchema).nullish(),
  relatedProjects: z
    .array(
      z.object({
        projectKey: z.object({ id: z.string() }),
        relationProvenance: z.string().nullish(),
        relationType: z.string().nullish(),
      }),
    )
    .nullish(),
});

export const depsDevProjectSchema = z.object({
  projectKey: z.object({ id: z.string() }),
  scorecard: z
    .object({
      date: z.string().nullish(),
      repository: z.object({ name: z.string().nullish(), commit: z.string().nullish() }).nullish(),
      checks: z
        .array(
          z.object({
            name: z.string(),
            score: z.number().nullish(),
            reason: z.string().nullish(),
            documentation: z.object({ url: z.string().nullish() }).nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

/** How deps.dev says a package version is tied to a repository. */
export type DepsDevRelation = {
  /** `SOURCE_REPO`, `ISSUE_TRACKER`, … */
  type: string;
  /** `SLSA_ATTESTATION`, `GO_ORIGIN`, `UNVERIFIED_METADATA`, … */
  provenance: string;
};

export type DepsDevRepoPackage = {
  system: DepsDevSystem;
  name: string;
  /** Distinct (type, provenance) pairs over every version naming the repository. */
  relations: DepsDevRelation[];
  /** `https://github.com/o/r` of each verified SLSA provenance, lowercased, distinct. */
  verifiedProvenanceRepos: string[];
  versionCount: number;
};

export type DepsDevRepoPackages = { packages: DepsDevRepoPackage[] };

export type DepsDevPackageVersion = { version: string; publishedAt?: Date; isDefault: boolean; isDeprecated: boolean };

export type DepsDevPackage = {
  system: DepsDevSystem;
  name: string;
  versions: DepsDevPackageVersion[];
  /** The registry's default version, else the newest by publication time. */
  latest?: DepsDevPackageVersion;
};

export type DepsDevVersion = {
  system: DepsDevSystem;
  name: string;
  version: string;
  publishedAt?: Date;
  homepage?: string;
  /** The repository the publisher typed; a claim, not proof. */
  sourceRepo?: string;
  verifiedProvenanceRepos: string[];
  relatedProjects: { id: string; provenance: string; type: string }[];
};

export type DepsDevScorecardCheck = { name: string; score?: number; reason?: string; documentationUrl?: string };

export type DepsDevProject = {
  id: string;
  /** Absent when deps.dev holds no Scorecard for the repository — the common case. */
  scorecard?: { date?: Date; commit?: string; checks: DepsDevScorecardCheck[] };
};

export type DepsDevRepoInput = { owner: string; repo: string; baseUrl?: string };
export type DepsDevPackageInput = { system: DepsDevSystem; name: string; baseUrl?: string };
export type DepsDevVersionInput = DepsDevPackageInput & { version: string };

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** `https://github.com/o/r` from the forms deps.dev and registries store; undefined for anything else. */
export function githubRepoUrlFrom(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(?:git\+)?(?:https?:\/\/|git:\/\/|ssh:\/\/git@)?(?:www\.)?github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(value.trim());
  if (!match || !match[1] || !match[2]) return undefined;
  return `https://github.com/${match[1]}/${match[2]}`.toLowerCase();
}

const asSystem = (value: string): DepsDevSystem | undefined => {
  const parsed = systemSchema.safeParse(value.toUpperCase());
  return parsed.success ? parsed.data : undefined;
};

const baseOf = (input: { baseUrl?: string }): string => (input.baseUrl ?? DEPSDEV_BASE_URL).replace(/\/$/, '');
const projectKey = (input: DepsDevRepoInput): string => encodeURIComponent(`github.com/${input.owner}/${input.repo}`);
const request = (url: string, maxBytes: number) => ({
  url,
  headers: { accept: 'application/json' },
  maxBytes,
  allowedContentTypes: ['application/json'] as const,
  // No validators are ever sent: deps.dev answers without an ETag.
  conditional: false,
});
const bounded = (ctx: SourceContext): SourceContext => ({ ...ctx, timeoutMs: Math.min(ctx.timeoutMs, TIMEOUT_MS) });

const verifiedRepos = (provenances: readonly z.infer<typeof slsaSchema>[] | null | undefined): string[] =>
  (provenances ?? [])
    .filter((entry) => entry.verified === true)
    .map((entry) => githubRepoUrlFrom(entry.sourceRepository))
    .filter((url): url is string => url !== undefined);

/** Every package version naming a GitHub repository, grouped by package. */
export function createDepsDevRepoPackagesAdapter(): SourceAdapter<DepsDevRepoInput, DepsDevRepoPackages> {
  return {
    name: 'depsdev-packageversions',
    canHandle: (input) => OWNER_REPO.test(input.owner) && OWNER_REPO.test(input.repo),
    async fetch(input, ctx) {
      const base = baseOf(input);
      const result = await performSourceFetch(
        bounded(ctx),
        request(`${base}/v3/projects/${projectKey(input)}:packageversions`, PACKAGE_VERSIONS_MAX_BYTES),
        {
          schema: depsDevPackageVersionsSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): DepsDevRepoPackages => {
            const byKey = new Map<string, DepsDevRepoPackage & { relationKeys: Set<string>; repos: Set<string> }>();
            for (const entry of raw.versions ?? []) {
              const system = asSystem(entry.versionKey.system);
              if (!system) continue;
              const key = `${system}\u0000${entry.versionKey.name}`;
              const found =
                byKey.get(key) ??
                { system, name: entry.versionKey.name, relations: [], verifiedProvenanceRepos: [], versionCount: 0, relationKeys: new Set<string>(), repos: new Set<string>() };
              found.versionCount += 1;
              const type = entry.relationType ?? 'UNKNOWN';
              const provenance = entry.relationProvenance ?? 'UNKNOWN';
              const relationKey = `${type}\u0000${provenance}`;
              if (!found.relationKeys.has(relationKey)) {
                found.relationKeys.add(relationKey);
                found.relations.push({ type, provenance });
              }
              for (const repo of verifiedRepos(entry.slsaProvenances)) found.repos.add(repo);
              byKey.set(key, found);
            }
            return {
              packages: [...byKey.values()].map(({ relationKeys: _keys, repos, ...pkg }) => ({ ...pkg, verifiedProvenanceRepos: [...repos].sort() })),
            };
          },
        },
      );
      return keepToProviderHost(result, base);
    },
  };
}

/** A package's versions and publication times. */
export function createDepsDevPackageAdapter(): SourceAdapter<DepsDevPackageInput, DepsDevPackage> {
  return {
    name: 'depsdev-package',
    canHandle: (input) => packageName(input.name),
    async fetch(input, ctx) {
      const base = baseOf(input);
      const result = await performSourceFetch(
        bounded(ctx),
        request(`${base}/v3/systems/${input.system.toLowerCase()}/packages/${encodeURIComponent(input.name)}`, PACKAGE_MAX_BYTES),
        {
          schema: depsDevPackageSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): DepsDevPackage => {
            const versions = (raw.versions ?? []).map((entry) => ({
              version: entry.versionKey.version,
              isDefault: entry.isDefault === true,
              isDeprecated: entry.isDeprecated === true,
              ...opt('publishedAt', toDate(entry.publishedAt)),
            }));
            const newest = [...versions]
              .filter((entry) => entry.publishedAt !== undefined)
              .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))[0];
            const latest = versions.find((entry) => entry.isDefault) ?? newest;
            return { system: input.system, name: raw.packageKey.name, versions, ...(latest ? { latest } : {}) };
          },
        },
      );
      return keepToProviderHost(result, base);
    },
  };
}

/** One version's links, provenance and related projects. */
export function createDepsDevVersionAdapter(): SourceAdapter<DepsDevVersionInput, DepsDevVersion> {
  return {
    name: 'depsdev-version',
    canHandle: (input) => packageName(input.name) && versionToken(input.version),
    async fetch(input, ctx) {
      const base = baseOf(input);
      const url = `${base}/v3/systems/${input.system.toLowerCase()}/packages/${encodeURIComponent(input.name)}/versions/${encodeURIComponent(input.version)}`;
      const result = await performSourceFetch(bounded(ctx), request(url, VERSION_MAX_BYTES), {
        schema: depsDevVersionSchema,
        parse: (body) => JSON.parse(body) as unknown,
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        normalize: (raw): DepsDevVersion => {
          const link = (label: string) => raw.links?.find((entry) => entry.label.toUpperCase() === label)?.url;
          return {
            system: input.system,
            name: raw.versionKey.name,
            version: raw.versionKey.version,
            verifiedProvenanceRepos: [...new Set(verifiedRepos(raw.slsaProvenances))].sort(),
            relatedProjects: (raw.relatedProjects ?? []).map((entry) => ({
              id: entry.projectKey.id,
              provenance: entry.relationProvenance ?? 'UNKNOWN',
              type: entry.relationType ?? 'UNKNOWN',
            })),
            ...opt('publishedAt', toDate(raw.publishedAt)),
            ...opt('homepage', link('HOMEPAGE')),
            ...opt('sourceRepo', link('SOURCE_REPO')),
          };
        },
      });
      return keepToProviderHost(result, base);
    },
  };
}

/** A repository's deps.dev record — read only for its OpenSSF Scorecard block. */
export function createDepsDevProjectAdapter(): SourceAdapter<DepsDevRepoInput, DepsDevProject> {
  return {
    name: 'depsdev-project',
    canHandle: (input) => OWNER_REPO.test(input.owner) && OWNER_REPO.test(input.repo),
    async fetch(input, ctx) {
      const base = baseOf(input);
      const result = await performSourceFetch(bounded(ctx), request(`${base}/v3/projects/${projectKey(input)}`, PROJECT_MAX_BYTES), {
        schema: depsDevProjectSchema,
        parse: (body) => JSON.parse(body) as unknown,
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        normalize: (raw): DepsDevProject => {
          const card = raw.scorecard;
          const checks = (card?.checks ?? []).map((check) => ({
            name: check.name,
            ...opt('score', check.score ?? undefined),
            ...opt('reason', check.reason ? check.reason.slice(0, 300) : undefined),
            ...opt('documentationUrl', check.documentation?.url ?? undefined),
          }));
          return {
            id: raw.projectKey.id,
            ...(card && checks.length > 0
              ? { scorecard: { checks, ...opt('date', toDate(card.date)), ...opt('commit', card.repository?.commit ?? undefined) } }
              : {}),
          };
        },
      });
      return keepToProviderHost(result, base);
    },
  };
}
