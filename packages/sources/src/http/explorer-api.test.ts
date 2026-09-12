import { describe, expect, it } from 'vitest';

import { explorerApiUrl, redactApiKey, redactResultUrl } from './explorer-api';

describe('explorer api addressing', () => {
  it('addresses an instance without a key and the PRO API with chain and key', () => {
    expect(explorerApiUrl({ baseUrl: 'https://robinhoodchain.blockscout.com/' }, '/api/v2/smart-contracts')).toBe('https://robinhoodchain.blockscout.com/api/v2/smart-contracts');
    expect(explorerApiUrl({ baseUrl: 'https://api.blockscout.com', chainId: 4663, apiKey: 'proapi_x' }, 'api/v2/addresses/0xabc', { items_count: 50 })).toBe(
      'https://api.blockscout.com/api/v2/addresses/0xabc?items_count=50&chain_id=4663&apikey=proapi_x',
    );
  });

  it('never lets the key out in an echoed URL or message', () => {
    expect(redactApiKey('https://api.blockscout.com/api/v2/x?chain_id=4663&apikey=proapi_secret&y=1')).toBe('https://api.blockscout.com/api/v2/x?chain_id=4663&apikey=REDACTED&y=1');
    expect(redactApiKey(undefined)).toBeUndefined();
    expect(redactResultUrl({ status: 'error', sourceUrl: 'https://h/?apikey=k', errorMessage: 'failed https://h/?apikey=k' })).toEqual({ status: 'error', sourceUrl: 'https://h/?apikey=REDACTED', errorMessage: 'failed https://h/?apikey=REDACTED' });
  });
});
