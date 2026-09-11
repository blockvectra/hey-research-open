import { describe, expect, it } from 'vitest';

import { parseLaunchMetadata } from './metadata';

describe('parseLaunchMetadata', () => {
  it('reads the inline JSON hood.fun stores, dropping the base64 image', () => {
    const result = parseLaunchMetadata(
      '{"description":"Climb the net","community":true,"website":"https://climb.net/","x":"@climbnet","image":"data:image/webp;base64,UklGRp"}',
    );
    expect(result).toEqual({
      description: 'Climb the net',
      websiteUrl: 'https://climb.net/',
      socials: [{ type: 'twitter', url: 'https://x.com/climbnet' }],
    });
  });

  it('reads the Clanker shape with platform-tagged social URLs', () => {
    const result = parseLaunchMetadata(
      '{"description":"Dogs have legs.\\nCats have arms.","socialMediaUrls":[{"platform":"twitter","url":"https://x.com/CatArmRH"},{"platform":"website","url":"https://catarm.example"}]}',
    );
    expect(result).toEqual({
      description: 'Dogs have legs.\nCats have arms.',
      websiteUrl: 'https://catarm.example/',
      socials: [{ type: 'twitter', url: 'https://x.com/CatArmRH' }],
    });
  });

  it('keeps an ipfs or https artwork reference and files a social given as the site under socials', () => {
    expect(
      parseLaunchMetadata('{"image":"ipfs://QmSTzmwHa3NiHhEb6Esz","website":"https://t.me/chat"}'),
    ).toEqual({
      imageUrl: 'ipfs://QmSTzmwHa3NiHhEb6Esz',
      socials: [{ type: 'telegram', url: 'https://t.me/chat' }],
    });
  });

  it('returns a URL untouched rather than fetching it', () => {
    expect(parseLaunchMetadata('ipfs://QmWE1x6CMmkan6R8A3N89PXotPUUWu1BBan7EnYgYpmaRt')).toEqual({
      socials: [],
      metadataUrl: 'ipfs://QmWE1x6CMmkan6R8A3N89PXotPUUWu1BBan7EnYgYpmaRt',
    });
    expect(parseLaunchMetadata('https://k8r.food/twewu-launch/metadata/robinlaunch.json')).toEqual({
      socials: [],
      metadataUrl: 'https://k8r.food/twewu-launch/metadata/robinlaunch.json',
    });
  });

  it('yields nothing for empty, malformed or non-object documents', () => {
    expect(parseLaunchMetadata('')).toEqual({ socials: [] });
    expect(parseLaunchMetadata('{}')).toEqual({ socials: [] });
    expect(parseLaunchMetadata('{"description":')).toEqual({ socials: [] });
    expect(parseLaunchMetadata('[1,2]')).toEqual({ socials: [] });
    expect(parseLaunchMetadata('not a uri')).toEqual({ socials: [] });
    expect(parseLaunchMetadata('{"website":"javascript:alert(1)"}')).toEqual({ socials: [] });
  });

  it('caps a description and ignores a document that is too large to be metadata', () => {
    const long = parseLaunchMetadata(JSON.stringify({ description: 'x'.repeat(5_000) }));
    expect(long.description?.length).toBe(2_000);
    const huge = parseLaunchMetadata(`{"description":"${'y'.repeat(70_000)}"}`);
    expect(huge).toEqual({ socials: [] });
  });
});
