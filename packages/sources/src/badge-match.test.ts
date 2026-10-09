import { describe, expect, it } from 'vitest';

import { findBadgePlacement, type BadgeTarget } from './badge-match';
import { createGithubFileAdapter } from './adapters/github-contents';
import { createWebsiteAdapter } from './adapters/website';
import { readFixture, stubFetch, testContext } from './testing';

/**
 * Finding a project's own HEY badge (2026-10-09). The one reading of "HEY
 * found the badge": a link or image to this project's badge image or badge
 * page, on HEY's own origin, that a reader can see.
 */
const ORIGIN = 'https://heyresearch.xyz';
const target = (slugs: string[] = ['agentos'], origin: string = ORIGIN): BadgeTarget => ({ origin, slugs });
const html = (body: string, slugs?: string[]) => findBadgePlacement(body, 'html', target(slugs)).found;
const readme = (body: string, slugs?: string[]) => findBadgePlacement(body, 'readme', target(slugs)).found;

describe('findBadgePlacement', () => {
  it('finds the badge image and the badge page, with any query, for this slug only', () => {
    expect(html('<img src="https://heyresearch.xyz/api/badge/agentos">')).toBe(true);
    expect(html('<img src="https://heyresearch.xyz/api/badge/agentos?theme=dark&amp;style=pill">')).toBe(true);
    expect(html('<iframe src="https://heyresearch.xyz/badge/agentos?embed=1" width="440"></iframe>')).toBe(true);
    expect(html('<a href="https://heyresearch.xyz/badge/agentos">badge</a>')).toBe(true);
    expect(html("<img src='//heyresearch.xyz/api/badge/agentos'>")).toBe(true);
    expect(html('<img src=https://heyresearch.xyz/api/badge/agentos>')).toBe(true);
    expect(html('<img srcset="https://heyresearch.xyz/api/badge/agentos?theme=dark 2x, /x.png 1x">')).toBe(true);
    expect(html('<IMG SRC="HTTPS://HEYRESEARCH.XYZ/API/BADGE/AGENTOS">')).toBe(true);
    // The documented image form, as HEY's own README and docs/BADGES.md give it (2026-10-09).
    expect(html('<img src="https://heyresearch.xyz/badge/agentos.svg">')).toBe(true);
    expect(readme('[![AgentOS on HEY](https://heyresearch.xyz/badge/agentos.svg)](https://heyresearch.xyz/project/agentos)')).toBe(true);
    expect(html('<img src="https://heyresearch.xyz/api/badge/agentos.svg">')).toBe(false);
    // A trailing slash on the path is the same badge.
    expect(html('<img src="https://heyresearch.xyz/api/badge/agentos/">')).toBe(true);
  });

  it('ignores another project’s badge, a longer slug that starts with this one, and other HEY pages', () => {
    expect(html('<img src="https://heyresearch.xyz/api/badge/otherproject">')).toBe(false);
    expect(html('<img src="https://heyresearch.xyz/api/badge/agentos-2">')).toBe(false);
    expect(html('<img src="https://heyresearch.xyz/badge/agentos-2.svg">')).toBe(false);
    expect(html('<a href="https://heyresearch.xyz/project/agentos">HEY</a>')).toBe(false);
    expect(html('<img src="https://heyresearch.xyz/api/badge/agentos/extra">')).toBe(false);
    expect(html('<img src="https://heyresearch.xyz/og/project/agentos">')).toBe(false);
  });

  it('takes the origin from the target, never a host in the logic', () => {
    expect(html('<img src="https://evil.example/api/badge/agentos">')).toBe(false);
    expect(html('<img src="https://heyresearch.xyz.evil.example/api/badge/agentos">')).toBe(false);
    expect(findBadgePlacement('<img src="https://staging.hey.test/api/badge/agentos">', 'html', target(['agentos'], 'https://staging.hey.test')).found).toBe(true);
    expect(findBadgePlacement('<img src="https://heyresearch.xyz/api/badge/agentos">', 'html', target(['agentos'], 'https://staging.hey.test')).found).toBe(false);
  });

  it('accepts an old slug that still redirects to the project', () => {
    expect(html('<img src="https://heyresearch.xyz/api/badge/agentos-old">', ['agentos', 'agentos-old'])).toBe(true);
  });

  it('does not count what a reader cannot see: a comment, a script, a code block or plain text', () => {
    expect(html('<!-- <img src="https://heyresearch.xyz/api/badge/agentos"> -->')).toBe(false);
    expect(html('<script>const s = \'<img src="https://heyresearch.xyz/api/badge/agentos">\';</script>')).toBe(false);
    expect(html('<pre><code><img src="https://heyresearch.xyz/api/badge/agentos"></code></pre>')).toBe(false);
    expect(html('<textarea><img src="https://heyresearch.xyz/api/badge/agentos"></textarea>')).toBe(false);
    expect(html('<p>https://heyresearch.xyz/api/badge/agentos</p>')).toBe(false);
    // An unclosed comment hides everything after it.
    expect(html('<!-- open <img src="https://heyresearch.xyz/api/badge/agentos">')).toBe(false);
    // A badge after a closed comment still counts.
    expect(html('<!-- note --><img src="https://heyresearch.xyz/api/badge/agentos">')).toBe(true);
    // `<codex>` is not `<code>`.
    expect(html('<codex></codex><img src="https://heyresearch.xyz/api/badge/agentos">')).toBe(true);
  });

  it('reads a README’s Markdown, inline HTML and bare URLs, and skips its code and comments', () => {
    expect(readme('[![AgentOS](https://heyresearch.xyz/api/badge/agentos)](https://heyresearch.xyz/project/agentos)')).toBe(true);
    expect(readme('<a href="https://heyresearch.xyz/project/agentos"><img src="https://heyresearch.xyz/api/badge/agentos?style=pill"></a>')).toBe(true);
    expect(readme('[badge]: https://heyresearch.xyz/api/badge/agentos\n\n![HEY][badge]')).toBe(true);
    expect(readme('See https://heyresearch.xyz/badge/agentos.')).toBe(true);
    expect(readme('```\n[![x](https://heyresearch.xyz/api/badge/agentos)](x)\n```')).toBe(false);
    expect(readme('~~~md\n![x](https://heyresearch.xyz/api/badge/agentos)\n~~~')).toBe(false);
    expect(readme('Use `https://heyresearch.xyz/api/badge/agentos` in yours.')).toBe(false);
    expect(readme('<!-- ![x](https://heyresearch.xyz/api/badge/agentos) -->')).toBe(false);
    expect(readme('[![x](https://heyresearch.xyz/api/badge/otherproject)](x)')).toBe(false);
  });

  it('finds nothing without a usable origin or slug', () => {
    expect(findBadgePlacement('<img src="https://heyresearch.xyz/api/badge/agentos">', 'html', { origin: 'not a url', slugs: ['agentos'] }).found).toBe(false);
    expect(findBadgePlacement('<img src="https://heyresearch.xyz/api/badge/agentos">', 'html', { origin: ORIGIN, slugs: [] }).found).toBe(false);
  });

  it('stays fast on a hostile body', () => {
    const started = Date.now();
    findBadgePlacement('<!--'.repeat(50_000) + 'src="'.repeat(50_000) + '<code'.repeat(50_000), 'html', target());
    findBadgePlacement('`'.repeat(100_000) + '```\n'.repeat(20_000) + 'https://'.repeat(50_000), 'readme', target());
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('reads the saved page and README fixtures', () => {
    expect(findBadgePlacement(readFixture('website-badge.html'), 'html', target())).toEqual({
      found: true,
      url: 'https://heyresearch.xyz/api/badge/agentos?theme=dark&style=pill',
    });
    for (const hidden of ['scriptonly', 'commented', 'codeonly', 'textonly', 'otherproject']) {
      expect(findBadgePlacement(readFixture('website-badge.html'), 'html', target([hidden])).found, hidden).toBe(hidden === 'otherproject');
    }
    expect(findBadgePlacement(readFixture('github-readme-badge.md'), 'readme', target())).toEqual({ found: true, url: 'https://heyresearch.xyz/api/badge/agentos' });
    for (const hidden of ['commented', 'fenced', 'inlinecode']) expect(findBadgePlacement(readFixture('github-readme-badge.md'), 'readme', target([hidden])).found, hidden).toBe(false);
  });
});

describe('the adapters carry the verdict, never the body', () => {
  it('the website adapter answers whether the page shows the badge', async () => {
    const { fetchImpl } = stubFetch({ status: 200, body: readFixture('website-badge.html'), headers: { 'content-type': 'text/html; charset=utf-8' } });
    const result = await createWebsiteAdapter().fetch({ url: 'https://agentos.xyz/', badge: target() }, testContext({ fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data?.badge).toEqual({ found: true });
    const other = await createWebsiteAdapter().fetch({ url: 'https://agentos.xyz/', badge: target(['scriptonly']) }, testContext({ fetchImpl }));
    expect(other.data?.badge).toEqual({ found: false });
    const none = await createWebsiteAdapter().fetch({ url: 'https://agentos.xyz/' }, testContext({ fetchImpl }));
    expect(none.data?.badge).toBeUndefined();
  });

  it('the README comes through GitHub’s readme endpoint as raw text the matcher reads', async () => {
    const { fetchImpl, requests } = stubFetch({ status: 200, body: readFixture('github-readme-badge.md'), headers: { 'content-type': 'application/vnd.github.raw+json; charset=utf-8' } });
    const result = await createGithubFileAdapter().fetch({ owner: 'agentos', repo: 'agentos' }, testContext({ fetchImpl }));
    expect(requests[0]?.url).toBe('https://api.github.com/repos/agentos/agentos/readme');
    expect(result.status).toBe('fresh');
    expect(findBadgePlacement(result.data?.text ?? '', 'readme', target()).found).toBe(true);
  });
});
