import { describe, expect, it } from 'vitest';

import {
  classifyCommit,
  classifyFile,
  classifyPath,
  codeWeekSubstance,
  COMMIT_SUBSTANCE_VERSION,
  isLowInformationCodeWeek,
  isSubmodulePointerPatch,
  isWhitespaceOnlyPatch,
  patchShowsGeneratedHeader,
  type CommitFileInput,
  type FileClass,
} from './commit-substance';

const file = (filename: string, patch?: string, extra: Partial<CommitFileInput> = {}): CommitFileInput => ({
  filename,
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  ...(patch === undefined ? {} : { patch }),
  ...extra,
});

describe('classifyPath (commit-substance-v1)', () => {
  const cases: [string, FileClass][] = [
    // README and documentation.
    ['README.md', 'readme'],
    ['README', 'readme'],
    ['readme.rst', 'readme'],
    ['packages/sdk/README.md', 'readme'],
    ['README.zh-CN.md', 'readme'],
    ['README-dev.md', 'readme'],
    ['docs/getting-started.md', 'docs'],
    ['docs/api/index.mdx', 'docs'],
    ['documentation/guide.txt', 'docs'],
    ['docs/diagram.png', 'asset'],
    ['CHANGELOG.md', 'docs'],
    ['LICENSE', 'docs'],
    ['LICENSE-MIT', 'docs'],
    ['CONTRIBUTING.md', 'docs'],
    ['CODE_OF_CONDUCT.md', 'docs'],
    ['SECURITY.md', 'docs'],
    ['notes.txt', 'docs'],
    ['whitepaper.pdf', 'docs'],
    ['.github/ISSUE_TEMPLATE/bug.md', 'docs'],
    // A source file that shares a documentation name is still code.
    ['src/history.ts', 'source'],
    ['src/readme.tsx', 'source'],
    ['src/security.py', 'source'],
    // Dependency lockfiles; manifests are configuration.
    ['package-lock.json', 'dependency'],
    ['yarn.lock', 'dependency'],
    ['pnpm-lock.yaml', 'dependency'],
    ['bun.lockb', 'dependency'],
    ['bun.lock', 'dependency'],
    ['Cargo.lock', 'dependency'],
    ['go.sum', 'dependency'],
    ['poetry.lock', 'dependency'],
    ['Pipfile.lock', 'dependency'],
    ['Gemfile.lock', 'dependency'],
    ['composer.lock', 'dependency'],
    ['flake.lock', 'dependency'],
    ['uv.lock', 'dependency'],
    ['apps/web/package-lock.json', 'dependency'],
    ['package.json', 'config'],
    ['packages/core/package.json', 'config'],
    ['Cargo.toml', 'config'],
    ['go.mod', 'config'],
    ['pyproject.toml', 'config'],
    ['requirements.txt', 'config'],
    ['requirements-dev.txt', 'config'],
    ['foundry.toml', 'config'],
    ['remappings.txt', 'config'],
    ['CMakeLists.txt', 'config'],
    // CI.
    ['.github/workflows/ci.yml', 'ci'],
    ['.github/actions/setup/action.yml', 'ci'],
    ['.gitlab-ci.yml', 'ci'],
    ['.circleci/config.yml', 'ci'],
    ['.travis.yml', 'ci'],
    // Configuration.
    ['.gitignore', 'config'],
    ['.eslintrc.json', 'config'],
    ['.prettierrc', 'config'],
    ['.env.example', 'config'],
    ['Dockerfile', 'config'],
    ['Dockerfile.prod', 'config'],
    ['docker-compose.yml', 'config'],
    ['Makefile', 'config'],
    ['tsconfig.json', 'config'],
    ['tsconfig.build.json', 'config'],
    ['vite.config.ts', 'config'],
    ['hardhat.config.ts', 'config'],
    ['next.config.mjs', 'config'],
    ['config/app.yaml', 'config'],
    ['deploy/k8s.yml', 'config'],
    ['.github/dependabot.yml', 'config'],
    ['settings.ini', 'config'],
    ['infra/main.tf', 'config'],
    // Structured data outside configuration: HEY cannot place it.
    ['src/data/tokens.json', 'unknown'],
    ['public/manifest.json', 'unknown'],
    // Generated output.
    ['dist/index.js', 'generated'],
    ['packages/sdk/dist/index.d.ts', 'generated'],
    ['build/app.js', 'generated'],
    ['out/Token.sol/Token.json', 'generated'],
    ['artifacts/contracts/Token.sol/Token.json', 'generated'],
    ['vendor/github.com/x/y/z.go', 'generated'],
    ['node_modules/left-pad/index.js', 'generated'],
    ['coverage/lcov.info', 'generated'],
    ['typechain-types/Token.ts', 'generated'],
    ['public/app.min.js', 'generated'],
    ['static/app.js.map', 'generated'],
    ['api/service.pb.go', 'generated'],
    ['proto/service_pb2.py', 'generated'],
    ['lib/models.g.dart', 'generated'],
    // A folder called build inside the source tree is code.
    ['src/build/plan.ts', 'source'],
    ['scripts/build/index.ts', 'source'],
    // Assets.
    ['public/logo.svg', 'asset'],
    ['assets/hero.png', 'asset'],
    ['fonts/Inter.woff2', 'asset'],
    ['media/intro.mp4', 'asset'],
    ['favicon.ico', 'asset'],
    // Tests.
    ['test/Token.t.sol', 'test'],
    ['tests/test_pool.py', 'test'],
    ['src/__tests__/pool.ts', 'test'],
    ['src/pool.test.ts', 'test'],
    ['src/pool.spec.tsx', 'test'],
    ['pkg/pool/pool_test.go', 'test'],
    ['test_pool.py', 'test'],
    ['spec/models/user_spec.rb', 'test'],
    ['src/test/java/com/x/PoolTest.java', 'test'],
    ['app/src/main/java/com/x/PoolTest.java', 'test'],
    ['app/src/main/java/com/x/Latest.java', 'source'],
    ['tests/fixtures/sample.json', 'test'],
    // Source.
    ['src/Token.sol', 'source'],
    ['contracts/Vault.sol', 'source'],
    ['sources/pool.move', 'source'],
    ['src/lib.cairo', 'source'],
    ['src/main.rs', 'source'],
    ['cmd/server/main.go', 'source'],
    ['src/index.ts', 'source'],
    ['app/page.tsx', 'source'],
    ['src/app.py', 'source'],
    ['src/App.vue', 'source'],
    ['src/routes/+page.svelte', 'source'],
    ['lib/main.dart', 'source'],
    ['src/main.zig', 'source'],
    ['styles/global.css', 'source'],
    ['index.html', 'source'],
    ['scripts/deploy.sh', 'source'],
    ['db/schema.sql', 'source'],
    ['circuits/withdraw.circom', 'source'],
    // Nothing HEY can place.
    ['data/blob.bin', 'unknown'],
    ['weird', 'unknown'],
  ];

  it.each(cases)('%s → %s', (path, expected) => {
    expect(classifyPath(path)).toBe(expected);
  });

  it('is pure and case-insensitive for paths', () => {
    expect(classifyPath('DOCS/Intro.MD')).toBe('docs');
    expect(classifyPath('Src/Index.TS')).toBe('source');
    expect(classifyPath('./README.md')).toBe('readme');
    expect(classifyPath('src\\main.rs')).toBe('source');
  });
});

describe('patch readings', () => {
  it('reads a re-indented, re-spaced patch as whitespace only', () => {
    const patch = '@@ -1,3 +1,3 @@\n-function a() {\n-return 1;\n+function a()  {\n+    return 1;\n }';
    expect(isWhitespaceOnlyPatch(patch, 'src/a.ts')).toBe(true);
  });

  it('reads added blank lines and trailing spaces as whitespace only', () => {
    expect(isWhitespaceOnlyPatch('@@ -1,2 +1,4 @@\n const a = 1;\n+\n+   \n-const b = 2;   \n+const b = 2;', 'src/a.ts')).toBe(true);
  });

  it('refuses a token that whitespace used to separate', () => {
    expect(isWhitespaceOnlyPatch('@@ -1 +1 @@\n-int a;\n+inta;', 'src/a.c')).toBe(false);
  });

  it('refuses a real change hidden among whitespace', () => {
    expect(isWhitespaceOnlyPatch('@@ -1,2 +1,2 @@\n-return 1;\n+return 2;\n-  x\n+x', 'src/a.ts')).toBe(false);
  });

  it('keeps leading whitespace in an indentation-sensitive file', () => {
    const reindent = '@@ -1,2 +1,2 @@\n-    return x\n+return x';
    expect(isWhitespaceOnlyPatch(reindent, 'app/main.py')).toBe(false);
    expect(isWhitespaceOnlyPatch('@@ -1 +1 @@\n-    return x   \n+    return x', 'app/main.py')).toBe(true);
    expect(isWhitespaceOnlyPatch(reindent, 'src/main.ts')).toBe(true);
  });

  it('proves nothing from an empty patch', () => {
    expect(isWhitespaceOnlyPatch('', 'src/a.ts')).toBe(false);
    expect(isWhitespaceOnlyPatch('@@ -1 +1 @@\n unchanged', 'src/a.ts')).toBe(false);
  });

  it('recognises a submodule pointer move', () => {
    expect(isSubmodulePointerPatch('@@ -1 +1 @@\n-Subproject commit 1111111aaaaaaa\n+Subproject commit 2222222bbbbbbb')).toBe(true);
    expect(isSubmodulePointerPatch('@@ -1 +1 @@\n-a\n+b')).toBe(false);
  });

  it('sees a generated header only at the top of the new file', () => {
    expect(patchShowsGeneratedHeader('@@ -0,0 +1,3 @@\n+// Code generated by protoc-gen-go. DO NOT EDIT.\n+package x\n+')).toBe(true);
    expect(patchShowsGeneratedHeader('@@ -0,0 +1,2 @@\n+/* @generated */\n+x')).toBe(true);
    expect(patchShowsGeneratedHeader('@@ -40,3 +40,3 @@\n+// Code generated DO NOT EDIT')).toBe(false);
    expect(patchShowsGeneratedHeader('@@ -0,0 +1,2 @@\n+export const a = 1;\n+')).toBe(false);
  });
});

describe('classifyFile', () => {
  it('reads a pure rename as a rename, whatever the path', () => {
    expect(classifyFile(file('src/b.ts', undefined, { status: 'renamed', changes: 0, additions: 0, deletions: 0 }))).toBe('rename');
    expect(classifyFile(file('src/b.ts', '@@ -1 +1 @@\n-a\n+b', { status: 'renamed' }))).toBe('source');
  });

  it('cannot claim whitespace without a patch', () => {
    expect(classifyFile(file('src/a.ts'))).toBe('source');
  });

  it('downgrades a whitespace-only source change', () => {
    expect(classifyFile(file('src/a.ts', '@@ -1 +1 @@\n-a  =  1;\n+a = 1;'))).toBe('whitespace');
  });

  it('keeps a README whitespace change a README change', () => {
    expect(classifyFile(file('README.md', '@@ -1 +1 @@\n-# Title \n+# Title'))).toBe('readme');
  });

  it('reads a submodule bump as a dependency change', () => {
    expect(classifyFile(file('lib/forge-std', '@@ -1 +1 @@\n-Subproject commit aaaaaaa1\n+Subproject commit bbbbbbb2'))).toBe('dependency');
  });

  it('reads a new file with a generated header as generated', () => {
    expect(classifyFile(file('api/client.go', '@@ -0,0 +1,2 @@\n+// Code generated by oapi-codegen. DO NOT EDIT.\n+package api', { status: 'added' }))).toBe('generated');
  });
});

describe('classifyCommit', () => {
  it('README only → LOW_INFORMATION, readme_only', () => {
    const result = classifyCommit({ files: [file('README.md', '@@ -1 +1 @@\n-a\n+b')], filesTruncated: false });
    expect(result).toMatchObject({ substance: 'LOW_INFORMATION', reasons: ['readme_only'], filesChanged: 1, classifierVersion: COMMIT_SUBSTANCE_VERSION });
    expect(result.classes.readme).toBe(1);
  });

  it('README and docs → documentation_only', () => {
    expect(classifyCommit({ files: [file('README.md'), file('docs/a.md')], filesTruncated: false })).toMatchObject({ substance: 'LOW_INFORMATION', reasons: ['documentation_only'] });
  });

  it('lockfile only → lockfile_only', () => {
    expect(classifyCommit({ files: [file('pnpm-lock.yaml')], filesTruncated: false })).toMatchObject({ substance: 'LOW_INFORMATION', reasons: ['lockfile_only'] });
  });

  it('whitespace only → whitespace_only', () => {
    expect(classifyCommit({ files: [file('src/a.ts', '@@ -1 +1 @@\n-a  = 1;\n+a = 1;'), file('src/b.ts', '@@ -1 +1 @@\n-x;  \n+x;')], filesTruncated: false })).toMatchObject({
      substance: 'LOW_INFORMATION',
      reasons: ['whitespace_only'],
    });
  });

  it('generated churn → generated_only', () => {
    expect(classifyCommit({ files: [file('dist/index.js'), file('dist/index.js.map')], filesTruncated: false })).toMatchObject({ substance: 'LOW_INFORMATION', reasons: ['generated_only'] });
  });

  it('mixed maintenance names each class', () => {
    expect(classifyCommit({ files: [file('README.md'), file('yarn.lock'), file('public/logo.png')], filesTruncated: false })).toMatchObject({
      substance: 'LOW_INFORMATION',
      reasons: ['maintenance_only', 'readme', 'dependency', 'asset'],
    });
  });

  it('source change → SUBSTANTIVE, source_changed', () => {
    expect(classifyCommit({ files: [file('src/Token.sol', '@@ -1 +1 @@\n-uint a;\n+uint b;')], filesTruncated: false })).toMatchObject({ substance: 'SUBSTANTIVE', reasons: ['source_changed'] });
  });

  it('source and tests → SUBSTANTIVE with both reasons', () => {
    expect(classifyCommit({ files: [file('src/pool.ts'), file('src/pool.test.ts'), file('README.md')], filesTruncated: false })).toMatchObject({
      substance: 'SUBSTANTIVE',
      reasons: ['source_changed', 'tests_changed'],
    });
  });

  it('config and CI count as development', () => {
    expect(classifyCommit({ files: [file('package.json')], filesTruncated: false }).substance).toBe('SUBSTANTIVE');
    expect(classifyCommit({ files: [file('.github/workflows/ci.yml')], filesTruncated: false })).toMatchObject({ substance: 'SUBSTANTIVE', reasons: ['ci_changed'] });
  });

  it('an unplaceable file → UNKNOWN, never a guess', () => {
    expect(classifyCommit({ files: [file('README.md'), file('data/blob.bin')], filesTruncated: false })).toMatchObject({ substance: 'UNKNOWN', reasons: ['unclassified_files'] });
  });

  it('a truncated file list is UNKNOWN unless what was visible changed code', () => {
    expect(classifyCommit({ files: [file('README.md')], filesTruncated: true })).toMatchObject({ substance: 'UNKNOWN', reasons: ['files_truncated'] });
    expect(classifyCommit({ files: [file('README.md'), file('src/a.ts')], filesTruncated: true }).substance).toBe('SUBSTANTIVE');
  });

  it('an empty commit changes nothing; an unlisted one is UNKNOWN', () => {
    expect(classifyCommit({ files: [], filesTruncated: false, stats: { additions: 0, deletions: 0, total: 0 } })).toMatchObject({ substance: 'LOW_INFORMATION', reasons: ['empty_commit'] });
    expect(classifyCommit({ files: [], filesTruncated: false, stats: { additions: 5, deletions: 0, total: 5 } })).toMatchObject({ substance: 'UNKNOWN', reasons: ['files_not_listed'] });
  });

  it('never uses words about intent', () => {
    const reasons = [
      classifyCommit({ files: [file('README.md')], filesTruncated: false }),
      classifyCommit({ files: [file('yarn.lock'), file('docs/a.md')], filesTruncated: false }),
      classifyCommit({ files: [file('src/a.ts', '@@ -1 +1 @@\n-a \n+a')], filesTruncated: false }),
    ].flatMap((result) => result.reasons);
    for (const reason of reasons) expect(reason).not.toMatch(/fake|gam|padd|spam|trivial|meaningless|suspicious/i);
  });

  it('is deterministic', () => {
    const input = { files: [file('src/a.ts'), file('README.md')], filesTruncated: false };
    expect(classifyCommit(input)).toEqual(classifyCommit(input));
  });
});

describe('codeWeekSubstance', () => {
  const human = (substance: 'SUBSTANTIVE' | 'LOW_INFORMATION' | 'UNKNOWN' | null) => ({ isBot: false, isMerge: false, substance });

  it('one substantive commit decides the week, whatever is still unread', () => {
    const week = codeWeekSubstance({ commits: [human('SUBSTANTIVE'), human(null), human(null)], fullyListed: false });
    expect(week).toMatchObject({ verdict: 'SUBSTANTIVE', commitsRead: 3, classified: 1, substantive: 1, pending: 2 });
  });

  it('LOW_INFORMATION only when every human commit is listed, read and low-information', () => {
    expect(codeWeekSubstance({ commits: [human('LOW_INFORMATION'), human('LOW_INFORMATION')], fullyListed: true }).verdict).toBe('LOW_INFORMATION');
    expect(codeWeekSubstance({ commits: [human('LOW_INFORMATION'), human(null)], fullyListed: true }).verdict).toBe('UNKNOWN');
    expect(codeWeekSubstance({ commits: [human('LOW_INFORMATION'), human('UNKNOWN')], fullyListed: true }).verdict).toBe('UNKNOWN');
    expect(codeWeekSubstance({ commits: [human('LOW_INFORMATION')], fullyListed: false }).verdict).toBe('UNKNOWN');
    expect(codeWeekSubstance({ commits: [], fullyListed: true }).verdict).toBe('UNKNOWN');
  });

  it('bots and merges are not the week', () => {
    const week = codeWeekSubstance({
      commits: [human('LOW_INFORMATION'), { isBot: true, isMerge: false, substance: null }, { isBot: false, isMerge: true, substance: null }],
      fullyListed: true,
    });
    expect(week).toMatchObject({ verdict: 'LOW_INFORMATION', commitsRead: 1 });
  });

  it('sums the classes of the commits it read', () => {
    const week = codeWeekSubstance({
      commits: [
        { isBot: false, isMerge: false, substance: 'LOW_INFORMATION', classes: { readme: 1 } },
        { isBot: false, isMerge: false, substance: 'SUBSTANTIVE', classes: { source: 3, test: 1 } },
      ],
      fullyListed: true,
    });
    expect(week.classes).toMatchObject({ readme: 1, source: 3, test: 1, docs: 0 });
  });
});

describe('isLowInformationCodeWeek', () => {
  it('is true only for a code-activity week read as LOW_INFORMATION', () => {
    expect(isLowInformationCodeWeek({ eventType: 'CODE_ACTIVITY', codeSubstance: 'LOW_INFORMATION' })).toBe(true);
    expect(isLowInformationCodeWeek({ eventType: 'CODE_ACTIVITY', codeSubstance: 'UNKNOWN' })).toBe(false);
    expect(isLowInformationCodeWeek({ eventType: 'CODE_ACTIVITY', codeSubstance: null })).toBe(false);
    expect(isLowInformationCodeWeek({ eventType: 'CODE_ACTIVITY' })).toBe(false);
    expect(isLowInformationCodeWeek({ eventType: 'GITHUB_RELEASE', codeSubstance: 'LOW_INFORMATION' })).toBe(false);
  });
});
