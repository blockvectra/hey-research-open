import { describe, expect, it } from 'vitest';

import { decodeAbiString, decodeAbiUint8 } from './erc20';

/**
 * Factory-indexed tokens are named from their own contract, so this decoder is
 * the difference between a readable project and a row labelled `0x14b51c…`.
 */
describe('decodeAbiString', () => {
  const dynamic = (value: string): string => {
    const bytes = Buffer.from(value, 'utf8');
    const padded = Buffer.alloc(Math.ceil(bytes.length / 32) * 32);
    bytes.copy(padded);
    return (
      '0x' +
      (32).toString(16).padStart(64, '0') +
      bytes.length.toString(16).padStart(64, '0') +
      padded.toString('hex')
    );
  };

  it('decodes a dynamic string return', () => {
    expect(decodeAbiString(dynamic('Ryan Cohen'))).toBe('Ryan Cohen');
  });

  it('decodes the bytes32 form some tokens return instead', () => {
    const value = Buffer.alloc(32);
    Buffer.from('RYAN', 'utf8').copy(value);
    expect(decodeAbiString('0x' + value.toString('hex'))).toBe('RYAN');
  });

  it('returns nothing for an empty result rather than an empty name', () => {
    expect(decodeAbiString('0x')).toBeUndefined();
  });

  it('rejects binary that is not really text', () => {
    const value = Buffer.alloc(32);
    Buffer.from([0x01, 0x02, 0x03]).copy(value);
    expect(decodeAbiString('0x' + value.toString('hex'))).toBeUndefined();
  });

  it('decodes decimals() as a small integer and refuses anything that is not one word', () => {
    expect(decodeAbiUint8('0x' + '0'.repeat(62) + '06')).toBe('6');
    expect(decodeAbiUint8('0x' + '0'.repeat(62) + '12')).toBe('18');
    expect(decodeAbiUint8('0x' + '0'.repeat(60) + '0100')).toBeUndefined();
    expect(decodeAbiUint8('0x06')).toBeUndefined();
  });
});
