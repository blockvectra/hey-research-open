/**
 * Commit substance (founder ruling G1, 2026-09-27).
 *
 * "Activity exists" and "development exists" are two different facts. A commit
 * that only changes documentation or the README, a dependency lockfile,
 * generated output, assets or whitespace is real activity and HEY keeps it on
 * the record — it is simply not evidence of building. This module is the one
 * deterministic, versioned reading of what a commit changed, from the file
 * list and patches GitHub returns for it. It never calls a model, never reads
 * repository code as code, and never guesses: a file it cannot place is
 * UNKNOWN, a whitespace claim needs the patch that proves it, and a commit it
 * could not see in full is UNKNOWN unless what it did see already changed code.
 *
 * The words matter. A low-information commit is "documentation or maintenance
 * only", never fake, padding or gaming: HEY says what changed, not why.
 *
 * Pure: no clock, no I/O. `COMMIT_SUBSTANCE_VERSION` is stored with every
 * classification, so a rule change is a new version and old rows say which
 * rules read them.
 */

/**
 * commit-substance-v1 (2026-09-27): the path classes, whitespace and rename
 * rules below; SUBSTANTIVE when any source, test, config or CI file changed
 * beyond whitespace; LOW_INFORMATION when every file is README, docs,
 * dependency lockfile, generated, asset, whitespace-only or a pure rename.
 */
export const COMMIT_SUBSTANCE_VERSION = 'commit-substance-v3' as const;

/*
 * commit-substance-v2 (2026-09-27, founder ruling: "data tak kira"): a data
 * file — JSON, JSON Lines, CSV, TSV, Parquet and the like outside the
 * repository root and configuration directories — is its own class, `data`,
 * and a commit that changes only data (with or without documentation or
 * maintenance files) is LOW_INFORMATION. v1 left such files `unknown`, and an
 * UNKNOWN week counts, so a file rewritten by a script dozens of times a week
 * (one production repository: 58 one-line commits to one JSON file) read as
 * building. YAML and XML outside configuration directories stay `unknown`:
 * they are as often deployment configuration as data.
 */

/*
 * commit-substance-v3 (2026-10-02, outsider audit; founder delegation
 * 2026-10-02, hbm-v22). Three rules, each from a real repository that led the
 * ships feed:
 *
 *  1. A commit that changes only CI configuration (`.github/workflows/…`) is
 *     maintenance, `ci_only`. A repository running a trading script from
 *     GitHub Actions edited its workflow files dozens of times a week; one
 *     such commit, read first, made a 149-commit week "building".
 *  2. A burst week — `BURST.minCommits` or more human commits — needs
 *     substance on a sample, not on its first commit: SUBSTANTIVE once
 *     `BURST.minSubstantive` of up to `BURST.sample` commits read changed
 *     code; read as "mostly maintenance or automation" (LOW_INFORMATION,
 *     `sampled`) when the sample is read and too few could have; UNKNOWN
 *     (counts as before) until then. A sample may decide a week whose listing
 *     was cut short; nothing else may.
 *  3. A week whose commits HEY holds are all automation — bot accounts or an
 *     automated stream (`commit-automation.ts`) — and at least as many as its
 *     summary counted is `automated_only`, LOW_INFORMATION.
 *
 * The absence of HEY's reading still never demotes a project: an unread
 * sample, or a week HEY holds too few commits for, is UNKNOWN.
 */

export const FILE_CLASSES = [
  'source',
  'test',
  'docs',
  'readme',
  'dependency',
  'config',
  'ci',
  'generated',
  'asset',
  'whitespace',
  'rename',
  'data',
  'unknown',
] as const;
export type FileClass = (typeof FILE_CLASSES)[number];
export type FileClassCounts = Record<FileClass, number>;

export const COMMIT_SUBSTANCES = ['SUBSTANTIVE', 'LOW_INFORMATION', 'UNKNOWN'] as const;
export type CommitSubstance = (typeof COMMIT_SUBSTANCES)[number];

/** Classes whose change is evidence of development. */
const SUBSTANTIVE_CLASSES: ReadonlySet<FileClass> = new Set(['source', 'test', 'config']);
/** Classes whose change alone is documentation or maintenance (G1). */
const LOW_INFORMATION_CLASSES: ReadonlySet<FileClass> = new Set([
  'readme',
  'docs',
  'dependency',
  'generated',
  'asset',
  'whitespace',
  'rename',
  'data',
  // CI configuration alone is maintenance (commit-substance-v3).
  'ci',
]);

export const emptyFileClassCounts = (): FileClassCounts =>
  Object.fromEntries(FILE_CLASSES.map((kind) => [kind, 0])) as FileClassCounts;

// ---------------------------------------------------------------------------
// Path classes
// ---------------------------------------------------------------------------

/** Directory names whose contents are build output or vendored code, not authored in the commit. */
const GENERATED_DIRS = new Set([
  'dist',
  'vendor',
  'node_modules',
  'coverage',
  'typechain',
  'typechain-types',
  '__generated__',
  'generated',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
]);
/**
 * Build-output names that are also ordinary folder names: output only when no
 * source-tree folder sits above them (`build/index.js` and
 * `packages/sdk/out/…` are output; `src/build/plan.ts` is code).
 */
const OUTPUT_DIRS = new Set(['build', 'out', 'artifacts', 'cache']);
const SOURCE_TREE_DIRS = new Set(['src', 'lib', 'app', 'contracts', 'source', 'sources', 'pkg', 'cmd', 'internal', 'scripts']);
const isOutputPath = (dirs: readonly string[]): boolean => {
  for (const dir of dirs) {
    if (SOURCE_TREE_DIRS.has(dir)) return false;
    if (OUTPUT_DIRS.has(dir)) return true;
  }
  return false;
};
const GENERATED_FILE = [
  /\.min\.(js|css|mjs)$/,
  /\.(js|css|mjs)\.map$/,
  /\.map$/,
  /\.pb\.go$/,
  /_pb2(_grpc)?\.py$/,
  /\.pb\.(ts|js|cc|h)$/,
  /\.generated\.[a-z0-9]+$/,
  /\.g\.dart$/,
  /\.freezed\.dart$/,
];

/** Lockfiles: resolved dependency versions, rewritten by a package manager. Manifests are config. */
const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'go.sum',
  'poetry.lock',
  'pipfile.lock',
  'gemfile.lock',
  'composer.lock',
  'flake.lock',
  'uv.lock',
  'pdm.lock',
  'mix.lock',
  'pubspec.lock',
  'podfile.lock',
  'packages.lock.json',
  'gradle.lockfile',
  'deno.lock',
  'package.resolved',
]);

const CI_PREFIXES = ['.github/workflows/', '.github/actions/', '.circleci/', '.buildkite/', '.woodpecker/', '.gitlab/ci/'];
const CI_FILES = new Set([
  '.gitlab-ci.yml',
  '.travis.yml',
  'azure-pipelines.yml',
  'jenkinsfile',
  '.drone.yml',
  'bitbucket-pipelines.yml',
  'appveyor.yml',
  'cloudbuild.yaml',
  'cloudbuild.yml',
]);

const README_STEM = /^readme([-_][a-z0-9-]+)?$/;
const DOC_DIRS = new Set(['docs', 'doc', 'documentation']);
const DOC_EXTENSIONS = new Set(['md', 'mdx', 'markdown', 'rst', 'adoc', 'asciidoc', 'txt', 'textile', 'pdf']);
const DOC_STEM = /^(license|licence|copying|changelog|changes|history|contributing|code_of_conduct|security|authors|contributors|notice|maintainers|support|governance|citation)([-_][a-z0-9-]+)?$/;

const TEST_DIRS = new Set(['test', 'tests', '__tests__', '__test__', '__mocks__', 'spec', 'specs', 'e2e', 'testdata', 'cypress']);
const TEST_FILE = [
  /\.(test|spec)\.[a-z0-9]+$/,
  /_test\.(go|py|rb|exs|dart)$/,
  /^test_[^/]+\.py$/,
  /\.t\.sol$/,
  /_spec\.rb$/,
];
/** JVM, Swift and .NET convention, read on the original case: `FooTest.java`, never `Latest.java`. */
const TEST_FILE_CASED = /[a-z0-9]Tests?\.(java|kt|swift|cs|scala)$/;

const ASSET_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tif', 'tiff', 'svg', 'psd', 'eps', 'heic',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  'mp4', 'mov', 'webm', 'avi', 'mkv',
  'glb', 'gltf', 'riv', 'lottie',
]);

/** Always configuration, wherever they sit. */
const CONFIG_EXTENSIONS = new Set(['toml', 'ini', 'cfg', 'conf', 'properties', 'env', 'tf', 'tfvars', 'hcl', 'gradle', 'cmake', 'bzl', 'nix']);
/** Structured data: configuration at the root or in a configuration directory, otherwise data HEY cannot place. */
const DATA_EXTENSIONS = new Set(['json', 'jsonc', 'json5', 'yaml', 'yml', 'xml']);
/** Data files (commit-substance-v2): outside configuration they are `data`, never code. */
const DATA_FILE_EXTENSIONS = new Set(['json', 'jsonl', 'ndjson', 'geojson', 'csv', 'tsv', 'parquet', 'avro', 'arrow']);
/** Of those, the ones a repository root or config directory holds as configuration (tsconfig.json is caught earlier by name). */
const CONFIG_LIKE_DATA = new Set(['json']);
const CONFIG_DIRS = new Set(['config', 'configs', '.config', 'conf', 'settings', 'deploy', 'deployment', 'deployments', 'k8s', 'helm', 'charts', '.github', '.devcontainer', '.vscode', '.husky', '.changeset']);
const CONFIG_BASENAMES = /^(dockerfile.*|containerfile|makefile|gnumakefile|justfile|rakefile|procfile|gemfile|pipfile|brewfile|vagrantfile|cmakelists\.txt|requirements.*\.txt|constraints\.txt|remappings\.txt|package\.json|tsconfig.*\.json|jsconfig.*\.json|deno\.jsonc?|composer\.json|cargo\.toml|go\.mod|go\.work|pyproject\.toml|setup\.py|setup\.cfg|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|foundry\.toml|hardhat\.config\.[a-z]+|truffle-config\.js|vercel\.json|manifest\.json|app\.json|firebase\.json|renovate\.json|turbo\.json|nx\.json|lerna\.json|angular\.json|project\.json|components\.json|biome\.jsonc?|netlify\.toml|wrangler\.toml|docker-compose.*\.ya?ml|compose\.ya?ml|anchor\.toml|move\.toml|scarb\.toml|codeowners)$/;
const CONFIG_FILE = [/\.config\.(js|cjs|mjs|ts|cts|mts|json)$/, /^\.[^/]+rc(\.[a-z]+)?$/];

const SOURCE_EXTENSIONS = new Set([
  // Contracts and chain languages.
  'sol', 'vy', 'move', 'cairo', 'circom', 'nr', 'huff', 'yul', 'fe', 'tact', 'fc', 'func', 'clar',
  // General purpose.
  'rs', 'go', 'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyi', 'java', 'kt', 'kts', 'swift',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'cs', 'fs', 'fsx', 'rb', 'php', 'vue', 'svelte', 'astro',
  'zig', 'ex', 'exs', 'erl', 'hrl', 'hs', 'scala', 'sc', 'clj', 'cljs', 'cljc', 'dart', 'lua', 'r', 'jl',
  'm', 'mm', 'ml', 'mli', 'nim', 'elm', 'purs', 're', 'res', 'groovy', 'pl', 'pm', 'v', 'sv', 'vhd', 'cr',
  'd', 'odin', 'gleam', 'wat', 'ipynb',
  // Scripts, queries, schemas, markup and styles authored as part of the product.
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'proto', 'thrift', 'prisma',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl', 'hbs', 'ejs', 'pug', 'liquid', 'twig', 'jinja', 'j2',
]);

const extensionOf = (basename: string): string => {
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot + 1);
};

/**
 * The class of one path, by path alone. Checked in a fixed order so a path
 * that fits two readings always lands the same way: build output and
 * lockfiles first (whatever their extension), then CI, the README, tests,
 * documentation, assets, configuration and code; anything else is UNKNOWN.
 */
/** A name whose extension, if any, is not code or configuration: `README`, `README.md`, `LICENSE-MIT`, never `history.ts`. */
const namedDocument = (stem: RegExp, basename: string): boolean => {
  const dot = basename.indexOf('.');
  const head = dot === -1 ? basename : basename.slice(0, dot);
  if (!stem.test(head)) return false;
  if (dot === -1) return true;
  const extension = extensionOf(basename);
  return !SOURCE_EXTENSIONS.has(extension) && !DATA_EXTENSIONS.has(extension) && !DATA_FILE_EXTENSIONS.has(extension) && !CONFIG_EXTENSIONS.has(extension);
};

export function classifyPath(path: string): FileClass {
  const original = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalized = original.toLowerCase();
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const basename = segments[segments.length - 1] ?? '';
  const originalBasename = original.split('/').pop() ?? '';
  const dirs = segments.slice(0, -1);
  const extension = extensionOf(basename);

  if (dirs.some((dir) => GENERATED_DIRS.has(dir)) || isOutputPath(dirs) || GENERATED_FILE.some((pattern) => pattern.test(basename))) return 'generated';
  if (LOCKFILES.has(basename)) return 'dependency';
  if (CI_PREFIXES.some((prefix) => normalized.startsWith(prefix)) || (dirs.length === 0 && CI_FILES.has(basename))) return 'ci';
  if (namedDocument(README_STEM, basename)) return 'readme';
  if (dirs.some((dir) => TEST_DIRS.has(dir)) || TEST_FILE.some((pattern) => pattern.test(basename)) || TEST_FILE_CASED.test(originalBasename)) return 'test';
  if (namedDocument(DOC_STEM, basename)) return 'docs';
  if (CONFIG_BASENAMES.test(basename)) return 'config';
  if (dirs.some((dir) => DOC_DIRS.has(dir))) return ASSET_EXTENSIONS.has(extension) ? 'asset' : 'docs';
  if (DOC_EXTENSIONS.has(extension)) return 'docs';
  if (ASSET_EXTENSIONS.has(extension)) return 'asset';
  if (CONFIG_EXTENSIONS.has(extension) || CONFIG_FILE.some((pattern) => pattern.test(basename))) return 'config';
  if (DATA_EXTENSIONS.has(extension) || DATA_FILE_EXTENSIONS.has(extension)) {
    if (dirs.length === 0 || dirs.some((dir) => CONFIG_DIRS.has(dir))) return DATA_FILE_EXTENSIONS.has(extension) && !CONFIG_LIKE_DATA.has(extension) ? 'data' : 'config';
    return DATA_FILE_EXTENSIONS.has(extension) ? 'data' : 'unknown';
  }
  // A dotfile at any depth (.gitignore, .editorconfig, .env.example, .nvmrc).
  if (basename.startsWith('.') && basename.length > 1) return 'config';
  if (SOURCE_EXTENSIONS.has(extension)) return 'source';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Patch readings
// ---------------------------------------------------------------------------

/** Where leading whitespace is syntax, re-indenting is a change; only trailing whitespace and blank lines are layout. */
const INDENTATION_SENSITIVE = new Set(['py', 'pyi', 'yaml', 'yml', 'haml', 'pug', 'slim', 'sass', 'styl', 'coffee', 'nim', 'fs', 'fsx', 'elm', 'mk']);
const indentationSensitive = (path: string): boolean => {
  const basename = path.toLowerCase().split('/').pop() ?? '';
  return INDENTATION_SENSITIVE.has(extensionOf(basename)) || basename === 'makefile' || basename === 'gnumakefile';
};

type PatchLines = { added: string[]; removed: string[] };

function patchLines(patch: string): PatchLines {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

/**
 * Whether a patch changes only whitespace: the removed lines and the added
 * lines are the same multiset once whitespace runs are collapsed, ends
 * trimmed and blank lines dropped. Collapsed, never deleted: `int a` and
 * `inta` stay different. In an indentation-sensitive file the leading
 * whitespace is kept. A patch with no changed lines proves nothing.
 */
export function isWhitespaceOnlyPatch(patch: string, path: string): boolean {
  const { added, removed } = patchLines(patch);
  if (added.length === 0 && removed.length === 0) return false;
  const keepIndent = indentationSensitive(path);
  const normalize = (line: string): string => {
    const trimmedEnd = line.replace(/\s+$/, '');
    if (keepIndent) {
      const indent = /^\s*/.exec(trimmedEnd)?.[0] ?? '';
      return indent + trimmedEnd.slice(indent.length).replace(/\s+/g, ' ');
    }
    return trimmedEnd.trim().replace(/\s+/g, ' ');
  };
  const tally = new Map<string, number>();
  for (const line of added) {
    const key = normalize(line);
    if (key.trim() === '') continue;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  for (const line of removed) {
    const key = normalize(line);
    if (key.trim() === '') continue;
    const count = tally.get(key) ?? 0;
    if (count === 0) return false;
    tally.set(key, count - 1);
  }
  return [...tally.values()].every((count) => count === 0);
}

/** A submodule pointer moved: the patch is `Subproject commit` lines and nothing else. */
export function isSubmodulePointerPatch(patch: string): boolean {
  const { added, removed } = patchLines(patch);
  const changed = [...added, ...removed];
  return changed.length > 0 && changed.every((line) => /^Subproject commit [0-9a-f]{7,64}(-dirty)?\s*$/.test(line));
}

/**
 * A generated-file header, only when the patch shows the top of the file: a
 * hunk that starts at line 1 of the new file carrying `@generated`, `Code
 * generated … DO NOT EDIT` or `<auto-generated` within its first five lines.
 */
export function patchShowsGeneratedHeader(patch: string): boolean {
  const lines = patch.split('\n');
  const header = lines[0] ?? '';
  if (!/^@@ -\d+(,\d+)? \+1(,\d+)? @@/.test(header)) return false;
  let seen = 0;
  for (const line of lines.slice(1)) {
    if (line.startsWith('-')) continue;
    seen += 1;
    if (/@generated\b|code generated .*do not edit|<auto-generated/i.test(line)) return true;
    if (seen >= 5) break;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Commit substance
// ---------------------------------------------------------------------------

/** One changed file as GitHub reports it on the commit. */
export type CommitFileInput = {
  filename: string;
  /** added, removed, modified, renamed, copied, changed, unchanged. */
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  /** Absent for binary files and for patches GitHub will not inline. */
  patch?: string | undefined;
};

export type CommitDetailInput = {
  files: readonly CommitFileInput[];
  /** GitHub listed only part of the files (its per-page file cap). */
  filesTruncated: boolean;
  /** GitHub's own totals for the whole commit. */
  stats?: { additions: number; deletions: number; total: number } | undefined;
};

export type CommitSubstanceResult = {
  substance: CommitSubstance;
  /** Plain reasons naming the classes, e.g. `readme_only`, `lockfile_only`, `source_changed`. */
  reasons: string[];
  classes: FileClassCounts;
  filesChanged: number;
  additions: number;
  deletions: number;
  classifierVersion: typeof COMMIT_SUBSTANCE_VERSION;
};

/** The effective class of one changed file: its path class, unless the patch shows only layout. */
export function classifyFile(file: CommitFileInput): FileClass {
  const byPath = classifyPath(file.filename);
  if ((file.status === 'renamed' || file.status === 'copied') && file.changes === 0) return 'rename';
  if (file.patch !== undefined) {
    if (byPath !== 'generated' && isSubmodulePointerPatch(file.patch)) return 'dependency';
    if (file.status === 'added' && patchShowsGeneratedHeader(file.patch)) return 'generated';
    // Only a class that would otherwise count can be downgraded to layout.
    if ((SUBSTANTIVE_CLASSES.has(byPath) || byPath === 'unknown') && isWhitespaceOnlyPatch(file.patch, file.filename)) return 'whitespace';
  }
  return byPath;
}

const ONLY_REASON: Partial<Record<FileClass, string>> = {
  readme: 'readme_only',
  docs: 'documentation_only',
  dependency: 'lockfile_only',
  generated: 'generated_only',
  asset: 'assets_only',
  whitespace: 'whitespace_only',
  rename: 'rename_only',
  data: 'data_only',
  ci: 'ci_only',
};
const CHANGED_REASON: Partial<Record<FileClass, string>> = {
  source: 'source_changed',
  test: 'tests_changed',
  config: 'config_changed',
  ci: 'ci_changed',
};

export function classifyCommit(input: CommitDetailInput): CommitSubstanceResult {
  const classes = emptyFileClassCounts();
  let additions = 0;
  let deletions = 0;
  for (const file of input.files) {
    classes[classifyFile(file)] += 1;
    additions += file.additions;
    deletions += file.deletions;
  }
  const result = (substance: CommitSubstance, reasons: string[]): CommitSubstanceResult => ({
    substance,
    reasons,
    classes,
    filesChanged: input.files.length,
    additions: input.stats?.additions ?? additions,
    deletions: input.stats?.deletions ?? deletions,
    classifierVersion: COMMIT_SUBSTANCE_VERSION,
  });

  const substantive = FILE_CLASSES.filter((kind) => SUBSTANTIVE_CLASSES.has(kind) && classes[kind] > 0);
  // What HEY could see already changed code: the commit is substantive however much more it hid.
  if (substantive.length > 0) return result('SUBSTANTIVE', substantive.map((kind) => CHANGED_REASON[kind] ?? kind));
  if (input.filesTruncated) return result('UNKNOWN', ['files_truncated']);

  if (input.files.length === 0) {
    // An empty commit changes nothing; one whose files GitHub did not list cannot be read.
    return (input.stats?.total ?? 0) === 0 ? result('LOW_INFORMATION', ['empty_commit']) : result('UNKNOWN', ['files_not_listed']);
  }
  if (classes.unknown > 0) return result('UNKNOWN', ['unclassified_files']);

  const present = FILE_CLASSES.filter((kind) => classes[kind] > 0);
  if (present.every((kind) => LOW_INFORMATION_CLASSES.has(kind))) {
    if (present.length === 1) return result('LOW_INFORMATION', [ONLY_REASON[present[0]!] ?? 'maintenance_only']);
    // README with other documentation is still documentation only.
    if (present.every((kind) => kind === 'readme' || kind === 'docs')) return result('LOW_INFORMATION', ['documentation_only']);
    return result('LOW_INFORMATION', ['maintenance_only', ...present]);
  }
  return result('UNKNOWN', ['unclassified_files']);
}

// ---------------------------------------------------------------------------
// Week verdict
// ---------------------------------------------------------------------------

export type CodeWeekCommit = {
  isBot: boolean;
  isMerge: boolean;
  /** Null while HEY has not read the commit. */
  substance: CommitSubstance | null;
  classes?: Partial<FileClassCounts> | null | undefined;
};

export type CodeWeekInput = {
  commits: readonly CodeWeekCommit[];
  /**
   * Every commit of the week was on a page HEY read: the listing reached back
   * past the week's start, and HEY holds at least as many human commits for
   * the week as the summary counted.
   */
  fullyListed: boolean;
  /**
   * How many commits the week's summary counted as human when it was written
   * (v3). An `automated_only` week needs HEY to hold at least that many
   * automated commits for it; without the figure the rule never applies.
   */
  counted?: number | undefined;
};

/** A burst week is decided on a sample (commit-substance-v3). */
export const BURST = {
  /** Human, non-merge commits HEY holds for the week that make it a burst. */
  minCommits: 25,
  /** How many of its commits are read before the week is decided. */
  sample: 10,
  /** Commits of the sample that must change code for the week to be building. */
  minSubstantive: 3,
} as const;

export type CodeWeekSubstance = {
  verdict: CommitSubstance;
  /** Human, non-merge commits of the week HEY holds. */
  commitsRead: number;
  /** Of those, classified (substance known). */
  classified: number;
  substantive: number;
  lowInformation: number;
  unknown: number;
  /** Not yet read (pending, or not needed once the week was decided). */
  pending: number;
  classes: FileClassCounts;
  classifierVersion: typeof COMMIT_SUBSTANCE_VERSION;
  /** Bot or automated-stream commits HEY holds for the week (v3; never part of the counts above). */
  automated: number;
  /** The verdict rests on a sample of a burst week (v3). */
  sampled: boolean;
  /** Why a LOW_INFORMATION week is one, when it is not "every commit read" (v3). */
  basis: 'all_read' | 'burst_sample' | 'automated_only' | null;
};

/** How many substantive commits decide a week, and how many reads a week may take: what the detail sweep reads to. */
export function codeWeekReadPlan(humanCommits: number): { burst: boolean; needSubstantive: number; sample: number } {
  const burst = humanCommits >= BURST.minCommits;
  return burst
    ? { burst, needSubstantive: BURST.minSubstantive, sample: Math.min(BURST.sample, humanCommits) }
    : { burst, needSubstantive: 1, sample: humanCommits };
}

/**
 * One repository's ISO week, from its commits (G1, v3).
 *
 * An ordinary week is SUBSTANTIVE as soon as one human commit changed code,
 * and LOW_INFORMATION only when HEY can show it for the whole week: every
 * human, non-merge commit listed, read and documentation or maintenance only.
 * A burst week is decided on a sample (`BURST`). A week whose commits are all
 * automation, at least as many as its summary counted, is LOW_INFORMATION.
 * Anything short of that is UNKNOWN — HEY has not read the substance, and the
 * absence of HEY's reading must never demote a project, so UNKNOWN counts
 * exactly as before.
 */
export function codeWeekSubstance(input: CodeWeekInput): CodeWeekSubstance {
  const human = input.commits.filter((commit) => !commit.isBot && !commit.isMerge);
  const automated = input.commits.filter((commit) => commit.isBot && !commit.isMerge).length;
  const classes = emptyFileClassCounts();
  let substantive = 0;
  let lowInformation = 0;
  let unknown = 0;
  for (const commit of human) {
    if (commit.substance === 'SUBSTANTIVE') substantive += 1;
    else if (commit.substance === 'LOW_INFORMATION') lowInformation += 1;
    else if (commit.substance === 'UNKNOWN') unknown += 1;
    if (commit.substance !== null && commit.classes) {
      for (const kind of FILE_CLASSES) classes[kind] += commit.classes[kind] ?? 0;
    }
  }
  const classified = substantive + lowInformation + unknown;
  const pending = human.length - classified;
  const plan = codeWeekReadPlan(human.length);

  let verdict: CommitSubstance = 'UNKNOWN';
  let basis: CodeWeekSubstance['basis'] = null;
  if (human.length === 0) {
    if (automated > 0 && input.counted !== undefined && input.counted > 0 && automated >= input.counted) {
      verdict = 'LOW_INFORMATION';
      basis = 'automated_only';
    }
  } else if (plan.burst) {
    if (substantive >= plan.needSubstantive) verdict = 'SUBSTANTIVE';
    // The sample is read and even the commits HEY could not place would not make enough.
    else if (classified >= plan.sample && substantive + unknown < plan.needSubstantive) {
      verdict = 'LOW_INFORMATION';
      basis = 'burst_sample';
    }
  } else if (substantive > 0) verdict = 'SUBSTANTIVE';
  else if (input.fullyListed && pending === 0 && unknown === 0 && lowInformation === human.length) {
    verdict = 'LOW_INFORMATION';
    basis = 'all_read';
  }
  return {
    verdict,
    commitsRead: human.length,
    classified,
    substantive,
    lowInformation,
    unknown,
    pending,
    classes,
    classifierVersion: COMMIT_SUBSTANCE_VERSION,
    automated,
    sampled: plan.burst,
    basis,
  };
}

/**
 * Whether a code-activity summary is left out of building (G1): only a week
 * HEY read in full and found documentation or maintenance only. Null or
 * UNKNOWN — not read yet — counts as it always has.
 */
export const isLowInformationCodeWeek = (event: { eventType: string; codeSubstance?: string | null | undefined }): boolean =>
  event.eventType === 'CODE_ACTIVITY' && event.codeSubstance === 'LOW_INFORMATION';
