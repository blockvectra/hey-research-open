import { describe, expect, it } from 'vitest';

import { DISCLAIMER_WINDOW_CHARS, disclaimedMentions } from './website';

/**
 * A page that names a contract and disowns it (2026-10-12, audit INV-1). The
 * pages are written for the test in the shape the audit found, lower-cased as
 * the adapter reads them.
 */
const COMMUNITY = '0xddd4947010496b500abe96ab0965c38584413ba3';
const OWN = '0x15d36b6a28d8327abc7afabf0f106ae2c9af5c4d';
const FAKE = '0x70af000000000000000000000000000000004dd2';

describe('disclaimedMentions', () => {
  it('reads a link to a community token followed by "not issued or endorsed by" the project as disowned, in both spellings', () => {
    const page = `<div><a href="https://hoodscan.co/token/${COMMUNITY}">thanks, community <span>→</span></a></div>
      <p class="note">a community shares trading fees from its independent token with us.<!-- --> this is a community token, not issued or endorsed by the project. it has no role in the software.</p>`;
    expect(disclaimedMentions(page, [COMMUNITY, COMMUNITY.slice(2)])).toEqual([COMMUNITY, COMMUNITY.slice(2)]);
  });

  it('never reads the Robinhood disclaimer a footer prints beside the project’s own contract', () => {
    const page = `<p>contract: ${OWN}</p><footer>this project is not endorsed by robinhood markets, inc. it is not issued by robinhood.</footer>`;
    expect(disclaimedMentions(page, [OWN])).toEqual([]);
  });

  it('gives a warning to the address it is about, not the project’s own one beside it', () => {
    const page = `<p>beware: ${FAKE} is not our token. our contract: ${OWN}</p>`;
    expect(disclaimedMentions(page, [OWN])).toEqual([]);
    expect(disclaimedMentions(page, [FAKE])).toEqual([FAKE]);
  });

  it('never reads a meme calling itself a community token, or a phrase far from the contract', () => {
    expect(disclaimedMentions(`<p>${OWN}</p><p>100% community token, no team allocation.</p>`, [OWN])).toEqual([]);
    const far = `<p>${OWN}</p>${'x'.repeat(DISCLAIMER_WINDOW_CHARS + 10)}<p>this is not our token</p>`;
    expect(disclaimedMentions(far, [OWN])).toEqual([]);
  });

  it('reads "no official token" and "not affiliated with this token" beside the contract', () => {
    expect(disclaimedMentions(`<p>we have no official token. ${COMMUNITY} was launched by fans.</p>`, [COMMUNITY])).toEqual([COMMUNITY]);
    expect(disclaimedMentions(`<p>${COMMUNITY}: we are not affiliated with this token.</p>`, [COMMUNITY])).toEqual([COMMUNITY]);
  });
});
