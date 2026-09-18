/**
 * `@hey-research/sdk` (2026-09-19): HEY Research's public API as typed calls.
 *
 * Everything exported here is either a call the API answers, a shape it
 * answers with, or the error it throws. There is nothing that ranks by
 * price, values a token or names a wallet, because HEY does not do those.
 */
export { DEFAULT_BASE_URL, HeyClient, USER_AGENT, type FetchLike, type HeyClientOptions, type QueryParams } from './client';
export { HeyApiError, retryAfterSeconds, type HeyApiErrorCode, type HeyApiErrorOptions } from './error';
export { itemsOf, nextOffsetPages, totalPages } from './paging';
export { SDK_VERSION } from './version';
export type {
  HeyActivityStatus,
  HeyBountiesQuery,
  HeyBounty,
  HeyBountyDetail,
  HeyBountyPage,
  HeyBountyRules,
  HeyBuilder,
  HeyBuilderFilter,
  HeyBuilderRadarDay,
  HeyBuildersPage,
  HeyBuildersQuery,
  HeyCardFact,
  HeyCatalogueCounts,
  HeyChain,
  HeyChainDay,
  HeyIntelligenceMarket,
  HeyLaunchStage,
  HeyMarketCoverage,
  HeyPage,
  HeyProject,
  HeyProjectDetail,
  HeyProjectIntelligence,
  HeyProjectKind,
  HeyProjectSurface,
  HeyProjectsQuery,
  HeyScanCard,
  HeyShip,
  HeyShipsQuery,
  HeySignal,
  HeySignalDetail,
  HeySignalGroup,
  HeySignalPage,
  HeySignalsQuery,
  HeyStatus,
  HeyStatusLevel,
  HeyStatusSlo,
  HeyStatusSource,
  HeyThisWeek,
  HeyThisWeekProject,
  HeyThisWeekShip,
  HeyToken,
  HeyTokenLookup,
  HeyTokenLookupProject,
  HeyTokenMarket,
  HeyWeeklyIndex,
  HeyWeeklyReport,
} from './types';
