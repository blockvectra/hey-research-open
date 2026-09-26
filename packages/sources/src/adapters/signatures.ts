import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { SourceError } from '../errors';
import { performSourceFetch } from '../http/perform';
import { sameOrigin } from './sourcify';

/**
 * Signature candidates for 4-byte selectors (brief §21, 2026-09-27).
 *
 * Sourcify's signature database (`api.4byte.sourcify.dev`) answers many
 * selectors in one GET, with no key. OpenChain's lookup returns the
 * byte-identical body (the same database), and 4byte.directory answers one
 * selector per request with less coverage for this chain (audit F §2), so
 * this is the one signature service HEY asks.
 *
 * What comes back is a **candidate**, never a name. Selectors collide:
 * `0xa9059cbb` is `transfer(address,uint256)` and at least twelve other
 * signatures (`many_msg_babbage(bytes1)`, …) — see the collision fixture. HEY
 * asks with `filter=true`, which drops the entries the database itself marks
 * as spam, keeps every remaining alternative, and stores them all with the
 * service's `hasVerifiedContract` flag. The domain checks that each candidate
 * really hashes to its selector before storing it, and never upgrades one to a
 * method name: only a contract's own verified ABI names a function.
 */
export const SIGNATURE_DATABASE_BASE_URL = 'https://api.4byte.sourcify.dev';

/** Selectors per request: the database answers comma-separated lists. */
export const SIGNATURE_LOOKUP_BATCH = 25;
/** A candidate list longer than this is cut: the rest adds nothing a reader can use. */
export const SIGNATURE_CANDIDATES_MAX = 20;

const CACHE_TTL_SECONDS = 7 * 86_400;
const MAX_BYTES = 512 * 1024;
const SELECTOR = /^0x[0-9a-f]{8}$/;
/** A canonical signature: an identifier, then a parenthesised type list. Anything else is not stored. */
const SIGNATURE = /^[A-Za-z_$][A-Za-z0-9_$]{0,99}\([A-Za-z0-9_,()[\]]{0,400}\)$/;

const entrySchema = z.object({
  name: z.string(),
  filtered: z.boolean().nullish(),
  hasVerifiedContract: z.boolean().nullish(),
});

const responseSchema = z.object({
  ok: z.boolean(),
  result: z
    .object({
      function: z.record(z.string(), z.array(entrySchema).nullable()).nullish(),
      event: z.record(z.string(), z.array(entrySchema).nullable()).nullish(),
    })
    .nullish(),
});

export type SignatureLookupInput = {
  /** Function selectors, `0x` + eight lower-case hex digits, at most {@link SIGNATURE_LOOKUP_BATCH}. */
  selectors: readonly string[];
  baseUrl?: string;
};

export type SignatureCandidate = {
  signature: string;
  /** The database says a verified contract somewhere declares this signature. Not this contract. */
  hasVerifiedContract: boolean;
};

/** Per selector: its candidates (possibly none). A selector missing from the answer is absent, not "none". */
export type SignatureLookup = Map<string, SignatureCandidate[]>;

export function normalizeSignatureLookup(raw: z.infer<typeof responseSchema>, selectors: readonly string[]): SignatureLookup {
  const out: SignatureLookup = new Map();
  const answered = raw.result?.function ?? {};
  for (const selector of selectors) {
    if (!Object.prototype.hasOwnProperty.call(answered, selector)) continue;
    const entries = answered[selector] ?? [];
    const seen = new Set<string>();
    const candidates: SignatureCandidate[] = [];
    for (const entry of entries) {
      const signature = entry.name.trim();
      // Filtered entries are the database's own spam marks; asked with filter=true they should not appear at all.
      if (entry.filtered === true || !SIGNATURE.test(signature) || seen.has(signature)) continue;
      seen.add(signature);
      candidates.push({ signature, hasVerifiedContract: entry.hasVerifiedContract === true });
      if (candidates.length >= SIGNATURE_CANDIDATES_MAX) break;
    }
    out.set(selector, candidates);
  }
  return out;
}

export function createSignatureLookupAdapter(): SourceAdapter<SignatureLookupInput, SignatureLookup> {
  return {
    name: 'sourcify-4byte',

    canHandle(input) {
      return input.selectors.length > 0 && input.selectors.length <= SIGNATURE_LOOKUP_BATCH && input.selectors.every((selector) => SELECTOR.test(selector));
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<SignatureLookup>> {
      const base = (input.baseUrl ?? SIGNATURE_DATABASE_BASE_URL).replace(/\/$/, '');
      const selectors = [...new Set(input.selectors)].sort();
      const url = `${base}/signature-database/v1/lookup?function=${selectors.join(',')}&filter=true`;
      return performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' }, allowedContentTypes: ['application/json'], maxBytes: MAX_BYTES },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw, response) => {
            sameOrigin(url, response);
            if (!raw.ok) throw new SourceError('INVALID_RESPONSE', 'the signature database answered ok=false');
            return normalizeSignatureLookup(raw, selectors);
          },
        },
      );
    },
  };
}
