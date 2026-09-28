import { gunzipSync } from 'node:zlib';

import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { SourceError } from '../errors';
import { performSourceFetch } from '../http/perform';
import { readTar, TarFormatError } from '../tar';
import { isMigrationFileName, replayTaxonomy, type OpenDevDataTaxonomy, type TaxonomyError } from './open-dev-data-taxonomy';

/**
 * Open Dev Data — Electric Capital's crypto-ecosystems taxonomy (2026-09-28, brief §25).
 *
 * What it is: a public, community-edited map of ecosystem ↔ repository, kept
 * as dated migration files in github.com/electric-capital/open-dev-data (the
 * repository was renamed from `crypto-ecosystems`; the old name redirects).
 * The data is CC BY 4.0 (attribution: "Open Dev Data by Electric Capital",
 * https://github.com/electric-capital/open-dev-data, CC BY 4.0); the code is
 * MIT. There is no released export file, so HEY reads the repository archive
 * from GitHub's codeload host — about 17 MB gzipped, 73 MB of migrations,
 * one request — and replays the migrations itself (`open-dev-data-taxonomy.ts`).
 *
 * Measured 2026-09-28: codeload sends a strong ETag and answers a matching
 * `If-None-Match` with 304, so an unchanged week costs one empty response.
 * The archive's pax global header carries the commit id, kept as provenance.
 *
 * What HEY does with it is decided elsewhere and is narrow: which ecosystems
 * list a repository HEY already attributes to a project. It never
 * establishes, corroborates or removes an attribution, is never a ship and
 * never reaches a score (authority entry `open_dev_data`). The parquet
 * snapshots at data.opendevdata.org — commits and developer tables among
 * them — are deliberately not read: HEY needs no person-level data.
 */
export const OPEN_DEV_DATA_ARCHIVE_URL = 'https://codeload.github.com/electric-capital/open-dev-data/tar.gz/refs/heads/master';
export const OPEN_DEV_DATA_REPOSITORY_URL = 'https://github.com/electric-capital/open-dev-data';
export const OPEN_DEV_DATA_ATTRIBUTION = 'Open Dev Data by Electric Capital (https://github.com/electric-capital/open-dev-data), CC BY 4.0';

/** The archive was 17 MB gzipped on 2026-09-28; four times that is refused. */
export const OPEN_DEV_DATA_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
/** The unpacked archive was about 80 MB; the gunzip stops past this. */
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
/** 829 migration files and a few hundred other entries on 2026-09-28. */
const MAX_TAR_ENTRIES = 20_000;
/**
 * Their validator fails a taxonomy on any error; the current one has none.
 * A handful is tolerated (and reported) so one bad line upstream does not
 * blind HEY for a week; more than this means the format moved.
 */
export const OPEN_DEV_DATA_MAX_ERRORS = 50;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const COMMIT = /^[0-9a-f]{40}$/;

const archiveSchema = z.object({
  commit: z.string().regex(COMMIT).nullable(),
  files: z.array(z.object({ name: z.string().min(17).max(300), text: z.string() })).min(1).max(MAX_TAR_ENTRIES),
  ignoredFiles: z.number().int().nonnegative(),
});
type Archive = z.infer<typeof archiveSchema>;

export type OpenDevDataSnapshot = {
  /** The commit the archive was cut from (its pax global header), when present. */
  commit: string | null;
  /** Migration files replayed. */
  migrations: number;
  /** Files in `migrations/` whose name has no valid dated prefix — their tool skips them, and so does HEY. */
  ignoredFiles: number;
  ecosystems: number;
  listedRepos: number;
  errorCount: number;
  errors: TaxonomyError[];
  taxonomy: OpenDevDataTaxonomy;
};

export type OpenDevDataInput = { url?: string };

/** `<root>/migrations/<file>`: the one directory the taxonomy lives in. */
const migrationPath = (name: string): string | undefined => {
  const parts = name.split('/');
  return parts.length === 3 && parts[1] === 'migrations' && parts[2] ? parts[2] : undefined;
};

export function parseOpenDevDataArchive(body: string): Archive {
  let unpacked: Buffer;
  try {
    unpacked = gunzipSync(Buffer.from(body, 'latin1'), { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch (error) {
    throw new Error(`not a gzip archive within ${MAX_UNPACKED_BYTES} bytes: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  let ignoredFiles = 0;
  let read;
  try {
    read = readTar(unpacked, {
      maxEntries: MAX_TAR_ENTRIES,
      keep: (name) => {
        const file = migrationPath(name);
        if (!file) return false;
        if (isMigrationFileName(file)) return true;
        ignoredFiles += 1;
        return false;
      },
    });
  } catch (error) {
    if (error instanceof TarFormatError) throw new Error(`not a readable tar archive: ${error.message}`);
    throw error;
  }
  return {
    commit: read.globalComment && COMMIT.test(read.globalComment) ? read.globalComment : null,
    files: read.entries.map((entry) => ({ name: migrationPath(entry.name)!, text: entry.data.toString('utf8') })),
    ignoredFiles,
  };
}

export function snapshotFromArchive(archive: Archive): OpenDevDataSnapshot {
  const taxonomy = replayTaxonomy(archive.files);
  if (taxonomy.errorCount > OPEN_DEV_DATA_MAX_ERRORS) {
    const sample = taxonomy.errors.slice(0, 3).map((e) => `${e.file}:${e.line} ${e.kind}`).join('; ');
    throw new SourceError('INVALID_RESPONSE', `taxonomy replay failed on ${taxonomy.errorCount} commands (cap ${OPEN_DEV_DATA_MAX_ERRORS}): ${sample}`);
  }
  return {
    commit: archive.commit,
    migrations: taxonomy.migrations,
    ignoredFiles: archive.ignoredFiles,
    ecosystems: taxonomy.ecosystemCount,
    listedRepos: taxonomy.listedRepoCount,
    errorCount: taxonomy.errorCount,
    errors: taxonomy.errors,
    taxonomy,
  };
}

export function createOpenDevDataAdapter(): SourceAdapter<OpenDevDataInput, OpenDevDataSnapshot> {
  return {
    name: 'open-dev-data',
    canHandle: () => true,
    fetch(input: OpenDevDataInput, ctx: SourceContext): Promise<SourceResult<OpenDevDataSnapshot>> {
      return performSourceFetch(
        ctx,
        {
          url: input.url ?? OPEN_DEV_DATA_ARCHIVE_URL,
          headers: { accept: 'application/x-gzip, application/gzip, application/octet-stream' },
          allowedContentTypes: ['application/x-gzip', 'application/gzip', 'application/octet-stream'],
          maxBytes: OPEN_DEV_DATA_MAX_ARCHIVE_BYTES,
          bodyEncoding: 'latin1',
        },
        { schema: archiveSchema, parse: parseOpenDevDataArchive, normalize: snapshotFromArchive, cacheTtlSeconds: CACHE_TTL_SECONDS },
      );
    },
  };
}
