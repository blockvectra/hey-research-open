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
import { gunzipSync } from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const SKIP_DIRS = new Set(['.git', '.claude', 'node_modules', 'dist', '.next', 'coverage', '.pnpm-store', 'test-results', 'playwright-report']);
// A `.lock` file is text and is scanned (2026-10-16); it used to be skipped with the binaries, silently.
const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp4|mov|pdf)$/i;
/*
 * Archives are opened, never skipped (2026-10-25): a gzip file is decompressed and a tar file is read entry by entry,
 * each entry scanned like a file of the tree. An archive format this scanner cannot open fails the scan until someone
 * looks at it, as a file too large to read does.
 */
const GZIP = /\.(gz|tgz)$/i;
const TAR = /\.tar$/i;
const UNREADABLE_ARCHIVE = /\.(zip|jar|war|7z|rar|bz2|tbz2?|xz|txz|zst|lz|lzma|lz4|cab|iso|dmg)$/i;
/** Larger than this is not read — and is reported as a hit, never skipped in silence (2026-10-16). */
export const SCAN_MAX_BYTES = 8 * 1024 * 1024;
/** The most a compressed file may expand to before the scan refuses it. */
export const SCAN_MAX_EXPANDED_BYTES = 64 * 1024 * 1024;

/** The regular files of a tar archive, as `{ name, data }`; throws on a malformed archive. */
export function tarEntries(buffer) {
  const entries = [];
  const text = (start, length) => {
    const raw = buffer.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
  };
  let offset = 0;
  let longName;
  let paxName;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(text(offset + 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`malformed tar header at byte ${offset}`);
    const type = String.fromCharCode(header[156] || 0x30);
    const magic = text(offset + 257, 6);
    const prefix = magic.startsWith('ustar') ? text(offset + 345, 155) : '';
    const dataStart = offset + 512;
    if (dataStart + size > buffer.length) throw new Error(`truncated tar entry at byte ${offset}`);
    const data = buffer.subarray(dataStart, dataStart + size);
    if (type === 'L') longName = data.toString('utf8').replace(/\0+$/, '');
    else if (type === 'x') paxName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))?.[1];
    else {
      const name = paxName ?? longName ?? (prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100));
      // Regular files only ('0', NUL in old archives, '7' contiguous); directories, links and global headers carry no content.
      if (type === '0' || type === '7') entries.push({ name, data });
      longName = undefined;
      paxName = undefined;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

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
  const scanText = (file, text) => {
    const lines = text.split('\n');
    for (const pattern of patterns) {
      lines.forEach((line, index) => {
        if (pattern.test(line)) hits.push({ file, line: index + 1, pattern: pattern.source });
      });
    }
  };
  /** One file's content, by name: an archive is opened, a binary skipped, anything else read as text. */
  const scanContent = (file, name, data) => {
    if (BINARY.test(name)) return;
    if (UNREADABLE_ARCHIVE.test(name)) {
      hits.push({ file, line: 0, pattern: 'an archive the scan cannot open' });
      return;
    }
    if (GZIP.test(name)) {
      let inner;
      try {
        inner = gunzipSync(data, { maxOutputLength: SCAN_MAX_EXPANDED_BYTES });
      } catch (error) {
        hits.push({ file, line: 0, pattern: `a gzip file the scan cannot expand (${error.code ?? error.message})` });
        return;
      }
      const isTar = /\.(tar\.gz|tgz)$/i.test(name) || inner.subarray(257, 262).toString('latin1') === 'ustar';
      scanContent(file, isTar ? `${name}.tar` : name.replace(/\.gz$/i, ''), inner);
      return;
    }
    if (TAR.test(name)) {
      let entries;
      try {
        entries = tarEntries(data);
      } catch (error) {
        hits.push({ file, line: 0, pattern: `a tar file the scan cannot read (${error.message})` });
        return;
      }
      for (const entry of entries) scanContent(`${file}!${entry.name}`, entry.name, entry.data);
      return;
    }
    if (data.length >= SCAN_MAX_BYTES) {
      // A file too large to read could hold anything: it fails the scan until someone looks at it.
      hits.push({ file, line: 0, pattern: `file of ${data.length} bytes is too large to scan` });
      return;
    }
    scanText(file, data.toString('utf8'));
  };
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (!stat.isFile() || BINARY.test(entry)) continue;
      else if (stat.size >= SCAN_MAX_BYTES) {
        hits.push({ file: relative(root, path), line: 0, pattern: `file of ${stat.size} bytes is too large to scan` });
      } else scanContent(relative(root, path), entry, readFileSync(path));
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
