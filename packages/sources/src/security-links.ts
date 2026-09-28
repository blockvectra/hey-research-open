import { registrableHost } from './registrable';

/**
 * Security-evidence links, by their shape alone (2026-09-28, brief §17–18).
 *
 * The strict allow-list the harvester's link collector and the security
 * context read: which URLs are an audit report on a known auditor's own host,
 * which are a bug-bounty program on a known platform, and which are an audit
 * or bounty page on the project's own site. Nothing else is kept — no generic
 * link hoarding (SECURITY_COVERAGE.md).
 *
 * Read from the host and path only, never from anchor text or the page's
 * words: "audited by CertiK" on a page is not a CertiK report. A URL is never
 * fetched because it matched here; a PDF is linked, never read.
 *
 * Every pattern is the firm's own published URL form, checked on 2026-09-28
 * (for example `skynet.certik.com/projects/<name>`,
 * `www.halborn.com/audits/<org>/<report>`, `cantina.xyz/portfolio/<uuid>`,
 * `cantina.xyz/bounties/<uuid>`, `hackenproof.com/programs/<name>`,
 * `www.openzeppelin.com/news/<name>-audit`). A firm whose reports live in
 * its clients' repositories (OtterSec, for one) has no host here: such a
 * report is on the project's host, and a file name that names the firm is
 * recorded as that, never as the firm's publication.
 */

export type SecurityLinkKind = 'AUDIT' | 'BUG_BOUNTY';
/** Whose host the document is on: the auditor's, a bounty platform's, or the project's own site or repository. */
export type SecurityLinkHost = 'AUDITOR' | 'BOUNTY_PLATFORM' | 'PROJECT';

export type SecurityLink = {
  kind: SecurityLinkKind;
  hostedBy: SecurityLinkHost;
  /** The auditor or platform, when the host names it or the URL's path does. */
  firm?: string;
  /** How `firm` was read: the host is the firm's, or only a path segment names it. */
  firmBasis?: 'HOST' | 'URL_PATH';
};

type HostRule = {
  host: string;
  /** A path prefix (lower-case) the URL must start with, beyond which at least one more segment must follow. */
  prefix: string;
  /** Extra condition on the lower-cased path. */
  pathTest?: RegExp;
  kind: SecurityLinkKind;
  firm: string;
};

/** Auditors' and bounty platforms' own hosts. Exact host (without `www.`), path prefix, and a segment after it. */
const HOST_RULES: readonly HostRule[] = [
  // Audit reports on the auditor's own host.
  { host: 'skynet.certik.com', prefix: '/projects/', kind: 'AUDIT', firm: 'CertiK' },
  { host: 'certik.com', prefix: '/projects/', kind: 'AUDIT', firm: 'CertiK' },
  { host: 'hacken.io', prefix: '/audits/', kind: 'AUDIT', firm: 'Hacken' },
  { host: 'audits.hacken.io', prefix: '/', kind: 'AUDIT', firm: 'Hacken' },
  { host: 'code4rena.com', prefix: '/reports/', kind: 'AUDIT', firm: 'Code4rena' },
  { host: 'code4rena.com', prefix: '/audits/', kind: 'AUDIT', firm: 'Code4rena' },
  { host: 'audits.sherlock.xyz', prefix: '/contests/', kind: 'AUDIT', firm: 'Sherlock' },
  { host: 'app.sherlock.xyz', prefix: '/audits/', kind: 'AUDIT', firm: 'Sherlock' },
  { host: 'cantina.xyz', prefix: '/portfolio/', kind: 'AUDIT', firm: 'Cantina' },
  { host: 'cantina.xyz', prefix: '/competitions/', kind: 'AUDIT', firm: 'Cantina' },
  { host: 'codehawks.cyfrin.io', prefix: '/c/', kind: 'AUDIT', firm: 'Cyfrin CodeHawks' },
  { host: 'blog.openzeppelin.com', prefix: '/', pathTest: /audit/, kind: 'AUDIT', firm: 'OpenZeppelin' },
  { host: 'openzeppelin.com', prefix: '/news/', pathTest: /audit/, kind: 'AUDIT', firm: 'OpenZeppelin' },
  { host: 'consensys.io', prefix: '/diligence/audits/', kind: 'AUDIT', firm: 'Consensys Diligence' },
  { host: 'consensys.net', prefix: '/diligence/audits/', kind: 'AUDIT', firm: 'Consensys Diligence' },
  { host: 'diligence.consensys.net', prefix: '/audits/', kind: 'AUDIT', firm: 'Consensys Diligence' },
  { host: 'certificate.quantstamp.com', prefix: '/', kind: 'AUDIT', firm: 'Quantstamp' },
  { host: 'reports.zellic.io', prefix: '/', kind: 'AUDIT', firm: 'Zellic' },
  { host: 'halborn.com', prefix: '/audits/', kind: 'AUDIT', firm: 'Halborn' },
  { host: 'chainsecurity.com', prefix: '/security-audit/', kind: 'AUDIT', firm: 'ChainSecurity' },
  { host: 'dedaub.com', prefix: '/audits/', kind: 'AUDIT', firm: 'Dedaub' },
  { host: 'immunefi.com', prefix: '/audit-competition/', kind: 'AUDIT', firm: 'Immunefi' },
  // Bug-bounty programs on the platform's own host.
  { host: 'immunefi.com', prefix: '/bug-bounty/', kind: 'BUG_BOUNTY', firm: 'Immunefi' },
  { host: 'immunefi.com', prefix: '/bounty/', kind: 'BUG_BOUNTY', firm: 'Immunefi' },
  { host: 'hackenproof.com', prefix: '/programs/', kind: 'BUG_BOUNTY', firm: 'HackenProof' },
  { host: 'code4rena.com', prefix: '/bounties/', kind: 'BUG_BOUNTY', firm: 'Code4rena' },
  { host: 'cantina.xyz', prefix: '/bounties/', kind: 'BUG_BOUNTY', firm: 'Cantina' },
];

/** Auditors' own public report repositories on GitHub: `owner/repo`, lower-case. */
const GITHUB_AUDITOR_REPOS: Readonly<Record<string, string>> = {
  'spearbit/portfolio': 'Spearbit',
  'trailofbits/publications': 'Trail of Bits',
  'peckshield/publications': 'PeckShield',
  'zellic/publications': 'Zellic',
  'cyfrin/cyfrin-audit-reports': 'Cyfrin',
  'sherlock-protocol/sherlock-reports': 'Sherlock',
  'pashov/audits': 'Pashov Audit Group',
  'solidified-platform/audits': 'Solidified',
  'guardianaudits/audits': 'Guardian',
  'zokyo-sec/audit-reports': 'Zokyo',
  'mixbytes/audits_public': 'MixBytes',
  'oak-security/audit-reports': 'Oak Security',
  'nethermindeth/publicauditreports': 'Nethermind',
  'sigp/public-audits': 'Sigma Prime',
  'runtimeverification/publications': 'Runtime Verification',
  'ackee-blockchain/public-audit-reports': 'Ackee Blockchain',
};

/**
 * Firm names a path segment may carry (`…/audits/cyfrin-2024.pdf`). Only ever
 * `firmBasis: 'URL_PATH'`: a file name is what the project called its file,
 * not the firm's publication.
 */
const FIRM_TOKENS: readonly (readonly [RegExp, string])[] = [
  [/certik/, 'CertiK'],
  [/hacken/, 'Hacken'],
  [/code4rena/, 'Code4rena'],
  [/sherlock/, 'Sherlock'],
  [/cantina/, 'Cantina'],
  [/spearbit/, 'Spearbit'],
  [/trail-?of-?bits|trailofbits/, 'Trail of Bits'],
  [/openzeppelin/, 'OpenZeppelin'],
  [/consensys|diligence/, 'Consensys Diligence'],
  [/quantstamp/, 'Quantstamp'],
  [/peckshield/, 'PeckShield'],
  [/zellic/, 'Zellic'],
  [/otter-?sec/, 'OtterSec'],
  [/halborn/, 'Halborn'],
  [/cyfrin/, 'Cyfrin'],
  [/pashov/, 'Pashov Audit Group'],
  [/zokyo/, 'Zokyo'],
  [/mixbytes/, 'MixBytes'],
  [/chainsecurity/, 'ChainSecurity'],
  [/sigma-?prime/, 'Sigma Prime'],
  [/dedaub/, 'Dedaub'],
  [/guardian/, 'Guardian'],
  [/secure3/, 'Secure3'],
  [/zksecurity/, 'zkSecurity'],
  [/cyberscope/, 'Cyberscope'],
];

/** A same-site path segment that names an audit page or report: `/audit`, `/audits`, `/audit-reports`, `/security/audits`, `…-audit.pdf`. */
const AUDIT_SEGMENT = /^(audits?|audit-?reports?|security-?audits?)$|audit[^/]*\.pdf$/;
/** A same-site bounty page: `/bug-bounty`, `/bugbounty`, `/bounty`, `/security/bug-bounty`. */
const BOUNTY_SEGMENT = /^(bug-?bounty|bug-?bounties|bounty|bounties|bug-?bounty-?program)$/;

const MAX_URL_LENGTH = 500;

function parse(url: string): URL | undefined {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    if (parsed.username || parsed.password) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

const hostOf = (parsed: URL): string => parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

function firmInPath(path: string): string | undefined {
  for (const [pattern, firm] of FIRM_TOKENS) if (pattern.test(path)) return firm;
  return undefined;
}

function sameSite(host: string, siteUrl: string | undefined): boolean {
  if (!siteUrl) return false;
  const site = parse(siteUrl);
  if (!site) return false;
  const a = registrableHost(host);
  return a !== undefined && a === registrableHost(hostOf(site));
}

/**
 * The security-evidence reading of a link, or undefined for any link that is
 * not one. `siteUrl` is the project's declared site: an audit or bounty *path*
 * counts only on it (or on the project's GitHub, which the caller already
 * holds as found on the site). An auditor or platform host counts wherever the
 * link was found; who linked it is the caller's provenance, not this.
 */
export function classifySecurityLink(url: string, siteUrl?: string): SecurityLink | undefined {
  const parsed = parse(url);
  if (!parsed) return undefined;
  const host = hostOf(parsed);
  const path = decodeSafe(parsed.pathname).toLowerCase();
  const segments = path.split('/').filter(Boolean);

  for (const rule of HOST_RULES) {
    if (host !== rule.host) continue;
    if (!path.startsWith(rule.prefix)) continue;
    const rest = path.slice(rule.prefix.length).split('/').filter(Boolean);
    if (rest.length === 0) continue;
    if (rule.pathTest && !rule.pathTest.test(path)) continue;
    return { kind: rule.kind, hostedBy: rule.kind === 'AUDIT' ? 'AUDITOR' : 'BOUNTY_PLATFORM', firm: rule.firm, firmBasis: 'HOST' };
  }

  if (host === 'github.com') {
    const [owner, repo] = segments;
    if (!owner || !repo) return undefined;
    const auditor = GITHUB_AUDITOR_REPOS[`${owner}/${repo.replace(/\.git$/, '')}`];
    // An auditor's portfolio repository: only a path inside it names one report; the bare repository is its index.
    if (auditor) return segments.length > 2 ? { kind: 'AUDIT', hostedBy: 'AUDITOR', firm: auditor, firmBasis: 'HOST' } : undefined;
    // A repository path with an audit segment on a project's page: the project's own claim, hosted where it chose.
    const rest = segments.slice(1);
    if (rest.some((segment) => AUDIT_SEGMENT.test(segment) || /(^|[-_])audits?([-_]|$)/.test(segment))) {
      const firm = firmInPath(segments.slice(2).join('/'));
      return { kind: 'AUDIT', hostedBy: 'PROJECT', ...(firm ? { firm, firmBasis: 'URL_PATH' as const } : {}) };
    }
    return undefined;
  }

  if (!sameSite(host, siteUrl)) return undefined;
  if (segments.some((segment) => BOUNTY_SEGMENT.test(segment))) return { kind: 'BUG_BOUNTY', hostedBy: 'PROJECT' };
  if (segments.some((segment) => AUDIT_SEGMENT.test(segment))) {
    const firm = firmInPath(path);
    return { kind: 'AUDIT', hostedBy: 'PROJECT', ...(firm ? { firm, firmBasis: 'URL_PATH' as const } : {}) };
  }
  return undefined;
}

/**
 * The key one security document is counted by. A report file (a PDF) or a
 * page on an auditor's or platform's host is itself; a page on the project's
 * own site is its audit or bounty section — `docs.x.io/security/audits` and
 * every page under it are one claim, so a sitemap listing forty audit pages
 * is not forty audits. Host without `www.`, lower-cased, no query or fragment.
 * Never a URL to fetch: a key, which may name a page that does not exist.
 */
export function securityLinkRoot(url: string, siteUrl?: string): string | undefined {
  const link = classifySecurityLink(url, siteUrl);
  const parsed = parse(url);
  if (!link || !parsed) return undefined;
  const host = hostOf(parsed);
  const segments = decodeSafe(parsed.pathname).toLowerCase().split('/').filter(Boolean);
  const isFile = /\.pdf$/.test(segments[segments.length - 1] ?? '');
  if (link.hostedBy !== 'PROJECT' || isFile) return `${host}/${segments.join('/')}`;
  const pattern = link.kind === 'AUDIT' ? AUDIT_SEGMENT : BOUNTY_SEGMENT;
  const at = segments.findIndex((segment) => pattern.test(segment) || (host === 'github.com' && /(^|[-_])audits?([-_]|$)/.test(segment)));
  return `${host}/${(at >= 0 ? segments.slice(0, at + 1) : segments).join('/')}`;
}

function decodeSafe(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The host rules, for documentation and tests: `host + prefix` per firm. */
export const SECURITY_HOST_ALLOW_LIST: readonly { host: string; prefix: string; kind: SecurityLinkKind; firm: string }[] = [
  ...HOST_RULES.map(({ host, prefix, kind, firm }) => ({ host, prefix, kind, firm })),
  ...Object.entries(GITHUB_AUDITOR_REPOS).map(([repo, firm]) => ({ host: 'github.com', prefix: `/${repo}/`, kind: 'AUDIT' as const, firm })),
];
