/**
 * Whether a project's Build Momentum is a measurement (10-agent audit,
 * 2026-09-25).
 *
 * The gate exists so a project HEY never researched does not print a 0 that
 * means "not measured". But a positive score is never that false zero — it
 * came from evidence HEY scored — and the gate hid real scores while the
 * Builder Radar, Still Building and the Discovery Gap, all computed from the
 * same score, showed them: bitbots-on-chain read "not measured" on its
 * Overview and "#24 on the Radar" one tab away. One rule, every surface.
 */
export function momentumMeasured<P extends { score?: { hbm?: number } | undefined; activityResearched?: boolean | undefined; activityStatus?: string | undefined }>(
  profile: P,
): profile is P & { score: NonNullable<P['score']> & { hbm: number } } {
  const hbm = profile.score?.hbm;
  if (hbm === undefined) return false;
  if (hbm > 0) return true;
  /*
   * A zero on an UNKNOWN project is "HEY found nothing it could read", not a
   * measurement (full-platform audit 2026-09-25, A10-12): an attempted GitHub
   * resolution counted as research, and 4,069 unknown pages printed "Build
   * Momentum 0". A readable source with nothing recent is QUIET or DORMANT,
   * and its zero stays a measurement.
   */
  return profile.activityResearched === true && profile.activityStatus !== 'UNKNOWN';
}
