import { describe, expect, it } from 'vitest';

import { formatUsdCompact, plainText, formatRelativeTime } from './format';

/**
 * Source text reaches the interface as words, never as markup (QA sweep
 * 2026-09-04). Every case here was seen on a production card or page.
 */
describe('plainText', () => {
  it('drops Markdown images, which were the first line of a homepage card', () => {
    expect(
      plainText(
        '![Upload](https://s3.ap-southeast-1.amazonaws.com/virtualprotocolcdn/vex.png) ProjectVex is a launchpad.',
      ),
    ).toBe('ProjectVex is a launchpad.');
    expect(plainText('**MERRYMEN**![🏹](https://abs.twimg.com/emoji/v2/svg/1f3f9.svg) Robin Hood')).toBe(
      'MERRYMEN Robin Hood',
    );
  });

  it('keeps the text of a link and the URL of a bare link', () => {
    expect(plainText('𝕏 @aigen\\_io [https://aigenprotocol.com/](https://aigenprotocol.com/)')).toBe(
      '𝕏 @aigen_io https://aigenprotocol.com/',
    );
    expect(plainText('🌐 **Website:** [hoods](https://hoods.gitlawb.org)')).toBe('🌐 Website: hoods');
  });

  it('strips headings, emphasis, code and rules', () => {
    expect(plainText('### Introducing $CAPYHOOD: The Legendary Outlaw **We** are')).toBe(
      'Introducing $CAPYHOOD: The Legendary Outlaw We are',
    );
    expect(plainText('## Initial production release\nA low-latency Go parser for `launchAndBuy`.')).toBe(
      'Initial production release A low-latency Go parser for launchAndBuy.',
    );
    expect(plainText('01 **The fix.** A launch refused. --- ## 01 · pools.fun')).toBe(
      '01 The fix. A launch refused. --- 01 · pools.fun',
    );
    expect(plainText('rules. **Sourced:** every claim')).toBe('rules. Sourced: every claim');
  });

  it('collapses runs of whitespace, carriage returns and non-breaking spaces', () => {
    expect(plainText('Private swaps native to Robinhood Chain.  @Axol\\_io is the team')).toBe(
      'Private swaps native to Robinhood Chain. @Axol_io is the team',
    );
    expect(plainText('line one\r\nline two three')).toBe('line one line two three');
  });

  it('leaves ordinary text, tickers and snake_case alone', () => {
    expect(plainText('Agents can settle $AOS through StockFi (v0.4).')).toBe(
      'Agents can settle $AOS through StockFi (v0.4).',
    );
    expect(plainText('token_select and 2*3=6')).toBe('token_select and 2*3=6');
    expect(plainText('')).toBe('');
    expect(plainText(undefined)).toBe('');
    expect(plainText(null)).toBe('');
  });

  it('removes HTML tags a source pasted in', () => {
    expect(plainText('Meet <b>BoneHood</b><br/>the dog')).toBe('Meet BoneHood the dog');
  });
});

describe('a project description that arrived as Markdown', () => {
  /*
   * The detail page rendered `shortDescription` raw, so a launchpad blurb
   * written in Markdown showed its escapes as literal characters — backticks
   * and backslashes around `sparkleware-catalog` on production.
   */
  it('keeps the words and drops the escaping', () => {
    expect(plainText('Run \\`sparkleware-catalog\\` to browse')).toBe(
      'Run sparkleware-catalog to browse',
    );
  });

  it('leaves a description that was never Markdown exactly as written', () => {
    const plain = 'A protocol for onchain identity. 100% open source; see docs.';
    expect(plainText(plain)).toBe(plain);
  });
});

describe('formatRelativeTime', () => {
  it('reads a future instant as a countdown, never as "just now" (2026-09-17)', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    expect(formatRelativeTime(new Date('2026-09-22T12:00:00Z'), now)).toBe('in 5d');
    expect(formatRelativeTime(new Date('2026-09-17T12:30:00Z'), now)).toBe('in 30m');
    expect(formatRelativeTime(new Date('2026-09-17T11:59:30Z'), now)).toBe('just now');
    expect(formatRelativeTime(new Date('2026-09-15T12:00:00Z'), now)).toBe('2d ago');
  });
});

describe('formatUsdCompact', () => {
  it('steps up a unit instead of printing a thousand of the smaller one (2026-09-17)', () => {
    expect(formatUsdCompact(999_999)).toBe('$1M');
    expect(formatUsdCompact(999_999_999)).toBe('$1B');
    expect(formatUsdCompact(999.7)).toBe('$1K');
    expect(formatUsdCompact(999_499)).toBe('$999K');
  });

  it('never prints a measured figure as $0', () => {
    // The distinction the whole product rests on: unknown, zero, and small.
    expect(formatUsdCompact(undefined)).toBeUndefined();
    expect(formatUsdCompact(0)).toBe('$0');
    expect(formatUsdCompact(0.42)).toBe('<$1');
    expect(formatUsdCompact(0.004)).toBe('<$1');
  });

  it('abbreviates upward without losing the order of magnitude', () => {
    expect(formatUsdCompact(1)).toBe('$1');
    expect(formatUsdCompact(999)).toBe('$999');
    expect(formatUsdCompact(1_000)).toBe('$1K');
    expect(formatUsdCompact(37_448_237)).toBe('$37M');
  });

  it('refuses a value that is not a number rather than printing one', () => {
    expect(formatUsdCompact(Number.NaN)).toBeUndefined();
    expect(formatUsdCompact(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
