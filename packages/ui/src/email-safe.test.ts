import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { emailSafe } from './email-safe';

const html = (text: string) => renderToStaticMarkup(createElement(Fragment, null, emailSafe(text)));

/** Cloudflare's scanner, approximately: a run of address characters on both sides of one `@`. */
const LOOKS_LIKE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

describe('emailSafe', () => {
  it('breaks a package version so the edge does not rewrite it (the /signals #418)', () => {
    const out = html('@artblocks/abx-token-api@0.2.1 published');
    expect(out).toBe('@artblocks/abx-token-api@<wbr/>0.2.1 published');
    expect(out).not.toMatch(LOOKS_LIKE_EMAIL);
  });

  it('leaves text without an inner @ untouched', () => {
    expect(html('Agent SDK v0.4')).toBe('Agent SDK v0.4');
    expect(html('@hoodlens on X')).toBe('@hoodlens on X');
    expect(emailSafe(undefined)).toBeNull();
  });
});
