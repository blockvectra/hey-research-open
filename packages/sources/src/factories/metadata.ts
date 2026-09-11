import { cleanHttpUrl, socialTypeForUrl, twitterUrlFrom, type SocialLink } from '../links';
import { opt } from '../optional';

/**
 * Creator-supplied launch metadata carried in a launch event.
 *
 * Several launchpads put a `metadataURI` string in their launch event. Two
 * shapes carry something HEY can read without another request:
 *
 * - **inline JSON** — hood.fun writes `{"description":"…","community":true}`
 *   (sometimes with a base64 `image`); Clanker's `tokenMetadata` is
 *   `{"description":"…","socialMediaUrls":[{"platform":"twitter","url":"…"}]}`.
 * - **a bare URL** — `ipfs://…` or `https://…` pointing at a JSON document.
 *
 * Only the inline shape is parsed here: reading an IPFS gateway or a
 * launchpad's metadata host for every launch would put a network request
 * into every discovered token, which is exactly the per-token fetch the
 * public-data rules keep out of bulk indexing. A URL is returned as-is so a
 * later, bounded step can decide whether it is worth a request.
 *
 * Nothing is guessed: a key that is not one of the known ones is ignored,
 * a `data:` image is dropped (it is not an address HEY can serve), and a
 * malformed document yields nothing rather than a partial reading.
 */
export type LaunchMetadata = {
  description?: string;
  websiteUrl?: string;
  imageUrl?: string;
  socials: SocialLink[];
  /** The URI when it was not inline JSON — `ipfs://…` or `https://…`. */
  metadataUrl?: string;
};

/** Inline documents longer than this are launch spam, not metadata. */
const MAX_INLINE_METADATA_BYTES = 64 * 1024;
const MAX_DESCRIPTION_LENGTH = 2_000;

const WEBSITE_KEYS = new Set(['website', 'site', 'url', 'homepage', 'web']);
const SOCIAL_KEYS: Record<string, string> = {
  x: 'twitter',
  twitter: 'twitter',
  telegram: 'telegram',
  tg: 'telegram',
  discord: 'discord',
  farcaster: 'farcaster',
  warpcast: 'farcaster',
};
const IMAGE_KEYS = new Set(['image', 'imageUrl', 'image_url', 'logo', 'icon']);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** `ipfs://` is accepted alongside http(s); `data:` and everything else is not. */
const cleanImageUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  if (/^ipfs:\/\/[A-Za-z0-9]+/.test(value)) return value;
  return cleanHttpUrl(value);
};

export function parseLaunchMetadata(uri: string | null | undefined): LaunchMetadata {
  const text = uri?.trim();
  if (!text) return { socials: [] };
  if (!text.startsWith('{')) {
    const url = cleanHttpUrl(text) ?? (/^ipfs:\/\/[A-Za-z0-9]+/.test(text) ? text : undefined);
    return { socials: [], ...opt('metadataUrl', url) };
  }
  if (text.length > MAX_INLINE_METADATA_BYTES) return { socials: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { socials: [] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { socials: [] };

  const socials: SocialLink[] = [];
  const push = (type: string, url: string | undefined) => {
    if (url && !socials.some((entry) => entry.url === url)) socials.push({ type, url });
  };

  let websiteUrl: string | undefined;
  let imageUrl: string | undefined;
  let description: string | undefined;

  for (const [rawKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    const key = rawKey.trim();
    const lower = key.toLowerCase();

    if (lower === 'description') {
      const given = asString(value);
      if (given) description = given.slice(0, MAX_DESCRIPTION_LENGTH);
      continue;
    }
    if (IMAGE_KEYS.has(key) || IMAGE_KEYS.has(lower)) {
      imageUrl ??= cleanImageUrl(asString(value));
      continue;
    }
    if (WEBSITE_KEYS.has(lower)) {
      const url = cleanHttpUrl(asString(value));
      if (!url) continue;
      const social = socialTypeForUrl(url);
      if (social) push(social, url);
      else websiteUrl ??= url;
      continue;
    }
    const socialType = SOCIAL_KEYS[lower];
    if (socialType) {
      const given = asString(value);
      if (!given) continue;
      push(socialType, socialType === 'twitter' ? twitterUrlFrom(given) : cleanHttpUrl(given));
      continue;
    }
    // Clanker: `socialMediaUrls: [{ platform, url }]`.
    if (lower === 'socialmediaurls' && Array.isArray(value)) {
      for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const url = cleanHttpUrl(asString((entry as Record<string, unknown>).url));
        if (!url) continue;
        const platform = asString((entry as Record<string, unknown>).platform)?.toLowerCase();
        const type = socialTypeForUrl(url) ?? (platform ? SOCIAL_KEYS[platform] : undefined);
        if (type) push(type, url);
        else websiteUrl ??= url;
      }
    }
  }

  return {
    socials,
    ...opt('description', description),
    ...opt('websiteUrl', websiteUrl),
    ...opt('imageUrl', imageUrl),
  };
}
