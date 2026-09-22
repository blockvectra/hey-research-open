import { Lock } from 'lucide-react';

import { cn } from './cn';

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
  /** Whether a pair holding this token is locked too. */
  pairLocked: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * `2027-09-09` -> `9 Sep 2027`. Plain words over jargon (CLAUDE.md UI rule 11).
 *
 * Spelled out rather than handed to `toLocaleDateString`, which returns
 * "9 Sept 2027" on this Node and "9 Sep 2027" in some browsers depending on
 * the ICU build. A month name that differs between the server render and the
 * client is a hydration mismatch, and this file is not the place to add one.
 */
export function lockUntilLabel(until: string): string {
  if (!DAY.test(until)) return until;
  const [year, month, day] = until.split('-').map(Number) as [number, number, number];
  const name = MONTHS[month - 1];
  if (!name) return until;
  return `${day} ${name} ${year}`;
}

/** The full sentence, used as the chip's title and as the project page's line. */
export function tokenLockHelp(lock: TokenLockFacts): string {
  /* "Pair", never "liquidity": the card's own e2e guard forbids that word, and pair is the more exact one anyway. */
  if (!lock.until) return 'A pair holding this token is locked at HoodLock. Context HEY read from the locker, not a verdict.';
  const share = lock.supplyPct === undefined ? 'Token supply is' : `${lock.supplyPct}% of the token supply is`;
  const pair = lock.pairLocked ? ' A pair holding this token is locked too.' : '';
  return `${share} held in a HoodLock lock until ${lockUntilLabel(lock.until)}. Context HEY read from the locker, not a verdict.${pair}`;
}

/**
 * The compact card form: the locker's name and, when HEY knows it, the share.
 *
 * It sits in the contract row rather than on a line of its own, because the
 * card's design contract is eight facts and this is part of the token's
 * identity, not a ninth. `shrink-0` because a long ticker already competes
 * for the row at 375px.
 */
export function TokenLockChip({ lock, className }: { lock: TokenLockFacts; className?: string }) {
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center gap-1 text-xs font-medium text-hey-muted', className)}
      data-testid="token-lock"
      title={tokenLockHelp(lock)}
    >
      <Lock aria-hidden className="size-3" />
      {lock.supplyPct === undefined ? 'HoodLock' : `${lock.supplyPct}% HoodLock`}
      <span className="sr-only">{tokenLockHelp(lock)}</span>
    </span>
  );
}
