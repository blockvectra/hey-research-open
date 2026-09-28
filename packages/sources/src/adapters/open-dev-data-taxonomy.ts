import { z } from 'zod';

/**
 * The Open Dev Data taxonomy, replayed (2026-09-28, brief §25).
 *
 * Electric Capital publishes its crypto-ecosystems taxonomy as a directory of
 * dated migration files in a small DSL (`ecoadd`, `repadd`, `ecocon`,
 * `ecodis`, `ecorem`, `repmov`, `ecomov`, `reprem`). There is no released
 * export file: their own tool replays the migrations to produce one. This is
 * a line-for-line port of that replay (`src/open_dev_data/taxonomy.py` and
 * `shlex_parser.py` in github.com/electric-capital/open-dev-data, read
 * 2026-09-28) so HEY's reading of a repository matches theirs:
 *
 *  - files are replayed only when the name starts `YYYY-MM-DDThhmmss` with a
 *    real date, in order of the first 19 characters (the full name breaks a
 *    tie, so the order is deterministic);
 *  - a line is a comment when it is blank or starts with `#`; a line shorter
 *    than six characters is skipped; the keyword is the first six characters
 *    and anything else is ignored;
 *  - the arguments are split like a shell (quotes group, backslash escapes);
 *  - a command that fails (unknown ecosystem, wrong arity, unterminated
 *    quote) is recorded as an error and the replay continues, as theirs does.
 *
 * Every command's arguments are validated with Zod (CLAUDE.md rule 15). The
 * replay holds only what the taxonomy holds — ecosystem names, repository
 * URLs, tags — and HEY keeps only the answers for its own repositories.
 */

const MIGRATION_NAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})/;

/** Their `has_valid_timestamp`: the dated prefix, with a real calendar date and time. */
export function isMigrationFileName(name: string): boolean {
  const match = MIGRATION_NAME.exec(name);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export class UnterminatedQuoteError extends Error {}

/** Their `shlex_parser.split`: whitespace separates, quotes group, a backslash escapes the next character. */
export function splitDslArguments(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  const space = (c: string | undefined) => c !== undefined && /\s/.test(c);
  while (i < n) {
    while (i < n && space(line[i])) i += 1;
    if (i >= n) break;
    const chars: string[] = [];
    const first = line[i];
    if (first === '"' || first === "'") {
      i += 1;
      while (i < n && line[i] !== first) {
        if (line[i] === '\\' && i + 1 < n) i += 1;
        chars.push(line[i]!);
        i += 1;
      }
      if (i >= n) throw new UnterminatedQuoteError('Unterminated quote');
      i += 1;
    } else {
      while (i < n && !space(line[i])) {
        if (line[i] === '\\' && i + 1 < n) i += 1;
        chars.push(line[i]!);
        i += 1;
      }
    }
    tokens.push(chars.join(''));
  }
  return tokens;
}

const ecoName = z.string().min(1).max(300);
const repoUrl = z.string().min(1).max(600);
const tag = z.string().min(1).max(200);

/** One command's arguments. Arity errors are theirs to raise too; the length checks are HEY's bound. */
const COMMAND_SCHEMAS = {
  ecoadd: z.tuple([ecoName]),
  repadd: z.tuple([ecoName, repoUrl]).rest(tag),
  ecocon: z.tuple([ecoName, ecoName]),
  ecodis: z.tuple([ecoName, ecoName]),
  ecorem: z.tuple([ecoName]),
  repmov: z.tuple([repoUrl, repoUrl]),
  ecomov: z.tuple([ecoName, ecoName]),
  reprem: z.tuple([ecoName, repoUrl]),
} as const;
type Keyword = keyof typeof COMMAND_SCHEMAS;
const isKeyword = (value: string): value is Keyword => Object.prototype.hasOwnProperty.call(COMMAND_SCHEMAS, value);

export type TaxonomyError = { file: string; line: number; kind: string };

export type TaxonomyEcosystemListing = {
  /** The ecosystem's current name. */
  name: string;
  /** Repositories listed directly under it. */
  repos: number;
  /** Distinct GitHub owners among those repositories — a count, never the owners. */
  owners: number;
  /** Share of its directly listed repositories held by this repository's own GitHub owner, 0–1. */
  ownerShare: number;
};

export type RepoListing = {
  /** Ecosystems that list the repository directly, by name. */
  ecosystems: TaxonomyEcosystemListing[];
  /** Tags the taxonomy gives it, across those listings. */
  tags: string[];
};

/** `https://github.com/<owner>/<repo>` lower-cased, or undefined for anything that is not a GitHub repository. */
export function normalizeGithubRepoUrl(url: string): string | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i.exec(url.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return `https://github.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
}

const ownerOf = (normalized: string): string => normalized.split('/')[3] ?? '';

/**
 * The replayed taxonomy. Holds the full state (their `Taxonomy` class) until
 * the caller has asked about its repositories, then can be dropped.
 */
export class OpenDevDataTaxonomy {
  private ecoAutoId = 0;
  private repoAutoId = 0;
  private readonly ecoIds = new Map<string, number>();
  private readonly ecoName = new Map<number, string>();
  private readonly repoIds = new Map<string, number>();
  private readonly repoUrl = new Map<number, string>();
  private readonly ecoRepos = new Map<number, Set<number>>();
  private readonly children = new Map<number, Set<number>>();
  private readonly parents = new Map<number, Set<number>>();
  private readonly tags = new Map<string, Set<string>>();
  readonly errors: TaxonomyError[] = [];
  errorCount = 0;
  migrations = 0;

  /** Replay one migration file's text. */
  applyFile(file: string, text: string): void {
    this.migrations += 1;
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const stripped = line.trimStart();
      if (stripped.length === 0 || stripped[0] === '#') continue;
      if (line.length < 6) continue;
      const keyword = line.slice(0, 6);
      if (!isKeyword(keyword)) continue;
      try {
        const tokens = splitDslArguments(line.slice(6));
        const parsed = COMMAND_SCHEMAS[keyword].safeParse(tokens);
        if (!parsed.success) throw new CommandError(`${keyword}Arguments`);
        this.run(keyword, parsed.data as string[]);
      } catch (error) {
        const kind = error instanceof CommandError ? error.message : error instanceof UnterminatedQuoteError ? 'UnterminatedQuote' : 'Error';
        this.errorCount += 1;
        if (this.errors.length < 20) this.errors.push({ file, line: index + 1, kind });
      }
    }
  }

  private run(keyword: Keyword, args: string[]): void {
    switch (keyword) {
      case 'ecoadd':
        if (!this.ecoIds.has(args[0]!)) {
          this.ecoAutoId += 1;
          this.ecoIds.set(args[0]!, this.ecoAutoId);
          this.ecoName.set(this.ecoAutoId, args[0]!);
        }
        return;
      case 'repadd': {
        const eco = this.eco(args[0]!, 'InvalidEcosystem');
        const url = args[1]!;
        let repo = this.repoIds.get(url);
        if (repo === undefined) {
          this.repoAutoId += 1;
          repo = this.repoAutoId;
          this.repoIds.set(url, repo);
          this.repoUrl.set(repo, url);
        }
        let set = this.ecoRepos.get(eco);
        if (!set) {
          set = new Set();
          this.ecoRepos.set(eco, set);
        }
        set.add(repo);
        if (args.length > 2) {
          const key = `${eco}:${repo}`;
          let tagSet = this.tags.get(key);
          if (!tagSet) {
            tagSet = new Set();
            this.tags.set(key, tagSet);
          }
          for (const tag of args.slice(2)) tagSet.add(tag);
        }
        return;
      }
      case 'ecocon': {
        const parent = this.eco(args[0]!, 'InvalidParentEcosystem');
        const child = this.eco(args[1]!, 'InvalidChildEcosystem');
        link(this.children, parent, child);
        link(this.parents, child, parent);
        return;
      }
      case 'ecodis': {
        const parent = this.eco(args[0]!, 'InvalidParentEcosystem');
        const child = this.eco(args[1]!, 'InvalidChildEcosystem');
        const kids = this.children.get(parent);
        if (!kids) throw new CommandError('ParentEcosystemHasNoChildren');
        kids.delete(child);
        this.parents.get(child)?.delete(parent);
        return;
      }
      case 'ecorem': {
        const eco = this.eco(args[0]!, 'InvalidEcosystem');
        for (const parent of this.parents.get(eco) ?? []) this.children.get(parent)?.delete(eco);
        this.parents.delete(eco);
        this.children.delete(eco);
        this.ecoIds.delete(args[0]!);
        return;
      }
      case 'repmov': {
        const [src, dst] = args as [string, string];
        if (src === dst) return;
        const srcId = this.repoIds.get(src);
        if (srcId === undefined) throw new CommandError('InvalidSourceRepo');
        const dstId = this.repoIds.get(dst);
        if (dstId !== undefined) {
          for (const set of this.ecoRepos.values()) {
            if (set.delete(srcId)) set.add(dstId);
          }
          this.repoIds.delete(src);
          this.repoUrl.delete(srcId);
        } else {
          this.repoIds.delete(src);
          this.repoUrl.set(srcId, dst);
          this.repoIds.set(dst, srcId);
        }
        return;
      }
      case 'ecomov': {
        const [src, dst] = args as [string, string];
        const id = this.ecoIds.get(src);
        if (id === undefined) throw new CommandError('InvalidSourceEcosystem');
        if (this.ecoIds.has(dst)) throw new CommandError('DestinationEcosystemAlreadyExists');
        this.ecoIds.delete(src);
        this.ecoName.set(id, dst);
        this.ecoIds.set(dst, id);
        return;
      }
      case 'reprem': {
        const eco = this.eco(args[0]!, 'InvalidEcosystem');
        const set = this.ecoRepos.get(eco);
        if (!set) throw new CommandError('EcosystemHasNoRepos');
        const repo = this.repoIds.get(args[1]!);
        if (repo === undefined) throw new CommandError('InvalidRepo');
        set.delete(repo);
        this.tags.delete(`${eco}:${repo}`);
        return;
      }
    }
  }

  private eco(name: string, error: string): number {
    const id = this.ecoIds.get(name);
    if (id === undefined) throw new CommandError(error);
    return id;
  }

  /** Ecosystems that exist now (a removed one keeps its id but not its name). */
  get ecosystemCount(): number {
    return this.ecoIds.size;
  }

  /** Repositories listed directly under at least one existing ecosystem. */
  get listedRepoCount(): number {
    const seen = new Set<number>();
    for (const id of this.ecoIds.values()) for (const repo of this.ecoRepos.get(id) ?? []) seen.add(repo);
    return seen.size;
  }

  /**
   * Where each of these repositories is listed, keyed by its normalised URL
   * (`normalizeGithubRepoUrl`). A repository the taxonomy does not list is
   * absent from the answer: "not listed" is a reading of this one index.
   */
  lookup(urls: Iterable<string>): Map<string, RepoListing> {
    const wanted = new Set<string>();
    for (const url of urls) {
      const normalized = normalizeGithubRepoUrl(url);
      if (normalized) wanted.add(normalized);
    }
    // Case variants of one repository are one repository, as HEY's own sources are (2026-09-17).
    const idsByUrl = new Map<string, number[]>();
    const urlById = new Map<number, string>();
    for (const [url, id] of this.repoIds) {
      const normalized = normalizeGithubRepoUrl(url);
      if (!normalized || !wanted.has(normalized)) continue;
      const list = idsByUrl.get(normalized) ?? [];
      list.push(id);
      idsByUrl.set(normalized, list);
      urlById.set(id, normalized);
    }

    const ecosByUrl = new Map<string, Set<number>>();
    const tagsByUrl = new Map<string, Set<string>>();
    for (const eco of this.ecoIds.values()) {
      const set = this.ecoRepos.get(eco);
      if (!set) continue;
      for (const [id, normalized] of urlById) {
        if (!set.has(id)) continue;
        const ecos = ecosByUrl.get(normalized) ?? new Set<number>();
        ecos.add(eco);
        ecosByUrl.set(normalized, ecos);
        for (const tag of this.tags.get(`${eco}:${id}`) ?? []) {
          const tags = tagsByUrl.get(normalized) ?? new Set<string>();
          tags.add(tag);
          tagsByUrl.set(normalized, tags);
        }
      }
    }

    // Owner counts for the ecosystems involved only.
    const ownerCounts = new Map<number, Map<string, number>>();
    for (const ecos of ecosByUrl.values()) {
      for (const eco of ecos) {
        if (ownerCounts.has(eco)) continue;
        const counts = new Map<string, number>();
        for (const repo of this.ecoRepos.get(eco) ?? []) {
          const url = this.repoUrl.get(repo);
          const normalized = url ? normalizeGithubRepoUrl(url) : undefined;
          const owner = normalized ? ownerOf(normalized) : '';
          counts.set(owner, (counts.get(owner) ?? 0) + 1);
        }
        ownerCounts.set(eco, counts);
      }
    }

    const answer = new Map<string, RepoListing>();
    for (const [normalized, ecos] of ecosByUrl) {
      const owner = ownerOf(normalized);
      const ecosystems = [...ecos]
        .map((eco): TaxonomyEcosystemListing => {
          const counts = ownerCounts.get(eco)!;
          const repos = this.ecoRepos.get(eco)?.size ?? 0;
          const githubOwners = [...counts.keys()].filter((key) => key !== '').length;
          return { name: this.ecoName.get(eco)!, repos, owners: githubOwners, ownerShare: repos === 0 ? 0 : Math.round(((counts.get(owner) ?? 0) / repos) * 1000) / 1000 };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
      answer.set(normalized, { ecosystems, tags: [...(tagsByUrl.get(normalized) ?? [])].sort() });
    }
    return answer;
  }
}

class CommandError extends Error {}

function link(map: Map<number, Set<number>>, from: number, to: number): void {
  let set = map.get(from);
  if (!set) {
    set = new Set();
    map.set(from, set);
  }
  set.add(to);
}

/** Replay migration files in their order. `files` holds only migration-named files. */
export function replayTaxonomy(files: readonly { name: string; text: string }[]): OpenDevDataTaxonomy {
  const taxonomy = new OpenDevDataTaxonomy();
  const ordered = [...files].sort((a, b) => {
    const ka = a.name.slice(0, 19);
    const kb = b.name.slice(0, 19);
    return ka < kb ? -1 : ka > kb ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  for (const file of ordered) taxonomy.applyFile(file.name, file.text);
  return taxonomy;
}
