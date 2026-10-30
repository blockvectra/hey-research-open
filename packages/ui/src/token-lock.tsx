import { BRAND_MARKS } from './brand';
import { cn } from './cn';
import { formatSharePct } from './format';

/**
 * Supply a project has locked at HoodLock (2026-09-22).
 *
 * Attribution is the point. "Locked" alone tells a reader that somebody said
 * so; naming the locker tells them who holds it and lets them go and look —
 * every lock has a public proof page. An independent locker is a decision a
 * project made, which is worth attributing in a way a launchpad's automatic
 * locker is not.
 *
 * What this is not: a score, a rank, a safety verdict, or a reason to think
 * anything about the price. A project with no chip is a project HEY has found
 * no lock for, which is the ordinary case — most projects have never used a
 * locker — and is never drawn as a failure. That is why the absent state has
 * no chip at all rather than a grey "unlocked" one, and why nothing here uses
 * the error colour, which this codebase reserves for real errors.
 */
export type TokenLockFacts = {
  /** Share of total supply locked, 0-100. Absent when HEY does not know the supply. */
  supplyPct?: number;
  /** When the last of it opens, `YYYY-MM-DD`. Absent when only a pair is locked. */
  until?: string;
  /**
   * When the next part of it opens, `YYYY-MM-DD`, and the share of total
   * supply that opens that day (2026-09-25). Without them `until` read as
   * "all of it until then": 16.49% "until 25 Sep 2027" where 8.57% opened
   * within the week.
   */
  nextUnlockAt?: string;
  nextUnlockPct?: number;
  /** Whether a pair holding this token is locked too. */
  pairLocked: boolean;
};

/** The locker's own mark, in `apps/web/public` at its hashed path (2026-10-17). */
const HOODLOCK_MARK = BRAND_MARKS.hoodlock;

/**
 * A lock date as the day it is, `2027-09-09` (2026-10-30): the format every other date on a project page, the change
 * ledger's unlock events included, already prints. It said `9 Sep 2027` until then, so one lock block read
 * "Next unlock 30 Oct 2026" beside "reached its unlock date 2026-10-20". A day is never handed to `toLocaleDateString`,
 * whose month names differ between the server's ICU build and the browser's and would mismatch the hydration.
 */
export function lockUntilLabel(until: string): string {
  return until;
}

/**
 * When the locked supply opens, in words (2026-09-25).
 *
 * The next date first, with its share, because that is the supply that can
 * move soonest; the last date after it. One date only when everything opens
 * on the same day — then "until" is true. Empty when only a pair is locked.
 */
export function tokenLockSchedule(lock: TokenLockFacts): string {
  if (!lock.until) return '';
  const next = lock.nextUnlockAt;
  if (!next || next >= lock.until) return `until ${lockUntilLabel(lock.until)}`;
  const nextShare = lock.nextUnlockPct === undefined ? 'the next part' : `the next ${formatSharePct(lock.nextUnlockPct)}%`;
  return `${nextShare} unlocks on ${lockUntilLabel(next)}, and the last on ${lockUntilLabel(lock.until)}`;
}

/** The full sentence, used as the chip's title and as the project page's line. */
export function tokenLockHelp(lock: TokenLockFacts): string {
  /* "Pair", never "liquidity": the card's own e2e guard forbids that word, and pair is the more exact one anyway. */
  if (!lock.until) return 'A pair holding this token is locked at HoodLock. Context HEY read from the locker, not a verdict.';
  const share = lock.supplyPct === undefined ? 'Token supply is' : `${formatSharePct(lock.supplyPct)}% of the token supply is`;
  const pair = lock.pairLocked ? ' A pair holding this token is locked too.' : '';
  const schedule = tokenLockSchedule(lock);
  // "held … until" only when it is all one date; otherwise the schedule is its own clause.
  const sentence = schedule.startsWith('until ')
    ? `${share} held in a HoodLock lock ${schedule}.`
    : `${share} locked at HoodLock; ${schedule}.`;
  return `${sentence} Context HEY read from the locker, not a verdict.${pair}`;
}

/**
 * The smallest share of supply a project card names as locked (persona audit
 * PB-10, 2026-10-18). Sherwood Protocol's homepage card wore "<0.01%
 * HoodLock" — the card's only extra chip, read by a skimming reader as
 * "locked" — for a lock that held next to nothing. Below this share the card
 * leaves the chip out; the project page still states the exact figure.
 */
export const TOKEN_LOCK_CARD_MIN_PCT = 1;

/**
 * What a project card may say about a lock, or undefined for no chip: the
 * lock as it is at `TOKEN_LOCK_CARD_MIN_PCT` or more (or when HEY does not
 * know the supply — an unknown share is not a small one), a pair lock alone
 * when the token share is below it, and nothing otherwise.
 */
export function cardTokenLock(lock: TokenLockFacts | undefined): TokenLockFacts | undefined {
  if (!lock) return undefined;
  if (lock.supplyPct === undefined || lock.supplyPct >= TOKEN_LOCK_CARD_MIN_PCT) return lock;
  return lock.pairLocked ? { pairLocked: true } : undefined;
}

/**
 * The compact card form: the locker's name and, when HEY knows it, the share.
 *
 * It sits in the contract row rather than on a line of its own, because the
 * card's design contract is eight facts and this is part of the token's
 * identity, not a ninth. `shrink-0` because a long ticker already competes
 * for the row at 375px.
 */
export function TokenLockChip({
  lock,
  /*
   * A default parameter, not a baked class, because `cn` is a plain joiner
   * and not tailwind-merge: a caller passing `text-hey-ink` next to a baked
   * `text-hey-muted` gets both, and stylesheet order decides which wins
   * rather than the caller. This is the third place in this codebase that
   * bug would have landed, so the tone is a value the caller replaces.
   */
  tone = 'text-xs text-hey-muted',
  className,
}: {
  lock: TokenLockFacts;
  tone?: string;
  className?: string;
}) {
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center gap-1 font-medium', tone, className)}
      data-testid="token-lock"
      title={tokenLockHelp(lock)}
    >
      {/*
       * HoodLock's own mark rather than a generic padlock (founder,
       * 2026-09-22): the point of the chip is that a reader recognises which
       * locker holds the supply without reading anything. Served from
       * `/hoodlock-mark.png` the way `HeyLogo` serves its own, at 48px for a
       * 16px slot so it stays sharp on a retina screen.
       *
       * `alt=""` because the words beside it already say HoodLock — a screen
       * reader that announced the mark too would say the name twice.
       */}
      <img
        src={HOODLOCK_MARK}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        decoding="async"
        className="size-4 shrink-0"
      />
      {lock.supplyPct === undefined ? 'HoodLock' : `${formatSharePct(lock.supplyPct)}% HoodLock`}
      <span className="sr-only">{tokenLockHelp(lock)}</span>
    </span>
  );
}
