import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  CircleHelp,
  Clock3,
  Flame,
  Hammer,
  PackageCheck,
  PauseCircle,
  RefreshCcw,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from './cn';

/**
 * Activity status (UI/UX V4 sections 31, 13).
 *
 * Status outranks every number in the interface, so this is the most prominent
 * signal on a card. Each status carries a text label as well as a colour and a
 * vector icon: status is never communicated by colour alone, and never by emoji
 * — HEY authors zero emoji in production UI (section 12).
 *
 * UNKNOWN is deliberately neutral grey. Red is reserved for real errors, and
 * "HEY has not researched this yet" is a gap in HEY's knowledge, not a fault of
 * the project.
 */
export type ActivityStatusValue =
  'SHIPPING' | 'ACTIVE' | 'QUIET' | 'DORMANT' | 'RESUMED' | 'UNKNOWN';

const STATUS_PRESENTATION: Record<
  ActivityStatusValue,
  { Icon: LucideIcon; label: string; text: string; surface: string; help: string }
> = {
  SHIPPING: {
    Icon: PackageCheck,
    label: 'Shipping',
    text: 'text-status-shipping',
    surface: 'bg-status-shipping-bg text-status-shipping',
    help: 'Shipped something meaningful in the last 7 days.',
  },
  ACTIVE: {
    Icon: Activity,
    label: 'Active',
    text: 'text-status-active',
    surface: 'bg-status-active-bg text-status-active',
    help: 'Meaningful updates in the last month.',
  },
  QUIET: {
    Icon: Clock3,
    label: 'Quiet',
    text: 'text-status-quiet',
    surface: 'bg-status-quiet-bg text-status-quiet',
    help: 'No meaningful updates for over a month.',
  },
  DORMANT: {
    Icon: PauseCircle,
    label: 'Dormant',
    text: 'text-status-dormant',
    surface: 'bg-status-dormant-bg text-status-dormant',
    help: 'No meaningful updates observed for a long time. Not the same as abandoned.',
  },
  RESUMED: {
    Icon: RefreshCcw,
    label: 'Resumed building',
    text: 'text-status-resumed',
    surface: 'bg-status-resumed-bg text-status-resumed',
    help: 'Started shipping again after a long gap.',
  },
  UNKNOWN: {
    Icon: CircleHelp,
    label: 'Activity unknown',
    text: 'text-status-unknown',
    surface: 'bg-status-unknown-bg text-status-unknown',
    help: 'Not enough public sources to judge activity yet.',
  },
};

/**
 * UNKNOWN with nothing to read (2026-09-13). Most token projects HEY found
 * through trades hold no repository, changelog or feed, so "Activity unknown"
 * on them read as HEY not having looked. It looked; there is nothing to read
 * building from yet, and trading is not building.
 */
export const NO_BUILDER_SIGNAL = {
  label: 'No builder signal yet',
  help: 'No repository, changelog or feed for HEY to read building from. Trading is not building.',
} as const;

export function ActivityChip({
  status,
  variant = 'text',
  noBuilderSource = false,
  className,
}: {
  status: ActivityStatusValue;
  /** `surface` gives the chip its own tinted pill, for hero and card headers. */
  variant?: 'text' | 'surface';
  /** UNKNOWN because HEY holds no source it can read building from: the chip says so instead of "unknown". */
  noBuilderSource?: boolean;
  className?: string;
}) {
  const presentation = STATUS_PRESENTATION[status] ?? STATUS_PRESENTATION.UNKNOWN;
  const { Icon } = presentation;
  const label = status === 'UNKNOWN' && noBuilderSource ? NO_BUILDER_SIGNAL.label : presentation.label;
  const help = status === 'UNKNOWN' && noBuilderSource ? NO_BUILDER_SIGNAL.help : presentation.help;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium',
        variant === 'surface'
          ? cn('rounded-full px-2.5 py-1 text-[13px]', presentation.surface)
          : presentation.text,
        className,
      )}
      title={help}
      // The canonical value behind the words, so every surface can be checked against the API (2026-09-25).
      data-activity-status={status}
    >
      <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      {label}
    </span>
  );
}

export function activityLabel(status: ActivityStatusValue): string {
  return (STATUS_PRESENTATION[status] ?? STATUS_PRESENTATION.UNKNOWN).label;
}

export function activityHelp(status: ActivityStatusValue): string {
  return (STATUS_PRESENTATION[status] ?? STATUS_PRESENTATION.UNKNOWN).help;
}

/**
 * Still Building (section 32).
 *
 * Gold Soft on Gold Dark text — a HEY intelligence signal, not a market one.
 * The wording stays factual for the same reason the colour is not green: it
 * records that building continued through a decline in attention, and implies
 * nothing about what happens next.
 */
export function StillBuildingBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-gold-300 bg-gold-soft px-2.5 py-1 text-xs font-medium text-gold-dark',
        className,
      )}
      title="Market attention declined while meaningful building continued."
    >
      <Hammer aria-hidden="true" size={14} strokeWidth={1.9} />
      Still Building
    </span>
  );
}

/**
 * Research level (section 39).
 *
 * Distinct from activity status: this says how far HEY's research has gone, not
 * what the project is doing. INDEXED is neutral Ice — a verified launch HEY has
 * not studied yet is not a lesser project, only a less-studied one.
 */
export type ResearchLevelValue = 'INDEXED' | 'RESEARCHED' | 'VERIFIED_BUILDER';

const RESEARCH_PRESENTATION: Record<
  ResearchLevelValue,
  { label: string; className: string; help: string }
> = {
  INDEXED: {
    label: 'Indexed',
    className: 'border-hey-border bg-ice-100 text-hey-secondary',
    help: 'Verified on Robinhood Chain. Not researched yet.',
  },
  RESEARCHED: {
    label: 'Researched',
    className: 'border-blue-300 bg-blue-soft text-blue-600',
    help: 'HEY has enriched this project from public sources.',
  },
  VERIFIED_BUILDER: {
    label: 'Verified Builder',
    className: 'border-gold-300 bg-gold-soft text-gold-dark',
    help: 'HEY holds verified evidence of shipping.',
  },
};

export function ResearchLevelBadge({
  level,
  className,
}: {
  level: ResearchLevelValue;
  className?: string;
}) {
  const presentation = RESEARCH_PRESENTATION[level] ?? RESEARCH_PRESENTATION.INDEXED;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        presentation.className,
        className,
      )}
      title={presentation.help}
    >
      {presentation.label}
    </span>
  );
}

/** Shipping streak (section 33). Vector flame — never the emoji. */
export function ShippingStreakBadge({ weeks, className }: { weeks: number; className?: string }) {
  if (weeks <= 0) return null;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium', className)}>
      <Flame aria-hidden="true" size={14} strokeWidth={1.9} className="text-gold-dark" />
      {weeks}-week shipping streak
    </span>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-hey-border px-2.5 py-1 text-xs text-hey-secondary',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Token market status and token verification (2026-09-11).                  */
/*                                                                           */
/* Shown beside, never inside, activity status: a project can be shipping    */
/* while its tracked token has no liquidity, and a reader should see both    */
/* facts on the same line without one colouring the other. Neutral surfaces: */
/* these are market observations, not HEY intelligence signals.              */
/* ------------------------------------------------------------------------ */

export type TokenMarketStatusValue =
  | 'ACTIVE_MARKET'
  | 'LOW_LIQUIDITY'
  | 'NO_LIQUIDITY'
  | 'TRADING_INACTIVE'
  | 'LIQUIDITY_REMOVED'
  | 'MARKET_ABANDONED'
  | 'INSUFFICIENT_DATA'
  | 'TOKEN_NOT_LAUNCHED';

const TOKEN_MARKET_PRESENTATION: Record<TokenMarketStatusValue, { label: string; help: string; tone: 'good' | 'neutral' | 'muted' }> = {
  ACTIVE_MARKET: { label: 'Active market', help: 'The tracked token has liquidity and traded in the last 24 hours.', tone: 'good' },
  LOW_LIQUIDITY: { label: 'Low liquidity', help: 'The tracked token has a small pool. Trades move the price a lot.', tone: 'neutral' },
  NO_LIQUIDITY: { label: 'No liquidity', help: 'HEY found no meaningful liquidity for the tracked token.', tone: 'neutral' },
  TRADING_INACTIVE: { label: 'Trading inactive', help: 'The tracked token has liquidity but recorded no trades in the last 24 hours.', tone: 'neutral' },
  LIQUIDITY_REMOVED: { label: 'Liquidity no longer detected', help: 'HEY recorded meaningful liquidity earlier; it is no longer there. A fact HEY observed, not a verdict on why.', tone: 'neutral' },
  MARKET_ABANDONED: { label: 'Market not detected', help: 'HEY recorded a market earlier and has not been able to read one for weeks.', tone: 'muted' },
  INSUFFICIENT_DATA: { label: 'Market data insufficient', help: 'HEY has not read enough market data to describe this token.', tone: 'muted' },
  TOKEN_NOT_LAUNCHED: { label: 'No token', help: 'HEY tracks no token for this project.', tone: 'muted' },
};

const TONE: Record<'good' | 'neutral' | 'muted', string> = {
  good: 'text-status-active',
  neutral: 'text-hey-ink',
  muted: 'text-hey-muted',
};

export function TokenMarketChip({ status, className }: { status: TokenMarketStatusValue; className?: string }) {
  const presentation = TOKEN_MARKET_PRESENTATION[status] ?? TOKEN_MARKET_PRESENTATION.INSUFFICIENT_DATA;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', TONE[presentation.tone], className)} title={presentation.help}>
      {presentation.label}
    </span>
  );
}

export function tokenMarketLabel(status: TokenMarketStatusValue): string {
  return (TOKEN_MARKET_PRESENTATION[status] ?? TOKEN_MARKET_PRESENTATION.INSUFFICIENT_DATA).label;
}

export function tokenMarketHelp(status: TokenMarketStatusValue): string {
  return (TOKEN_MARKET_PRESENTATION[status] ?? TOKEN_MARKET_PRESENTATION.INSUFFICIENT_DATA).help;
}

export type TokenVerificationValue = 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH';

const TOKEN_VERIFICATION_PRESENTATION: Record<TokenVerificationValue, { label: string; help: string; tone: 'good' | 'neutral' | 'muted' }> = {
  VERIFIED: { label: 'Token verified', help: 'The project itself ties this contract to the project: its site names the contract, or the owner proved control of the deployer.', tone: 'good' },
  UNVERIFIED: { label: 'Token unverified', help: 'HEY found this token through a launch record or a market listing. Nothing the project itself published ties the contract to the project yet.', tone: 'muted' },
  MISMATCH: { label: 'Contract mismatch', help: 'The project’s own site names a different contract than the one HEY tracks. Treat the tracked token with care.', tone: 'neutral' },
};

export function TokenVerificationChip({ verification, className }: { verification: TokenVerificationValue; className?: string }) {
  const presentation = TOKEN_VERIFICATION_PRESENTATION[verification] ?? TOKEN_VERIFICATION_PRESENTATION.UNVERIFIED;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', TONE[presentation.tone], className)} title={presentation.help}>
      {presentation.label}
    </span>
  );
}

export function tokenVerificationLabel(verification: TokenVerificationValue): string {
  return (TOKEN_VERIFICATION_PRESENTATION[verification] ?? TOKEN_VERIFICATION_PRESENTATION.UNVERIFIED).label;
}

export function tokenVerificationHelp(verification: TokenVerificationValue): string {
  return (TOKEN_VERIFICATION_PRESENTATION[verification] ?? TOKEN_VERIFICATION_PRESENTATION.UNVERIFIED).help;
}

/** Where a launch stands (Market Lens, 2026-09-12): plain words for the page. */
export const LAUNCH_STAGE_LABEL: Record<'CURVE' | 'GRADUATED' | 'DEX', string> = {
  CURVE: 'On the launch curve',
  GRADUATED: 'Graduated from its launch curve',
  DEX: 'Trading in a DEX pool',
};

/**
 * Why there is no market data, in one sentence (Market Lens, 2026-09-12):
 * what the last refresh found and when. A refusal or an outage is never
 * read as "no pool", and an unchecked token says so.
 */
export function marketCheckSentence(input: { result?: 'READING' | 'NO_POOL' | 'PROVIDER_DOWN' | 'BUDGET' | 'PACED' | undefined; checkedAt?: Date | undefined; ago: (date: Date) => string }): string | undefined {
  const when = input.checkedAt ? ` ${input.ago(input.checkedAt)}` : '';
  switch (input.result) {
    case 'NO_POOL':
      return `Checked${when}: no pool listed on DEX Screener or GeckoTerminal for this contract. A launch that has not graduated has none yet.`;
    case 'PROVIDER_DOWN':
      return `The market providers could not be read at the last check${when}; HEY will ask again. This says nothing about the token.`;
    case 'BUDGET':
    case 'PACED':
      return `HEY held its own market reads at the last check${when} to stay inside the providers' limits; it will ask again.`;
    case 'READING':
      return undefined;
    default:
      return input.checkedAt ? undefined : 'HEY has not asked the market providers about this contract yet.';
  }
}

