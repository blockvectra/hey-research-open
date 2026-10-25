import type { z } from 'zod';

/*
 * Zod 3's English messages, kept on zod 4 (2026-10-25).
 *
 * HEY moved from zod 3 to zod 4. Zod 4 words its default messages differently ("Invalid input: expected string,
 * received undefined" where zod 3 said "Required"), and some of those messages reach readers: an API 400 body, the
 * agent contract's `invalid_request`, a submission form's field errors, the environment check an operator reads. A
 * parse whose messages leave HEY passes this map (`schema.safeParse(value, ZOD_MESSAGES)`) and lists its issues through
 * `zod3Issues`, so every message zod writes itself reads exactly as it did on zod 3. A schema's own message (`.min(1, 'Needs a name')`, `{ message }`,
 * `ctx.addIssue({ message })`) is never touched: zod applies it before this map.
 *
 * Held to zod 3 itself (`zod/v3`, shipped inside the zod 4 package) by `zod-messages.test.ts`.
 *
 * The rest of the move kept zod 3's parsing the same way, in the schemas themselves:
 *  - `.prefault(x)` where zod 3 said `.default(x)`: zod 4's `.default()` returns the value as written, zod 3 parsed it
 *    through the schema (its transforms, its inner defaults); `.prefault()` is that.
 *  - `.guid()` where zod 3 said `.uuid()`: zod 3 took any 8-4-4-4-12 hex id, zod 4's `.uuid()` only RFC 9562 ones.
 *  - `.refine(isUrl, URL_MESSAGE)` where zod 3 said `.url()`: see `isUrl`.
 *  - `continue: true` on an issue a transform adds, where later checks (an env's cross-field rules) ran on zod 3.
 *  - `z.partialRecord()` where zod 3's `z.record()` had enum keys (zod 4's record requires every key).
 *  - `z.unknown().optional()` for an object key zod 3 let be absent (zod 4 requires a `z.unknown()` key).
 * Two differences stay, both zod 4's own: an array over its maximum length is refused before its items are read (zod
 * 4.6.6 and later), so only the length issue is listed; and `.int()` refuses integers beyond ±2^53, and every number
 * ±Infinity, which zod 3 let through to the next check.
 */

type RawIssue = z.core.$ZodRawIssue;

/** zod 3's `getParsedType`, which named what a value was in "Expected …, received …". */
function parsedType(value: unknown): string {
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return 'string';
    case 'number':
      return Number.isNaN(value) ? 'nan' : 'number';
    case 'boolean':
      return 'boolean';
    case 'function':
      return 'function';
    case 'bigint':
      return 'bigint';
    case 'symbol':
      return 'symbol';
    case 'object': {
      if (Array.isArray(value)) return 'array';
      if (value === null) return 'null';
      const thenable = value as { then?: unknown; catch?: unknown };
      if (typeof thenable.then === 'function' && typeof thenable.catch === 'function') return 'promise';
      if (value instanceof Map) return 'map';
      if (value instanceof Set) return 'set';
      if (value instanceof Date) return 'date';
      return 'object';
    }
    default:
      return 'unknown';
  }
}

/** zod 3's `util.joinValues`: strings quoted with ', joined by " | ". */
function joinValues(values: readonly unknown[], separator = ' | '): string {
  return values.map((value) => (typeof value === 'string' ? `'${value}'` : String(value))).join(separator);
}

const bigintAsString = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value);

/** zod 4's names for what a schema expected, in zod 3's words. */
const EXPECTED: Record<string, string> = { record: 'object', tuple: 'array' };

/** zod 4's string formats, in zod 3's words ("Invalid email", "Invalid uuid"). A regex said only "Invalid". */
const FORMAT: Record<string, string> = { guid: 'uuid', uuidv4: 'uuid', uuidv6: 'uuid', uuidv7: 'uuid', ipv4: 'ip', ipv6: 'ip', cidrv4: 'cidr', cidrv6: 'cidr' };

type SizeIssue = { origin?: string; exact?: boolean; inclusive?: boolean };

function sizeType(issue: SizeIssue): string {
  return issue.origin === 'int' ? 'number' : (issue.origin ?? '');
}

function tooSmall(issue: SizeIssue & { minimum: unknown }): string {
  const { exact, inclusive, minimum } = issue;
  switch (sizeType(issue)) {
    case 'array':
      return `Array must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'more than'} ${String(minimum)} element(s)`;
    case 'string':
      return `String must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'over'} ${String(minimum)} character(s)`;
    case 'number':
    case 'bigint':
      return `Number must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${String(minimum)}`;
    case 'date':
      return `Date must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${String(new Date(Number(minimum)))}`;
    default:
      return 'Invalid input';
  }
}

function tooBig(issue: SizeIssue & { maximum: unknown }): string {
  const { exact, inclusive, maximum } = issue;
  switch (sizeType(issue)) {
    case 'array':
      return `Array must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'less than'} ${String(maximum)} element(s)`;
    case 'string':
      return `String must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'under'} ${String(maximum)} character(s)`;
    case 'number':
      return `Number must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${String(maximum)}`;
    case 'bigint':
      return `BigInt must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${String(maximum)}`;
    case 'date':
      return `Date must be ${exact ? 'exactly' : inclusive ? 'smaller than or equal to' : 'smaller than'} ${String(new Date(Number(maximum)))}`;
    default:
      return 'Invalid input';
  }
}

function invalidType(issue: { expected: string; input?: unknown; inst?: unknown }): string {
  const { input } = issue;
  if (issue.expected === 'int' && typeof input === 'number') return 'Expected integer, received float';
  // zod 4 refuses ±Infinity in every number. zod 3 let it reach the checks: `.int()` refused it first, else `.finite()`.
  if (issue.expected === 'number' && typeof input === 'number' && !Number.isNaN(input) && !Number.isFinite(input)) {
    const checks = (issue as { inst?: { _zod?: { def?: { checks?: { _zod?: { def?: { format?: string } } }[] } } } }).inst?._zod?.def?.checks ?? [];
    return checks.some((check) => check._zod?.def?.format?.includes('int')) ? 'Expected integer, received float' : 'Number must be finite';
  }
  if (issue.expected === 'date' && input instanceof Date) return 'Invalid date';
  const received = parsedType(input);
  if (received === 'undefined') return 'Required';
  return `Expected ${EXPECTED[issue.expected] ?? issue.expected}, received ${received}`;
}

function invalidValue(issue: { values: readonly unknown[]; input?: unknown; inst?: unknown }): string {
  const kind = (issue.inst as { _zod?: { def?: { type?: string } } } | undefined)?._zod?.def?.type;
  if (issue.input === undefined && kind !== 'literal') return 'Required';
  if (kind === 'literal') return `Invalid literal value, expected ${JSON.stringify(issue.values[0], bigintAsString)}`;
  // An enum: zod 3 said a value that is not a string was the wrong type, and named a wrong string.
  if (typeof issue.input !== 'string') return `Expected ${joinValues(issue.values)}, received ${parsedType(issue.input)}`;
  return `Invalid enum value. Expected ${joinValues(issue.values)}, received '${issue.input}'`;
}

function invalidFormat(issue: { format: string; prefix?: string; suffix?: string; includes?: string; position?: number }): string {
  switch (issue.format) {
    case 'regex':
      return 'Invalid';
    case 'starts_with':
      return `Invalid input: must start with "${issue.prefix ?? ''}"`;
    case 'ends_with':
      return `Invalid input: must end with "${issue.suffix ?? ''}"`;
    case 'includes': {
      const message = `Invalid input: must include "${issue.includes ?? ''}"`;
      return typeof issue.position === 'number' ? `${message} at one or more positions greater than or equal to ${issue.position}` : message;
    }
    default:
      return `Invalid ${FORMAT[issue.format] ?? issue.format}`;
  }
}

/** The message zod 3 wrote for an issue zod 4 raised without one of its own. */
export function zodMessages(raw: RawIssue): string {
  const issue = raw as RawIssue & Record<string, unknown>;
  switch (raw.code) {
    case 'invalid_type':
      return invalidType(issue as unknown as { expected: string; input?: unknown });
    case 'invalid_value':
      return invalidValue(issue as unknown as { values: readonly unknown[]; input?: unknown; inst?: unknown });
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${joinValues((issue as unknown as { keys: string[] }).keys, ', ')}`;
    case 'invalid_union': {
      const options = (issue as unknown as { options?: unknown[] }).options;
      return Array.isArray(options) && options.length > 0 ? `Invalid discriminator value. Expected ${joinValues(options)}` : 'Invalid input';
    }
    case 'invalid_format':
      return invalidFormat(issue as unknown as { format: string });
    case 'too_small':
      return tooSmall(issue as unknown as SizeIssue & { minimum: unknown });
    case 'too_big':
      return tooBig(issue as unknown as SizeIssue & { maximum: unknown });
    case 'not_multiple_of':
      return `Number must be a multiple of ${String((issue as unknown as { divisor: unknown }).divisor)}`;
    case 'invalid_key': {
      // zod 3 reported a record's bad key by the key schema's own issue; zod 4 wraps those (already in these words).
      const inner = (issue as unknown as { issues?: { message?: string }[] }).issues;
      return inner?.[0]?.message ?? 'Invalid input';
    }
    default:
      return 'Invalid input';
  }
}

/**
 * The issues zod 3 would have listed. zod 4 still runs a length check on a value of the wrong type when the value has
 * a length (a string where a list belongs), and adds "String must contain …" after "Expected array, received string";
 * zod 3 stopped at the type. Any issue at the path of an earlier `invalid_type` is that follow-on, and is left out.
 */
export function zod3Issues<T extends { code: string; path: PropertyKey[] }>(issues: readonly T[]): T[] {
  const mistyped = new Set<string>();
  const kept: T[] = [];
  for (const issue of issues) {
    const key = JSON.stringify(issue.path.map(String));
    if (mistyped.has(key)) continue;
    if (issue.code === 'invalid_type') mistyped.add(key);
    kept.push(issue);
  }
  return kept;
}

/** Parse options that keep zod 3's messages: `schema.safeParse(value, ZOD_MESSAGES)`. */
export const ZOD_MESSAGES = { error: zodMessages } as const;

/**
 * zod 3's `.url()`: whatever `new URL()` accepts, returned as given. zod 4's `.url()` also trims the value and drops
 * tabs and line breaks from what it returns; this keeps the value a reader typed byte for byte.
 */
export function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** The message zod 3's `.url()` gave, for `.refine(isUrl, URL_MESSAGE)`. */
export const URL_MESSAGE = 'Invalid url';
