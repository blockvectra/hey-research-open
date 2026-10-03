/**
 * NFT marketplaces are never a DEX (2026-10-03, full audit).
 *
 * Bitquery's `DEXTradeByTokens` files a Seaport fill as a trade like any
 * other, with a USD "price" per unit. For an NFT collection that is the price
 * of one NFT, and multiplied by the collection's supply it became a
 * "$69K valuation via DEX (Seaport V1.4)" on `sinjoh`'s PIGGY — an
 * ERC-721 collection (YieldBankNFT) that then held Under the Radar on a
 * Discovery Gap of 28.3. A marketplace sale is not a pool, a swap or a
 * fungible market, so HEY never reads one as a market reading.
 *
 * Matched on the provider's protocol name and family, lower-cased, as a whole
 * word or the start of a compound id (`seaport_v1.4`, `opensea`,
 * `blur_marketplace`). A venue this list does not name is not refused.
 */
export const NFT_MARKETPLACE_NAMES = [
  'seaport',
  'opensea',
  'wyvern',
  'blur',
  'looksrare',
  'x2y2',
  'rarible',
  'magiceden',
  'magic_eden',
  'sudoswap',
  'element',
  'zora',
  'foundation',
  'superrare',
  'nftx',
  'reservoir',
  'tensor',
] as const;

const NFT_MARKETPLACE = new RegExp(`(?:^|[^a-z0-9])(?:${NFT_MARKETPLACE_NAMES.join('|')})(?:$|[^a-z0-9])`);

/** Whether a provider's protocol name or family names an NFT marketplace. */
export function isNftMarketplaceVenue(...names: ReadonlyArray<string | null | undefined>): boolean {
  return names.some((name) => {
    const raw = name?.trim().toLowerCase();
    if (!raw) return false;
    // Separate the version suffix and spaces so "Seaport V1.4" and "seaport_v1.4" read alike.
    return NFT_MARKETPLACE.test(raw.replace(/[\s.]+/g, '_'));
  });
}
