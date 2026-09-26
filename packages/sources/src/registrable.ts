/**
 * The registrable domain of a host (2026-09-17).
 *
 * Last-two-labels is right for `.com`/`.io`/`.fi`; under a multi-part public
 * suffix (`.co.uk`, `.com.au`, …) the last two labels are the suffix itself,
 * and every two sites under it compared equal — in the same-site rule for
 * feeds, in repository matching and in docs-link attribution, three copies of
 * the same mistake. One copy now, here, where every package can reach it.
 */
const MULTI_PART_SUFFIXES = [
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'net.nz',
  'com.br', 'net.br', 'org.br',
  'co.in', 'net.in', 'org.in', 'ac.in',
  'co.za', 'org.za',
  'com.sg', 'com.hk', 'com.tw', 'com.cn', 'net.cn', 'org.cn',
  'co.kr', 'or.kr',
  'com.mx', 'com.ar', 'com.tr', 'com.my', 'co.id', 'co.th', 'com.vn', 'com.ph',
  'co.il', 'org.il', 'com.eg', 'com.ng', 'co.ke',
] as const;

/**
 * Shared-hosting suffixes (2026-09-27, audit G finding 2 / S8): hosts under
 * which every subdomain is a different customer's site — the "private"
 * section of the Public Suffix List, trimmed to the platforms builders here
 * actually deploy on, plus three site generators seen in production.
 *
 * Before this list, `layer0-robinhood.vercel.app` and `veyra-sigma-ten.vercel.app`
 * had the same registrable domain, `vercel.app`, so a repository whose homepage
 * was any Vercel site counted as pointing back at every Vercel project: 9 of the
 * 12 reciprocal repository matches on shared hosts in production named another
 * tenant, all of them official on Verified Builder pages. The tenant is the
 * site now: `foo.vercel.app` is its own registrable domain, and the bare
 * `vercel.app` is a suffix that matches nothing.
 *
 * Adding a suffix only ever makes matching stricter (two tenants stop comparing
 * equal); it never joins two sites that were apart. Keep entries lower-case,
 * without a leading dot.
 */
export const SHARED_HOSTING_SUFFIXES = [
  // Static and app hosting
  'vercel.app', 'now.sh', 'netlify.app', 'netlify.com', 'pages.dev', 'workers.dev',
  'github.io', 'gitlab.io', 'codeberg.page', 'web.app', 'firebaseapp.com',
  'onrender.com', 'herokuapp.com', 'up.railway.app', 'fly.dev', 'deno.dev',
  'replit.app', 'repl.co', 'glitch.me', 'surge.sh', 'amplifyapp.com',
  'azurewebsites.net', 'azurestaticapps.net', 'cloudfront.net', 'appspot.com',
  'streamlit.app', 'hf.space', 'pythonanywhere.com', 'ngrok-free.app', 'ngrok.io',
  'ngrok.app', 'trycloudflare.com', 'bolt.host', 'stackblitz.io',
  // Site builders and no-code
  'lovable.app', 'lovableproject.com', 'framer.website', 'framer.app', 'framer.ai',
  'framer.media', 'webflow.io', 'wixsite.com', 'carrd.co', 'notion.site',
  'softr.app', 'typedream.app', 'bubbleapps.io', 'myshopify.com', 'squarespace.com',
  // Docs and blogs
  'gitbook.io', 'readthedocs.io', 'mintlify.app', 'hashnode.dev', 'substack.com',
  'blogspot.com', 'wordpress.com', 'medium.com',
  // Web3 gateways and hosting
  'eth.limo', 'eth.link', 'fleek.co', 'on.fleek.co', '4everland.app',
  // Site generators observed in production (2026-09-27): distinct, unrelated tokens per subdomain
  'gitlawb.app', 'gitlawb.org', 'onchaincoin.lol',
] as const;

const SUFFIXES: ReadonlySet<string> = new Set<string>([...MULTI_PART_SUFFIXES, ...SHARED_HOSTING_SUFFIXES]);

/** Longest known suffix any host can end with, in labels; bounds the lookup. */
const MAX_SUFFIX_LABELS = Math.max(...[...SUFFIXES].map((suffix) => suffix.split('.').length));

const labelsOf = (host: string): string[] =>
  host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '').split('.').filter(Boolean);

/** The public or shared-hosting suffix a host sits under (longest match), or its last label. */
function suffixLabels(labels: readonly string[]): number {
  for (let take = Math.min(MAX_SUFFIX_LABELS, labels.length); take >= 2; take -= 1) {
    if (SUFFIXES.has(labels.slice(-take).join('.'))) return take;
  }
  return 1;
}

/** The registrable domain of a host, or undefined for a host that is only a suffix. */
export function registrableHost(host: string): string | undefined {
  const labels = labelsOf(host);
  const take = suffixLabels(labels) + 1;
  if (labels.length < take) return undefined;
  return labels.slice(-take).join('.');
}

/**
 * The shared-hosting suffix a host is a tenant of (`vercel.app` for
 * `foo.vercel.app`), or undefined for a host on its own domain. For callers
 * that need to say why two sites on one platform are not one site.
 */
export function sharedHostingSuffix(host: string): string | undefined {
  const labels = labelsOf(host);
  for (let take = Math.min(MAX_SUFFIX_LABELS, labels.length); take >= 2; take -= 1) {
    const suffix = labels.slice(-take).join('.');
    if ((SHARED_HOSTING_SUFFIXES as readonly string[]).includes(suffix)) return suffix;
  }
  return undefined;
}
