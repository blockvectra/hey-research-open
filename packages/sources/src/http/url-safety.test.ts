import { describe, expect, it } from 'vitest';

import { assertResolvesPublic, assertSafeUrl, ipv6Groups, isPrivateAddress, isSafeUrl, raceWithSignal } from './url-safety';

describe('assertSafeUrl', () => {
  it('allows ordinary public http and https URLs', () => {
    expect(isSafeUrl('https://agentos.xyz/changelog')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
  });

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://10.1.2.3/',
    'http://172.16.0.1/',
    'http://192.168.0.10/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
  ])('blocks the private or loopback destination %s', (url) => {
    const result = assertSafeUrl(url);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('PRIVATE_HOST');
  });

  it.each(['http://localhost/', 'http://api.localhost/', 'http://metadata.google.internal/'])(
    'blocks the reserved hostname %s',
    (url) => {
      expect(assertSafeUrl(url).ok).toBe(false);
    },
  );

  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com'])(
    'rejects the non-HTTP protocol %s',
    (url) => {
      const result = assertSafeUrl(url);
      expect(result.ok === false && result.reason).toBe('UNSUPPORTED_PROTOCOL');
    },
  );

  it('rejects credentials embedded in the URL', () => {
    const result = assertSafeUrl('https://user:secret@example.com/');
    expect(result.ok === false && result.reason).toBe('CREDENTIALS_IN_URL');
  });

  it('rejects malformed input', () => {
    expect(assertSafeUrl('not a url').ok).toBe(false);
  });
});

describe('assertResolvesPublic', () => {
  const resolving = (answers: Record<string, string[]>) => async (hostname: string) => {
    const found = answers[hostname];
    if (!found) throw new Error('ENOTFOUND');
    return found;
  };

  it('accepts a hostname that resolves to public addresses only', async () => {
    const result = await assertResolvesPublic(
      'https://example.com/path',
      resolving({ 'example.com': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.addresses).toHaveLength(2);
  });

  it('refuses every link-local and site-local IPv6 address, not only the fe80 spelling (audit H05)', async () => {
    for (const address of ['fe80::1', 'fe81::1', 'febf::1', 'fec0::1', 'fd12::1', '::1']) {
      const result = await assertResolvesPublic('https://v6.example/', resolving({ 'v6.example': [address] }));
      expect(result.ok, address).toBe(false);
    }
    const fine = await assertResolvesPublic('https://v6.example/', resolving({ 'v6.example': ['2606:2800:220:1:248:1893:25c8:1946'] }));
    expect(fine.ok).toBe(true);
  });

  it('refuses a public-looking hostname that resolves to a private address', async () => {
    for (const address of ['169.254.169.254', '10.0.0.7', '127.0.0.1', '::1', 'fd00::1']) {
      const result = await assertResolvesPublic(
        'http://metadata.attacker.example/',
        resolving({ 'metadata.attacker.example': ['93.184.216.34', address] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('PRIVATE_HOST');
    }
  });

  it('refuses a hostname that does not resolve', async () => {
    const result = await assertResolvesPublic('https://nope.invalid/', resolving({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('UNRESOLVABLE_HOST');
  });

  it('never looks up an IP literal, and still refuses a private one', async () => {
    let looked = false;
    const spy = async () => {
      looked = true;
      return ['1.1.1.1'];
    };
    expect((await assertResolvesPublic('http://8.8.8.8/', spy)).ok).toBe(true);
    expect((await assertResolvesPublic('http://192.168.0.1/', spy)).ok).toBe(false);
    expect(looked).toBe(false);
  });

  it('keeps every literal refusal from assertSafeUrl', async () => {
    const result = await assertResolvesPublic('ftp://example.com/', async () => ['1.1.1.1']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('UNSUPPORTED_PROTOCOL');
  });
});

describe('numeric host forms (2026-09-17)', () => {
  it('refuses the shorthand, decimal, hex and octal spellings of an address', () => {
    for (const host of ['127.1', '2130706433', '0x7f000001', '0177.0.0.1', '127.0.1']) {
      expect(assertSafeUrl(`http://${host}/admin`).ok, host).toBe(false);
    }
    expect(assertSafeUrl('https://example.com/').ok).toBe(true);
    expect(assertSafeUrl('http://8.8.8.8/').ok).toBe(true);
  });
});

describe('special-purpose ranges (2026-09-26, audit M6 G1)', () => {
  it.each([
    'http://198.18.0.1/',
    'http://198.19.255.254/',
    'http://192.0.0.1/',
    'http://192.0.2.10/',
    'http://198.51.100.7/',
    'http://203.0.113.9/',
    'http://[::7f00:1]/',
    'http://[::127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[64:ff9b::a00:1]/',
    'http://[64:ff9b:1::1]/',
    'http://[2002:7f00:1::]/',
    'http://[2002:a00:1::1]/',
    'http://[2001::1]/',
    'http://[2001:db8::1]/',
    'http://[100::1]/',
    'http://[ff02::1]/',
  ])('refuses %s', (url) => {
    const result = assertSafeUrl(url);
    expect(result.ok, url).toBe(false);
  });

  it('still allows ordinary public addresses near those ranges', () => {
    for (const url of ['http://198.20.0.1/', 'http://192.0.1.1/', 'http://203.0.114.1/', 'http://[2606:4700::1111]/', 'http://[2001:4860:4860::8888]/']) {
      expect(assertSafeUrl(url).ok, url).toBe(true);
    }
  });

  it('refuses a hostname whose DNS answer is an IPv4-compatible, NAT64 or 6to4 address (rebinding through IPv6)', async () => {
    for (const address of ['::7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:1::1', '198.18.0.1']) {
      const result = await assertResolvesPublic('https://hook.example/', async () => [address]);
      expect(result.ok, address).toBe(false);
      if (!result.ok) expect(result.reason).toBe('PRIVATE_HOST');
    }
  });
});

describe('ipv6Groups', () => {
  it('expands compressed forms and dotted tails, and refuses nonsense', () => {
    expect(ipv6Groups('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Groups('[64:ff9b::7f00:1]')).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x7f00, 1]);
    expect(ipv6Groups('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(ipv6Groups('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ipv6Groups('1::2::3')).toBeUndefined();
    expect(ipv6Groups('example.com')).toBeUndefined();
    expect(ipv6Groups('12345::')).toBeUndefined();
  });
});

/*
 * Audit G S2 (2026-09-27): the IPv6 range checks compared text prefixes on
 * any hostname, so real domains beginning with `fc`, `fd` or `fe8`–`fef` were
 * refused as private addresses. Three production projects were recorded as
 * website_unreachable:BLOCKED_URL for it (fc-footy.vercel.app, fcgnews.com,
 * feathercult.com).
 */
describe('IPv6 ranges apply to IPv6 literals only (audit G S2)', () => {
  it('allows public names that merely begin with an IPv6 range prefix', () => {
    for (const host of ['fedoraproject.org', 'fcc.gov', 'fdic.gov', 'feature.io', 'fcbarcelona.com', 'febreze.com', 'fc-footy.vercel.app', 'fcgnews.com', 'feathercult.com', 'fe80.example']) {
      expect(isSafeUrl(`https://${host}/`), host).toBe(true);
    }
  });

  it('still refuses every private IPv6 literal', () => {
    for (const literal of ['[fe80::1]', '[fe80::1%25eth0]', '[febf::1]', '[fec0::1]', '[fc00::1]', '[fd12:3456::1]', '[::1]', '[::]', '[::ffff:127.0.0.1]']) {
      expect(isSafeUrl(`http://${literal}/`), literal).toBe(false);
    }
  });

  it('reads the range from the address, not its spelling: 00fc:: is not fc00::/7', () => {
    expect(isSafeUrl('http://[fc::1]/')).toBe(true);
    expect(isSafeUrl('http://[2606:4700:4700::1111]/')).toBe(true);
    expect(isPrivateAddress('fc::1')).toBe(false);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('fedoraproject.org')).toBe(false);
  });

  it('resolves a name that begins with a range prefix and judges its addresses', async () => {
    const result = await assertResolvesPublic('https://fedoraproject.org/', async () => ['38.145.60.20']);
    expect(result.ok).toBe(true);
  });
});

describe('the DNS lookup is bounded by the request signal (audit G S7)', () => {
  it('gives up when the signal fires, with the signal’s reason', async () => {
    const never = () => new Promise<string[]>(() => {});
    const started = Date.now();
    await expect(assertResolvesPublic('https://slow-dns.example/', never, AbortSignal.timeout(50))).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('still reports a name that fails to resolve as unresolvable, not as a timeout', async () => {
    const failing = async (): Promise<string[]> => {
      throw new Error('ENOTFOUND');
    };
    const result = await assertResolvesPublic('https://nope.invalid/', failing, AbortSignal.timeout(5_000));
    expect(result).toMatchObject({ ok: false, reason: 'UNRESOLVABLE_HOST' });
  });

  it('raceWithSignal passes a result through and rejects at once on an aborted signal', async () => {
    await expect(raceWithSignal(Promise.resolve(1), AbortSignal.timeout(1_000))).resolves.toBe(1);
    await expect(raceWithSignal(Promise.resolve(1), undefined)).resolves.toBe(1);
    await expect(raceWithSignal(new Promise(() => {}), AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });
});
