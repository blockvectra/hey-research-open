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
 */
const MONOGRAM_PALETTE = [
  'bg-midnight-800 text-white',
  'bg-blue-600 text-white',
  'bg-midnight-700 text-white',
  'bg-blue-500 text-white',
  'bg-midnight-850 text-white',
  'bg-narrative-infra text-white',
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

export function ProjectLogo({
  name,
  slug,
  logoUrl,
  size = 40,
  className,
}: {
  name: string;
  slug: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const shared = 'shrink-0 overflow-hidden rounded-[6px]';

  const monogram = (
    <span
      aria-hidden="true"
      className={cn(
        shared,
        'inline-flex items-center justify-center font-semibold tracking-tight',
        MONOGRAM_PALETTE[paletteIndex(slug)],
        !logoUrl && className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {monogramOf(name)}
    </span>
  );

  if (logoUrl) {
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
       * sees a failed load. A logo whose host is not proxied still can.
       */
      <span
        className={cn(shared, 'relative inline-block bg-hey-subtle', className)}
        style={{ width: size, height: size }}
      >
        {monogram}
        <img
          src={logoUrl}
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
