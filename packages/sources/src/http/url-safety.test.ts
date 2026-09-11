import { describe, expect, it } from 'vitest';

import { assertResolvesPublic, assertSafeUrl, isSafeUrl } from './url-safety';

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
