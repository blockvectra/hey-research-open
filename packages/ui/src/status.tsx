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

import {
  ACTIVITY_NOT_MEASURABLE,
  ACTIVITY_STATUS_WORDS,
  activityPresentation,
  NO_BUILDER_SIGNAL,
  unknownActivityReason,
  type UnknownActivityReason,
} from '@hey/scoring/activity-words';
import {
  isLaunchPoolReason,
  LAUNCH_POOL_ONLY_LABEL,
  NOT_FUNGIBLE_LABEL,
  READING_NOT_CURRENT_LABEL,
  TOKEN_MARKET_LABELS,
  type UnconfirmedMarketReason,
} from '@hey/scoring/market-status-words';
import { RESEARCH_LEVEL_WORDS } from '@hey/scoring/research-level-words';

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

/*
 * The words come from `@hey/scoring/activity-words` (2026-10-01): the one
 * table the chip, the Research Summary and the API read, so a project's
 * status reads the same on the page and in an agent's answer. This file adds
 * the icon and the colours.
 */
const STATUS_STYLE: Record<ActivityStatusValue, { Icon: LucideIcon; text: string; surface: string }> = {
  SHIPPING: { Icon: PackageCheck, text: 'text-status-shipping', surface: 'bg-status-shipping-bg text-status-shipping' },
  ACTIVE: { Icon: Activity, text: 'text-status-active', surface: 'bg-status-active-bg text-status-active' },
  QUIET: { Icon: Clock3, text: 'text-status-quiet', surface: 'bg-status-quiet-bg text-status-quiet' },
  DORMANT: { Icon: PauseCircle, text: 'text-status-dormant', surface: 'bg-status-dormant-bg text-status-dormant' },
  RESUMED: { Icon: RefreshCcw, text: 'text-status-resumed', surface: 'bg-status-resumed-bg text-status-resumed' },
  UNKNOWN: { Icon: CircleHelp, text: 'text-status-unknown', surface: 'bg-status-unknown-bg text-status-unknown' },
};

export { ACTIVITY_NOT_MEASURABLE, activityPresentation, NO_BUILDER_SIGNAL, unknownActivityReason, type UnknownActivityReason };

/**
 * Whether a project reads "No builder signal yet" (2026-09-25): UNKNOWN,
 * no source HEY can read building from, *and* no ship on record. A project
 * whose page says "Last ship 1mo ago" has had a builder signal — a
 * deployment, a release read from somewhere else — and the chip printed
 * beside it contradicted the line under it.
 */
export function showsNoBuilderSignal(project: {
  activityStatus: string;
  hasBuilderSource?: boolean | undefined;
  lastMeaningfulShipAt?: Date | string | null | undefined;
}): boolean {
  return unknownActivityReason(project) === 'no_builder_signal';
}

export function ActivityChip({
  status,
  variant = 'text',
  noBuilderSource = false,
  unknownReason,
  answer,
  className,
}: {
  status: ActivityStatusValue;
  /** `surface` gives the chip its own tinted pill, for hero and card headers. */
  variant?: 'text' | 'surface';
  /** UNKNOWN with nothing to read and nothing shipped: "No builder signal yet". Superseded by `unknownReason`. */
  noBuilderSource?: boolean;
  /** Why an UNKNOWN is unknown (`unknownActivityReason`); takes precedence over `noBuilderSource`. */
  unknownReason?: UnknownActivityReason | null;
  /**
   * The human answer to print in place of the status word (2026-10-01): the
   * Research Summary's `answer` ("Quiet for 34 days"), same icon and colour.
   * The status word stays in `data-activity-status` and the title.
   */
  answer?: string | undefined;
  className?: string;
}) {
  const presentation = STATUS_STYLE[status] ?? STATUS_STYLE.UNKNOWN;
  const { Icon } = presentation;
  const reason = unknownReason !== undefined ? unknownReason : noBuilderSource ? 'no_builder_signal' : null;
  const { label: statusLabel, help } = activityPresentation(status, reason);
  const label = answer ?? statusLabel;

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
      {...(status === 'UNKNOWN' && reason ? { 'data-unknown-reason': reason } : {})}
    >
      <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      {label}
    </span>
  );
}

export function activityLabel(status: ActivityStatusValue): string {
  return (ACTIVITY_STATUS_WORDS[status] ?? ACTIVITY_STATUS_WORDS.UNKNOWN).label;
}

export function activityHelp(status: ActivityStatusValue): string {
  return (ACTIVITY_STATUS_WORDS[status] ?? ACTIVITY_STATUS_WORDS.UNKNOWN).help;
}

/**
 * Still Building (section 32).
 *
 * Gold Soft on Gold Dark text — a HEY intelligence signal, not a market one.
 * The wording stays factual for the same reason the colour is not green: it
 * records that building continued through a decline in attention, and implies
 * nothing about what happens next.
 */
/** What the badge means, in one sentence: the badge's title, the glossary and the card's Term read it. */
export const STILL_BUILDING_HELP = 'Market attention declined while meaningful building continued.';

export function StillBuildingBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-gold-300 bg-gold-soft px-2.5 py-1 text-xs font-medium text-gold-dark',
        className,
      )}
      title={STILL_BUILDING_HELP}
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

/** The words are `RESEARCH_LEVEL_WORDS` (`@hey/scoring`), the table the build line and "What HEY checked" read too. */
const RESEARCH_PRESENTATION: Record<ResearchLevelValue, { label: string; className: string; help: string }> = {
  INDEXED: { ...RESEARCH_LEVEL_WORDS.INDEXED, className: 'border-hey-border bg-ice-100 text-hey-secondary' },
  RESEARCHED: { ...RESEARCH_LEVEL_WORDS.RESEARCHED, className: 'border-blue-300 bg-blue-soft text-blue-600' },
  VERIFIED_BUILDER: { ...RESEARCH_LEVEL_WORDS.VERIFIED_BUILDER, className: 'border-gold-300 bg-gold-soft text-gold-dark' },
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
/*                                                                           */
/* No green (public UX review, 2026-09-28). "Active market" and "Token       */
/* verified" wore the builder status green (#1f7a5b), so on a meme page with */
/* no builder signal the only green was the market. Green is builder state;  */
/* red and green on a market mark are direction (UI rule 13) — a market's    */
/* *state* is neither, so it is ink, and a quieter state is muted.           */
/* ------------------------------------------------------------------------ */

/** A market or token-identity state's tone: never a builder colour, never a direction colour. */
type MarketTone = 'neutral' | 'muted';

export type TokenMarketStatusValue =
  | 'ACTIVE_MARKET'
  | 'LOW_LIQUIDITY'
  | 'NO_LIQUIDITY'
  | 'TRADING_INACTIVE'
  | 'LIQUIDITY_REMOVED'
  | 'MARKET_ABANDONED'
  | 'INSUFFICIENT_DATA'
  | 'TOKEN_NOT_LAUNCHED';

const TOKEN_MARKET_PRESENTATION: Record<TokenMarketStatusValue, { label: string; help: string; tone: MarketTone }> = {
  ACTIVE_MARKET: { label: TOKEN_MARKET_LABELS.ACTIVE_MARKET, help: 'The tracked token has liquidity and traded in the last 24 hours.', tone: 'neutral' },
  LOW_LIQUIDITY: { label: TOKEN_MARKET_LABELS.LOW_LIQUIDITY, help: 'The tracked token has a small pool. Trades move the price a lot.', tone: 'neutral' },
  NO_LIQUIDITY: { label: TOKEN_MARKET_LABELS.NO_LIQUIDITY, help: 'HEY found no meaningful liquidity for the tracked token.', tone: 'neutral' },
  TRADING_INACTIVE: { label: TOKEN_MARKET_LABELS.TRADING_INACTIVE, help: 'The tracked token has liquidity but recorded no trades in the last 24 hours.', tone: 'neutral' },
  LIQUIDITY_REMOVED: { label: TOKEN_MARKET_LABELS.LIQUIDITY_REMOVED, help: 'HEY recorded meaningful liquidity earlier; it is no longer there. A fact HEY observed, not a verdict on why.', tone: 'neutral' },
  MARKET_ABANDONED: { label: TOKEN_MARKET_LABELS.MARKET_ABANDONED, help: 'HEY recorded a market earlier and has not been able to read one for weeks.', tone: 'muted' },
  INSUFFICIENT_DATA: { label: TOKEN_MARKET_LABELS.INSUFFICIENT_DATA, help: 'HEY has not read enough market data to describe this token.', tone: 'muted' },
  TOKEN_NOT_LAUNCHED: { label: 'No token tracked', help: 'HEY tracks no token for this project.', tone: 'muted' },
};

const TONE: Record<MarketTone, string> = {
  neutral: 'text-hey-ink',
  muted: 'text-hey-muted',
};

/**
 * An active market that is only a launch pool (2026-10-02, outsider audit):
 * "Launch pool only", muted, never "Active market" beside "launch pool
 * inventory, not a market". The reason is the classifier's; without it the
 * status's own label stands.
 */
const LAUNCH_POOL_ONLY_PRESENTATION = {
  label: LAUNCH_POOL_ONLY_LABEL,
  help: 'The only pool HEY reads is the one the token launched in: its "liquidity" is the token’s own supply at its last price, not depth. HEY does not measure a Discovery Gap, Under the Radar or Still Building on it.',
  tone: 'muted' as MarketTone,
};
/*
 * Two reasons that name what the token or reading is (2026-10-03, full
 * audit): an NFT collection is no fungible market, and a reading days old
 * says nothing about the last day's trading.
 */
const NOT_FUNGIBLE_PRESENTATION = {
  label: NOT_FUNGIBLE_LABEL,
  help: 'The tracked token reads 0 decimals: an NFT collection or another token that is not fungible. A marketplace sale of it is not a fungible market, so HEY shows no valuation and measures no Discovery Gap, Under the Radar or Still Building on it.',
  tone: 'muted' as MarketTone,
};
const READING_NOT_CURRENT_PRESENTATION = {
  label: READING_NOT_CURRENT_LABEL,
  help: 'HEY’s newest reading of this market is more than 36 hours old, so whether it traded in the last day is not known. The figures shown are that reading’s, with its date.',
  tone: 'muted' as MarketTone,
};
const marketPresentation = (status: TokenMarketStatusValue, reason?: string | null) =>
  reason === 'not_a_fungible_token'
    ? NOT_FUNGIBLE_PRESENTATION
    : reason === 'reading_not_current'
      ? READING_NOT_CURRENT_PRESENTATION
      : status === 'ACTIVE_MARKET' && isLaunchPoolReason(reason)
        ? LAUNCH_POOL_ONLY_PRESENTATION
        : (TOKEN_MARKET_PRESENTATION[status] ?? TOKEN_MARKET_PRESENTATION.INSUFFICIENT_DATA);

export function TokenMarketChip({ status, reason, className }: { status: TokenMarketStatusValue; reason?: string | null; className?: string }) {
  const presentation = marketPresentation(status, reason);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', TONE[presentation.tone], className)} title={presentation.help} data-testid="token-market-chip">
      {presentation.label}
    </span>
  );
}

export function tokenMarketLabel(status: TokenMarketStatusValue, reason?: string | null): string {
  return marketPresentation(status, reason).label;
}

/*
 * Reasons whose sentence is more exact than the status's (2026-09-25): the
 * status alone said "has liquidity and traded" over a reading of $1, because
 * the market was in another pool the page did not name.
 */
/* Keyed by the scoring package's list, so the summary's "Readings not confirmed" rule and these sentences cannot drift. */
const TOKEN_MARKET_REASON_HELP: Readonly<Record<UnconfirmedMarketReason, string>> = {
  liquidity_in_another_pool:
    'The pool the latest reading follows is nearly empty, but another pool HEY read in the last day holds liquidity. The figures shown are the latest reading’s own pool.',
  pool_readings_disagree:
    'HEY’s readings disagree: the latest follows a nearly empty pool, while another pool held liquidity within the week. HEY claims neither a live market nor a drain until a fresh reading settles it.',
  launch_pool_volume_unknown:
    'A launch pool still holding the token’s own supply, and no reading reports its volume. Whether it trades is unknown, not zero.',
  readings_implausible:
    'The latest reading reports a large pool, but almost nothing traded in it and HEY’s own chain index does not find that liquidity. HEY does not show a figure it cannot believe, and claims neither a live market nor a drain.',
  removal_unconfirmed:
    'The latest reading finds almost no liquidity, but HEY has not measured a drain: the pool that held the market has not been read empty on two days, or a later reading still found it. HEY claims neither a live market nor a removal until it has.',
};

export function tokenMarketHelp(status: TokenMarketStatusValue, reason?: string | null): string {
  const exact = reason ? (TOKEN_MARKET_REASON_HELP as Readonly<Record<string, string>>)[reason] : undefined;
  if (exact) return exact;
  return marketPresentation(status, reason).help;
}

export type TokenVerificationValue = 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH';

const TOKEN_VERIFICATION_PRESENTATION: Record<TokenVerificationValue, { label: string; help: string; tone: MarketTone }> = {
  VERIFIED: { label: 'Token verified', help: 'The project itself ties this contract to the project: its site names the contract, or the owner proved control of the deployer.', tone: 'neutral' },
  UNVERIFIED: { label: 'Token unverified', help: 'HEY found this token through a launch record or a market listing. Nothing the project itself published ties the contract to the project yet.', tone: 'muted' },
  MISMATCH: { label: 'Contract mismatch', help: 'The project’s own site names a different contract than the one HEY tracks. Treat the tracked token with care.', tone: 'neutral' },
};

export function TokenVerificationChip({ verification, className }: { verification: TokenVerificationValue; className?: string }) {
  const presentation = TOKEN_VERIFICATION_PRESENTATION[verification] ?? TOKEN_VERIFICATION_PRESENTATION.UNVERIFIED;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', TONE[presentation.tone], className)} title={presentation.help} data-testid="token-verification-chip">
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

