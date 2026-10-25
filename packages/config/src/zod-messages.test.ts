import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';

import { isUrl, URL_MESSAGE, zod3Issues, ZOD_MESSAGES } from './zod-messages';

/**
 * The zod 4 move (2026-10-25) keeps zod 3's messages: each case builds one schema in zod 3 (`zod/v3`, shipped in the
 * zod 4 package) and the same schema in zod 4, parses the same values, and holds the outcome — accepted or not, the
 * value returned, and each issue's path and message — to zod 3's.
 */
type Outcome = { success: boolean; data?: unknown; issues?: { path: (string | number)[]; message: string }[] };

const v3Outcome = (schema: z3.ZodTypeAny, value: unknown): Outcome => {
  const result = schema.safeParse(value);
  return result.success ? { success: true, data: result.data } : { success: false, issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
};

const v4Outcome = (schema: z.ZodType, value: unknown): Outcome => {
  const result = schema.safeParse(value, ZOD_MESSAGES);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: zod3Issues(result.error.issues).map((issue) => ({ path: issue.path as (string | number)[], message: issue.message })) };
};

const cases: { name: string; v3: () => z3.ZodTypeAny; v4: () => z.ZodType; values: unknown[] }[] = [
  {
    name: 'strings',
    v3: () => z3.object({ name: z3.string().min(2).max(5), code: z3.string().length(3), tag: z3.string().regex(/^[a-z]+$/), start: z3.string().startsWith('0x').endsWith('ff').includes('ab') }),
    v4: () => z.object({ name: z.string().min(2).max(5), code: z.string().length(3), tag: z.string().regex(/^[a-z]+$/), start: z.string().startsWith('0x').endsWith('ff').includes('ab') }),
    values: [{}, { name: 'a', code: 'abcd', tag: 'A1', start: 'zz' }, { name: 'abcdefg', code: 'ab', tag: 7, start: null }, { name: 'abc', code: 'abc', tag: 'ok', start: '0xabff' }, 'nope', null, []],
  },
  {
    name: 'numbers',
    v3: () => z3.object({ n: z3.number().int().min(1).max(30), p: z3.number().positive(), q: z3.number().nonnegative().lt(10), f: z3.number().finite(), m: z3.number().multipleOf(5), g: z3.number().gt(2) }),
    v4: () => z.object({ n: z.number().int().min(1).max(30), p: z.number().positive(), q: z.number().nonnegative().lt(10), f: z.number().finite(), m: z.number().multipleOf(5), g: z.number().gt(2) }),
    values: [{}, { n: 0, p: 0, q: -1, f: Infinity, m: 7, g: 2 }, { n: 31, p: -2, q: 10, f: -Infinity, m: 10, g: 3 }, { n: 2.5, p: 1, q: 1, f: 1, m: 5, g: 3 }, { n: '3', p: Number.NaN, q: true, f: 1, m: 5, g: 3 }],
  },
  {
    name: 'coerced numbers and dates',
    v3: () => z3.object({ n: z3.coerce.number().int().min(0).max(1000), d: z3.coerce.date() }),
    v4: () => z.object({ n: z.coerce.number().int().min(0).max(1000), d: z.coerce.date() }),
    values: [{ n: 'abc', d: 'not a date' }, { n: '1001', d: '2026-10-25' }, { n: '-1', d: 0 }],
  },
  {
    name: 'enums, literals and booleans',
    v3: () => z3.object({ e: z3.enum(['a', 'b']), l: z3.literal('fixed'), k: z3.literal(5), b: z3.boolean() }),
    v4: () => z.object({ e: z.enum(['a', 'b']), l: z.literal('fixed'), k: z.literal(5), b: z.boolean() }),
    values: [{}, { e: 'c', l: 'other', k: 6, b: 'yes' }, { e: 3, l: 5, k: '5', b: null }],
  },
  {
    name: 'arrays, records, tuples, nullables',
    v3: () => z3.object({ a: z3.array(z3.string()).min(2).max(3), x: z3.array(z3.number()).length(2), r: z3.record(z3.string(), z3.number()), t: z3.tuple([z3.string(), z3.number()]), o: z3.string().nullable().optional() }),
    v4: () => z.object({ a: z.array(z.string()).min(2).max(3), x: z.array(z.number()).length(2), r: z.record(z.string(), z.number()), t: z.tuple([z.string(), z.number()]), o: z.string().nullable().optional() }),
    values: [{}, { a: ['x'], x: [1], r: { k: 'v' }, t: [1, 'a'], o: 3 }, { a: ['a', 'b', 'c', 'd'], x: [1, 2, 3], r: [], t: 'no', o: null }, { a: 'x', x: null, r: null, t: [], o: undefined }],
  },
  {
    name: 'strict objects',
    v3: () => z3.object({ id: z3.string() }).strict(),
    v4: () => z.object({ id: z.string() }).strict(),
    values: [{ id: 'a', extra: 1 }, { id: 'a', b: 1, c: 2 }, { extra: 1 }],
  },
  {
    name: 'unions and discriminated unions',
    v3: () => z3.object({ u: z3.union([z3.string(), z3.number()]), d: z3.discriminatedUnion('kind', [z3.object({ kind: z3.literal('a'), a: z3.string() }), z3.object({ kind: z3.literal('b'), b: z3.number() })]) }),
    v4: () => z.object({ u: z.union([z.string(), z.number()]), d: z.discriminatedUnion('kind', [z.object({ kind: z.literal('a'), a: z.string() }), z.object({ kind: z.literal('b'), b: z.number() })]) }),
    values: [{}, { u: true, d: { kind: 'c' } }, { u: 'x', d: { kind: 'a' } }, { u: 1, d: 'x' }],
  },
  {
    name: 'formats',
    v3: () => z3.object({ email: z3.string().email(), id: z3.string().uuid(), url: z3.string().url() }),
    v4: () => z.object({ email: z.string().email(), id: z.string().guid(), url: z.string().refine(isUrl, URL_MESSAGE) }),
    values: [
      { email: 'no', id: '1234', url: 'not a url' },
      { email: 'a@b.co', id: '11111111-1111-1111-1111-111111111111', url: ' https://example.com/x ' },
      { email: 'first.last+tag@sub.example.org', id: '00000000-0000-0000-0000-000000000000', url: 'mailto:a@b.co' },
      { email: '.a@b.co', id: 'ZZZZZZZZ-1111-1111-1111-111111111111', url: 'https://exa\tmple.com' },
      { email: 'a..b@c.io', id: 'not-a-uuid', url: 'https://example.com' },
    ],
  },
  {
    name: 'refinements and custom issues',
    v3: () => z3.object({ s: z3.string().refine((value) => value.length > 1), t: z3.string().refine((value) => value !== 'x', 'not x') }).superRefine((value, ctx) => ctx.addIssue({ code: z3.ZodIssueCode.custom, message: `saw ${value.s}`, path: ['s'] })),
    v4: () => z.object({ s: z.string().refine((value) => value.length > 1), t: z.string().refine((value) => value !== 'x', 'not x') }).superRefine((value, ctx) => ctx.addIssue({ code: 'custom', message: `saw ${value.s}`, path: ['s'] })),
    values: [{ s: 'a', t: 'x' }, { s: 'ab', t: 'y' }],
  },
  {
    name: 'a transform’s issue leaves the cross-field checks running, as zod 3 did',
    v3: () =>
      z3
        .object({ json: z3.string().transform((value, ctx) => { try { return JSON.parse(value) as unknown; } catch { ctx.addIssue({ code: 'custom', message: 'not JSON' }); return z3.NEVER; } }), on: z3.boolean() })
        .superRefine((value, ctx) => { if (value.on) ctx.addIssue({ code: 'custom', message: 'on needs json', path: ['on'] }); }),
    v4: () =>
      z
        .object({ json: z.string().transform((value, ctx) => { try { return JSON.parse(value) as unknown; } catch { ctx.addIssue({ code: 'custom', message: 'not JSON', continue: true }); return z.NEVER; } }), on: z.boolean() })
        .superRefine((value, ctx) => { if (value.on) ctx.addIssue({ code: 'custom', message: 'on needs json', path: ['on'] }); }),
    values: [{ json: '{bad', on: true }, { json: '{}', on: false }],
  },
  {
    name: 'an unknown value may be absent, as zod 3 let it be',
    v3: () => z3.object({ url: z3.unknown(), name: z3.string() }),
    v4: () => z.object({ url: z.unknown().optional(), name: z.string() }),
    values: [{ name: 'a' }, { url: 3, name: 'b' }, {}],
  },
  {
    name: 'enum-keyed records stay partial, as zod 3’s were',
    v3: () => z3.record(z3.enum(['page', 'api', 'static']), z3.number()),
    v4: () => z.partialRecord(z.enum(['page', 'api', 'static']), z.number()),
    values: [{ page: 1 }, { page: 1, api: 2, static: 3 }, { page: 'x' }],
  },
  {
    name: 'defaults run through the schema, as zod 3 did',
    v3: () => z3.object({ list: z3.array(z3.string()).default([]), n: z3.string().transform(Number).default('5'), inner: z3.object({ on: z3.boolean().default(true) }).default({}) }),
    v4: () => z.object({ list: z.array(z.string()).prefault([]), n: z.string().transform(Number).prefault('5'), inner: z.object({ on: z.boolean().prefault(true) }).prefault({}) }),
    values: [{}, { list: ['a'], n: '7', inner: { on: false } }],
  },
];

describe('zod 4 keeps zod 3’s messages and outcomes', () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      for (const value of testCase.values) expect(v4Outcome(testCase.v4(), value), JSON.stringify(value)).toEqual(v3Outcome(testCase.v3(), value));
    });
  }

  it('a schema’s own message still wins', () => {
    const schema = z.object({ name: z.string().min(1, 'Needs a name'), kind: z.enum(['a'], { error: () => 'Pick a kind' }) });
    const result = schema.safeParse({ name: '', kind: 'b' }, ZOD_MESSAGES);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toEqual(['Needs a name', 'Pick a kind']);
  });

  it('isUrl accepts what zod 3’s url check accepted, and returns the value as given', () => {
    const schema = z.string().refine(isUrl, URL_MESSAGE);
    expect(schema.parse(' https://example.com/a\n')).toBe(' https://example.com/a\n');
    expect(schema.safeParse('example.com', ZOD_MESSAGES).error?.issues[0]?.message).toBe('Invalid url');
  });
});
