import { cn } from './cn';

/**
 * Project identity mark (UI/UX V4 sections 15, 16).
 *
 * A project's logo is identity, not an icon, so it never comes from a Lucide
 * set. When no verified logo exists HEY draws a monogram rather than inventing
 * imagery: generated coin art or a random avatar would attach a visual identity
 * the project never chose, and on a research product that is a small lie.
 *
 * The colour is derived from the project's own slug, so it is stable across
 * renders and deployments, and it is picked from a controlled brand-adjacent
 * palette — never random neon.
 *
 * Every tile carries white initials at 4.5:1 or better (2026-10-22, audit WEB-9): Research Blue 500 (3.6:1)
 * gave way to Midnight 900, and the infrastructure violet (4.4:1) to the same violet darkened (5.8:1). The
 * order is kept, so a project keeps its tile's place in the palette.
 */
export const MONOGRAM_PALETTE = [
  'bg-midnight-800 text-white',
  'bg-blue-600 text-white',
  'bg-midnight-700 text-white',
  'bg-midnight-900 text-white',
  'bg-midnight-850 text-white',
  'bg-[#6454c8] text-white',
] as const;

/** Deterministic: the same project always gets the same colour. */
function paletteIndex(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % MONOGRAM_PALETTE.length;
}

/** At most two initials, taken from real words rather than punctuation. */
export function monogramOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${(words[0] ?? '').charAt(0)}${(words[1] ?? '').charAt(0)}`.toUpperCase();
}

/**
 * A logo a reader's browser may load (FE-5, 2026-10-12): a same-origin path —
 * HEY's logo proxy (`/api/logo?…`) or HEY's own asset — or inline image data.
 * Anything else would have the reader's browser contact a host HEY has not
 * vetted, a project owner's own server among them, which learns the reader's
 * address and can swap the image at will; the monogram is drawn instead. The
 * web layer decides which hosts are proxied; this is the fail-safe for a
 * page that forgets to ask it.
 */
export function isDrawableLogo(url: string | null | undefined): url is string {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
}

export function ProjectLogo({
  name,
  slug,
  logoUrl,
  size = 40,
  className,
  tone = 'palette',
}: {
  name: string;
  slug: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
  /**
   * `neutral` draws the monogram in the page's own ink on its subtle well (V2 phase 3): at a large size the palette's
   * saturated tile became the loudest colour on the page — a placeholder outshining the project's facts.
   */
  tone?: 'palette' | 'neutral';
}) {
  const shared = 'shrink-0 overflow-hidden rounded-[6px]';
  const drawable = isDrawableLogo(logoUrl) ? logoUrl : undefined;

  const monogram = (
    <span
      aria-hidden="true"
      className={cn(
        shared,
        'inline-flex items-center justify-center font-semibold tracking-tight',
        tone === 'neutral' ? 'border border-hey-border bg-hey-subtle text-hey-ink' : MONOGRAM_PALETTE[paletteIndex(slug)],
        !drawable && className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {monogramOf(name)}
    </span>
  );

  if (drawable) {
    return (
      /*
       * The image sits on top of the monogram, so a logo that cannot be had
       * leaves the monogram showing with no script involved. A plain <img>:
       * @hey/ui is framework-agnostic and must not depend on next/image, and
       * project logos are remote URLs of unknown dimensions.
       *
       * This used to say that an <img> with an empty alt "paints nothing"
       * when it fails. Chrome paints its broken-image glyph instead, and for
       * a year of Virtuals artwork exported at 8000×8000 — over the proxy's
       * pixel ceiling — that glyph sat on top of a perfectly good monogram
       * (2026-09-20). What makes the fallback work is that `/api/logo`
       * answers a transparent pixel rather than a 404, so nothing here ever
       * sees a failed load. A logo whose host is not proxied is never drawn
       * (`isDrawableLogo`, FE-5 2026-10-12).
       */
      <span
        className={cn(shared, 'relative inline-block bg-hey-subtle', className)}
        style={{ width: size, height: size }}
      >
        {monogram}
        <img
          src={drawable}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </span>
    );
  }

  return monogram;
}
