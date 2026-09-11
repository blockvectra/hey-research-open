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
} from './format';
import { ProjectLogo } from './project-logo';
import { ActivityChip, type ActivityStatusValue, StillBuildingBadge } from './status';
import { ContractAddress, ExternalRef } from './token-identity';

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
  /** The tracked token's market state (2026-09-11); a dead pool shows "No active market" instead of a cap. */
  tokenMarketStatus?: string;
  tokenMarketReason?: string;
  /** Which provider the reading came from; shown as a title, never as layout. */
  marketCapSource?: string;
  /** Canonical token identity. Absent for a project without a token. */
  token?: { chainId: number; contractAddress: string };
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
    (project.tokenMarketStatus === 'TRADING_INACTIVE' && project.tokenMarketReason === 'launch_pool_no_trades');
  const hasToken = Boolean(project.token);
  const shipVerified = ship ? VERIFIED_STATES.has(ship.verificationStatus) : false;
  // Source text as words: launchpad descriptions arrive with Markdown in them (QA sweep 2026-09-04).
  const description = plainText(project.shortDescription);
  const shipTitle = ship ? plainText(ship.title) : '';

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
              <ActivityChip status={project.activityStatus} variant="surface" />
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
            {project.symbol || project.primaryNarrative ? <span aria-hidden="true"> · </span> : null}
            <span data-testid="project-kind" className="normal-case">{formatProjectKind(project.projectKind)}</span>
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
            <span className="text-hey-secondary">Market cap</span>
            {deadMarket ? (
              <span className="text-hey-muted" title="The tracked token has no active market. Context only; it never affects activity status.">
                No active market
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

          {/* 5: contract address — identity, never a ticker */}
          <ContractAddress
            address={project.token!.contractAddress}
            chainId={project.token!.chainId}
            className="-ml-1.5"
          />

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
 * Consistency at a glance (UI/UX V2 section 19). Filled blocks are weeks that
 * contained a meaningful, verified build event — never social activity.
 */
export function BuildStreak({ weeks, className }: { weeks: number; className?: string }) {
  const shown = Math.min(weeks, 12);
  const label = `${weeks} week shipping streak`;

  return (
    <div className={className}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-hey-muted">Build streak</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex gap-[3px]" role="img" aria-label={label}>
          {Array.from({ length: shown }, (_, index) => (
            <span key={index} className="h-3.5 w-2 rounded-[2px] bg-blue-500" />
          ))}
        </span>
        <span className="text-[13px] text-hey-secondary">
          {weeks} {weeks === 1 ? 'week' : 'weeks'}
        </span>
      </div>
    </div>
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

/** Layout-aware skeleton so loading does not shift the grid (section 38). */
export function ProjectCardSkeleton() {
  return (
    <div className="rounded-[12px] border border-hey-border bg-hey-surface p-5">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-[10px] bg-hey-border/70" />
        <div className="flex-1">
          <div className="h-4 w-1/2 rounded bg-hey-border" />
          <div className="mt-2 h-3 w-1/4 rounded bg-hey-border/70" />
        </div>
      </div>
      <div className="mt-4 h-3.5 w-full rounded bg-hey-border/50" />
      <div className="mt-2 h-6 w-2/3 rounded bg-hey-border/50" />
      <div className="mt-4 h-3 w-1/2 rounded bg-hey-border/50" />
    </div>
  );
}

export { ProjectCardSkeleton as CardSkeleton };
