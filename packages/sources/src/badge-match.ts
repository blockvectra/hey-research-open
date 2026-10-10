import { decodeEntities } from './html';

/**
 * Whether a page or a README shows one project's HEY badge (2026-10-09, founder
 * ruling "buat halaman berasingan tu"; docs/EMBEDS.md, "Projects showing their
 * badge").
 *
 * A badge request cannot say which site or repository embedded it, and anyone
 * can embed anyone's badge, so HEY lists a placement only when it finds the
 * badge itself on the project's own official source. This is the one reading
 * of "finds": a link or an image whose URL is HEY's badge image
 * (`<origin>/api/badge/<slug>`, any query such as `theme` or `style`) or the
 * badge page (`<origin>/badge/<slug>`, the iframe and its link), for one of
 * the project's own slugs, its current slug or one that still redirects to it.
 * Another project's badge on the same page is not this project's placement.
 *
 * What a reader cannot see is not a placement, so it is removed before
 * matching: an HTML comment; a `<script>`, `<style>`, `<template>`,
 * `<textarea>`, `<pre>` or `<code>` element (a page showing the snippet as code
 * has not placed it); and in a README, a fenced or inline code span. In HTML
 * only a URL in an `href`, `src`, `srcset` or `data-src` attribute counts, never
 * text; in a README any URL outside code counts, because GitHub renders a
 * Markdown link, an image, a reference definition, inline HTML and a bare URL
 * alike as a link or an image.
 *
 * Every scan is linear in the body: delimiters are found with `indexOf` and
 * every pattern is bounded, so a hostile page cannot make the check expensive.
 */
export type BadgeTarget = {
  /** HEY's own origin, from `APP_URL` — never a host written into the logic. */
  origin: string;
  /** The project's slugs: its current slug and any old slug that redirects to it. */
  slugs: readonly string[];
};

export type BadgeBodyKind = 'html' | 'readme';

export type BadgeMatch = { found: true; url: string } | { found: false };

/** ASCII-only lower case: the same length as the input, so indices found in it hold in the original. */
const asciiLower = (value: string): string => value.replace(/[A-Z]+/g, (run) => run.toLowerCase());

/** Remove every `open … close` span, scanning once. An unclosed span runs to the end. */
function stripSpans(value: string, open: string, close: string, lowered: string = asciiLower(value)): string {
  const parts: string[] = [];
  let position = 0;
  for (;;) {
    const start = lowered.indexOf(open, position);
    if (start === -1) break;
    parts.push(value.slice(position, start), ' ');
    const end = lowered.indexOf(close, start + open.length);
    if (end === -1) return parts.join('');
    position = end + close.length;
  }
  parts.push(value.slice(position));
  return parts.join('');
}

/** Elements whose content a reader never sees as a placed link or image. */
const HIDDEN_ELEMENTS = ['script', 'style', 'template', 'textarea', 'pre', 'code'] as const;

function stripHiddenHtml(value: string): string {
  let out = stripSpans(value, '<!--', '-->');
  for (const element of HIDDEN_ELEMENTS) {
    const lowered = asciiLower(out);
    // `<code` would also open `<codex>`; an element name ends at whitespace, `>` or `/`.
    const parts: string[] = [];
    let position = 0;
    for (;;) {
      let start = lowered.indexOf(`<${element}`, position);
      while (start !== -1 && !/[\s>/]/.test(lowered.charAt(start + element.length + 1))) start = lowered.indexOf(`<${element}`, start + 1);
      if (start === -1) break;
      parts.push(out.slice(position, start), ' ');
      const end = lowered.indexOf(`</${element}`, start + element.length + 1);
      if (end === -1) {
        position = out.length;
        break;
      }
      const closeEnd = lowered.indexOf('>', end);
      position = closeEnd === -1 ? out.length : closeEnd + 1;
    }
    parts.push(out.slice(position));
    out = parts.join('');
  }
  return out;
}

/** A README without its HTML comments, fenced code blocks and inline code spans. */
function stripHiddenReadme(value: string): string {
  const withoutComments = stripHiddenHtml(value);
  const lines = withoutComments.split('\n');
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of lines) {
    const marker = /^[ ]{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    // Inline code: a single-backtick span on one line (bounded, linear).
    kept.push(line.replace(/`[^`\n]{0,2048}`/g, ' '));
  }
  return kept.join('\n');
}

/** Attribute values that place a link or an image. Bounded, so an unclosed quote costs one bounded scan. */
const PLACING_ATTRIBUTE = /\b(?:href|src|srcset|data-src)[ \t\r\n]{0,8}=[ \t\r\n]{0,8}(?:"([^"]{0,4096})"|'([^']{0,4096})'|([^\s"'<>`]{1,4096}))/gi;

/** Every absolute or protocol-relative URL in a text; bounded per match. */
const URL_IN_TEXT = /(?:https?:)?\/\/[^\s"'<>()[\]`{}|\\^]{1,2048}/gi;

/**
 * The badge image or page path, with the slug captured: `/api/badge/<slug>`, `/badge/<slug>`, and
 * the documented image form `/badge/<slug>.svg` (docs/BADGES.md, HEY's own README) — all three serve
 * this project's badge — and the embed widget's frame `/embed/project/<slug>` (2026-10-10, adoption brief §17:
 * the widget is the badge's richer form, docs/EMBEDS.md). A widget named by contract (`<chain>:0x…`) is not
 * matched: the matcher holds slugs only.
 */
const BADGE_PATH = /^\/(?:api\/badge\/([a-z0-9-]{1,120})|badge\/([a-z0-9-]{1,120})(?:\.svg)?|embed\/project\/([a-z0-9-]{1,120}))\/?$/;

function matchesTarget(raw: string, host: string, slugs: ReadonlySet<string>): boolean {
  let value = decodeEntities(raw.trim());
  if (value.startsWith('//')) value = `https:${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.host.toLowerCase() !== host) return false;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return false;
  }
  const found = BADGE_PATH.exec(path);
  const slug = found?.[1] ?? found?.[2] ?? found?.[3];
  return slug !== undefined && slugs.has(slug);
}

function targetParts(target: BadgeTarget): { host: string; slugs: Set<string> } | undefined {
  let host: string;
  try {
    host = new URL(target.origin).host.toLowerCase();
  } catch {
    return undefined;
  }
  const slugs = new Set(target.slugs.map((slug) => slug.trim().toLowerCase()).filter((slug) => /^[a-z0-9-]{1,120}$/.test(slug)));
  if (!host || slugs.size === 0) return undefined;
  return { host, slugs };
}

/**
 * Find this project's badge in a page (`html`) or a README (`readme`, Markdown
 * with inline HTML). Pure; the first matching URL is returned for the record.
 */
export function findBadgePlacement(body: string, kind: BadgeBodyKind, target: BadgeTarget): BadgeMatch {
  const parts = targetParts(target);
  if (!parts) return { found: false };
  const visible = kind === 'readme' ? stripHiddenReadme(body) : stripHiddenHtml(body);

  const candidates: string[] = [];
  if (kind === 'html') {
    for (const match of visible.matchAll(PLACING_ATTRIBUTE)) {
      const value = match[1] ?? match[2] ?? match[3] ?? '';
      // `srcset` lists candidates separated by commas, each with a descriptor.
      for (const piece of value.split(',')) candidates.push(piece.trim().split(/\s+/)[0] ?? '');
    }
  } else {
    // A bare URL ending a sentence keeps its full stop out of the path.
    for (const match of visible.matchAll(URL_IN_TEXT)) candidates.push(match[0].replace(/[.,;:!?*_~]+$/, ''));
  }
  for (const candidate of candidates) {
    if (candidate && matchesTarget(candidate, parts.host, parts.slugs)) return { found: true, url: decodeEntities(candidate.trim()) };
  }
  if (kind === 'html') {
    const widget = webComponentPlacement(body, visible, parts.host, parts.slugs);
    if (widget) return { found: true, url: widget };
  }
  return { found: false };
}

/** The Web Component's element, `<hey-project project="slug">`; bounded per tag. */
const WEB_COMPONENT = /<hey-project\b[^>]{0,1024}?\bproject[ \t\r\n]{0,8}=[ \t\r\n]{0,8}(?:"([^"]{1,120})"|'([^']{1,120})'|([a-z0-9-]{1,120}))/gi;

/**
 * The embed widget as its Web Component (2026-10-10, `htmlSnippet` in apps/web's embed snippets): a visible
 * `<hey-project project="<slug>">` element on a page that loads HEY's own `/embed/hey-project.js`. The script
 * element is hidden text, so the loader is looked for in the raw page; the element must be visible.
 */
function webComponentPlacement(body: string, visible: string, host: string, slugs: ReadonlySet<string>): string | undefined {
  const lowered = asciiLower(body);
  const loader = `${host}/embed/hey-project.js`;
  if (!lowered.includes(`//${loader}`)) return undefined;
  for (const match of visible.matchAll(WEB_COMPONENT)) {
    const slug = decodeEntities((match[1] ?? match[2] ?? match[3] ?? '').trim()).toLowerCase();
    if (slugs.has(slug)) return `https://${loader}#project=${slug}`;
  }
  return undefined;
}
