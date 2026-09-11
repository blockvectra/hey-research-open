import { describe, expect, it } from 'vitest';

import { cleanHttpUrl, extractHttpUrls, socialTypeForUrl, twitterUrlFrom } from './links';

describe('link helpers', () => {
  it('keeps only absolute http(s) URLs', () => {
    expect(cleanHttpUrl(' https://example.org ')).toBe('https://example.org/');
    expect(cleanHttpUrl('ipfs://Qm123')).toBeUndefined();
    expect(cleanHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(cleanHttpUrl('_bNkrynaHAamIH5s')).toBeUndefined();
    expect(cleanHttpUrl('')).toBeUndefined();
  });

  it('recognises social networks by host, including subdomains', () => {
    expect(socialTypeForUrl('https://x.com/hey')).toBe('twitter');
    expect(socialTypeForUrl('https://twitter.com/hey')).toBe('twitter');
    expect(socialTypeForUrl('https://t.me/hey')).toBe('telegram');
    expect(socialTypeForUrl('https://www.tiktok.com/@hey')).toBe('tiktok');
    expect(socialTypeForUrl('https://discord.gg/abc')).toBe('discord');
    expect(socialTypeForUrl('https://github.com/hey')).toBe('github');
    expect(socialTypeForUrl('https://example.org')).toBeUndefined();
    expect(socialTypeForUrl('https://notx.com')).toBeUndefined();
  });

  it('turns an X handle into a profile URL and leaves URLs alone', () => {
    expect(twitterUrlFrom('@KrooklyWallet')).toBe('https://x.com/KrooklyWallet');
    expect(twitterUrlFrom('SavageApes')).toBe('https://x.com/SavageApes');
    expect(twitterUrlFrom('https://x.com/eltoadpepe')).toBe('https://x.com/eltoadpepe');
    expect(twitterUrlFrom('not a handle!')).toBeUndefined();
    expect(twitterUrlFrom('')).toBeUndefined();
  });

  it('extracts distinct URLs from free text', () => {
    expect(extractHttpUrls('a https://a.org, b https://b.org/x) again https://a.org')).toEqual([
      'https://a.org/',
      'https://b.org/x',
    ]);
  });
});
