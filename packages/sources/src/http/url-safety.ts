/**
 * URL safety for user- and builder-submitted sources (PRD V4 sections 27, 48).
 *
 * HEY fetches URLs that strangers supply, so the crawler must not be usable to
 * reach the machine it runs on or a private network (SSRF).
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Hostnames that must never be fetched, regardless of DNS. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'instance-data',
]);

export type UrlSafetyFailure =
  'INVALID_URL' | 'UNSUPPORTED_PROTOCOL' | 'PRIVATE_HOST' | 'BLOCKED_HOST' | 'CREDENTIALS_IN_URL';

export type UrlSafetyResult =
  { ok: true; url: URL } | { ok: false; reason: UrlSafetyFailure; detail: string };

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;

  const [a = 0, b = 0] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this" network
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast and reserved
  return false;
};

/**
 * IPv4-mapped IPv6, e.g. `::ffff:127.0.0.1`.
 *
 * `new URL()` rewrites the dotted form into hex (`::ffff:7f00:1`), so both have to
 * be recognised or loopback slips straight through the guard.
 */
const mappedIpv4 = (groups: string[]): string | undefined => {
  const marker = groups.lastIndexOf('ffff');
  // The mapping is only real when every group before the marker is zero;
  // otherwise a public address that merely contains `ffff` would be misread.
  if (marker < 0) return undefined;
  const prefixIsZero = groups.slice(0, marker).every((group) => group === '' || /^0+$/.test(group));
  if (!prefixIsZero) return undefined;

  const tail = groups.slice(marker + 1);
  if (tail.length === 1 && tail[0]?.includes('.')) return tail[0];
  if (tail.length !== 2) return undefined;

  const high = Number.parseInt(tail[0] ?? '', 16);
  const low = Number.parseInt(tail[1] ?? '', 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return undefined;

  return [(high >>> 8) & 255, high & 255, (low >>> 8) & 255, low & 255].join('.');
};

const isPrivateIpv6 = (host: string): boolean => {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('fe80')) return true; // link-local

  const mapped = mappedIpv4(normalized.split(':'));
  if (mapped) return isPrivateIpv4(mapped);
  return false;
};

/**
 * Reject anything that could reach the host machine or a private network.
 *
 * This validates the URL's literal host only. A hostname that resolves to a
 * private address is caught by `assertResolvesPublic` below, which the strict
 * crawl path and the claim verifier use before connecting.
 */
export function assertSafeUrl(candidate: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: 'INVALID_URL', detail: `not a valid URL: ${candidate}` };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_PROTOCOL',
      detail: `protocol ${url.protocol} is not allowed`,
    };
  }

  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason: 'CREDENTIALS_IN_URL',
      detail: 'credentials in URL are not allowed',
    };
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'BLOCKED_HOST', detail: `host ${hostname} is blocked` };
  }

  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    return { ok: false, reason: 'PRIVATE_HOST', detail: `host ${hostname} is a private address` };
  }

  return { ok: true, url };
}

export function isSafeUrl(candidate: string): boolean {
  return assertSafeUrl(candidate).ok;
}

// ---------------------------------------------------------------- resolution

/** Resolves a hostname to every address it currently points at. */
export type AddressLookup = (hostname: string) => Promise<string[]>;

/** Node's resolver, as the crawler uses it. Tests inject a stub instead. */
export const systemLookup: AddressLookup = async (hostname) => {
  const { lookup } = await import('node:dns/promises');
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

const isIpLiteral = (hostname: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');

/** True for any address the literal-host guard would refuse. */
export function isPrivateAddress(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIpv6(address);
}

export type ResolvedUrlSafetyResult =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; reason: UrlSafetyFailure | 'UNRESOLVABLE_HOST'; detail: string };

/**
 * The literal check, then DNS: a hostname that resolves to a private or
 * link-local address is refused even though the URL itself looks public. This
 * closes the `attacker.example -> 169.254.169.254` hole that `assertSafeUrl`
 * documents as its known limitation.
 *
 * Resolution happens before the connection rather than being pinned to it, so
 * a record that flips between the lookup and the connect (DNS rebinding with a
 * near-zero TTL) is still possible. The window is one request and the
 * remaining risk is recorded in the audit report rather than hidden here.
 */
export async function assertResolvesPublic(
  candidate: string,
  lookup: AddressLookup = systemLookup,
): Promise<ResolvedUrlSafetyResult> {
  const literal = assertSafeUrl(candidate);
  if (!literal.ok) return literal;

  const hostname = literal.url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIpLiteral(hostname)) return { ok: true, url: literal.url, addresses: [hostname] };

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return { ok: false, reason: 'UNRESOLVABLE_HOST', detail: `host ${hostname} does not resolve` };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: 'UNRESOLVABLE_HOST', detail: `host ${hostname} does not resolve` };
  }

  const offending = addresses.find((address) => isPrivateAddress(address));
  if (offending) {
    return {
      ok: false,
      reason: 'PRIVATE_HOST',
      detail: `host ${hostname} resolves to private address ${offending}`,
    };
  }

  return { ok: true, url: literal.url, addresses };
}
