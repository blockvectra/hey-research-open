/**
 * Dependency bumps in a manifest (commit-substance-v4, founder ruling
 * 2026-10-15, "buat commit-substance-v4 tu").
 *
 * A lockfile was always maintenance; the manifest beside it was configuration,
 * and configuration counts as building. So a person who bumped a dependency's
 * version in `package.json` (and let the package manager rewrite the lockfile)
 * made a building week, while the same bump from a bot did not. This module
 * reads a manifest's patch and says whether every line it changed is a
 * dependency's version, the package's own version or the toolchain's — and
 * nothing else.
 *
 * Strict by construction, because only a proof may demote:
 *   - Context lines, blank lines and structural-only lines (`{`, `}`, `],`)
 *     are ignored; a line changed only by a trailing comma cancels itself.
 *   - Every remaining added or removed line must be a version line of its
 *     manifest, and the added and removed lines must pair up once the version
 *     values are blanked (`"react": "<v>"`): the same dependency, the same
 *     options, only the version moved. A dependency added or removed, a
 *     script, a new field, a comment, a git, URL, file or path spec — any of
 *     them leaves the file configuration.
 *   - No patch (GitHub omits it for large or binary files), no changed line,
 *     or a file that is not one of the manifests below: not a bump.
 *
 * Pure: no clock, no I/O.
 */

export type DependencyManifestKind = 'npm' | 'composer' | 'cargo' | 'gomod' | 'requirements' | 'pyproject' | 'gemfile';

/** The manifests whose version lines HEY reads (commit-substance-v4). */
export function dependencyManifestKind(path: string): DependencyManifestKind | null {
  const basename = (path.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
  if (basename === 'package.json') return 'npm';
  if (basename === 'composer.json') return 'composer';
  if (basename === 'cargo.toml') return 'cargo';
  if (basename === 'go.mod') return 'gomod';
  if (basename === 'pyproject.toml') return 'pyproject';
  if (basename === 'gemfile') return 'gemfile';
  if (/^requirements.*\.txt$/.test(basename) || basename === 'constraints.txt') return 'requirements';
  return null;
}

// ---------------------------------------------------------------------------
// Version values
// ---------------------------------------------------------------------------

/** A semver-style version, partial or wildcarded: `1`, `1.2`, `1.2.x`, `v1.2.3-rc.1+build`, `*`. */
const VERSION_CORE = String.raw`v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
/** One comparator of an npm, Composer or Cargo range; Composer may add a stability flag (`@dev`). */
const RANGE_COMPARATOR = new RegExp(String.raw`^(?:[<>]=?|==?|!=|~>|~|\^)?${VERSION_CORE}(?:@(?:dev|alpha|beta|rc|RC|stable))?$`);
/** A PEP 440 version: `1.2`, `1.2.*`, `1!2.0`, `1.0rc1`, `1.0.post2.dev3+local`. */
const PEP440 = /^v?\d+(?:!\d+)?(?:\.\d+)*(?:\.\*)?(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?(?:[-_.]?(?:post|rev|r)[-_.]?\d*)?(?:[-_.]?dev[-_.]?\d*)?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;
const PEP440_COMPARATOR = /^(===|==|~=|>=|<=|!=|<|>|\^|~)?\s*(.+)$/;

/** Comparators with the space after an operator closed up: `>= 1.2` → `>=1.2`. */
const closeOperators = (value: string): string => value.replace(/(^|[\s,|])([<>=!~^]+)\s+/g, '$1$2');

/**
 * An npm, Composer or Cargo version requirement: one or more comparator sets
 * joined by `||` (or Composer's `|`), comparators apart by spaces or commas,
 * hyphen ranges; `latest`, `next`, `workspace:…`, `catalog:…` and an `npm:`
 * alias to a version. Never a git, URL, `file:`, `link:` or path spec.
 */
export function isVersionRange(value: string): boolean {
  const spec = value.trim();
  if (spec === '') return false;
  if (spec === 'latest' || spec === 'next') return true;
  if (spec.startsWith('workspace:')) {
    const rest = spec.slice('workspace:'.length);
    return rest === '*' || rest === '^' || rest === '~' || isVersionRange(rest);
  }
  if (/^catalog:[\w.-]*$/.test(spec)) return true;
  const alias = /^npm:(?:@[\w.-]+\/)?[\w.-]+@(.+)$/.exec(spec);
  if (alias) return isVersionRange(alias[1]!);
  return closeOperators(spec)
    .split(/\|\|?/)
    .every((set) => {
      const tokens = set.trim().split(/\s*,\s*|\s+/).filter((token) => token.length > 0);
      if (tokens.length === 0) return false;
      return tokens.every((token, index) => (token === '-' ? index > 0 && index < tokens.length - 1 : RANGE_COMPARATOR.test(token)));
    });
}

/** A PEP 440 specifier list (`>=1.2,<2`, `~=3.1`), or, where a bare version is allowed (Poetry, TOML values), a bare version. */
export function isPep440Spec(value: string, options: { bareAllowed: boolean }): boolean {
  const spec = value.trim();
  if (spec === '') return false;
  return spec.split(',').every((part) => {
    const match = PEP440_COMPARATOR.exec(part.trim());
    if (!match) return false;
    if (!match[1] && !options.bareAllowed) return false;
    return PEP440.test(match[2]!.trim());
  });
}

/** The package's own version, as a manifest's `version` field carries it. */
const OWN_VERSION = /^v?\d+(?:\.\d+){0,3}(?:[-+.]?[0-9A-Za-z][0-9A-Za-z.+-]*)?$/;
const versionValue = (value: string): boolean => isVersionRange(value) || isPep440Spec(value, { bareAllowed: true }) || OWN_VERSION.test(value.trim());

// ---------------------------------------------------------------------------
// Version lines, per manifest: the line's skeleton, or null when it is not one
// ---------------------------------------------------------------------------

const V = '<v>';

/** JSON keys a dependency or engine may carry: `react`, `@scope/pkg`, `vendor/package`, `ext-json`, `php`. */
const JSON_PACKAGE_KEY = /^@?[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)?$/;
const PACKAGE_MANAGER = /^(?:npm|pnpm|yarn|bun)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.]+)?$/;

/** package.json and composer.json: `"name": "<range>"`, `"version": "x.y.z"`, `"packageManager": "pnpm@x.y.z"`. */
function jsonVersionLine(line: string): string | null {
  const match = /^"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"$/.exec(line);
  if (!match) return null;
  const [, key, value] = match as unknown as [string, string, string];
  if (key === 'version') return OWN_VERSION.test(value) ? `"version": ${V}` : null;
  if (key === 'packageManager') return PACKAGE_MANAGER.test(value) ? `"packageManager": ${V}` : null;
  if (!JSON_PACKAGE_KEY.test(key)) return null;
  return isVersionRange(value) ? `"${key}": ${V}` : null;
}

/**
 * TOML keys whose quoted values look like versions but are settings, never a
 * dependency's version: a Rust edition, a resolver, a profile level, a type
 * checker's target Python.
 */
const TOML_SETTING_KEYS = new Set(['edition', 'resolver', 'opt-level', 'debug', 'codegen-units', 'incremental', 'split-debuginfo', 'lto', 'panic', 'strip', 'python_version', 'pythonversion', 'target-version']);
const TOML_KEY = String.raw`(?:[A-Za-z0-9_][\w.-]*|"[^"]+")`;

/**
 * Cargo.toml and pyproject.toml: `name = "<req>"`, `version = "x.y.z"`,
 * `name = { version = "<req>", features = […] }` where only the version
 * string may differ (everything else stays in the skeleton), and, for
 * pyproject, a PEP 508 dependency string in an array: `"httpx>=0.27",`.
 */
function tomlVersionLine(line: string, kind: 'cargo' | 'pyproject'): string | null {
  const plain = new RegExp(String.raw`^(${TOML_KEY})\s*=\s*"([^"]*)"$`).exec(line);
  if (plain) {
    const key = plain[1]!.replace(/^"|"$/g, '');
    if (TOML_SETTING_KEYS.has(key.toLowerCase())) return null;
    return versionValue(plain[2]!) ? `${plain[1]} = ${V}` : null;
  }
  const inline = new RegExp(String.raw`^(${TOML_KEY})\s*=\s*\{(.*)\}$`).exec(line);
  if (inline) {
    if (TOML_SETTING_KEYS.has(inline[1]!.replace(/^"|"$/g, '').toLowerCase())) return null;
    const body = inline[2]!;
    const versions = [...body.matchAll(/(^|,)\s*version\s*=\s*"([^"]*)"/g)];
    if (versions.length !== 1 || !versionValue(versions[0]![2]!)) return null;
    return `${inline[1]} = {${body.replace(/(^|,)(\s*version\s*=\s*)"[^"]*"/, `$1$2${V}`)}}`;
  }
  if (kind === 'pyproject') {
    const quoted = /^(["'])(.*)\1$/.exec(line);
    if (quoted) {
      const requirement = requirementVersionLine(quoted[2]!);
      return requirement === null ? null : `"${requirement}"`;
    }
  }
  return null;
}

/** go.mod: `require module v1.2.3`, `module v1.2.3 // indirect` in a block, `go 1.22`, `toolchain go1.22.1`. */
const GO_DIRECTIVES = new Set(['module', 'go', 'toolchain', 'require', 'replace', 'exclude', 'retract', 'godebug', 'tool']);
function goModVersionLine(line: string): string | null {
  if (/^go\s+\d+\.\d+(?:\.\d+)?(?:(?:rc|beta)\d+)?$/.test(line)) return `go ${V}`;
  if (/^toolchain\s+go\d+\.\d+(?:\.\d+)?(?:(?:rc|beta)\d+)?$/.test(line)) return `toolchain ${V}`;
  const require = /^(?:require\s+)?([^\s()]+)\s+(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+incompatible)?)(\s*\/\/\s*indirect)?$/.exec(line);
  if (!require || GO_DIRECTIVES.has(require[1]!)) return null;
  return `${require[1]} ${V}${require[3] ? ' // indirect' : ''}`;
}

/**
 * A requirements line or PEP 508 string with a version specifier:
 * `pkg[extras]==1.2.3`, `pkg>=1.2,<2`, `pkg~=1.4 ; python_version < "3.11"`.
 * The name, extras, marker and any trailing comment stay in the skeleton; a
 * line with no specifier, an `@ url` or an option (`-e`, `-r`) is not one.
 */
function requirementVersionLine(line: string): string | null {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(\[[^\]]*\])?\s*([^;#]*?)\s*(;[^#]*?)?\s*(#.*)?$/.exec(line.replace(/\s*\\$/, ''));
  if (!match) return null;
  const specifier = match[3]!;
  if (specifier === '' || !/^(===|==|~=|>=|<=|!=|<|>)/.test(specifier) || !isPep440Spec(specifier, { bareAllowed: false })) return null;
  return `${match[1]}${match[2] ?? ''}${V}${match[4] ? ` ${match[4].trim()}` : ''}${match[5] ? ` ${match[5].trim()}` : ''}`;
}

/** A pip-compile hash pin under a requirement: it moves with the version it pins. */
const REQUIREMENT_HASH = /^--hash=[a-z0-9]+:[0-9a-f]+(\s*\\)?$/i;

/** Gemfile: `gem "name", "~> 1.2"[, ">= 1.2.1"][, options]`, `ruby "3.2.2"`. */
const RUBY_REQUIREMENT = /^(?:~>|>=|<=|!=|=|>|<)?\s*\d+(?:\.[0-9A-Za-z]+)*$/;
function gemfileVersionLine(line: string): string | null {
  const ruby = /^ruby\s+(['"])([^'"]*)\1$/.exec(line);
  if (ruby) return RUBY_REQUIREMENT.test(ruby[2]!.trim()) ? `ruby ${V}` : null;
  const gem = /^gem\s+(['"])([^'"]+)\1(.*)$/.exec(line);
  if (!gem) return null;
  let rest = gem[3]!;
  let versions = 0;
  for (;;) {
    const next = /^\s*,\s*(['"])([^'"]*)\1/.exec(rest);
    if (!next || !RUBY_REQUIREMENT.test(next[2]!.trim())) break;
    versions += 1;
    rest = rest.slice(next[0].length);
  }
  return versions === 0 ? null : `gem ${gem[2]}${`, ${V}`.repeat(versions)}${rest}`;
}

function versionLineSkeleton(kind: DependencyManifestKind, line: string): string | null {
  switch (kind) {
    case 'npm':
    case 'composer':
      return jsonVersionLine(line);
    case 'cargo':
    case 'pyproject':
      return tomlVersionLine(line, kind);
    case 'gomod':
      return goModVersionLine(line);
    case 'requirements':
      return requirementVersionLine(line);
    case 'gemfile':
      return gemfileVersionLine(line);
  }
}

// ---------------------------------------------------------------------------
// The patch
// ---------------------------------------------------------------------------

/** A line that only opens or closes a structure. */
const STRUCTURAL = /^[[\]{}()]+$/;

/**
 * Whether a manifest's patch changes only dependency versions, the package's
 * own version or the toolchain's (commit-substance-v4). False for anything
 * that is not one of the manifests `dependencyManifestKind` names, and for a
 * patch with no version line at all.
 */
export function isDependencyBumpPatch(patch: string, path: string): boolean {
  const kind = dependencyManifestKind(path);
  if (!kind) return false;
  const added: string[] = [];
  const removed: string[] = [];
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    const sign = raw[0];
    if (sign !== '+' && sign !== '-') continue;
    // Trimmed, and a trailing comma dropped: a comma added after a line is not a change to it.
    const line = raw.slice(1).trim().replace(/\s*,$/, '').trim();
    if (line === '' || STRUCTURAL.test(line)) continue;
    if (kind === 'requirements' && REQUIREMENT_HASH.test(line)) continue;
    (sign === '+' ? added : removed).push(line);
  }

  // Lines identical on both sides (a trailing comma, a line moved) cancel.
  const same = new Map<string, number>();
  for (const line of removed) same.set(line, (same.get(line) ?? 0) + 1);
  const addedLeft: string[] = [];
  for (const line of added) {
    const count = same.get(line) ?? 0;
    if (count > 0) same.set(line, count - 1);
    else addedLeft.push(line);
  }
  const removedLeft: string[] = [];
  for (const [line, count] of same) for (let index = 0; index < count; index += 1) removedLeft.push(line);
  if (addedLeft.length === 0 && removedLeft.length === 0) return false;

  // Every line left is a version line, and the two sides pair up once the versions are blanked.
  const skeletons = new Map<string, number>();
  for (const line of addedLeft) {
    const skeleton = versionLineSkeleton(kind, line);
    if (skeleton === null) return false;
    skeletons.set(skeleton, (skeletons.get(skeleton) ?? 0) + 1);
  }
  for (const line of removedLeft) {
    const skeleton = versionLineSkeleton(kind, line);
    if (skeleton === null) return false;
    const count = skeletons.get(skeleton) ?? 0;
    if (count === 0) return false;
    skeletons.set(skeleton, count - 1);
  }
  return [...skeletons.values()].every((count) => count === 0);
}
