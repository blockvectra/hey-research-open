import { describe, expect, it } from 'vitest';

import type { HeySecurityContext } from '@hey-research-lab/sdk';

import * as fx from './fixtures/api';
import { renderSnapshot, securityLines } from './render-machine';

const NOW = new Date('2026-09-28T12:00:00Z');
const PROJECT = '2ac87a66-1b2c-4d3e-8f90-0123456789ab';

const found: HeySecurityContext = {
  audits: {
    state: 'MEASURED',
    readFrom: ['official_site', 'defillama'],
    items: [
      {
        id: `security:${PROJECT}:audit:0123456789abcdef`,
        url: 'https://skynet.certik.com/projects/example',
        authority: 'AUDITOR_PUBLISHED',
        hostedOn: 'AUDITOR',
        auditor: { name: 'CertiK', basis: 'AUDITOR_HOST' },
        date: null,
        isPdf: false,
        foundBy: [{ foundVia: 'official_site', foundOnUrl: 'https://example.xyz/', firstObservedAt: '2026-09-27T00:00:00.000Z', lastObservedAt: '2026-09-28T00:00:00.000Z' }],
        observedAt: '2026-09-27T00:00:00.000Z',
      },
      {
        id: `security:${PROJECT}:audit:fedcba9876543210`,
        url: 'https://docs.example.xyz/audits/cyfrin-audit.pdf',
        authority: 'REGISTRY_LISTED',
        hostedOn: 'PROJECT_SITE',
        auditor: { name: 'Cyfrin', basis: 'URL_PATH' },
        date: null,
        isPdf: true,
        foundBy: [{ foundVia: 'defillama', foundOnUrl: 'https://defillama.com/protocol/example', firstObservedAt: '2026-09-20T00:00:00.000Z', lastObservedAt: '2026-09-20T00:00:00.000Z' }],
        observedAt: '2026-09-20T00:00:00.000Z',
      },
    ],
  },
  bugBounty: { state: 'NONE_FOUND', readFrom: ['official_site'], readAt: '2026-09-28T00:00:00.000Z' },
  securityTxt: { state: 'NOT_READ', reason: 'site_files_not_read_yet' },
  advisories: { state: 'NONE_FOUND', packagesRead: 3, readAt: '2026-09-26T00:00:00.000Z', stale: false },
  repositoryChecks: { state: 'NOT_APPLICABLE', reason: 'no_official_repository' },
  incidents: { state: 'NOT_READ', reason: 'no_incident_source_read' },
  linksOmitted: 0,
  meaning: 'An audit shows an audit took place; it is not a guarantee of safety.',
  contextOnly: true,
};

describe('security context in the MCP snapshot (2026-09-28)', () => {
  it('lists each audit with where it is published and its evidence id, and names the indexes a none-found read', () => {
    const lines = securityLines(found).join('\n');
    expect(lines).toContain("- FACT 2 audit report links found (read from the project's homepage, its DefiLlama listing):");
    expect(lines).toContain(`CertiK, on the auditor's own site: https://skynet.certik.com/projects/example [security:${PROJECT}:audit:0123456789abcdef]`);
    expect(lines).toContain('Cyfrin (named in the link only), listed by DefiLlama only');
    expect(lines).toContain("- FACT no bug-bounty link found on the project's homepage — a reading of those only");
    expect(lines).toContain('- UNKNOWN security.txt: not read (site files not read yet)');
    expect(lines).toContain('no open OSV advisory for the published versions of the 3 packages HEY reads (read 2026-09-26) — a reading of OSV, not a statement about the code');
    expect(lines).toContain('- UNKNOWN incidents');
    expect(lines).toContain('not a guarantee of safety');
    expect(lines).not.toMatch(/\bsafe\b|\bunsafe\b|risk score|audit score|security score|\baudited\b/i);
  });

  it('draws the section in the snapshot, and says unknown when the read failed', () => {
    expect(renderSnapshot({ ...fx.snapshot, security: found }, NOW)).toContain('## Security context (evidence, never a verdict)');
    const { security: _omitted, ...rest } = { ...fx.snapshot, security: found };
    expect(renderSnapshot(rest, NOW)).toContain('- UNKNOWN security context: HEY could not read it just now.');
  });
});
