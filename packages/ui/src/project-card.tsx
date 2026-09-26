import type { ReactNode } from 'react';

import { cn } from './cn';
import {
  formatEventType,
  formatMarketSource,
  formatProjectKind,
  formatRelativeTime,
  formatUsdCompact,
  formatVerification,
  plainText,
  isFullyDiluted,
} from './format';
import { ProjectLogo } from './project-logo';
import { ActivityChip, type ActivityStatusValue, showsNoBuilderSignal, StillBuildingBadge } from './status';
import { ContractAddress, ExternalRef } from './token-identity';
import { TokenLockChip, type TokenLockFacts } from './token-lock';

/**
 * Project card (Card V7, 2026-09-03; UI/UX V6 "Robinhood Pulse Minimal").
 *
 * One card, eight facts, nothing else. For a token-backed project:
 *
 *   [LOGO] NAME                          [STATUS]
 *          $TICKER
 *   Market cap  $1.24M
 *   0x82ae…91bf  [copy] [explorer]
 *   Pons ↗                       @project ↗
 *
 * Name, ticker, logo, market cap, contract address, activity status, launch
 * origin and official X account. A tokenless project keeps the identity,
 * status and X account, says what kind of thing it is, and links its own
 * site; it has no ticker, market cap or contract address to show.
 *
 * What is deliberately absent: momentum and gap scores, ship counts, commit
 * strips, holder / volume / liquidity figures, wallet analytics, descriptions
 * and second source links. The project page carries all of that behind the
 * card; the card is for recognising a project, not researching it.
 *
 * Every fact is shown only when HEY holds it. Market cap without a stored
 * snapshot reads "Unavailable"; a launch origin without a launch record reads
 * "Unknown"; a missing official X account is simply absent. Nothing here is
 * inferred from a name or a ticker — the token's identity is its chain id and
 * contract address.
 */
export type ProjectCardData = {
  slug: string;
  name: string;
  symbol?: string;
  logoUrl?: string | null;
  projectKind: string;
  activityStatus: ActivityStatusValue;
  marketCapUsd?: number;
  /** The reading's fully diluted valuation; equal to `marketCapUsd` when it stands in for one, and then the card says so. */
  fdvUsd?: number;
  /** The tracked token's market state (2026-09-11); a dead pool shows "No active market" instead of a cap. */
  tokenMarketStatus?: string;
  tokenMarketReason?: string;
  /** Which provider the reading came from; shown as a title, never as layout. */
  marketCapSource?: string;
  /*
   * Market Lens (2026-09-12): the same reading's liquidity and 24 h volume,
   * and the token's launch stage. Drawn only when the reader chose the Token
   * Projects view (`marketLens`); the eight facts of Card V7 do not change.
   */
  liquidityUsd?: number;
  volume24hUsd?: number;
  launchStage?: 'CURVE' | 'GRADUATED' | 'DEX';
  /** The pool the current reading came from, in words; names where the token trades when no launch record says where it launched (2026-09-13). */
  marketVenue?: string;
  /** Trades in the reading's last day and the price move over it, in percent (2026-09-13): counts and context, never a rank. */
  buys24h?: number;
  sells24h?: number;
  priceChange24hPct?: number;
  /** False when HEY holds no repository, changelog or feed: the status chip then says "No builder signal yet". */
  hasBuilderSource?: boolean;
  /** The token contract's events in its latest watched day: on-chain context, never a status input. */
  onchainEvents24h?: number;
  /** Canonical token identity. Absent for a project without a token. */
  token?: { chainId: number; contractAddress: string };
  /**
   * Supply held at HoodLock, when HEY found a live lock. Absent is the
   * ordinary case and is never drawn as a failing check — context, never a
   * verdict (CLAUDE.md product rule 3).
   */
  tokenLock?: TokenLockFacts;
  launchedVia?: { name: string; url?: string };
  officialX?: { handle: string; url: string };
  websiteUrl?: string;
  /** Kept for callers that still pass the fuller domain shape. */
  primaryNarrative?: { slug: string; name: string };
  shortDescription?: string;
  lastMeaningfulShipAt?: Date;
  stillBuilding?: boolean;
  researchLevel?: 'INDEXED' | 'RESEARCHED' | 'VERIFIED_BUILDER';
};

/**
 * One ship event, shown inside the card as its "Latest ship" (ships feed,
 * 2026-09-03). The card's eight facts do not change; the ship is the reason
 * this card is on the page, so it sits right under the identity.
 */
export type ProjectCardShip = {
  id: string;
  eventType: string;
  title: string;
  publishedAt: Date;
  /** `PUBLICLY_VERIFIED`, `SELF_REPORTED`, … — shown as text, never inferred. */
  verificationStatus: string;
  /** The public source behind the claim; the card links it when there is one. */
  sourceUrl?: string;
};

/**
 * The states a reader may take as "HEY checked this". Everything else — a
 * self-report, a dispute, a retraction — is shown in the muted tone so the
 * two kinds of claim never look alike.
 */
const VERIFIED_STATES = new Set(['PUBLICLY_VERIFIED', 'ADMIN_VERIFIED', 'SOURCE_LINKED']);

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function ProjectCard({
  project,
  ship,
  now,
  showStillBuilding = false,
  marketLens = false,
  className,
}: {
  project: ProjectCardData;
  /** When set, the card is one ship event of this project (the ships feed). */
  ship?: ProjectCardShip;
  now?: Date;
  /**
   * Say why the project is on a Still Building surface (Radar). Off
   * elsewhere: the card carries one status, and a second badge on every
   * card is the badge wall the design contract rules out.
   */
  showStillBuilding?: boolean;
  /**
   * The Token Projects view (Market Lens, 2026-09-12): one extra muted line
   * under the market cap with the reading's liquidity, 24 h volume and the
   * launch stage — the reader asked for market context, so the card gives
   * it. Off on Home, Radar and the Builders view (docs/PROJECT_CARD_V7.md §8).
   */
  marketLens?: boolean;
  className?: string;
}) {
  const marketCap = formatUsdCompact(project.marketCapUsd);
  const marketSource = formatMarketSource(project.marketCapSource);
  // A cap printed for a pool with no liquidity, a removed market or a launch
  // pool nobody traded is a number about nothing (2026-09-11).
  const deadMarket =
    project.tokenMarketStatus === 'NO_LIQUIDITY' ||
    project.tokenMarketStatus === 'LIQUIDITY_REMOVED' ||
    project.tokenMarketStatus === 'MARKET_ABANDONED' ||
    (project.tokenMarketStatus === 'TRADING_INACTIVE' && project.tokenMarketReason === 'launch_pool_no_trades') ||
    project.tokenMarketReason === 'launch_pool_volume_unknown';
  // Readings that disagree, or one HEY does not believe (2026-09-25): no figure, and no claim of a dead market either.
  const unsettledMarket = UNSETTLED_MARKET_REASONS.has(project.tokenMarketReason ?? '');
  const hasToken = Boolean(project.token);
  // What HEY does know about a token it cannot read building from (2026-09-13): trades and on-chain events, as context under the cap.
  const contextLine = hasToken && project.activityStatus === 'UNKNOWN' ? tradeContextLine(project) : undefined;
  const shipVerified = ship ? VERIFIED_STATES.has(ship.verificationStatus) : false;
  // Source text as words: launchpad descriptions arrive with Markdown in them (QA sweep 2026-09-04).
  const description = plainText(project.shortDescription);
  const shipTitle = ship ? plainText(ship.title) : '';
  // "Infrastructure · Infrastructure" says it once: the kind is dropped when
  // the narrative already names it. "Uncategorised" (kind OTHER) is a data
  // state, not a fact about the project; it is shown only when the line
  // would otherwise be empty, never beside a ticker or a narrative.
  const kindLabel = formatProjectKind(project.projectKind);
  const showKind =
    project.primaryNarrative?.name.toLowerCase() !== kindLabel.toLowerCase() &&
    (project.projectKind !== 'OTHER' || (!project.symbol && !project.primaryNarrative));

  return (
    <article
      data-testid="project-card"
      data-slug={project.slug}
      data-has-token={hasToken ? 'true' : 'false'}
      className={cn(
        // min-w-0 matters: a grid item defaults to its min-content width, and a
        // long name or a 32-character ticker would otherwise push the card wider
        // than its track and scroll the whole page sideways on mobile.
        'group relative flex h-full min-w-0 flex-col gap-3.5 rounded-[12px] border border-hey-border bg-hey-surface p-4 sm:p-5',
        'transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-hey-border-strong',
        'hover:shadow-[0_1px_2px_rgba(10,13,18,0.04),0_16px_36px_-18px_rgba(10,13,18,0.22)]',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {/* 1–3 + 6: logo, name, ticker, status */}
      <div className="flex items-start gap-3">
        <ProjectLogo
          name={project.name}
          slug={project.slug}
          logoUrl={project.logoUrl}
          size={44}
          className="rounded-[10px] ring-1 ring-inset ring-hey-border"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-[16px] font-semibold leading-tight tracking-tight">
              {/*
               * The whole card is the target; the link stays the accessible one.
               * Two lines, not one: a name is the identity, and a single
               * truncated line lost it (UI/UX audit U19).
               */}
              <a
                href={`/project/${project.slug}`}
                className="line-clamp-2 [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-[12px] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-hey-ink/30"
              >
                {project.name}
              </a>
            </h3>
            {/*
             * The status, and when that status was last earned (2026-09-05).
             * "Shipping" alone does not say whether that means yesterday or in
             * March, which is the question someone scanning a grid is asking —
             * so the two sit together, and the date says what it is in words.
             * It was briefly an unlabelled `8H AGO` beside the ticker, in the
             * telemetry face, and read as a code fragment rather than a fact.
             *
             * Suppressed when the card carries a ship block, which prints the
             * same date in full, and on a tokenless card, whose "Last ship"
             * row below already says it (UI/UX audit U19: the date was
             * printed twice on those cards).
             */}
            <span className="flex shrink-0 flex-col items-end gap-1">
              <ActivityChip status={project.activityStatus} variant="surface" noBuilderSource={showsNoBuilderSignal(project)} />
              {!ship && hasToken && project.lastMeaningfulShipAt ? (
                <time
                  dateTime={project.lastMeaningfulShipAt.toISOString()}
                  data-testid="card-last-ship"
                  className="text-[12px] leading-none text-hey-muted"
                >
                  Shipped {formatRelativeTime(project.lastMeaningfulShipAt, now)}
                </time>
              ) : null}
            </span>
          </div>
          {/*
           * Ticker, narrative, kind (UI/UX audit U02, 2026-09-11). The card
           * used to say "$AOS" and nothing about what the project is; the
           * design contract puts the narrative or kind on every card. One
           * line, secondary tone, so the identity still leads.
           */}
          <p className="hey-telemetry mt-1 truncate text-hey-secondary">
            {project.symbol ? <span data-testid="ticker">${project.symbol}</span> : null}
            {project.symbol && project.primaryNarrative ? <span aria-hidden="true"> · </span> : null}
            {project.primaryNarrative ? (
              <span data-testid="card-narrative" className="normal-case">{project.primaryNarrative.name}</span>
            ) : null}
            {showKind && (project.symbol || project.primaryNarrative) ? <span aria-hidden="true"> · </span> : null}
            {showKind ? (
              <span data-testid="project-kind" className="normal-case">{kindLabel}</span>
            ) : null}
          </p>
        </div>
      </div>

      {showStillBuilding && project.stillBuilding ? (
        <p className="flex items-center gap-2 text-[13px] text-hey-secondary" data-testid="card-still-building">
          <StillBuildingBadge />
          <span>Kept shipping through a market drawdown.</span>
        </p>
      ) : null}

      {ship ? (
        /*
         * The ship this card stands for: type, title, age and how well it is
         * backed. Between the identity and the facts, in the same subtle
         * surface the address uses, so it reads as context rather than as
         * a ninth fact. The source link is a nested target like the copy
         * and explorer controls: it opens the source, never the project.
         */
        <div
          data-testid="latest-ship"
          data-ship-id={ship.id}
          data-verification={ship.verificationStatus}
          className="min-w-0 rounded-[8px] bg-hey-subtle px-3 py-2.5"
        >
          <p className="flex items-baseline justify-between gap-3">
            {/*
              * "Ship", not "Latest ship" (2026-09-06). This block renders
              * whichever event the surface handed it, and on Ships that is one
              * row of a history: AUM0's card said "Latest ship" over a release
              * from seven hours ago while the same card's status line read
              * "Last ship 3h ago". Both times were right; the label was not.
              */}
            <span className="hey-eyebrow text-hey-muted">Ship</span>
            <time
              dateTime={ship.publishedAt.toISOString()}
              className="hey-telemetry shrink-0 tabular-nums text-hey-muted"
            >
              {formatRelativeTime(ship.publishedAt, now)}
            </time>
          </p>
          <p className="mt-1 truncate text-[14px] font-medium text-hey-ink" title={shipTitle} data-testid="ship-title">
            {shipTitle}
          </p>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]">
            <span className="text-hey-secondary" data-testid="ship-type">
              {formatEventType(ship.eventType)}
            </span>
            <span
              data-testid="ship-verification"
              className={shipVerified ? 'text-hey-secondary' : 'italic text-hey-muted'}
            >
              {formatVerification(ship.verificationStatus)}
            </span>
            {ship.sourceUrl ? (
              <ExternalRef
                href={ship.sourceUrl}
                label={`Open source for ${shipTitle}`}
                className="ml-auto text-[12.5px]"
                data-testid="ship-source"
              >
                Source
              </ExternalRef>
            ) : null}
          </p>
        </div>
      ) : null}

      {/*
       * A ship card stops at the ship (UI/UX audit U11, 2026-09-11). On the
       * feed the same project's market cap, contract and description were
       * printed for every event, so 48 events read as 48 token cards. The
       * facts live one click away on the project page; here the identity,
       * the ship and the footer are the card.
       */}
      {ship ? null : hasToken ? (
        <>
          {/* 4: market cap, from stored snapshots only */}
          <p className="flex items-baseline justify-between gap-3 text-[14px]" data-testid="market-cap">
            {/*
              Named for what it is (parity audit, 2026-09-25): a figure equal to
              the FDV is not called a market cap. The card itself stays inside
              its information budget (PRD V4 16.0 D: no FDV on a card), so it
              says "Valuation" and the tooltip names the measure.
            */}
            {isFullyDiluted(project.marketCapUsd, project.fdvUsd) ? (
              <span className="text-hey-secondary" title="Fully diluted valuation: the provider reports no circulating supply, so this is price × total supply.">
                Valuation
              </span>
            ) : (
              <span className="text-hey-secondary">Market cap</span>
            )}
            {deadMarket ? (
              <span className="text-hey-muted" title="The tracked token has no active market. Context only; it never affects activity status.">
                No active market
              </span>
            ) : unsettledMarket ? (
              <span className="text-hey-muted" title="HEY’s market readings for this token do not agree, so no figure is shown. Context only; it never affects activity status.">
                Unconfirmed
              </span>
            ) : marketCap ? (
              <span
                className="font-medium tabular-nums"
                {...(marketSource ? { title: `via ${marketSource}` } : {})}
              >
                {marketCap}
              </span>
            ) : (
              <span className="text-hey-muted">Unavailable</span>
            )}
          </p>

          {marketLens ? (
            <p className="-mt-1 text-[12.5px] leading-[1.5] text-hey-muted" data-testid="market-lens-line">
              {marketLensLine(project)}
            </p>
          ) : contextLine ? (
            <p className="-mt-1 text-[12.5px] leading-[1.5] text-hey-muted" data-testid="card-context-line">
              {contextLine}
            </p>
          ) : null}

          {/* 5: contract address — identity, never a ticker */}
          <div className="-ml-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <ContractAddress address={project.token!.contractAddress} chainId={project.token!.chainId} />
            {/*
             * The locker, beside the contract rather than on a line of its
             * own: which supply is locked is part of the token's identity,
             * and the card's design contract is eight facts, not nine.
             * It wraps instead of squeezing the address at 375px.
             */}
            {project.tokenLock ? <TokenLockChip lock={project.tokenLock} /> : null}
          </div>

          {/* One line about the token, under its identity (founder, 2026-09-03). */}
          {description ? (
            <p className="line-clamp-2 text-[13.5px] leading-[1.5] text-hey-secondary" data-testid="description">
              {description}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {/*
           * A tokenless project has no market cap or contract to show, so its
           * card carries the equivalent builder facts in the same slots: the
           * last ship where the market cap would be, the site where the
           * address would be, and one line about what it is.
           */}
          <p className="flex items-baseline justify-between gap-3 text-[14px]" data-testid="last-ship">
            <span className="text-hey-secondary">Last ship</span>
            {project.lastMeaningfulShipAt ? (
              <span className="font-medium">{formatRelativeTime(project.lastMeaningfulShipAt, now)}</span>
            ) : (
              <span className="text-hey-muted">None recorded</span>
            )}
          </p>
          {project.websiteUrl ? (
            <p className="flex min-w-0 text-[14px]" data-testid="website">
              <ExternalRef href={project.websiteUrl} label={`Open ${project.name} website`}>
                {hostOf(project.websiteUrl)}
              </ExternalRef>
            </p>
          ) : null}
          {description ? (
            <p className="line-clamp-2 text-[13.5px] leading-[1.5] text-hey-secondary" data-testid="description">
              {description}
            </p>
          ) : null}
        </>
      )}

      {/* 7 + 8: launch origin and official X */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-hey-border pt-3 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5" data-testid="launched-via">
          <span className="text-hey-muted">via</span>
          {project.launchedVia?.url ? (
            <ExternalRef href={project.launchedVia.url} label={`Open ${project.launchedVia.name} launch page`}>
              {project.launchedVia.name}
            </ExternalRef>
          ) : (project.launchedVia?.name ?? 'Unknown') === 'Unknown' && project.marketVenue ? (
            // No launch record, but a pool: say where the token trades, never where it launched.
            <span className="truncate text-hey-secondary" title={`HEY did not observe the launch; the token trades on ${project.marketVenue}.`}>
              DEX ({project.marketVenue})
            </span>
          ) : (
            <span className="truncate text-hey-secondary">{project.launchedVia?.name ?? 'Unknown'}</span>
          )}
        </span>
        {project.officialX ? (
          <ExternalRef
            href={project.officialX.url}
            label={`Open ${project.name} on X`}
            className="shrink-0"
            data-testid="official-x"
          >
            @{project.officialX.handle}
          </ExternalRef>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Responsive grid: one column on a phone, two on a tablet, three across the
 * 1280px shell, where each card keeps well over 300px.
 *
 * `auto-fill`, not `auto-fit`: auto-fit collapses the empty tracks, so a row
 * holding a single project would stretch that one card across the whole page.
 * Keeping the tracks means one card stays one column wide and the row simply
 * looks short, which is the honest shape of the data.
 */
export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Helpful empty states rather than blank screens (UI/UX V2 section 39). */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-[6px] border border-dashed border-hey-border bg-hey-subtle p-12 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      {hint ? <p className="mt-1.5 text-[15px] text-hey-secondary">{hint}</p> : null}
    </div>
  );
}

const STAGE_WORDS: Record<NonNullable<ProjectCardData['launchStage']>, string> = {
  CURVE: 'on the launch curve',
  GRADUATED: 'graduated from its curve',
  DEX: 'in a DEX pool',
};

/**
 * The Market Lens line: what the reading says about the pool, in words, with
 * nothing invented. A launch pool nobody traded says so; a reading without a
 * liquidity figure says which stage the token is in instead of printing a
 * dash; no reading at all names the stage or says the market is unread.
 */
/** Reasons under which HEY claims neither a live market nor a dead one (`@hey/scoring` DEAD_MARKET_REASONS). */
const UNSETTLED_MARKET_REASONS: ReadonlySet<string> = new Set(['pool_readings_disagree', 'readings_implausible', 'removal_unconfirmed']);

export function marketLensLine(project: ProjectCardData): string {
  const parts: string[] = [];
  const liquidity = formatUsdCompact(project.liquidityUsd);
  const volume = formatUsdCompact(project.volume24hUsd);
  if (project.tokenMarketStatus === 'TRADING_INACTIVE' && project.tokenMarketReason === 'launch_pool_no_trades') {
    parts.push('Launch pool, no trades yet');
  } else if (project.tokenMarketReason === 'launch_pool_volume_unknown') {
    parts.push('Launch pool, trading unknown');
  } else if (project.tokenMarketReason === 'readings_implausible') {
    parts.push('Reported liquidity not confirmed');
  } else if (project.tokenMarketReason === 'pool_readings_disagree') {
    parts.push('Pool readings disagree');
  } else if (project.tokenMarketReason === 'removal_unconfirmed') {
    parts.push('Liquidity fall not confirmed');
  } else {
    if (liquidity) parts.push(`Liquidity ${liquidity}`);
    if (volume) parts.push(`24 h volume ${volume}`);
    if (project.buys24h !== undefined && project.sells24h !== undefined) parts.push(`${project.buys24h.toLocaleString('en-US')} buys · ${project.sells24h.toLocaleString('en-US')} sells`);
    const move = formatPercentChange(project.priceChange24hPct);
    if (move) parts.push(`${move} / 24 h`);
  }
  if (project.launchStage === 'DEX' && project.marketVenue) parts.push(`in a ${project.marketVenue} pool`);
  else if (project.launchStage) parts.push(STAGE_WORDS[project.launchStage]);
  if (project.onchainEvents24h !== undefined) parts.push(eventsPhrase(project.onchainEvents24h));
  if (parts.length === 0) return project.marketCapUsd === undefined ? 'No market reading yet' : 'No liquidity figure from this source';
  return parts.join(' · ');
}

/** A price move as "+4.2%" / "−12.0%"; nothing for an absent figure. */
export function formatPercentChange(pct: number | undefined): string | undefined {
  if (pct === undefined || !Number.isFinite(pct)) return undefined;
  const rounded = Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)).toLocaleString('en-US') : Math.abs(pct).toFixed(1);
  return `${pct < 0 ? '−' : '+'}${rounded}%`;
}

const eventsPhrase = (count: number): string => `${count.toLocaleString('en-US')} on-chain event${count === 1 ? '' : 's'} / 24 h`;

/**
 * The context line under an UNKNOWN token card (2026-09-13): what HEY does
 * know when it has nothing to read building from — whether the token traded
 * today and how many events its contract emitted. Context, never a status;
 * nothing invented, so a card with neither fact gets no line.
 */
export function tradeContextLine(project: ProjectCardData): string | undefined {
  const parts: string[] = [];
  if (project.tokenMarketStatus === 'ACTIVE_MARKET') parts.push('Traded today');
  else if (project.tokenMarketStatus === 'TRADING_INACTIVE' && project.tokenMarketReason === 'launch_pool_no_trades') parts.push('Launch pool, no trades yet');
  else if (project.tokenMarketReason === 'launch_pool_volume_unknown') parts.push('Launch pool, trading unknown');
  else if (project.tokenMarketStatus === 'TRADING_INACTIVE') parts.push('No trades today');
  if (project.onchainEvents24h !== undefined) parts.push(eventsPhrase(project.onchainEvents24h));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

