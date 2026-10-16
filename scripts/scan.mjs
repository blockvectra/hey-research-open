#!/usr/bin/env node
/**
 * Forbidden-string scan (2026-09-11).
 *
 * Walks a tree and fails on any match of the manifest's `forbidden` patterns:
 * the founder's former handle, the production address, local paths, tokens,
 * private keys, connection strings with passwords. Used on the public staging
 * tree before every sync and on the fresh private tree before its first push.
 *
 *   node scripts/open-source/scan.mjs <dir> [--quiet]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const SKIP_DIRS = new Set(['.git', '.claude', 'node_modules', 'dist', '.next', 'coverage', '.pnpm-store', 'test-results', 'playwright-report']);
// A `.lock` file is text and is scanned (2026-10-16); it used to be skipped with the binaries, silently.
const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp4|mov|pdf|zip|gz)$/i;
/** Larger than this is not read — and is reported as a hit, never skipped in silence (2026-10-16). */
export const SCAN_MAX_BYTES = 8 * 1024 * 1024;

export function scanTree(root) {
  /*
   * Both lists (2026-09-17). `secretLiterals` is this deployment's own hosts,
   * credentials, accounts and paths; it stays in the private repository, and
   * the redacted manifest the export publishes carries only `forbidden`. A
   * public checkout therefore scans for the generic shapes and finds no list
   * of what it is looking for.
   */
  const patterns = [...manifest.forbidden, ...(manifest.secretLiterals ?? [])].map((source) => new RegExp(source, 'i'));
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && !BINARY.test(entry) && stat.size >= SCAN_MAX_BYTES) {
        // A file too large to read could hold anything: it fails the scan until someone looks at it.
        hits.push({ file: relative(root, path), line: 0, pattern: `file of ${stat.size} bytes is too large to scan` });
      } else if (stat.isFile() && !BINARY.test(entry)) {
        const text = readFileSync(path, 'utf8');
        const lines = text.split('\n');
        for (const pattern of patterns) {
          lines.forEach((line, index) => {
            if (pattern.test(line)) hits.push({ file: relative(root, path), line: index + 1, pattern: pattern.source });
          });
        }
      }
    }
  };
  walk(root);
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: scan.mjs <dir>');
    process.exit(2);
  }
  const hits = scanTree(root);
  if (hits.length > 0) {
    for (const hit of hits) console.error(`forbidden: ${hit.file}:${hit.line} (${hit.pattern})`);
    process.exit(1);
  }
  if (!process.argv.includes('--quiet')) console.log(`scan clean: ${root}`);
}
