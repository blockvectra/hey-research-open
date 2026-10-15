import { describe, expect, it } from 'vitest';

import { classifyCommit, classifyFile, COMMIT_SUBSTANCE_VERSION, type CommitFileInput } from './commit-substance';
import { dependencyManifestKind, isDependencyBumpPatch, isPep440Spec, isVersionRange } from './dependency-bump';

/**
 * commit-substance-v4 (2026-10-15, founder ruling "buat commit-substance-v4
 * tu"): a manifest whose patch only moves versions is maintenance, like its
 * lockfile. Prompted by an outside reader on X: "How strict are you on
 * 'meaningful' when commits are mostly dependency bumps?" — under v3 a human
 * bumping versions in package.json made a building week.
 */
const file = (filename: string, patch?: string): CommitFileInput => ({
  filename,
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  ...(patch === undefined ? {} : { patch }),
});
const hunk = (...lines: string[]) => ['@@ -1,8 +1,8 @@', ...lines].join('\n');
const commitOf = (...files: CommitFileInput[]) => classifyCommit({ files, filesTruncated: false });

const LOW = { substance: 'LOW_INFORMATION', reasons: ['dependency_bump'], classifierVersion: COMMIT_SUBSTANCE_VERSION };

describe('commit-substance-v4: version', () => {
  it('is v4', () => {
    expect(COMMIT_SUBSTANCE_VERSION).toBe('commit-substance-v4');
  });
});

describe('dependencyManifestKind', () => {
  it('names the manifests it reads, and nothing else', () => {
    expect(dependencyManifestKind('package.json')).toBe('npm');
    expect(dependencyManifestKind('apps/web/package.json')).toBe('npm');
    expect(dependencyManifestKind('composer.json')).toBe('composer');
    expect(dependencyManifestKind('crates/core/Cargo.toml')).toBe('cargo');
    expect(dependencyManifestKind('go.mod')).toBe('gomod');
    expect(dependencyManifestKind('requirements-dev.txt')).toBe('requirements');
    expect(dependencyManifestKind('constraints.txt')).toBe('requirements');
    expect(dependencyManifestKind('pyproject.toml')).toBe('pyproject');
    expect(dependencyManifestKind('Gemfile')).toBe('gemfile');
    expect(dependencyManifestKind('tsconfig.json')).toBeNull();
    expect(dependencyManifestKind('foundry.toml')).toBeNull();
  });
});

describe('version values', () => {
  it('reads npm, Composer and Cargo ranges as versions', () => {
    for (const spec of ['^18.2.0', '~1.2', '>=1.2.3 <2.0.0', '>= 1.2', '1.x', '*', 'x', '1.2.3 - 2.3.4', '^1.0 || ^2.0', '^6.0|^7.0', 'latest', 'workspace:*', 'workspace:^1.2.0', 'npm:string-width@^4.2.0', 'catalog:', '1.0.0-rc.1', '~1.2@dev', '>=1, <2', '=1.2.3']) {
      expect(isVersionRange(spec), spec).toBe(true);
    }
  });

  it('never reads a git, URL, file or path spec as a version', () => {
    for (const spec of ['github:acme/lib', 'acme/lib#v1.2.0', 'git+https://github.com/acme/lib.git#v1.2', 'https://example.com/lib-1.2.0.tgz', 'file:../lib', 'link:../lib', 'portal:../lib', '', 'dev-main', 'module']) {
      expect(isVersionRange(spec), spec).toBe(false);
    }
  });

  it('reads PEP 440 specifiers', () => {
    expect(isPep440Spec('>=1.2,<2', { bareAllowed: false })).toBe(true);
    expect(isPep440Spec('~=3.1.0rc1', { bareAllowed: false })).toBe(true);
    expect(isPep440Spec('==1.2.*', { bareAllowed: false })).toBe(true);
    expect(isPep440Spec('1.2', { bareAllowed: false })).toBe(false);
    expect(isPep440Spec('1.2', { bareAllowed: true })).toBe(true);
  });
});

describe('package.json and composer.json', () => {
  const deps = hunk('   "dependencies": {', '-    "react": "^18.2.0",', '+    "react": "^18.3.1",', '-    "@types/node": "20.11.5"', '+    "@types/node": "20.12.7"', '   },');

  it('dependencies only → LOW_INFORMATION, dependency_bump', () => {
    expect(isDependencyBumpPatch(deps, 'package.json')).toBe(true);
    expect(classifyFile(file('package.json', deps))).toBe('dependency');
    expect(commitOf(file('package.json', deps))).toMatchObject(LOW);
  });

  it('the package’s own version and the package manager → LOW_INFORMATION', () => {
    expect(commitOf(file('package.json', hunk('-  "version": "1.4.0",', '+  "version": "1.4.1",')))).toMatchObject(LOW);
    expect(commitOf(file('package.json', hunk('-  "packageManager": "pnpm@9.1.0",', '+  "packageManager": "pnpm@9.12.3+sha512.cce0f9de9c5a7c95bef944e7bc87dcd1",')))).toMatchObject(LOW);
  });

  it('a trailing comma and structural lines are not changes', () => {
    const patch = hunk('-    "react": "^18.2.0"', '+    "react": "^18.3.1",', '-  }', '+  },', '-    "zod": "3.22.0"', '+    "zod": "3.23.8"', '-    "next": "14.2.0",', '+    "next": "14.2.0"');
    expect(isDependencyBumpPatch(patch, 'package.json')).toBe(true);
  });

  it('a script or a config key beside the bump → SUBSTANTIVE', () => {
    const script = hunk('-    "react": "^18.2.0",', '+    "react": "^18.3.1",', '-    "build": "tsc",', '+    "build": "tsc -b",');
    expect(commitOf(file('package.json', script))).toMatchObject({ substance: 'SUBSTANTIVE', reasons: ['config_changed'] });
    const field = hunk('-  "version": "1.4.0",', '+  "version": "1.4.1",', '+  "type": "module",');
    expect(commitOf(file('package.json', field)).substance).toBe('SUBSTANTIVE');
  });

  it('a dependency added or removed is not a bump', () => {
    expect(isDependencyBumpPatch(hunk('+    "viem": "^2.21.0",'), 'package.json')).toBe(false);
    expect(isDependencyBumpPatch(hunk('-    "ethers": "^5.7.2",'), 'package.json')).toBe(false);
    // One package swapped for another is new code's dependency, not a version moved.
    expect(isDependencyBumpPatch(hunk('-    "ethers": "^5.7.2",', '+    "viem": "^2.21.0",'), 'package.json')).toBe(false);
  });

  it('a git, URL or file spec → SUBSTANTIVE', () => {
    expect(commitOf(file('package.json', hunk('-    "lib": "^1.2.0",', '+    "lib": "github:acme/lib#v1.3.0",'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('package.json', hunk('-    "lib": "git+https://github.com/acme/lib.git#v1",', '+    "lib": "git+https://github.com/acme/lib.git#v2",'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('package.json', hunk('-    "lib": "file:../lib-a",', '+    "lib": "file:../lib-b",'))).substance).toBe('SUBSTANTIVE');
  });

  it('the package’s name is not a version', () => {
    expect(commitOf(file('package.json', hunk('-  "name": "acme-app",', '+  "name": "acme-web",'))).substance).toBe('SUBSTANTIVE');
  });

  it('composer requirements and the PHP constraint', () => {
    const patch = hunk('-        "php": "^8.1",', '+        "php": "^8.2",', '-        "laravel/framework": "^10.0",', '+        "laravel/framework": "^10.0 || ^11.0",');
    expect(commitOf(file('composer.json', patch))).toMatchObject(LOW);
    expect(commitOf(file('composer.json', hunk('-        "laravel/framework": "^10.0",', '+        "laravel/framework": "dev-main",'))).substance).toBe('SUBSTANTIVE');
  });
});

describe('Cargo.toml', () => {
  it('plain and inline-table versions, and the crate’s own version → LOW_INFORMATION', () => {
    const patch = hunk(
      ' [package]',
      '-version = "0.3.1"',
      '+version = "0.3.2"',
      ' [dependencies]',
      '-anyhow = "1.0.86"',
      '+anyhow = "1.0.89"',
      '-serde = { version = "1.0.203", features = ["derive"] }',
      '+serde = { version = "1.0.210", features = ["derive"] }',
    );
    expect(commitOf(file('Cargo.toml', patch))).toMatchObject(LOW);
  });

  it('an inline table whose features change too → SUBSTANTIVE', () => {
    const patch = hunk('-tokio = { version = "1.38", features = ["rt"] }', '+tokio = { version = "1.40", features = ["rt", "macros"] }');
    expect(commitOf(file('Cargo.toml', patch)).substance).toBe('SUBSTANTIVE');
  });

  it('an edition or resolver is a setting, never a version', () => {
    expect(commitOf(file('Cargo.toml', hunk('-edition = "2018"', '+edition = "2021"'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('Cargo.toml', hunk('-resolver = "1"', '+resolver = "2"'))).substance).toBe('SUBSTANTIVE');
  });

  it('a git dependency’s revision → SUBSTANTIVE', () => {
    const patch = hunk('-alloy = { git = "https://github.com/alloy-rs/alloy", rev = "abc1234" }', '+alloy = { git = "https://github.com/alloy-rs/alloy", rev = "def5678" }');
    expect(commitOf(file('Cargo.toml', patch)).substance).toBe('SUBSTANTIVE');
  });
});

describe('go.mod and go.sum', () => {
  it('require lines, indirect ones, the go directive and the toolchain → LOW_INFORMATION', () => {
    const patch = hunk(
      '-go 1.21',
      '+go 1.22.1',
      '-toolchain go1.21.5',
      '+toolchain go1.22.1',
      ' require (',
      '-\tgithub.com/ethereum/go-ethereum v1.13.14',
      '+\tgithub.com/ethereum/go-ethereum v1.14.8',
      '-\tgolang.org/x/crypto v0.21.0 // indirect',
      '+\tgolang.org/x/crypto v0.27.0 // indirect',
      '-\tgithub.com/acme/x v0.0.0-20240101000000-abcdef123456 // indirect',
      '+\tgithub.com/acme/x v0.0.0-20240901000000-123456abcdef // indirect',
      ' )',
    );
    expect(commitOf(file('go.mod', patch))).toMatchObject(LOW);
    expect(commitOf(file('go.mod', hunk('-require github.com/a/b v1.2.0', '+require github.com/a/b v1.3.0')))).toMatchObject(LOW);
  });

  it('go.mod with go.sum → one dependency bump', () => {
    const result = commitOf(file('go.mod', hunk('-\tgithub.com/a/b v1.2.0', '+\tgithub.com/a/b v1.3.0')), file('go.sum', hunk('-github.com/a/b v1.2.0 h1:x=', '+github.com/a/b v1.3.0 h1:y=')));
    expect(result).toMatchObject(LOW);
    expect(result.classes.dependency).toBe(2);
    expect(result.classes.config).toBe(0);
  });

  it('a replace directive or a new requirement → SUBSTANTIVE', () => {
    expect(commitOf(file('go.mod', hunk('-replace github.com/a/b => ../b', '+replace github.com/a/b => github.com/c/b v1.0.0'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('go.mod', hunk('+\tgithub.com/new/dep v1.0.0'))).substance).toBe('SUBSTANTIVE');
  });
});

describe('requirements*.txt, constraints.txt and pyproject.toml', () => {
  it('pinned and ranged requirements, with extras, markers and hashes → LOW_INFORMATION', () => {
    const patch = hunk(
      '-requests==2.31.0',
      '+requests==2.32.3',
      '-uvicorn[standard]>=0.29,<0.30',
      '+uvicorn[standard]>=0.30,<0.31',
      '-tomli~=2.0.1 ; python_version < "3.11"',
      '+tomli~=2.0.2 ; python_version < "3.11"',
      '-web3 != 6.0.0, >= 6.15',
      '+web3 != 6.0.0, >= 6.20',
      '-pydantic==2.7.1 \\',
      '+pydantic==2.9.2 \\',
      '-    --hash=sha256:aa11',
      '+    --hash=sha256:bb22',
    );
    expect(commitOf(file('requirements.txt', patch))).toMatchObject(LOW);
    expect(commitOf(file('constraints.txt', hunk('-numpy<2', '+numpy<2.1')))).toMatchObject(LOW);
  });

  it('an editable install, an unpinned line or a comment → SUBSTANTIVE', () => {
    expect(commitOf(file('requirements.txt', hunk('-requests==2.31.0', '+requests==2.32.3', '+-e git+https://github.com/acme/lib.git#egg=lib'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('requirements.txt', hunk('-requests', '+httpx'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('requirements.txt', hunk('-requests==2.31.0', '+requests==2.32.3', '+# pinned for the API client'))).substance).toBe('SUBSTANTIVE');
  });

  it('pyproject dependency strings, Poetry tables and the project’s version → LOW_INFORMATION', () => {
    const patch = hunk(
      ' [project]',
      '-version = "0.4.0"',
      '+version = "0.4.1"',
      ' dependencies = [',
      '-    "httpx>=0.26",',
      '+    "httpx>=0.27",',
      '-    "web3[tester]>=6.15,<7",',
      '+    "web3[tester]>=6.20,<7",',
      ' ]',
      '-requires-python = ">=3.10"',
      '+requires-python = ">=3.11"',
      ' [tool.poetry.dependencies]',
      '-fastapi = "^0.110"',
      '+fastapi = "^0.115"',
      '-sqlalchemy = { version = "^2.0.29", extras = ["asyncio"] }',
      '+sqlalchemy = { version = "^2.0.35", extras = ["asyncio"] }',
    );
    expect(commitOf(file('pyproject.toml', patch))).toMatchObject(LOW);
  });

  it('a tool setting in pyproject → SUBSTANTIVE', () => {
    expect(commitOf(file('pyproject.toml', hunk('-    "httpx>=0.26",', '+    "httpx>=0.27",', '-line-length = 88', '+line-length = 100'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('pyproject.toml', hunk('-python_version = "3.10"', '+python_version = "3.11"'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('pyproject.toml', hunk('-ignore = ["E501"]', '+ignore = ["E501", "F401"]'))).substance).toBe('SUBSTANTIVE');
  });
});

describe('Gemfile', () => {
  it('gem versions and the Ruby version → LOW_INFORMATION', () => {
    const patch = hunk('-ruby "3.2.2"', '+ruby "3.3.5"', '-gem "rails", "~> 7.1.0"', '+gem "rails", "~> 7.2.1"', "-gem 'pg', '>= 0.18', '< 2.0'", "+gem 'pg', '>= 1.1', '< 2.0'", '-gem "puma", "~> 6.0", require: false', '+gem "puma", "~> 6.4", require: false');
    expect(commitOf(file('Gemfile', patch))).toMatchObject(LOW);
  });

  it('a gem added, an option changed or a git source → SUBSTANTIVE', () => {
    expect(commitOf(file('Gemfile', hunk('+gem "sidekiq", "~> 7.3"'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('Gemfile', hunk('-gem "puma", "~> 6.0", require: false', '+gem "puma", "~> 6.4"'))).substance).toBe('SUBSTANTIVE');
    expect(commitOf(file('Gemfile', hunk('-gem "x", "~> 1.0"', '+gem "x", git: "https://github.com/acme/x"'))).substance).toBe('SUBSTANTIVE');
  });
});

describe('what a bump needs to be proved', () => {
  it('no patch → configuration, SUBSTANTIVE as before', () => {
    expect(classifyFile(file('package.json'))).toBe('config');
    expect(commitOf(file('package.json'))).toMatchObject({ substance: 'SUBSTANTIVE', reasons: ['config_changed'] });
    expect(commitOf(file('Cargo.toml'), file('Cargo.lock', hunk('-version = "1"', '+version = "2"'))).substance).toBe('SUBSTANTIVE');
  });

  it('a patch with no changed version line proves nothing', () => {
    expect(isDependencyBumpPatch(hunk(' "react": "^18.2.0"'), 'package.json')).toBe(false);
    expect(isDependencyBumpPatch(hunk('-  },', '+  }'), 'package.json')).toBe(false);
  });

  it('a manifest bump beside source → SUBSTANTIVE', () => {
    const result = commitOf(file('package.json', hunk('-    "viem": "^2.17.0",', '+    "viem": "^2.21.0",')), file('src/client.ts', hunk('-const a = 1;', '+const a = 2;')));
    expect(result).toMatchObject({ substance: 'SUBSTANTIVE', reasons: ['source_changed'] });
    expect(result.classes).toMatchObject({ source: 1, dependency: 1, config: 0 });
  });

  it('a manifest bump with its lockfile → LOW_INFORMATION, dependency_bump', () => {
    const result = commitOf(file('package.json', hunk('-    "viem": "^2.17.0",', '+    "viem": "^2.21.0",')), file('pnpm-lock.yaml', hunk('-  viem: 2.17.0', '+  viem: 2.21.0')));
    expect(result).toMatchObject(LOW);
    expect(result.classes.dependency).toBe(2);
    // A lockfile alone keeps its own reason.
    expect(commitOf(file('pnpm-lock.yaml', hunk('-a', '+b')))).toMatchObject({ substance: 'LOW_INFORMATION', reasons: ['lockfile_only'] });
  });

  it('a version bump with a changelog is maintenance, naming both', () => {
    expect(commitOf(file('package.json', hunk('-  "version": "1.4.0",', '+  "version": "1.4.1",')), file('CHANGELOG.md', hunk('+## 1.4.1')))).toMatchObject({
      substance: 'LOW_INFORMATION',
      reasons: ['maintenance_only', 'docs', 'dependency'],
    });
  });

  it('a manifest in a test fixture is a test, never read for versions', () => {
    expect(classifyFile(file('test/fixtures/package.json', hunk('-    "react": "^18.2.0",', '+    "react": "^18.3.1",')))).toBe('test');
  });
});
