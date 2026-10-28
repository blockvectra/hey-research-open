import { describe, expect, it } from 'vitest';

import { projectDisplayName } from './format';

/** A name a reader can read (2026-10-28 simplicity study, DATA-9): "-" on a Verified Builder, "7", "%%%%". */
describe('projectDisplayName', () => {
  it('keeps a readable name in any script', () => {
    expect(projectDisplayName({ name: 'AgentOS', symbol: 'AOS', slug: 'agentos' })).toBe('AgentOS');
    expect(projectDisplayName({ name: '富贵', slug: 'fugui' })).toBe('富贵');
    expect(projectDisplayName({ name: '  HEY  ', slug: 'hey' })).toBe('HEY');
  });

  it('prints the ticker for a name with no letter or digit, or under two characters', () => {
    expect(projectDisplayName({ name: '-', symbol: 'APOGEE', slug: 'apogeemcp' })).toBe('APOGEE');
    expect(projectDisplayName({ name: '%%%%%%%%', symbol: '$PCT', slug: 'pct' })).toBe('PCT');
    expect(projectDisplayName({ name: '7', symbol: 'SEVEN', slug: 'seven-7' })).toBe('SEVEN');
    expect(projectDisplayName({ name: '👉 _________', symbol: 'PT', slug: 'point' })).toBe('PT');
  });

  it('falls back to the slug in words when the ticker is unreadable too', () => {
    expect(projectDisplayName({ name: '-', slug: 'apogeemcp' })).toBe('Apogeemcp');
    expect(projectDisplayName({ name: 'i', symbol: '-', slug: 'hookr-fun-18e674' })).toBe('Hookr Fun 18e674');
  });
});
