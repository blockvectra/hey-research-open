/**
 * A bounded reader for ustar/pax archives (2026-09-28, Open Dev Data).
 *
 * Only what a `git archive` tarball uses: regular files, directories, the
 * pax global header (whose `comment` is the commit id), pax per-entry headers
 * and GNU long names. Every header's checksum is verified, sizes are read
 * from their octal fields only (a base-256 size is refused), and the reader
 * stops at a caller-set entry cap — an archive that lies about itself is
 * refused, never guessed at. It reads from a buffer already bounded by the
 * HTTP client's byte cap and the gunzip output cap.
 */

const BLOCK = 512;

export class TarFormatError extends Error {}

export type TarEntry = { name: string; data: Buffer };

export type TarReadResult = {
  /** Files the filter kept, in archive order. */
  entries: TarEntry[];
  /** The pax global header's `comment` (git writes the commit id there), when present. */
  globalComment: string | undefined;
  /** Every regular file seen, kept or not. */
  files: number;
};

const text = (block: Buffer, start: number, length: number): string => {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
};

const octal = (block: Buffer, start: number, length: number): number => {
  if ((block[start] ?? 0) & 0x80) throw new TarFormatError('base-256 size field is not supported');
  const raw = text(block, start, length).trim();
  if (raw === '') return 0;
  if (!/^[0-7]+$/.test(raw)) throw new TarFormatError(`bad octal field "${raw.slice(0, 16)}"`);
  return Number.parseInt(raw, 8);
};

const checksumOk = (block: Buffer): boolean => {
  const stored = octal(block, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
  return sum === stored;
};

/** `len key=value\n` records (POSIX pax). */
function paxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(offset, space).toString('ascii'), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > data.length) throw new TarFormatError('bad pax record');
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) records.set(record.slice(0, eq), record.slice(eq + 1));
    offset += length;
  }
  return records;
}

export function readTar(archive: Buffer, options: { keep: (name: string) => boolean; maxEntries: number }): TarReadResult {
  const entries: TarEntry[] = [];
  let globalComment: string | undefined;
  let files = 0;
  let headers = 0;
  let nextName: string | undefined;
  let offset = 0;

  while (offset + BLOCK <= archive.length) {
    const block = archive.subarray(offset, offset + BLOCK);
    // Two zero blocks end the archive; one is enough to stop reading.
    if (block.every((byte) => byte === 0)) break;
    headers += 1;
    if (headers > options.maxEntries) throw new TarFormatError(`more than ${options.maxEntries} entries`);
    if (!checksumOk(block)) throw new TarFormatError(`header checksum mismatch at byte ${offset}`);

    const size = octal(block, 124, 12);
    const type = String.fromCharCode(block[156] ?? 0);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new TarFormatError('entry runs past the end of the archive');
    const data = archive.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'g') {
      globalComment = paxRecords(data).get('comment') ?? globalComment;
      continue;
    }
    if (type === 'x') {
      nextName = paxRecords(data).get('path') ?? nextName;
      continue;
    }
    if (type === 'L') {
      nextName = text(data, 0, data.length);
      continue;
    }

    const magic = text(block, 257, 6);
    const prefix = magic.startsWith('ustar') ? text(block, 345, 155) : '';
    const plain = text(block, 0, 100);
    const name = nextName ?? (prefix ? `${prefix}/${plain}` : plain);
    nextName = undefined;

    if (type !== '0' && type !== '\0') continue;
    files += 1;
    if (options.keep(name)) entries.push({ name, data });
  }

  return { entries, globalComment, files };
}
