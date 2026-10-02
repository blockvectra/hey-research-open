import { describe, expect, it } from 'vitest';

import { extractHtmlMetadata, xHandleOf } from '../html';
import { listedMentions } from './website';

const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec';
const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

/*
 * "Uses" is not "issues" (2026-10-02, outsider audit OA-A). saturn2022.com
 * lists the Robinhood stock tokens its options market trades — NVDA among a
 * row of blockscout links — and HEY took the NVDA mention for the site saying
 * "this is our token". A contract named only inside a list of contracts is one
 * the site uses.
 */
describe('listedMentions', () => {
  it('a contract named only inside a list of contract links is listed', () => {
    const page = [NVDA, address(1), address(2), address(3), address(4)]
      .map((a) => `<li><a href="https://robinhoodchain.blockscout.com/address/${a}">T</a></li>`)
      .join('')
      .toLowerCase();
    expect(listedMentions(page, [NVDA, NVDA.slice(2)])).toEqual([NVDA, NVDA.slice(2)]);
  });

  it('one mention standing on its own makes it the site’s own, wherever else it is listed', () => {
    const list = [NVDA, address(1), address(2), address(3)].map((a) => `<li>${a}</li>`).join('');
    const page = `<header>Contract address: ${NVDA}</header>${'<p>about us</p>'.repeat(200)}<footer><ul>${list}</ul></footer>`.toLowerCase();
    expect(listedMentions(page, [NVDA])).toEqual([]);
  });

  it('a token page naming its token beside one or two of its own contracts is not a list', () => {
    const page = `<p>Token ${NVDA}</p><p>Staking ${address(1)}</p><p>Vault ${address(2)}</p>`.toLowerCase();
    expect(listedMentions(page, [NVDA])).toEqual([]);
  });
});

describe('the X account a site links', () => {
  it('reads the handle of an account link, a post’s author included, and nothing else on x.com', () => {
    expect(xHandleOf('https://x.com/saturn2022com')).toBe('saturn2022com');
    expect(xHandleOf('https://twitter.com/@Saturn2022com/status/1')).toBe('saturn2022com');
    expect(xHandleOf('https://x.com/intent/tweet?text=hi')).toBeUndefined();
    expect(xHandleOf('https://x.com/search?q=nvda')).toBeUndefined();
    expect(xHandleOf('https://github.com/saturn')).toBeUndefined();
  });

  it('collects them from anchors', () => {
    const meta = extractHtmlMetadata('<a href="https://x.com/saturn2022com">X</a><a href="https://x.com/share?u=1">share</a>', 'https://saturn2022.com');
    expect(meta.xHandles).toEqual(['saturn2022com']);
  });
});
