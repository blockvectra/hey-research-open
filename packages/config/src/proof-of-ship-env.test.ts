import { describe, expect, it } from 'vitest';

import { parseServerEnv, safeParseServerEnv } from './env';

/** Proof of Ship (2026-10-24): off unless the attester key is set; the key is never echoed. */
describe('Proof of Ship configuration', () => {
  const base = { DATABASE_URL: 'postgresql://hey:hey@localhost:5432/hey_research' };
  const KEY = `0x${'ab'.repeat(32)}`;

  it('is off with nothing set, and no key or escrow is invented', () => {
    const env = parseServerEnv(base);
    expect(env.proofOfShip).toEqual({ attesterKey: undefined, escrowAddresses: [] });
  });

  it('turns on with the key, and reads the escrows lower-cased and trimmed', () => {
    const env = parseServerEnv({
      ...base,
      HEY_SHIP_ATTESTER_KEY: KEY,
      HEY_SHIP_ESCROW_ADDRESSES: ' 0x000000000000000000000000000000000000E5C0, 0x1111111111111111111111111111111111111111 ,',
    });
    expect(env.proofOfShip.attesterKey).toBeTruthy();
    expect(env.proofOfShip.escrowAddresses).toEqual(['0x000000000000000000000000000000000000e5c0', '0x1111111111111111111111111111111111111111']);
  });

  it('refuses a malformed key or escrow by name, never quoting the value', () => {
    const secret = `0x${'cd'.repeat(31)}`;
    const parsed = safeParseServerEnv({ ...base, HEY_SHIP_ATTESTER_KEY: secret, HEY_SHIP_ESCROW_ADDRESSES: '0x1234' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect([...parsed.variables].sort()).toEqual(['HEY_SHIP_ATTESTER_KEY', 'HEY_SHIP_ESCROW_ADDRESSES']);
    expect(parsed.issues.join('\n')).not.toContain(secret);
  });
});
