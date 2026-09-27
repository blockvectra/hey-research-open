import { describe, expect, it } from 'vitest';

import type { HeyDeveloperFootprint, HeyProtocolEconomics } from '@hey-research-lab/sdk';

import * as fx from './fixtures/api';
import { economicsLines, footprintLines, promotionLine, REASON_WORDS, renderContract, renderCoverage, renderProjectContracts, renderSnapshot } from './render-machine';

/**
 * The free-data wave in the MCP's words (2026-09-27): protocol economics,
 * market promotion, the developer footprint and the contract's verified
 * source, each no stronger than the API object it reads. A registry's
 * silence is not a zero, "none found" is a reading of one index, a
 * candidate is never a name, and nothing here is building.
 */
const NOW = new Date('2026-09-27T00:00:00Z');
const NO_GARBAGE = /undefined|\[object|NaN/;

const economics: HeyProtocolEconomics = {
  protocols: [
    {
      protocol: 'rips-dex',
      protocolName: 'Rips DEX',
      category: 'Dexs',
      tvlUsd: 1_250_000,
      tvlDay: '2026-09-26',
      matchedBy: 'declared_token',
      fees24h: { state: 'MEASURED', valueUsd: 0 },
      revenue24h: { state: 'NOT_TRACKED' },
      dexVolume24h: { state: 'NOT_ENOUGH_YET' },
      economicsDay: '2026-09-26',
      auditLinks: ['https://example.com/audit.pdf'],
      methodologyUrl: 'https://example.com/methodology',
    },
  ],
  source: 'defillama',
  contextOnly: true,
};

describe('get_project_snapshot: protocol economics', () => {
  it('tags each metric in its own state: a measured zero is zero, not tracked is a fact about the registry, unread is unknown', () => {
    const text = economicsLines(economics, { state: 'MEASURED' }).join('\n');
    expect(text).toContain('- FACT DefiLlama lists Rips DEX (Dexs), matched by declared token: TVL $1.25M on 2026-09-26');
    expect(text).toContain('FACT fees 24h zero, as measured; FACT revenue 24h: not tracked by the registry; UNKNOWN DEX volume 24h: not read yet (for 2026-09-26)');
    expect(text).toContain('FACT the registry links 1 audit report and a methodology — links, never verdicts');
    expect(text).toContain('never reaches activity status, Build Momentum, the Discovery Gap or the Radar');
    expect(text).not.toMatch(/\$0\b|safe|audited/);
  });

  it('says why when the project has no protocol, from coverage, and unknown when coverage is missing', () => {
    expect(economicsLines(undefined, { state: 'NOT_APPLICABLE', reason: 'no_protocol_listing' })).toEqual(['- FACT protocol economics: NOT_APPLICABLE (no_protocol_listing: matched to no DefiLlama protocol)']);
    expect(economicsLines(undefined, { state: 'NOT_ENOUGH_YET', reason: 'economics_not_read_yet' })[0]).toMatch(/^- UNKNOWN protocol economics: NOT_ENOUGH_YET/);
    expect(economicsLines(undefined, undefined)[0]).toMatch(/^- UNKNOWN protocol economics/);
  });

  it('prints the block inside the snapshot, after the market and before the footprint', () => {
    const text = renderSnapshot({ ...fx.snapshot, protocolEconomics: economics }, NOW);
    const market = text.indexOf('## Market');
    const protocol = text.indexOf('## Protocol economics (registry context, never building)');
    const footprint = text.indexOf('## Developer footprint (context, never a ship)');
    expect(market).toBeGreaterThan(0);
    expect(protocol).toBeGreaterThan(market);
    expect(footprint).toBeGreaterThan(protocol);
    expect(text).not.toMatch(NO_GARBAGE);
  });
});

describe('get_project_snapshot: market promotion', () => {
  it('prints presence and dates, the provider’s date when it gave one, never an amount, and never as building', () => {
    const text = renderSnapshot(fx.snapshot, NOW);
    expect(text).toContain('- FACT promotion or takeover seen 3 times; newest: paid promotion on boost, 2026-09-26 (first seen by HEY). Context only: paid promotion never reaches a ranking, a score or a signal of building.');
    const dated = promotionLine({ entries: [{ kind: 'COMMUNITY_TAKEOVER_PROFILE_OBSERVED', channel: 'community-takeover', providerAt: '2026-09-20T00:00:00.000Z', firstObservedAt: '2026-09-21T00:00:00.000Z', lastObservedAt: '2026-09-21T00:00:00.000Z', source: 'dexscreener' }], total: 1, contextOnly: true });
    expect(dated).toContain('seen 1 time; newest: community-takeover profile on community-takeover, 2026-09-20 (the provider\'s date)');
    expect(text).not.toMatch(/\$\d|amount|spent/i);
  });

  it('says nothing about promotion when the API carries none, rather than "none"', () => {
    const { promotion: _gone, ...market } = fx.snapshot.market!;
    const text = renderSnapshot({ ...fx.snapshot, market }, NOW);
    expect(text).not.toMatch(/promotion or takeover/);
  });
});

describe('get_project_snapshot: developer footprint', () => {
  it('prints the four lines in their coverage states, and a package index reading as that and no more', () => {
    const text = footprintLines(fx.snapshot.developerFootprint!).join('\n');
    expect(text).toContain('- FACT official repositories: 2; metadata read for 2 (MEASURED, repository_metadata_read)');
    expect(text).toContain('- FACT newest production deployment 2026-09-20 (environment "Production", read 2026-09-26) — a dated record of an environment, not building');
    expect(text).toContain('a reading of that index only, not "no package"');
    expect(text).toContain('- FACT package advisories: NOT_APPLICABLE');
  });

  it('never prints an unread count as zero, and says a package publication is never a ship', () => {
    const unread: HeyDeveloperFootprint = {
      repositories: { state: 'NOT_ENOUGH_YET', reason: 'footprint_not_read_yet', official: 1, metadataRead: 0 },
      productionDeployment: { state: 'NOT_READ' },
      packages: { state: 'NOT_ENOUGH_YET', reason: 'package_lookup_not_run' },
      advisories: { state: 'NOT_ENOUGH_YET', reason: 'advisories_not_read_yet', subject: 'PUBLISHED_PACKAGE' },
      contextOnly: true,
      coverageUrl: 'https://heyresearch.xyz/api/projects/x/coverage',
    };
    const text = footprintLines(unread).join('\n');
    expect(text).toContain('- UNKNOWN production deployments: not read yet');
    expect(text).toContain('- UNKNOWN packages: NOT_ENOUGH_YET (package_lookup_not_run: the package index has not been asked yet)');
    expect(text).toContain('- UNKNOWN package advisories: NOT_ENOUGH_YET');
    expect(text).not.toMatch(/\b0 (accepted|current)/);
    const held: HeyDeveloperFootprint = { ...unread, packages: { state: 'MEASURED', reason: 'accepted_package_links', accepted: 1, claimed: 2 }, advisories: { state: 'MEASURED', reason: 'advisories_about_published_package', current: 1, subject: 'PUBLISHED_PACKAGE' } };
    const withPackages = footprintLines(held).join('\n');
    expect(withPackages).toContain("- FACT packages: 1 accepted as the project's own, 2 claimed (a claim rests only on what its publisher typed, such as an official repository or homepage). A package publication is never a ship.");
    expect(withPackages).toContain("- FACT 1 current advisory about accepted packages' published versions — about a published version, never a verdict on the project");
  });

  it('tags a project with no repository held UNKNOWN, never FACT (uniswap-v3, review repair 2026-09-27)', () => {
    const none: HeyDeveloperFootprint = {
      repositories: { state: 'NO_SOURCE', reason: 'no_repository', official: 0, metadataRead: 0 },
      productionDeployment: { state: 'NOT_APPLICABLE' },
      packages: { state: 'NO_SOURCE', reason: 'no_repository' },
      advisories: { state: 'NOT_APPLICABLE', reason: 'no_accepted_package', subject: 'PUBLISHED_PACKAGE' },
      contextOnly: true,
      coverageUrl: 'https://heyresearch.xyz/api/projects/uniswap-v3/coverage',
    };
    const text = footprintLines(none).join('\n');
    expect(text).toContain('- UNKNOWN official repositories: none held (NO_SOURCE, no_repository)');
    expect(text).not.toContain('FACT official repositories');
  });

  it('is unknown, never absent-as-none, when the snapshot carries no footprint', () => {
    const { developerFootprint: _gone, ...rest } = fx.snapshot;
    expect(renderSnapshot(rest, NOW)).toContain("- UNKNOWN developer footprint: HEY could not read this project's coverage.");
  });
});

describe('get_contract: verified source, Sourcify, clones and method counts (2026-09-27)', () => {
  it('says how the source was verified, whose code it is as DERIVED, and what Sourcify answered', () => {
    const text = renderContract(fx.contract);
    expect(text).toContain('matched by the explorer to source published for identical bytecode, not published for this address (full match)');
    expect(text).toContain("- DERIVED whose code: a bytecode match to someone else's source (bytecode matched to other source)");
    expect(text).toContain('- FACT Sourcify holds no source for it (checked 2026-09-27)');
  });

  it('never reads an unread Sourcify answer as unverified', () => {
    const text = renderProjectContracts(fx.projectContracts);
    expect(text).toContain('- UNKNOWN Sourcify: not read');
    expect(text).toContain('not "unverified"');
  });

  it('prints a clone as a fact about its code', () => {
    const text = renderContract({ ...fx.contract, proxy: { ...fx.contract.proxy, clonedFrom: '0x4444000000000000000000000000000000000004' } });
    expect(text).toContain('- FACT an immutable minimal clone (EIP-1167) of 0x4444000000000000000000000000000000000004');
  });

  it('counts ABI-named calls, candidate selectors labelled as candidates, and the creation call apart — never a name', () => {
    const text = renderContract(fx.contract);
    expect(text).toContain("90 of the named calls were named by the contract's own verified ABI.");
    expect(text).toContain("1 undecoded selector has a signature candidate — a database's guess, never a name, and not counted as named.");
    expect(text).toContain('1 call to its creation code (the deployment, not a method) counted apart.');
    expect(text).not.toMatch(NO_GARBAGE);
  });
});

describe('get_project_coverage: reason words for the new dimensions', () => {
  it('says how far a reading goes beside the code, so an agent cannot read "none found" as "none"', () => {
    const text = renderCoverage(fx.coverage);
    for (const [code, words] of Object.entries(REASON_WORDS)) expect(words.length, code).toBeGreaterThan(10);
    const packageLine = renderCoverage({ ...fx.coverage, dimensions: { ...fx.coverage.dimensions, package: { state: 'MEASURED', reason: 'none_found_in_package_index' } } })
      .split('\n')
      .find((line) => line.includes('published packages'));
    expect(packageLine).toContain('a reading of that index only, not "no package"');
    expect(text).not.toMatch(NO_GARBAGE);
  });
});
