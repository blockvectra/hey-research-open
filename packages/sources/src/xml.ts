import { XMLParser } from 'fast-xml-parser';

/**
 * The one XML parser configuration for documents strangers publish — feeds
 * today, sitemaps and site manifests when they are read (2026-09-27, audit G
 * S9, brief §47).
 *
 * The limits used to be whatever `fast-xml-parser` defaulted to, so a
 * dependency bump could have loosened them without a line changing here. They
 * are pinned now, and `xml.test.ts` holds them:
 *
 * - **Entities off.** No entity a document declares is expanded, and neither
 *   are the five XML ones: a `<!DOCTYPE>` full of `<!ENTITY>` (billion laughs,
 *   quadratic blow-up) is inert text. Text is decoded afterwards by
 *   `decodeEntities`, which knows a fixed set of named entities and clamps
 *   numeric ones, and cannot expand anything recursively.
 * - **Declaration caps** in case processing is ever switched back on: at most
 *   64 declared entities of at most 1 KB each, one level deep, one expansion.
 * - **Depth:** 64 nested elements. A feed is five deep; an Atom entry with
 *   XHTML content a few more.
 * - **Size:** `MAX_XML_CHARS` characters, checked before parsing. The HTTP
 *   client already stops reading at the adapter's byte cap; this holds for a
 *   caller that got its text some other way.
 */
export const MAX_XML_CHARS = 2 * 1024 * 1024;

export const XML_PARSER_LIMITS = {
  maxNestedTags: 64,
  processEntities: {
    enabled: false,
    maxEntityCount: 64,
    maxEntitySize: 1024,
    maxExpansionDepth: 1,
    maxTotalExpansions: 1,
    maxExpandedLength: 1024,
  },
  htmlEntities: false,
} as const;

export class XmlTooLargeError extends Error {
  constructor(chars: number, cap: number) {
    super(`document is ${chars} characters (cap ${cap})`);
    this.name = 'XmlTooLargeError';
  }
}

export function createBoundedXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    maxNestedTags: XML_PARSER_LIMITS.maxNestedTags,
    processEntities: { ...XML_PARSER_LIMITS.processEntities },
    htmlEntities: XML_PARSER_LIMITS.htmlEntities,
  });
}

const shared = createBoundedXmlParser();

/** Parse a stranger's XML under the pinned limits; throws on oversize, depth or malformed input. */
export function parseBoundedXml(body: string, maxChars: number = MAX_XML_CHARS): Record<string, unknown> {
  if (body.length > maxChars) throw new XmlTooLargeError(body.length, maxChars);
  return shared.parse(body) as Record<string, unknown>;
}
