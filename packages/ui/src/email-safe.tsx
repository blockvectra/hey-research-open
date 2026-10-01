import { Fragment, type ReactNode } from 'react';

/**
 * Text that Cloudflare must not rewrite as an e-mail address (2026-10-01).
 *
 * Cloudflare's e-mail obfuscation scans the HTML at the edge and replaces
 * anything shaped like `name@host` with a `[email protected]` link plus a
 * decoder script. A package version on HEY Signal — `@artblocks/
 * abx-token-api@0.2.1` — has that shape, so the server's HTML reached the
 * browser changed, React's hydration found different text (minified error
 * #418 on /signals in production), and the CSP blocked the decoder, leaving
 * "[email protected]" on the page.
 *
 * A `<wbr>` after an `@` that sits between two non-space characters breaks
 * the pattern for the edge's scanner without changing what a reader sees or
 * copies, and the server and the client render it identically. Plain text in,
 * nodes out; a string without such an `@` comes back as itself.
 */
const INNER_AT = /(?<=\S)@(?=\S)/g;

export function emailSafe(text: string | null | undefined): ReactNode {
  if (!text || !text.includes('@')) return text ?? null;
  const parts = text.split(INNER_AT);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? (
        <>
          @<wbr />
        </>
      ) : null}
    </Fragment>
  ));
}
