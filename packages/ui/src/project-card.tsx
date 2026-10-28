import type { ReactNode } from 'react';

import { cn } from './cn';
import { emailSafe } from './email-safe';
import {
  formatMarketSource,
  formatProjectKind,
  formatRelativeTime,
  formatUsdCompact,
  formatVerification,
  oneLineDescription,
  projectDisplayName,
  shipKindLabel,
  staleReadingAge,
  tickerLabel,
} from './format';
import { discoveryGapMarketMeasurable, marketVolumeTooThin } from '@hey/scoring/token-market';
import { valuationDisplay, valuationDisplayLabel, valuationHiddenCardWords, valuationHiddenSentence } from '@hey/scoring/valuation-display';
import { projectCategory } from './project-category';
import { ProjectLogo } from './project-logo';
import { cardShipPhrase, displayShipTitle } from './ship-phrase';
import { ActivityChip, activityPresentation, type ActivityStatusValue, isLaunchPoolOnlyMarket, LAUNCH_POOL_ONLY_PRESENTATION, unknownActivityReason, StillBuildingBadge, TokenVerificationChip, tokenVerificationHelp, tokenVerificationLabel } from './status';
import { ContractAddress, ExternalRef } from './token-identity';
import { cardTokenLock, TokenLockChip, type TokenLockFacts } from './token-lock';
import { BrandNotice, type BrandNoticeData } from './brand-notice';

/**
 * Project card (Card V7, 2026-09-03; recomposed in the public IA pass,
 * 2026-09-28). The public discovery primitive: card = discovery, project page
 * = understanding, Terminal = deep research.
 *
 *   [LOGO] NAME
 *          $TICKER · Narrative
 *   [● Shipping]  SDK v0.4 · 2d ago                ← builder state + latest signal
 *   One or two lines about what it is.
 *   ─────────────────────────────────────────
 *   Market cap                         $1.24M      ← market context
 *   0x82ae…91bf  [copy]                            ← reference
 *   via Pons                           @project    ← origin
 *
 * One link, one action (2026-10-28 simplicity study, DISC-7): the card is one link to the project — the name, whose
 * stretched target covers the card — and one button, copy the contract, with a 44px target. The launch page, the
 * explorer and the X account are named here as text and linked on the project page: a card carried seven tab stops
 * (24 cards made 168 of Explore's 229 interactive elements) with targets of 20–28px. The facts are unchanged.
 *
 * The order is the reading order a first-time visitor needs: who it is, is it
 * building, what did it ship, what is it, what is the market, how do I check
 * it. The status leads the body at its own size (UI rule 4); the latest
 * signal is one line from the canonical latest meaningful ship; the market
 * row reads `valuationDisplay` and nothing else. A project with no token HEY
 * tracks says "No token tracked" in the market slot and links its own site there.
 *
 * What is deliberately absent: momentum and gap scores, ship counts, commit
 * strips, holder / volume / liquidity figures, wallet analytics and second
 * source links. The project page carries all of that behind the card; the
 * card is for recognising a project, not researching it.
 *
 * Every fact is shown only when HEY holds it. Nothing here is inferred from a
 * name or a ticker — the token's identity is its chain id and contract
 * address — and nothing here is derived: every value is a canonical card fact.
 */
/**
 * A token the project's own site does not stand behind (2026-10-24 full audit INV-1): MISMATCH — the site names
 * another contract — or one the site names and disowns (`site_disclaims_contract`). The share line's rule
 * (`shareSymbolOf`, founder F7): the card prints neither its ticker beside the project's name nor its valuation as
 * the project's, on any card. The contract row and its chip still say which token HEY tracks.
 */
export function cardTokenNotTheProjects(project: Pick<ProjectCardData, 'tokenVerification' | 'tokenVerificationReason'>): boolean {
  return project.tokenVerification === 'MISMATCH' || project.tokenVerificationReason === 'site_disclaims_contract';
}

/**
 * Whether a card prints a valuation at all (display only, never a score or an order input).
 *
 * 2026-10-24 full audit UI-7 (founder delegation): a default card — every card but the Token Projects view, where the
 * reader asked for market context — printed one only when the tracked token is VERIFIED, or its market is
 * ACTIVE_MARKET and its ticker is not contested. A token that is not the project's (INV-1) prints none on any card.
 *
 * 2026-10-28 simplicity study, ruling R5 (founder "semua R ya", DATA-6, DISC-15): a default card also prints one only
 * on a market HEY measures — the Discovery Gap's own measured-market test (`discoveryGapMarketMeasurable`: an
 * ACTIVE_MARKET that is more than a launch curve or a launch pool, hbm-v18/v22; `marketVolumeTooThin`: a measured 24 h
 * volume of $1,000 or more, hbm-v31) — and only when the figure is shown (`valuationDisplay`). Otherwise no valuation
 * row and no placeholder: the project page says why. "Valuation $24M" beside "No trades in 24 h" was the largest
 * figure on a card whose own page declined to measure its market (172 cards on 2026-10-28).
 */
export function cardShowsValuation(
  project: Pick<
    ProjectCardData,
    | 'tokenVerification'
    | 'tokenVerificationReason'
    | 'tokenMarketStatus'
    | 'tokenMarketReason'
    | 'tokenTickerContested'
    | 'launchStage'
    | 'volume24hUsd'
    | 'marketCapUsd'
    | 'fdvUsd'
    | 'valuationImplausible'
  >,
  options: { marketLens?: boolean } = {},
): boolean {
  if (cardTokenNotTheProjects(project)) return false;
  if (options.marketLens) return true;
  if (!cardMarketMeasured(project)) return false;
  if (project.tokenVerification !== 'VERIFIED' && project.tokenTickerContested === true) return false;
  return valuationDisplay({
    valueUsd: project.marketCapUsd,
    fdvUsd: project.fdvUsd,
    marketStatus: project.tokenMarketStatus,
    marketReason: project.tokenMarketReason,
    valuationImplausible: project.valuationImplausible,
  }).shown;
}

/**
 * Whether the card's tracked market is one HEY measures (R5, 2026-10-28): the Discovery Gap's test, read, never
 * restated — `discoveryGapMarketMeasurable` on the status, launch stage and reason, and `marketVolumeTooThin` on the
 * reading's 24 h volume (a volume HEY does not hold never trips it: unknown is not thin).
 */
export function cardMarketMeasured(project: Pick<ProjectCardData, 'tokenMarketStatus' | 'tokenMarketReason' | 'launchStage' | 'volume24hUsd'>): boolean {
  return discoveryGapMarketMeasurable(project.tokenMarketStatus, project.launchStage, project.tokenMarketReason) && !marketVolumeTooThin(project.volume24hUsd);
}

/** What "Valuation" means on a card when the figure is a fully diluted valuation: the card's title and the glossary read it. */
export const FDV_HELP = 'Fully diluted valuation: the provider reports no circulating supply, so this is price × total supply.';

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
  /** The valuation gate's reason when the reading's valuation is not plausible (round 4, 2026-09-30); the card then says it is withheld, in the gate's own phrase (2026-10-17). */
  valuationImplausible?: string;
  /** Which provider the reading came from; shown as a title, never as layout. */
  marketCapSource?: string;
  /** When the reading was taken: a figure older than a day says its age beside it (2026-09-28). */
  marketCapObservedAt?: Date;
  /** Whether the project itself ties the contract to the project: a mismatch is the page's chip, an unverified token quiet text (2026-10-09). */
  tokenVerification?: string;
  /** Why: `site_disclaims_contract` is a token the project's own site names and disowns (INV-1, 2026-10-24). */
  tokenVerificationReason?: string;
  /** An UNVERIFIED token whose ticker another published project's token carries (hbm-v30): no valuation on a default card (UI-7). */
  tokenTickerContested?: boolean;
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
  /** "No known affiliation with Robinhood — HEY holds no evidence of one." (2026-10-02): drawn first, above every badge. */
  brandNotice?: BrandNoticeData;
  /**
   * Supply held at HoodLock, when HEY found a live lock. Absent is the
   * ordinary case and is never drawn as a failing check — context, never a
   * verdict (CLAUDE.md product rule 3).
   */
  tokenLock?: TokenLockFacts;
  launchedVia?: { name: string; url?: string };
  /**
   * The project's official X account. `withheldLine` (2026-10-18) is set when HEY's last read found the
   * account suspended, unavailable or gone: the card prints that muted, dated fact instead of a live link.
   * On the card it is a short state (`officialXCardState`, 2026-10-19) — "X held", "X suspended" — and the
   * full dated sentence stays on the project page and in the card's title.
   */
  officialX?: {
    handle: string;
    url: string;
    withheldLine?: string | undefined;
    status?: 'ACTIVE' | 'SUSPENDED' | 'UNAVAILABLE' | 'NOT_FOUND' | null | undefined;
    linkHeld?: 'handle_reassigned' | 'links_other_project' | 'not_the_project' | undefined;
  };
  websiteUrl?: string;
  /** Kept for callers that still pass the fuller domain shape. */
  primaryNarrative?: { slug: string; name: string };
  shortDescription?: string;
  lastMeaningfulShipAt?: Date;
  /**
   * The latest meaningful ship (public IA pass, 2026-09-28): the event the
   * scorer counts as building, newest first — what the card's one evidence
   * line names. Always corroborated, so it needs no verification word.
   */
  latestShip?: { id: string; title: string; eventType: string; publishedAt: Date };
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
  /** Where the evidence came from; it decides the kind's word for a verified contract (`shipKindLabel`). */
  sourceKind?: string;
};

/**
 * The states a reader may take as "HEY checked this". Everything else — a
 * self-report, a dispute, a retraction — is shown in the muted tone so the
 * two kinds of claim never look alike.
 */
const VERIFIED_STATES = new Set(['PUBLICLY_VERIFIED', 'ADMIN_VERIFIED', 'SOURCE_LINKED']);

/**
 * Where a token launched, when HEY holds no launch record (2026-10-12, audit
 * RD-10): the homepage and search printed "via Unknown". A card and a launch
 * record row say this instead, with no "via".
 */
export const LAUNCH_NOT_OBSERVED = 'Launch not observed';

/** No launch origin HEY can name: none recorded, or the domain's "Unknown" placeholder. */
export const launchNotObserved = (name: string | null | undefined): boolean => !name || name.trim() === '' || name === 'Unknown';

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/**
 * A withheld official X account on a card, in a few words (2026-10-19): a held link says "X held", a dead
 * account its state. The full dated sentence (`withheldLine`) is the project page's.
 */
export function officialXCardState(officialX: Pick<NonNullable<ProjectCardData['officialX']>, 'status' | 'linkHeld'>): string {
  if (officialX.linkHeld) return 'X held';
  if (officialX.status === 'SUSPENDED') return 'X suspended';
  if (officialX.status === 'NOT_FOUND') return 'X not found';
  if (officialX.status === 'UNAVAILABLE') return 'X unavailable';
  return 'X held';
}

export function ProjectCard({
  project,
  ship,
  now,
  showStillBuilding = false,
  marketLens = false,
  disclosure,
  terms,
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
  /**
   * One line of disclosure under the identity (round 4, 2026-09-30): on
   * `$HEY`'s own card, "HEY’s own token — researched by the same rules". The
   * words come from the caller (`HEYS_OWN_TOKEN_DISCLOSURE` in the domain);
   * the card only prints them, and they change nothing else on it.
   */
  disclosure?: string;
  /**
   * Definitions one press away (outsider audit, 2026-10-02): the caller wraps
   * the status chip and the valuation label in its glossary control. The card
   * only hands over what it drew and the facts it drew it from; the words
   * live in the app's glossary. Absent, the card renders as before.
   */
  terms?: {
    status?: (chip: ReactNode, status: ActivityStatusValue) => ReactNode;
    valuation?: (label: ReactNode, kind: 'marketCap' | 'fdv' | undefined) => ReactNode;
  };
  className?: string;
}) {
  const marketSource = formatMarketSource(project.marketCapSource);
  /*
   * Whether a figure is printed and under which name, from one rule
   * (`valuationDisplay`, 2026-09-28). A cap printed for a pool with no
   * liquidity, a removed market or a launch pool nobody traded is a number
   * about nothing (2026-09-11); readings that disagree, or one HEY does not
   * believe, print no figure and claim no dead market either (2026-09-25).
   * The label comes from the same display, so a hidden figure never lends
   * its kind to the empty state beside it.
   */
  const valuation = valuationDisplay({
    valueUsd: project.marketCapUsd,
    fdvUsd: project.fdvUsd,
    marketStatus: project.tokenMarketStatus,
    marketReason: project.tokenMarketReason,
    valuationImplausible: project.valuationImplausible,
  });
  /*
   * A launch pool that traded (`launch_pool_trading`, 2026-10-09 red team
   * RT2-01): the classifier calls it ACTIVE_MARKET, so `valuationDisplay`
   * shows its figure, and the card printed "Market cap $X" over the token's
   * own supply at its last price on the homepage, Explore and the token view.
   * The card names it "Launch pool only", as the chip and the page do.
   *
   * Founder ruling 2026-10-11: the project page already printed the figure
   * beside that label ("Launch pool only · $43K fully diluted valuation"), so
   * a card that printed none disagreed with its own page. The card now prints
   * the valuation with "launch pool" beside it, named "Valuation" (never a
   * market cap); the pool's "liquidity" still stays off (it is the token's own
   * supply), and the Discovery Gap, Under the Radar and Still Building stay
   * unmeasured on it (hbm-v22).
   */
  const launchPoolOnly = isLaunchPoolOnlyMarket(project.tokenMarketStatus, project.tokenMarketReason);
  const staleAge = valuation.shown ? staleReadingAge(project.marketCapObservedAt, now) : undefined;
  const hasToken = Boolean(project.token);
  // What HEY does know about a token it cannot read building from (2026-09-13): trades and on-chain events, as context under the cap.
  const contextLine = hasToken && project.activityStatus === 'UNKNOWN' ? tradeContextLine(project) : undefined;
  // A lock below a meaningful share is no chip on a card (persona audit PB-10); the project page keeps the exact figure.
  const lockChip = cardTokenLock(project.tokenLock);
  const shipVerified = ship ? VERIFIED_STATES.has(ship.verificationStatus) : false;
  // Source text as words: launchpad descriptions arrive with Markdown in them (QA sweep 2026-09-04).
  // A line, not a pasted README (2026-10-01): the two-line clamp hid the rest on screen, never from a screen reader.
  const description = oneLineDescription(project.shortDescription, 220);
  // A code week by its fixed week, never the rolling "100+ commits since …" (2026-10-02, `displayShipTitle`).
  const shipTitle = ship ? displayShipTitle(ship) : '';
  /*
   * The one latest-evidence line (public IA pass, 2026-09-28): what shipped
   * and when, from the canonical latest meaningful ship. A card used to say
   * "Shipped 13h ago" and never what; the title now carries the "what" and
   * the date the "when". Without a counted ship HEY still knows the date the
   * scorer holds, and says only that.
   */
  const latest = ship ? undefined : project.latestShip;
  const latestTitle = latest ? displayShipTitle(latest) : '';
  /*
   * The line's words come from one formatter (`cardShipPhrase`, public UX
   * review 2026-09-28): short by construction and never cut mid-word by CSS.
   * When all it could say is the status the chip already shows, it says
   * nothing and the date stands alone.
   */
  const latestPhrase = latest
    ? cardShipPhrase(latest, { ...(now ? { now } : {}), statusLabel: activityPresentation(project.activityStatus, unknownActivityReason(project)).label })
    : undefined;
  const lastShipAt = latest?.publishedAt ?? project.lastMeaningfulShipAt;
  // "Infrastructure · Infrastructure" says it once: the kind is dropped when
  // the narrative already names it. "Uncategorised" (kind OTHER) is a data
  // state, not a fact about the project; it is shown only when the line
  // would otherwise be empty, never beside a ticker or a narrative.
  // The catch-all narrative "Other" is a data state too (ux-data audit, 2026-10-01): "$CHIT · Other · Infrastructure" named no category.
  // One rule with the compare page and `/api/compare` (`projectCategory`, OA-G 2026-10-02).
  const category = projectCategory(project);
  const kindLabel = formatProjectKind(project.projectKind);
  const narrative = category.narrative;
  const showKind = category.kindLabel !== undefined || (project.projectKind === 'OTHER' && !project.symbol && !narrative);
  const identityParts: ReactNode[] = [];
  const showValuation = cardShowsValuation(project, { marketLens });
  // A name a reader can read (DATA-9), never a disowned token's ticker in its place (the 2026-10-24 card rule).
  const name = projectDisplayName({ name: project.name, slug: project.slug, symbol: cardTokenNotTheProjects(project) ? undefined : project.symbol });
  if (project.symbol && !cardTokenNotTheProjects(project))
    identityParts.push(
      <span key="ticker" data-testid="ticker" className="font-medium text-hey-ink/80 [font-family:var(--font-mono)] text-[12px] tracking-[0.02em]">
        {tickerLabel(project.symbol)}
      </span>,
    );
  if (narrative)
    identityParts.push(
      <span key="narrative" data-testid="card-narrative">
        {narrative.name}
      </span>,
    );
  if (showKind)
    identityParts.push(
      <span key="kind" data-testid="project-kind">
        {kindLabel}
      </span>,
    );

  // REFERENCE: launch origin and official X, the card's last line on every variant.
  const launchUnobserved = launchNotObserved(project.launchedVia?.name) && !project.marketVenue;
  const origin = (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="flex min-w-0 shrink-0 items-center gap-1.5" data-testid="launched-via">
        {/* No launch record and no pool: say so, never "via Unknown" (2026-10-12, audit RD-10). */}
        {launchUnobserved ? null : <span className="text-hey-muted">via</span>}
        {launchUnobserved ? (
          <span className="truncate text-hey-muted" title="HEY did not observe where this token launched.">
            {LAUNCH_NOT_OBSERVED}
          </span>
        ) : project.launchedVia?.url ? (
          // Named, not linked (DISC-7): the launch page is one press away on the project page.
          <span className="truncate text-hey-secondary" title={`Launched on ${project.launchedVia.name}`}>
            {project.launchedVia.name}
          </span>
        ) : launchNotObserved(project.launchedVia?.name) && project.marketVenue ? (
          // No launch record, but a pool: say where the token trades, never where it launched.
          <span className="truncate text-hey-secondary" title={`HEY did not observe the launch; the token trades on ${project.marketVenue}.`}>
            {/* A venue HEY cannot name is "DEX" already (`venueLabel`): print it once, never "DEX (DEX)" (full audit, 2026-10-03). */}
            {project.marketVenue === 'DEX' ? 'DEX' : `DEX (${project.marketVenue})`}
          </span>
        ) : (
          <span className="truncate text-hey-secondary">{project.launchedVia?.name}</span>
        )}
      </span>
      {project.officialX?.withheldLine ? (
        // A suspended or missing account is a fact, never a live link (2026-10-18); on the card a short state, the
        // dated sentence in the title and for screen readers (2026-10-19).
        <span className="min-w-0 truncate text-hey-muted" data-testid="official-x-withheld" title={project.officialX.withheldLine}>
          <span aria-hidden="true">{officialXCardState(project.officialX)}</span>
          <span className="sr-only">{project.officialX.withheldLine}</span>
        </span>
      ) : project.officialX ? (
        // The account HEY reads as the project's, named as text (DISC-7); the project page links it.
        <span className="min-w-0 shrink-0 truncate text-hey-secondary" data-testid="official-x" title={`${name} on X`}>
          @{project.officialX.handle}
        </span>
      ) : null}
    </div>
  );

  return (
    <article
      data-testid="project-card"
      data-slug={project.slug}
      data-has-token={hasToken ? 'true' : 'false'}
      // The whole card is one target (the name's link covers it), so on glass it lifts 1px on hover.
      data-interactive=""
      className={cn(
        // min-w-0 matters: a grid item defaults to its min-content width, and a
        // long name or a 32-character ticker would otherwise push the card wider
        // than its track and scroll the whole page sideways on mobile.
        //
        // `lg-card` (Luminous Glass, 2026-09-30): the level-2 card material —
        // translucent fill, edge, specular highlight, radius, and on hover a
        // 1px lift and a firmer edge — glass by translucency, never by blur.
        // Every place a card is drawn (the public site, the Terminal) is a
        // `[data-lg]` scope, so the card carries no surface of its own.
        'lg-card group relative flex h-full min-w-0 flex-col gap-3 p-4 sm:p-5',
        className,
      )}
    >
      {/* A name that borrows Robinhood's brand or a stock ticker says so before anything else (2026-10-02). */}
      {project.brandNotice ? <BrandNotice notice={project.brandNotice} /> : null}

      {/* IDENTITY — logo, name, ticker · narrative · kind */}
      <div className="flex items-start gap-3">
        <ProjectLogo
          name={name}
          slug={project.slug}
          logoUrl={project.logoUrl}
          size={44}
          className="rounded-[10px] ring-1 ring-inset ring-hey-border"
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="text-[16.5px] font-semibold leading-[1.25] tracking-[-0.01em] text-hey-ink">
            {/*
             * The whole card is the target; the link stays the accessible one.
             * Two lines, not one: a name is the identity, and a single
             * truncated line lost it (UI/UX audit U19). The name now has the
             * full width: the status moved to its own line below.
             */}
            <a
              href={`/project/${project.slug}`}
              className="line-clamp-2 [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-hey-ink/30"
            >
              {name}
            </a>
          </h3>
          {identityParts.length > 0 ? (
            <p className="mt-1 truncate text-[13px] leading-5 text-hey-secondary">
              {identityParts.map((part, index) => (index === 0 ? part : [<span key={`sep-${index}`} aria-hidden="true"> · </span>, part]))}
            </p>
          ) : null}
          {disclosure ? (
            <p className="mt-1 text-[12.5px] leading-5 text-hey-secondary [overflow-wrap:anywhere]" data-testid="heys-own-token">
              {disclosure}
            </p>
          ) : null}
        </div>
      </div>

      {/*
       * BUILDER STATE, then the LATEST SIGNAL, on one line (public IA pass,
       * 2026-09-28). The status is the card's most important fact (UI rule 4),
       * so it leads the body at its own size rather than sitting as a small
       * pill beside the name; the evidence that earned it follows it. The
       * line wraps under the chip on a narrow card instead of squeezing.
       */}
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5" data-testid="card-builder">
        {(() => {
          const chip = <ActivityChip status={project.activityStatus} variant="surface" unknownReason={unknownActivityReason(project)} className="shrink-0" />;
          return terms?.status ? terms.status(chip, project.activityStatus) : chip;
        })()}
        {!ship && latest && latestPhrase ? (
          <p
            className="min-w-0 grow basis-[9rem] text-[13px] leading-5"
            data-testid="card-latest-signal"
            data-ship-id={latest.id}
            title={`${shipKindLabel(latest)}: ${latestTitle}`}
          >
            {/* Wraps at a word when the card is narrow; never an ellipsis in the middle of one. */}
            <span className="font-medium text-hey-ink">{emailSafe(latestPhrase.what)}</span>{' '}
            <time
              dateTime={latest.publishedAt.toISOString()}
              data-testid="card-last-ship"
              className="whitespace-nowrap tabular-nums text-hey-muted"
            >
              · {latestPhrase.when}
            </time>
          </p>
        ) : !ship && lastShipAt ? (
          <time
            dateTime={lastShipAt.toISOString()}
            data-testid="card-last-ship"
            className="text-[13px] leading-5 tabular-nums text-hey-muted"
          >
            Shipped {formatRelativeTime(lastShipAt, now)}
          </time>
        ) : null}
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
          className="min-w-0 rounded-control bg-hey-row-hover px-3 py-2.5 ring-1 ring-inset ring-hey-border"
        >
          <p className="flex items-baseline justify-between gap-3 text-[12.5px] text-hey-muted">
            {/*
              * "Ship", not "Latest ship" (2026-09-06). This block renders
              * whichever event the surface handed it, and on Ships that is one
              * row of a history.
              */}
            <span>Ship</span>
            <time dateTime={ship.publishedAt.toISOString()} className="shrink-0 tabular-nums">
              {formatRelativeTime(ship.publishedAt, now)}
            </time>
          </p>
          <p className="mt-1 line-clamp-2 break-words text-[14px] font-medium text-hey-ink" title={shipTitle} data-testid="ship-title">
            {emailSafe(shipTitle)}
          </p>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]">
            <span className="text-hey-secondary" data-testid="ship-type">
              {shipKindLabel(ship)}
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
                label={`Source: ${shipTitle} (opens in a new tab)`}
                className="ml-auto text-[12.5px]"
                data-testid="ship-source"
              >
                Source
              </ExternalRef>
            ) : null}
          </p>
        </div>
      ) : description ? (
        /* What the project is, in its own words: two lines, secondary, after the builder line. */
        <p className="line-clamp-2 text-[13.5px] leading-[1.5] text-hey-secondary" data-testid="description">
          {description}
        </p>
      ) : null}

      {/*
       * MARKET CONTEXT, REFERENCE, ORIGIN — one quiet block at the foot of
       * the card, so the facts line up across a row of cards whatever the
       * description's length. A ship card stops at the ship (UI/UX audit
       * U11): on the feed the same project's market cap and contract were
       * printed for every event.
       */}
      {ship ? (
        <div className="mt-auto border-t border-hey-border pt-3">{origin}</div>
      ) : (
        <div className="mt-auto space-y-2.5 border-t border-hey-border pt-3">
        {hasToken ? (
          <>
            {/* Market context: valuation kind + value, from stored snapshots only; only where the card may print one (UI-7, INV-1). */}
            {showValuation ? (
            <p className="flex items-baseline justify-between gap-3 text-[13.5px]" data-testid="market-cap">
              {/*
                Named for what it is (parity audit, 2026-09-25): a figure equal to
                the FDV is not called a market cap. The card stays inside its
                information budget (PRD V4 16.0 D: no FDV on a card), so it says
                "Valuation" and the tooltip names the measure.
              */}
              <span
                className="text-hey-secondary"
                {...(valuation.shown && valuation.kind === 'fdv'
                  ? { title: FDV_HELP }
                  : {})}
              >
                {terms?.valuation
                  ? terms.valuation(launchPoolOnly ? 'Valuation' : valuationDisplayLabel(valuation, 'card'), valuation.shown ? valuation.kind : undefined)
                  : launchPoolOnly
                    ? 'Valuation'
                    : valuationDisplayLabel(valuation, 'card')}
              </span>
              {launchPoolOnly && valuation.shown ? (
                <span className="font-semibold tabular-nums text-hey-ink" data-valuation-state="launch_pool_only" title={LAUNCH_POOL_ONLY_PRESENTATION.help}>
                  {formatUsdCompact(valuation.usd)}
                  <span className="ml-1 font-normal text-hey-muted">· launch pool{staleAge ? ` · ${staleAge} old` : ''}</span>
                </span>
              ) : launchPoolOnly ? (
                <span className="text-hey-muted" data-valuation-state="launch_pool_only" title={LAUNCH_POOL_ONLY_PRESENTATION.help}>
                  {LAUNCH_POOL_ONLY_PRESENTATION.label}
                </span>
              ) : valuation.shown ? (
                <span className="font-semibold tabular-nums text-hey-ink" {...(marketSource ? { title: `via ${marketSource}` } : {})}>
                  {formatUsdCompact(valuation.usd)}
                  {/* Stale is not current (2026-09-28): a reading older than a day says how old, as the Terminal does. */}
                  {staleAge ? (
                    <span className="ml-1 font-normal text-hey-muted" data-testid="valuation-age">
                      · {staleAge} old
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-right text-hey-muted" data-valuation-state={valuation.state} title={valuationHiddenSentence(valuation)}>
                  {valuationHiddenCardWords(valuation.state)}
                </span>
              )}
            </p>
            ) : null}

            {marketLens ? (
              <p className="-mt-1 text-[12.5px] leading-[1.5] text-hey-muted" data-testid="market-lens-line">
                {marketLensLine(project)}
              </p>
            ) : contextLine ? (
              <p className="-mt-1 text-[12.5px] leading-[1.5] text-hey-muted" data-testid="card-context-line">
                {contextLine}
              </p>
            ) : null}

            {/* Reference: the contract — identity, never a ticker — with its lock and any contradiction beside it. */}
            <div className="-ml-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <ContractAddress address={project.token!.contractAddress} chainId={project.token!.chainId} explorer={false} />
              {lockChip ? <TokenLockChip lock={lockChip} /> : null}
              {/*
                Token is not project (data-correctness pass, 2026-09-28): where
                the project's own site names a different contract, the page and
                the API say "Contract mismatch"; the card carries the page's chip.
              */}
              {project.tokenVerification === 'MISMATCH' ? (
                <TokenVerificationChip verification="MISMATCH" className="text-[12px]" />
              ) : project.tokenVerification === 'UNVERIFIED' ? (
                /*
                 * Quiet text, not a chip (outsider audit AOP-09, 2026-10-09):
                 * 82% of published tokens are unverified, and a card's
                 * valuation read as the project's own token's — the page said
                 * "Token unverified", the card nothing. Unknown verification
                 * (no field) prints nothing; VERIFIED stays the quiet default.
                 */
                <span className="text-[12px] text-hey-muted" title={tokenVerificationHelp('UNVERIFIED')} data-testid="token-unverified">
                  {tokenVerificationLabel('UNVERIFIED')}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          /*
           * No token: said once, in the slot a market would take, with the
           * project's own site as its reference — a builder without a token
           * is a complete card, not an empty one. "No token tracked", the
           * market status's own words (2026-10-03, full audit): USDBT's card
           * read "No token" under its own "The first community token you can
           * actually spend" — HEY links none of the launch records carrying its
           * ticker, which says what HEY tracks, not that no token exists.
           */
          <p className="flex min-w-0 items-baseline justify-between gap-3 text-[13.5px]" data-testid="no-token">
            <span className="shrink-0 text-hey-secondary" title="HEY tracks no token for this project.">No token tracked</span>
            {project.websiteUrl ? (
              <span className="min-w-0 truncate text-hey-secondary" data-testid="website" title={project.websiteUrl}>
                {hostOf(project.websiteUrl)}
              </span>
            ) : null}
          </p>
        )}

        {origin}
        </div>
      )}
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
export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="lg-panel p-12 text-center" data-variant="empty">
      <p className="text-[15px] font-medium">{title}</p>
      {hint ? <p className="mt-1.5 text-[15px] text-hey-secondary">{hint}</p> : null}
    </div>
  );
}

/*
 * `launch_pool_no_trades` means nothing traded in the launch pool in the last
 * day (`TOKEN_MARKET_REASON_WORDS`), not that it never traded (2026-10-09, red
 * team RT2-06): the card said "no trades yet" over a pool with a trade history.
 */
const LAUNCH_POOL_NO_TRADES_WORDS = 'Launch pool, no trades in the last day';

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
export function marketLensLine(project: ProjectCardData): string {
  const parts: string[] = [];
  const liquidity = formatUsdCompact(project.liquidityUsd);
  const volume = formatUsdCompact(project.volume24hUsd);
  if (project.tokenMarketStatus === 'TRADING_INACTIVE' && project.tokenMarketReason === 'launch_pool_no_trades') {
    parts.push(LAUNCH_POOL_NO_TRADES_WORDS);
  } else if (project.tokenMarketReason === 'launch_pool_volume_unknown') {
    parts.push('Launch pool, trading unknown');
  } else if (isLaunchPoolOnlyMarket(project.tokenMarketStatus, project.tokenMarketReason)) {
    // The pool's "liquidity" is the token's own supply, never a depth figure (RT2-01); its trades are real and stay.
    parts.push(LAUNCH_POOL_ONLY_PRESENTATION.label);
    if (volume) parts.push(`24 h volume ${volume}`);
    if (project.buys24h !== undefined && project.sells24h !== undefined) parts.push(`${project.buys24h.toLocaleString('en-US')} buys · ${project.sells24h.toLocaleString('en-US')} sells`);
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
 * in the last 24 hours and how many events its contract emitted. Context, never a status;
 * nothing invented, so a card with neither fact gets no line.
 */
export function tradeContextLine(project: ProjectCardData): string | undefined {
  const parts: string[] = [];
  if (isLaunchPoolOnlyMarket(project.tokenMarketStatus, project.tokenMarketReason)) parts.push(`${LAUNCH_POOL_ONLY_PRESENTATION.label} · traded in the last 24 h`);
  else if (project.tokenMarketStatus === 'ACTIVE_MARKET') parts.push('Traded in the last 24 h');
  else if (project.tokenMarketStatus === 'TRADING_INACTIVE' && project.tokenMarketReason === 'launch_pool_no_trades') parts.push(LAUNCH_POOL_NO_TRADES_WORDS);
  else if (project.tokenMarketReason === 'launch_pool_volume_unknown') parts.push('Launch pool, trading unknown');
  else if (project.tokenMarketStatus === 'TRADING_INACTIVE') parts.push('No trades in 24 h');
  if (project.onchainEvents24h !== undefined) parts.push(eventsPhrase(project.onchainEvents24h));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

