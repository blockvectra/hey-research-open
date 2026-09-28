import { describe, expect, it } from 'vitest';

import { extractHtmlMetadata } from './html';
import { classifySecurityLink, SECURITY_HOST_ALLOW_LIST, securityLinkRoot } from './security-links';

const SITE = 'https://example-protocol.xyz';

describe('security links by shape (2026-09-28)', () => {
  it('reads an auditor’s own report host as the auditor’s publication', () => {
    expect(classifySecurityLink('https://skynet.certik.com/projects/example-protocol')).toEqual({ kind: 'AUDIT', hostedBy: 'AUDITOR', firm: 'CertiK', firmBasis: 'HOST' });
    expect(classifySecurityLink('https://www.halborn.com/audits/example/smart-contract-assessment-e853f5')?.firm).toBe('Halborn');
    expect(classifySecurityLink('https://cantina.xyz/portfolio/c185d7eb-d80b-49d4-8141-44e122c6fee4')?.firm).toBe('Cantina');
    expect(classifySecurityLink('https://www.openzeppelin.com/news/example-protocol-audit')?.firm).toBe('OpenZeppelin');
    expect(classifySecurityLink('https://github.com/spearbit/portfolio/blob/master/pdfs/Example.pdf')).toMatchObject({ kind: 'AUDIT', hostedBy: 'AUDITOR', firm: 'Spearbit' });
    expect(classifySecurityLink('https://github.com/Zellic/publications/blob/master/Example.pdf')?.firm).toBe('Zellic');
  });

  it('reads a bounty program on the platform’s own host', () => {
    expect(classifySecurityLink('https://immunefi.com/bug-bounty/example/information/')).toEqual({ kind: 'BUG_BOUNTY', hostedBy: 'BOUNTY_PLATFORM', firm: 'Immunefi', firmBasis: 'HOST' });
    expect(classifySecurityLink('https://hackenproof.com/programs/example-protocol')?.kind).toBe('BUG_BOUNTY');
    expect(classifySecurityLink('https://cantina.xyz/bounties/3709ca85-4050-407e-9b36-51f5d5ea9b00')?.kind).toBe('BUG_BOUNTY');
  });

  it('never reads an index, a marketing page or a look-alike host as a report', () => {
    expect(classifySecurityLink('https://skynet.certik.com/projects')).toBeUndefined();
    expect(classifySecurityLink('https://www.openzeppelin.com/security-audits')).toBeUndefined();
    expect(classifySecurityLink('https://www.openzeppelin.com/news/some-product-launch')).toBeUndefined();
    expect(classifySecurityLink('https://immunefi.com/')).toBeUndefined();
    expect(classifySecurityLink('https://github.com/spearbit/portfolio')).toBeUndefined();
    expect(classifySecurityLink('https://certik.com.evil.example/projects/x')).toBeUndefined();
    expect(classifySecurityLink('https://notcertik.com/projects/x')).toBeUndefined();
    expect(classifySecurityLink('javascript:alert(1)')).toBeUndefined();
    expect(classifySecurityLink('https://user:pass@skynet.certik.com/projects/x')).toBeUndefined();
  });

  it('keeps an audit or bounty page on the project’s own site as the project’s claim, and nowhere else', () => {
    expect(classifySecurityLink(`${SITE}/audits`, SITE)).toEqual({ kind: 'AUDIT', hostedBy: 'PROJECT' });
    expect(classifySecurityLink('https://docs.example-protocol.xyz/resources/audits', SITE)?.kind).toBe('AUDIT');
    expect(classifySecurityLink(`${SITE}/files/cyfrin-audit-2025.pdf`, SITE)).toEqual({ kind: 'AUDIT', hostedBy: 'PROJECT', firm: 'Cyfrin', firmBasis: 'URL_PATH' });
    expect(classifySecurityLink(`${SITE}/bug-bounty`, SITE)).toEqual({ kind: 'BUG_BOUNTY', hostedBy: 'PROJECT' });
    // Another site's audits page says nothing about this project.
    expect(classifySecurityLink('https://other-protocol.io/audits', SITE)).toBeUndefined();
    expect(classifySecurityLink(`${SITE}/audits`)).toBeUndefined();
    // "auditchain" is a name, not an audit page.
    expect(classifySecurityLink(`${SITE}/auditchain`, SITE)).toBeUndefined();
  });

  it('reads a project repository path with an audits folder as the project’s claim', () => {
    expect(classifySecurityLink('https://github.com/own-protocol/own-v2/tree/main/audits')).toEqual({ kind: 'AUDIT', hostedBy: 'PROJECT' });
    expect(classifySecurityLink('https://github.com/beefyfinance/beefy-audits')).toEqual({ kind: 'AUDIT', hostedBy: 'PROJECT' });
    expect(classifySecurityLink('https://github.com/example/auditchain')).toBeUndefined();
  });

  it('counts an audit section of the project’s own site once, and a report file or an auditor’s page as itself', () => {
    expect(securityLinkRoot('https://docs.example-protocol.xyz/security/audits/v2-review', SITE)).toBe('docs.example-protocol.xyz/security/audits');
    expect(securityLinkRoot('https://docs.example-protocol.xyz/security/audits/v1-review', SITE)).toBe('docs.example-protocol.xyz/security/audits');
    expect(securityLinkRoot(`${SITE}/audits/cyfrin-audit-2025.pdf`, SITE)).toBe('example-protocol.xyz/audits/cyfrin-audit-2025.pdf');
    expect(securityLinkRoot('https://www.skynet.certik.com/projects/example-protocol/', SITE)).toBe('skynet.certik.com/projects/example-protocol');
    expect(securityLinkRoot('https://github.com/own-protocol/own-v2/tree/main/audits/2025', SITE)).toBe('github.com/own-protocol/own-v2/tree/main/audits');
    expect(securityLinkRoot('https://example.org/about', SITE)).toBeUndefined();
  });

  it('lists every host rule with a path beyond the host', () => {
    for (const rule of SECURITY_HOST_ALLOW_LIST) {
      expect(rule.prefix.startsWith('/'), rule.host).toBe(true);
      expect(rule.host, rule.firm).not.toMatch(/^www\./);
    }
  });

  it('is collected from a page’s anchors by shape, never by anchor text', () => {
    const html = `<html><body>
      <a href="https://skynet.certik.com/projects/example-protocol">Our safe audit</a>
      <a href="/audits">Audits</a>
      <a href="https://example.org/">Audited by the best</a>
      <a href="https://immunefi.com/bug-bounty/example/">Bounty</a>
    </body></html>`;
    const meta = extractHtmlMetadata(html, SITE);
    expect(meta.securityUrls).toEqual([
      'https://skynet.certik.com/projects/example-protocol',
      'https://example-protocol.xyz/audits',
      'https://immunefi.com/bug-bounty/example/',
    ]);
  });
});
