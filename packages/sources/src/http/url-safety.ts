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
  /*
   * Special-purpose ranges no public service answers on (2026-09-26, audit M6
   * G1). Harmless for the crawler, which never had a reason to reach them, and
   * required for webhook delivery, where a subscriber chooses the destination:
   * 198.18.0.0/15 is benchmarking space some networks route internally,
   * 192.0.0.0/24 holds protocol assignments (incl. NAT64 discovery), and the
   * three TEST-NETs are documentation addresses.
   */
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  const [, , c = 0] = octets;
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
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

/**
 * The eight 16-bit groups of an IPv6 address, or undefined when it does not
 * parse. An embedded dotted IPv4 tail counts as the last two groups.
 */
export function ipv6Groups(address: string): number[] | undefined {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  if (!bare.includes(':') || !/^[0-9a-f:.]+$/.test(bare)) return undefined;
  const halves = bare.split('::');
  if (halves.length > 2) return undefined;
  const part = (text: string): number[] | undefined => {
    if (text === '') return [];
    const out: number[] = [];
    const pieces = text.split(':');
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index]!;
      if (piece.includes('.')) {
        if (index !== pieces.length - 1) return undefined;
        const octets = piece.split('.').map((value) => (/^\d{1,3}$/.test(value) ? Number(value) : Number.NaN));
        if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value > 255)) return undefined;
        out.push(((octets[0]! << 8) | octets[1]!) >>> 0, ((octets[2]! << 8) | octets[3]!) >>> 0);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined;
      out.push(Number.parseInt(piece, 16));
    }
    return out;
  };
  const head = part(halves[0] ?? '');
  const tail = halves.length === 2 ? part(halves[1] ?? '') : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

const v4Of = (high: number, low: number): string => [(high >>> 8) & 255, high & 255, (low >>> 8) & 255, low & 255].join('.');

const isPrivateIpv6 = (host: string): boolean => {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local fc00::/7
  // Link-local is fe80::/10: the first ten bits, so fe80 through febf (audit H05).
  if (/^fe[89ab]/.test(normalized)) return true;
  if (/^fec/.test(normalized) || /^fed/.test(normalized) || /^fee/.test(normalized) || /^fef/.test(normalized)) return true; // site-local fec0::/10, deprecated but routable

  const mapped = mappedIpv4(normalized.split(':'));
  if (mapped) return isPrivateIpv4(mapped);

  /*
   * Prefixes that carry or translate an IPv4 address, or that no public
   * service answers on (2026-09-26, audit M6 G1). Each is refused whole rather
   * than by the address it embeds: a translator or relay decides where the
   * packet really goes, and HEY has no reason to reach any of them.
   */
  const groups = ipv6Groups(normalized);
  if (!groups) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  // ::/96, IPv4-compatible (deprecated): `[::7f00:1]` is 127.0.0.1 on a stack that still honours it.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true;
  // 64:ff9b::/96 and the local-use 64:ff9b:1::/48: NAT64, which reaches whatever IPv4 address the low bits name.
  if (g0 === 0x64 && g1 === 0xff9b) return true;
  // 2002::/16, 6to4: the next 32 bits are an IPv4 address the relay connects to.
  if (g0 === 0x2002) return true;
  // 2001::/32, Teredo: an obfuscated IPv4 server and client inside.
  if (g0 === 0x2001 && g1 === 0) return true;
  // 2001:db8::/32, documentation.
  if (g0 === 0x2001 && g1 === 0xdb8) return true;
  // 100::/64, discard-only.
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // ff00::/8, multicast.
  if (g0 >= 0xff00) return true;
  // An IPv4-mapped tail written in hex under a zero prefix (`::ffff:7f00:1`) is caught above; keep the embedded check for any other zero-prefixed spelling.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return isPrivateIpv4(v4Of(g6, g7));
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

  // `127.1`, `2130706433`, `0x7f000001`, `0177.0.0.1` all resolve to loopback
  // (2026-09-17); a host that is only digits, dots and a hex prefix is an
  // address in a form the octet check cannot read, and is refused as one.
  if (isNumericHostForm(hostname) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { ok: false, reason: 'BLOCKED_HOST', detail: `host ${hostname} is a numeric address form` };
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

const isNumericHostForm = (hostname: string): boolean => /^(0x[0-9a-f]+|[0-9.]+)$/i.test(hostname);

const isIpLiteral = (hostname: string): boolean =>
  isNumericHostForm(hostname) || hostname.includes(':');

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
