/**
 * Automated commit streams (commit-substance-v3, 2026-10-02, outsider audit).
 *
 * The methodology has always said automated commits do not count as
 * building, but HEY only recognised automation by its account (`[bot]`,
 * dependabot …). A script that commits under a person's own account was read
 * as that person shipping: one repository committed "stats: 7.80609407393365932
 * BNB distributed" every 25 minutes, another "chore: refresh ledgers
 * 2026-10-01T17:09:57Z" a dozen times a day, and both led the ships feed as
 * "100+ commits".
 *
 * This module reads one listing of a repository's commits — the subjects and
 * dates GitHub returns, nothing else — and names the commits that belong to
 * a templated stream: the same subject once numbers, hashes, addresses and
 * timestamps are set aside, repeated at least `AUTOMATION.minRepeats` times,
 * and either
 *
 *   - committed at a regular interval (most gaps within a quarter of the
 *     median gap), or
 *   - carrying a timestamp, or at least two numbers, that change from commit
 *     to commit — a script writing its own output into the message.
 *
 * A person repeating "Update worker.js" by hand at irregular times, or "fix
 * #12", "fix #15" … is not a stream: one varying number and no regular clock.
 * Subjects only automation writes (`[bot] …`, `auto-update …`) are named one
 * by one.
 *
 * Pure: no clock, no I/O. The subject is read in memory and never stored; a
 * commit named here is kept on the record as automated (`is_bot`), never
 * deleted, and never part of a week's verdict.
 */

export const AUTOMATION = {
  /** How many commits of one template make a stream. */
  minRepeats: 6,
  /** Share of consecutive gaps that must sit within `regularTolerance` of the median gap. */
  regularShare: 0.6,
  /** A gap within this fraction of the median gap is "on the clock". */
  regularTolerance: 0.25,
  /** Placeholders a template needs, without a regular clock, to read as a script's output. */
  minNumericPlaceholders: 2,
} as const;

export type ListedCommitSubject = {
  sha: string;
  /** The first line of the commit message. */
  message: string;
  committedAt: Date;
};

export type AutomationReason = 'automated_stream' | 'automated_subject';

export type CommitAutomation = {
  /** Lower-cased sha → why it reads as automation. */
  automated: Map<string, AutomationReason>;
  /** The streams found, for logs and tests: the template, its size, and what made it a stream. */
  streams: { template: string; commits: number; regular: boolean; varying: 'timestamp' | 'numbers' | 'none' }[];
};

/** Subjects only automation writes, whatever the account. */
const AUTOMATED_SUBJECT = /^(\[(bot|auto|automated|automation)\]|(auto|automated)[- ](commit|update|updated|sync|generated|deploy|build|refresh)\b|🤖)/iu;

/**
 * A subject with what changes from run to run set aside: ISO timestamps and
 * dates, 0x addresses and hashes, long hex strings and numbers each become a
 * placeholder; case and whitespace are folded.
 */
export function commitSubjectTemplate(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}([t ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})?)?/g, '<time>')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<time>')
    .replace(/\b0x[0-9a-f]{6,}\b/g, '<hex>')
    // A hash has letters and digits; a run of digits alone is a number below.
    .replace(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,64}\b/g, '<hex>')
    .replace(/[-+]?\d[\d,]*(\.\d+)?(e[-+]?\d+)?/g, '<n>')
    .replace(/\s+/g, ' ');
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Whether commits land on a clock: most consecutive gaps sit near the median gap. */
export function onRegularClock(times: readonly Date[]): boolean {
  if (times.length < AUTOMATION.minRepeats) return false;
  const sorted = [...times].map((time) => time.getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) gaps.push(sorted[index]! - sorted[index - 1]!);
  const typical = median(gaps);
  if (typical <= 0) return false;
  const onClock = gaps.filter((gap) => Math.abs(gap - typical) <= typical * AUTOMATION.regularTolerance).length;
  return onClock / gaps.length >= AUTOMATION.regularShare;
}

/** The commits of one listing that read as automation, and the streams behind them. */
export function detectAutomatedCommits(commits: readonly ListedCommitSubject[]): CommitAutomation {
  const automated = new Map<string, AutomationReason>();
  const streams: CommitAutomation['streams'] = [];
  const groups = new Map<string, ListedCommitSubject[]>();
  for (const commit of commits) {
    const subject = commit.message.trim();
    if (subject === '') continue;
    if (AUTOMATED_SUBJECT.test(subject)) automated.set(commit.sha.toLowerCase(), 'automated_subject');
    const template = commitSubjectTemplate(subject);
    groups.set(template, [...(groups.get(template) ?? []), commit]);
  }
  for (const [template, members] of groups) {
    if (members.length < AUTOMATION.minRepeats) continue;
    // A template with no words of its own ("<n>", "<hex>") says nothing about who wrote it.
    if (template.replace(/<[a-z]+>/g, '').replace(/[^\p{L}]/gu, '').length < 3) continue;
    const regular = onRegularClock(members.map((member) => member.committedAt));
    const distinctSubjects = new Set(members.map((member) => member.message.trim().toLowerCase())).size;
    const timestamps = (template.match(/<time>/g) ?? []).length;
    const numbers = (template.match(/<n>|<hex>/g) ?? []).length;
    // The placeholders must actually vary: a fixed "v2" in every subject is part of the words.
    const varying: 'timestamp' | 'numbers' | 'none' =
      distinctSubjects > 1 && timestamps > 0 ? 'timestamp' : distinctSubjects > 1 && numbers >= AUTOMATION.minNumericPlaceholders ? 'numbers' : 'none';
    if (!regular && varying === 'none') continue;
    streams.push({ template, commits: members.length, regular, varying });
    for (const member of members) automated.set(member.sha.toLowerCase(), 'automated_stream');
  }
  return { automated, streams };
}
