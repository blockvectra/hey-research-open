/**
 * Link hygiene shared by the listing adapters.
 *
 * Every listing source hands HEY a bag of self-declared links with inconsistent
 * labelling: DEX Screener types some and labels others, hood.dev stores a JSON
 * string whose `x` value may be a URL, a `@handle`, or a bare handle. These
 * helpers turn that into the two shapes the candidate store understands — one
 * website and a list of `{ type, url }` socials — without guessing at anything
 * the source did not say.
 */
export type SocialLink = { type: string; url: string };

/** Only absolute http(s) URLs survive; `ipfs://`, `javascript:` and junk do not. */
export const cleanHttpUrl = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const SOCIAL_HOSTS: readonly [RegExp, string][] = [
  [/(^|\.)(x|twitter)\.com$/, 'twitter'],
  [/(^|\.)t\.me$/, 'telegram'],
  [/(^|\.)telegram\.(me|org)$/, 'telegram'],
  [/(^|\.)discord\.(gg|com)$/, 'discord'],
  [/(^|\.)warpcast\.com$/, 'farcaster'],
  [/(^|\.)farcaster\.xyz$/, 'farcaster'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)youtube\.com$/, 'youtube'],
  [/(^|\.)youtu\.be$/, 'youtube'],
  [/(^|\.)medium\.com$/, 'medium'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)github\.com$/, 'github'],
];

/** The social network a URL points at, by host; `undefined` for an ordinary site. */
export const socialTypeForUrl = (url: string): string | undefined => {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return SOCIAL_HOSTS.find(([pattern]) => pattern.test(host))?.[1];
};

/**
 * An X/Twitter reference as launchpads store it: a full URL, `@handle`, or a
 * bare handle. Handles become profile URLs; anything else is left alone.
 */
export const twitterUrlFrom = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const asUrl = cleanHttpUrl(trimmed);
  if (asUrl) return asUrl;
  const handle = trimmed.replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}` : undefined;
};

/** Every absolute http(s) URL found in free text, in order, without duplicates. */
export const extractHttpUrls = (text: string): string[] => {
  const found = new Set<string>();
  for (const match of text.match(/https?:\/\/[^\s"'<>)\]},]+/g) ?? []) {
    const url = cleanHttpUrl(match);
    if (url) found.add(url);
  }
  return [...found];
};
