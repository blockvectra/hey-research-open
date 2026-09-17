/**
 * The registrable domain of a host (2026-09-17).
 *
 * Last-two-labels is right for `.com`/`.io`/`.fi`; under a multi-part public
 * suffix (`.co.uk`, `.com.au`, …) the last two labels are the suffix itself,
 * and every two sites under it compared equal — in the same-site rule for
 * feeds, in repository matching and in docs-link attribution, three copies of
 * the same mistake. One copy now, here, where every package can reach it.
 */
const MULTI_PART_SUFFIXES = new Set([
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
]);

/** The registrable domain of a host, or undefined for a host that is only a suffix. */
export function registrableHost(host: string): string | undefined {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  const take = MULTI_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  if (labels.length < take) return undefined;
  return labels.slice(-take).join('.');
}
