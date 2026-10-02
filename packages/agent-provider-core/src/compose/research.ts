import type { HeyProjectSnapshot, HeySummaryLine } from '@hey-research-lab/sdk';

import { ageBucket, familyFreshness, SNAPSHOT_SOURCE_FAMILY, type AgentFreshnessEntry, type RefreshTier } from '../freshness';
import type { AgentChange, AgentClaim, AgentFreshness, AgentResponseOf, AgentSourceType } from '../schema';
import { derivedText, externalText, heyText } from '../text';
import { countOf, valuationWithheldSentence, WORD_MEANINGFUL_BUILDING_EVENT, WORD_MEANINGFUL_EVENT, WORD_THING } from '../words';
import { stillBuildingStateOf } from '../disclosures';
import type { AgentEvidenceKind } from '../evidence-kinds';
import { agentChange, envelope, evidenceRef, isContextChange, looksLikeEvidenceId, projectApi, type AgentComposeContext } from './common';
import { projectUnknowns, type CanonicalGap } from './gaps';

/**
 * research_project (2026-09-30): HEY's current research view of one project,
 * restated from the snapshot — its Research Summary lines, build block,
 * verification, market and usage context, latest changes, coverage and
 * freshness. The snapshot is the canonical read; nothing here computes a
 * figure the snapshot does not already publish.
 */
export type ResearchInput = {
  snapshot: HeyProjectSnapshot;
  /** The domain's canonical gap list for the project (`coverageGaps`). */
  gaps: readonly CanonicalGap[];
  /** The domain's brand gap for the project (`brandGap`), when its name borrows a brand; the one matcher decides it. */
  brand?: { sentence: string; reason: string };
  /** The project's refresh tier by the domain's rule, when the caller computed it. */
  tier?: RefreshTier;
  /**
   * The explain engine's evidence ids for the three builder facts (round 4,
   * 2026-09-30): exactly what `/api/projects/{slug}/explain?fact=…` cites for
   * `activity.status`, `build.momentum` and `still_building`. Absent, those
   * claims cite none, as before.
   */
  explained?: { activity: readonly string[]; momentum: readonly string[]; stillBuilding: readonly string[] };
  isEvidenceId?: (id: string) => boolean;
};

/** Why Still Building was not measured, in the contract's words (the API's `stillBuildingWithheld`). */
const STILL_BUILDING_WITHHELD_TEXT: Readonly<Record<string, string>> = {
  market_not_live: 'the token has no live market HEY tracks',
  token_not_the_projects: "the tracked token is not the project's own",
  market_too_thin: 'the market is too thin to hold a drawdown HEY measures',
  valuation_not_plausible: 'its current valuation is not plausible from the readings HEY has, so there is no drawdown HEY measures',
  // hbm-v21 (2026-10-01, founder rulings F1 and F2).
  no_token: 'the project has no tracked token, so there is no market drawdown to measure',
  active_pool_not_read: "the market is active only in another pool of the token, and HEY holds no current reading of that pool; it is never measured on the token's own thin pool",
  no_market_reading: 'HEY holds no current market reading to measure a drawdown on',
  activity_unknown: 'HEY holds no builder source it can read, so whether the project kept building is not known',
  not_scored: 'HEY has not scored it under the current rules yet',
};

const STILL_BUILDING_MEANING = 'Still Building: verified activity continuing through a market drawdown HEY tracked; a record of what happened, not a prediction and not a buy signal.';

/** What each Research Summary line rests on when it cites no record (round 4): its reading, its coverage state, or the snapshot read. */
const LINE_KIND: Readonly<Partial<Record<HeySummaryLine['dimension'], AgentEvidenceKind>>> = {
  usage: 'usage_reading',
  market: 'market_reading',
  unknown: 'coverage_state',
};

const LINE_SOURCE: Readonly<Record<HeySummaryLine['dimension'], { name: string; type: AgentSourceType; context?: true }>> = {
  build: { name: 'builder sources', type: 'builder_source' },
  usage: { name: 'decoded contract calls', type: 'chain', context: true },
  market: { name: 'market readings', type: 'market_provider', context: true },
  contract: { name: 'Robinhood Chain explorer and RPC', type: 'chain' },
  fundamentals: { name: 'DefiLlama', type: 'registry', context: true },
  security: { name: 'official site and registries', type: 'project_site', context: true },
  latestChange: { name: 'change ledger', type: 'hey_record' },
  unknown: { name: 'project coverage', type: 'hey_record' },
};

/** A summary line's freshness in the contract's words: its age bucket when fresh, `stale`, else `unknown`. */
export function lineFreshness(line: Pick<HeySummaryLine, 'freshness' | 'observedAt'>, now: Date): AgentClaim['freshness'] {
  if (line.freshness === 'stale') return 'stale';
  if (line.freshness !== 'fresh' || !line.observedAt) return 'unknown';
  const at = Date.parse(line.observedAt);
  return Number.isFinite(at) ? ageBucket(Math.max(0, now.getTime() - at)) : 'unknown';
}

/**
 * One Research Summary line as a claim: the line's own tag, text, evidence and reading time — never restated in other words.
 *
 * Two readings of the line's own evidence (2026-09-30, adversarial review):
 * - a line that repeats a ledger event's source title ("Yesterday: AgentOS
 *   2026.9.29.post1.") carries a source's words, so the whole line is typed
 *   `external_source` and quoted as data on every text transport;
 * - a line whose event is market or usage context (a volume spike as the
 *   latest change) is `contextOnly`, and tagged no stronger than the event's
 *   own record tag.
 */
export function summaryClaim(line: HeySummaryLine, ctx: AgentComposeContext, isEvidenceId: (id: string) => boolean, changes: readonly AgentChange[] = []): AgentClaim {
  const source = LINE_SOURCE[line.dimension];
  const evidence = line.evidence.filter((entry) => isEvidenceId(entry.id)).slice(0, 12).map((entry) => evidenceRef(ctx.baseUrl, entry.id, entry.url));
  const lineIds = new Set(line.evidence.map((entry) => entry.id));
  const event = changes.find((change) => lineIds.has(change.id) || change.evidence.some((ref) => lineIds.has(ref.id)));
  const quotesSource = event !== undefined && event.summary.contentOrigin === 'external_source' && event.summary.text.length > 0 && line.text.includes(event.summary.text);
  const context = source.context === true || (event !== undefined && isContextChange(event));
  const tag = event && line.tag === 'FACT' && event.status === 'DERIVED' ? 'DERIVED' : line.tag;
  return {
    id: `summary.${line.dimension}`,
    dimension: line.dimension,
    statement: quotesSource ? externalText(line.text, 'research_summary_quoting_source', event.summary.sourceUrl, 600) : derivedText(line.text),
    status: tag,
    value: null,
    source: tag === 'UNKNOWN' ? null : tag === 'DERIVED' ? { name: 'hey', type: 'hey_rule' } : { name: evidence.length > 0 && line.evidence[0]?.label ? line.evidence[0].label.slice(0, 120) : source.name, type: context && event ? 'market_provider' : source.type },
    observedAt: line.observedAt ?? null,
    occurredAt: null,
    precision: null,
    freshness: lineFreshness(line, ctx.now),
    evidence,
    explainUrl: line.detailUrl,
    ...(line.reason ? { reason: line.reason } : {}),
    ...(context ? { contextOnly: true as const } : {}),
    // The line's own basis first (2026-10-01): the summary names what an uncited FACT rests on, in this contract's words.
    ...(tag !== 'UNKNOWN' && evidence.length === 0 && line.basis && line.basis !== 'evidence_record' && line.basis !== 'not_held'
      ? { evidenceKind: line.basis }
      : tag !== 'UNKNOWN' && evidence.length === 0 && LINE_KIND[line.dimension]
        ? { evidenceKind: LINE_KIND[line.dimension] }
        : {}),
  };
}

/** The snapshot's per-source freshness, plus usage, peers and economics where the snapshot carries them, in the contract's words. */
export function snapshotFreshness(snapshot: HeyProjectSnapshot, now: Date, tier?: RefreshTier): AgentFreshness[] {
  const out: AgentFreshnessEntry[] = snapshot.freshness.map((entry) =>
    familyFreshness(SNAPSHOT_SOURCE_FAMILY[entry.source], {
      observedAt: entry.observedAt ?? null,
      now,
      staleAfterHours: entry.staleAfterHours,
      ...(tier && (entry.source === 'code' || entry.source === 'market') ? { tier } : {}),
    }),
  );
  if (snapshot.usage) out.push(familyFreshness('usage', { observedAt: snapshot.usage.observedAt ?? null, dataAsOf: snapshot.usage.collectedThrough ?? null, now }));
  if (snapshot.peerContext?.freshness) out.push(familyFreshness('peers', { observedAt: snapshot.peerContext.freshness.asOf, now, staleAfterHours: snapshot.peerContext.freshness.staleAfterHours }));
  const economicsDay = snapshot.protocolEconomics?.protocols.map((entry) => entry.economicsDay ?? entry.tvlDay).sort().at(-1);
  if (snapshot.protocolEconomics) out.push(familyFreshness('protocol_economics', { observedAt: economicsDay ? `${economicsDay}T00:00:00.000Z` : null, now }));
  return out as AgentFreshness[];
}

function scoreObservedAt(snapshot: HeyProjectSnapshot): string | null {
  return snapshot.freshness.find((entry) => entry.source === 'score')?.observedAt ?? null;
}

export function composeResearch(ctx: AgentComposeContext, input: ResearchInput): AgentResponseOf<'research_project'> {
  const { snapshot } = input;
  const isEvidenceId = input.isEvidenceId ?? looksLikeEvidenceId;
  const slug = snapshot.identity.slug;
  const api = projectApi(ctx, slug);
  const explain = (fact: string) => `${api}/explain?fact=${fact}`;
  const freshness = snapshotFreshness(snapshot, ctx.now, input.tier);
  const scoreFresh = freshness.find((entry) => entry.family === 'activity_score');
  const scoreAt = scoreObservedAt(snapshot);
  const b = snapshot.build;
  const status = b.activityStatus;
  const project = { slug, url: snapshot.identity.url };

  const changes: AgentChange[] = snapshot.latestChanges.available
    ? snapshot.latestChanges.items.flatMap((item) => (item.op === 'upsert' ? [agentChange(item, project, ctx.baseUrl, isEvidenceId)] : []))
    : [];
  const latestMeaningful = changes.find((change) => change.countsAsBuilding) ?? null;
  const events30d = snapshot.evidenceSummary.meaningfulEvents30d;
  // Round 4 (2026-09-30): the API's own state, as the scorer decided it; the contract derives none of its own.
  const stillBuildingState = stillBuildingStateOf({ apiState: b.stillBuildingState });
  const explainedRefs = (ids: readonly string[] | undefined) => (ids ?? []).filter(isEvidenceId).slice(0, 12).map((id) => evidenceRef(ctx.baseUrl, id));
  /*
   * The count's own events, as far as the ledger lists them (round 4): the
   * building events among the snapshot's latest changes dated inside the
   * 30 days. A sample of what is counted, never a list HEY assembles apart
   * from the ledger, and none when the count is not measured or zero.
   */
  const windowStart = ctx.now.getTime() - 30 * 86_400_000;
  const windowEvidence =
    events30d !== null && events30d > 0
      ? changes
          .filter((change) => change.countsAsBuilding && Date.parse(change.occurredAt ?? change.detectedAt) >= windowStart)
          .flatMap((change) => change.evidence)
          .slice(0, 12)
      : [];
  const token = snapshot.identity.token;
  const verification = snapshot.verification.token;

  const claims: AgentClaim[] = [
    ...snapshot.summary.lines.map((line) => summaryClaim(line, ctx, isEvidenceId, changes)),
    {
      id: 'build.activity_status',
      dimension: 'build',
      statement: derivedText(`Activity status ${status} under HEY's activity rule${snapshot.scoringVersion ? ` (${snapshot.scoringVersion})` : ''}.`),
      status: status === 'UNKNOWN' ? 'UNKNOWN' : 'DERIVED',
      value: status,
      // An UNKNOWN claim names no source (AgentIntelligenceResponse v1 invariant).
      source: status === 'UNKNOWN' ? null : { name: 'hey', type: 'hey_rule' },
      observedAt: scoreAt,
      occurredAt: null,
      precision: null,
      freshness: scoreFresh?.freshnessStatus ?? 'unknown',
      evidence: status === 'UNKNOWN' ? [] : explainedRefs(input.explained?.activity),
      explainUrl: explain('activity.status'),
      evidenceKind: status === 'UNKNOWN' ? 'not_held' : 'rule_output',
    },
    b.lastShippedAt
      ? {
          id: 'build.last_meaningful_ship',
          dimension: 'build',
          statement: derivedText(`The newest meaningful ship HEY recorded is dated ${b.lastShippedAt.slice(0, 10)}.`),
          status: 'FACT',
          value: b.lastShippedAt,
          source: { name: 'builder sources', type: 'builder_source' },
          observedAt: scoreAt,
          occurredAt: b.lastShippedAt,
          precision: latestMeaningful && latestMeaningful.occurredAt === b.lastShippedAt ? latestMeaningful.precision : null,
          freshness: scoreFresh?.freshnessStatus ?? 'unknown',
          evidence: latestMeaningful && latestMeaningful.occurredAt === b.lastShippedAt ? latestMeaningful.evidence : [],
          explainUrl: explain('activity.status'),
        }
      : {
          id: 'build.last_meaningful_ship',
          dimension: 'build',
          statement: heyText(b.activityMeasured === true ? 'HEY has recorded no meaningful ship for this project.' : 'HEY does not know when this project last shipped: its building is not measured.'),
          status: b.activityMeasured === true ? 'FACT' : 'UNKNOWN',
          value: null,
          source: b.activityMeasured === true ? { name: 'builder sources', type: 'builder_source' } : null,
          observedAt: scoreAt,
          occurredAt: null,
          precision: null,
          freshness: scoreFresh?.freshnessStatus ?? 'unknown',
          evidence: [],
          reason: b.activityMeasured === true ? 'none_recorded' : 'activity_not_measured',
        },
    events30d === null
      ? { id: 'build.meaningful_events_30d', dimension: 'build', statement: heyText('Meaningful building events in 30 days are not measured for this project; no count is published, because a zero would mean "not read".'), status: 'UNKNOWN', value: null, source: null, observedAt: scoreAt, occurredAt: null, precision: 'WINDOW', freshness: scoreFresh?.freshnessStatus ?? 'unknown', evidence: [], reason: 'activity_not_measured', explainUrl: explain('activity.status') }
      : { id: 'build.meaningful_events_30d', dimension: 'build', statement: derivedText(`${countOf(events30d, WORD_MEANINGFUL_BUILDING_EVENT)} in the last 30 days.`), status: 'DERIVED', value: events30d, source: { name: 'hey', type: 'hey_rule' }, observedAt: scoreAt, occurredAt: null, precision: 'WINDOW', freshness: scoreFresh?.freshnessStatus ?? 'unknown', evidence: windowEvidence, explainUrl: explain('activity.status'), evidenceKind: 'rule_output' },
    b.buildMomentum === undefined
      ? { id: 'build.momentum', dimension: 'build', statement: heyText('Build Momentum is not measured for this project.'), status: 'UNKNOWN', value: null, source: null, observedAt: scoreAt, occurredAt: null, precision: null, freshness: scoreFresh?.freshnessStatus ?? 'unknown', evidence: [], reason: 'not_measured', explainUrl: explain('build.momentum') }
      : { id: 'build.momentum', dimension: 'build', statement: derivedText(`Build Momentum ${b.buildMomentum} (0–100, from development evidence only; never price).`), status: 'DERIVED', value: b.buildMomentum, source: { name: 'hey', type: 'hey_rule' }, observedAt: scoreAt, occurredAt: null, precision: null, freshness: scoreFresh?.freshnessStatus ?? 'unknown', evidence: explainedRefs(input.explained?.momentum), explainUrl: explain('build.momentum'), evidenceKind: 'rule_output' },
    /*
     * Not measured is not "does not hold" (2026-09-30, hbm-v19): the API sends
     * stillBuilding: false beside stillBuildingWithheld, and the claim is then
     * UNKNOWN with the reason, never a false the contract would restate.
     */
    b.stillBuildingWithheld || stillBuildingState === 'NOT_MEASURED'
      ? {
          id: 'build.still_building',
          dimension: 'build',
          statement: heyText(
            b.stillBuildingWithheld
              ? `Still Building is not measured for this project: ${STILL_BUILDING_WITHHELD_TEXT[b.stillBuildingWithheld] ?? 'its market does not hold a drawdown HEY measures'}.`
              : 'Still Building is not measured for this project: HEY has not scored it.',
          ),
          status: 'UNKNOWN',
          value: null,
          source: null,
          observedAt: scoreAt,
          occurredAt: null,
          precision: null,
          freshness: scoreFresh?.freshnessStatus ?? 'unknown',
          evidence: [],
          reason: b.stillBuildingWithheld ?? 'not_scored',
          explainUrl: explain('still_building'),
        }
      : {
          id: 'build.still_building',
          dimension: 'build',
          statement: heyText(b.stillBuilding ? STILL_BUILDING_MEANING : 'Still Building does not hold for this project now.'),
          status: 'DERIVED',
          value: b.stillBuilding,
          source: { name: 'hey', type: 'hey_rule' },
          observedAt: scoreAt,
          occurredAt: null,
          precision: null,
          freshness: scoreFresh?.freshnessStatus ?? 'unknown',
          // The explain engine cites records only for a badge that holds; a "does not hold" is the rule's output alone.
          evidence: b.stillBuilding ? explainedRefs(input.explained?.stillBuilding) : [],
          explainUrl: explain('still_building'),
          evidenceKind: 'rule_output',
        },
  ];

  if (token) {
    const state = verification?.status;
    claims.push({
      id: 'contract.token_verification',
      dimension: 'contract',
      statement: heyText(
        state === 'VERIFIED'
          ? 'The project itself names this token contract (its own site, a deploy record in its own repository, or an on-chain signature).'
          : state === 'MISMATCH'
            ? 'The project’s own site names a different contract than the token HEY tracks: its building activity does not apply to this token.'
            : 'HEY has not seen the project name this token contract.',
      ),
      status: state === 'VERIFIED' || state === 'MISMATCH' ? 'FACT' : 'UNKNOWN',
      value: state ?? null,
      source: state === 'VERIFIED' || state === 'MISMATCH' ? { name: 'project’s own voice', type: 'project_site' } : null,
      observedAt: verification?.verifiedAt ?? null,
      occurredAt: null,
      precision: null,
      freshness: verification?.verifiedAt ? ageBucket(Math.max(0, ctx.now.getTime() - Date.parse(verification.verifiedAt))) : 'unknown',
      evidence: [],
      explainUrl: explain('token.verification'),
      ...(state === 'VERIFIED' || state === 'MISMATCH' ? { evidenceKind: 'registry_record' as const } : {}),
      ...(verification?.reason ? { reason: verification.reason } : {}),
    });
  }

  const market = snapshot.market;
  if (market) {
    const cap = market.marketCap;
    const marketFresh = freshness.find((entry) => entry.family === 'market');
    claims.push(
      cap
        ? {
            id: 'market.valuation',
            dimension: 'market',
            statement: derivedText(`${cap.kind === 'fdv' ? 'FDV' : cap.kind === 'marketCap' ? 'Market cap' : 'Valuation'} about $${Math.round(cap.usd).toLocaleString('en-US')} from ${cap.source}: market context only, never a builder judgement.`),
            status: 'FACT',
            value: cap.usd,
            source: { name: cap.source.slice(0, 120), type: 'market_provider' },
            observedAt: cap.observedAt ?? null,
            occurredAt: null,
            precision: null,
            freshness: marketFresh?.freshnessStatus ?? 'unknown',
            evidence: [],
            explainUrl: explain('market.valuation'),
            contextOnly: true,
            evidenceKind: 'market_reading',
          }
        : {
            id: 'market.valuation',
            dimension: 'market',
            statement: heyText(market.valuationWithheld ? valuationWithheldSentence(market.valuationWithheld) : 'HEY holds no market reading for this token.'),
            status: market.valuationWithheld ? 'DERIVED' : 'UNKNOWN',
            value: null,
            source: market.valuationWithheld ? { name: 'hey', type: 'hey_rule' } : null,
            observedAt: null,
            occurredAt: null,
            precision: null,
            freshness: marketFresh?.freshnessStatus ?? 'unknown',
            evidence: [],
            explainUrl: explain('market.valuation'),
            reason: market.valuationWithheld ?? 'no_reading',
            contextOnly: true,
            ...(market.valuationWithheld ? { evidenceKind: 'rule_output' as const } : {}),
          },
    );
  }

  const unknowns = projectUnknowns({
    gaps: input.gaps,
    dimensions: snapshot.coverage,
    facts: {
      activityStatus: status,
      tokenVerification: verification ? { status: verification.status as 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH', ...(verification.reason ? { reason: verification.reason } : {}) } : null,
      ownerVerified: snapshot.verification.ownerVerified,
      buildMomentum: b.buildMomentum,
      usage: snapshot.usage ? { state: snapshot.usage.state, reason: snapshot.usage.reason, ...(snapshot.usage.observedAt ? { observedAt: snapshot.usage.observedAt } : {}) } : null,
      ledger: snapshot.latestChanges.available ? { available: true } : { available: false, reason: snapshot.latestChanges.reason },
      ...(input.brand ? { brand: input.brand } : {}),
    },
    coverageUrl: `${api}/coverage`,
    explainUrl: explain,
  });

  const shipWords = b.lastShippedAt ? `, last meaningful ship ${b.lastShippedAt.slice(0, 10)}` : b.activityMeasured === true ? ', no meaningful ship recorded' : '';
  const eventWords = events30d === null ? 'meaningful events in 30 days not measured' : `${countOf(events30d, WORD_MEANINGFUL_EVENT)} in 30 days`;
  // A mismatched token is named in the answer itself (2026-09-30, adversarial review), not only in a claim further down.
  const tokenWords = verification?.status === 'MISMATCH' ? ' The token HEY tracks for it is not the one its own site names: this building does not apply to that token.' : '';
  const answer = derivedText(`${slug}: activity status ${status}${shipWords}; ${eventWords}.${tokenWords} HEY lists ${countOf(unknowns.length, WORD_THING)} it does not know (coverage gaps and unverified identity) under unknowns.`);

  const u = snapshot.usage;
  return envelope(ctx, {
    capability: 'research_project',
    status: 'ok',
    subject: { kind: 'project', project: { slug, name: externalText(snapshot.identity.name, 'project_record'), url: snapshot.identity.url, ...(token ? { token: { chainId: token.chainId, address: token.contractAddress.toLowerCase() } } : {}) } },
    answer,
    answerStatus: status === 'UNKNOWN' ? 'UNKNOWN' : 'DERIVED',
    claims,
    unknowns,
    freshness,
    dataEvidence: changes.flatMap((change) => change.evidence),
    data: {
      identity: {
        slug,
        name: externalText(snapshot.identity.name, 'project_record'),
        symbol: snapshot.identity.symbol ? externalText(snapshot.identity.symbol, 'token_metadata', undefined, 40) : null,
        projectKind: snapshot.identity.projectKind,
        researchLevel: snapshot.identity.researchLevel,
        catalogStatus: snapshot.identity.catalogStatus,
        narrative: snapshot.identity.primaryNarrative ? { slug: snapshot.identity.primaryNarrative.slug, name: derivedText(snapshot.identity.primaryNarrative.name, 80) } : null,
        firstRecordedByHeyAt: snapshot.identity.firstRecordedByHeyAt,
        websiteUrl: snapshot.identity.websiteUrl && /^https?:\/\/\S{1,600}$/.test(snapshot.identity.websiteUrl) ? snapshot.identity.websiteUrl : null,
        url: snapshot.identity.url,
      },
      builderState: {
        activityStatus: status,
        activityMeasured: b.activityMeasured ?? null,
        lastMeaningfulShipAt: b.lastShippedAt ?? null,
        meaningfulEvents30d: events30d,
        buildMomentum: b.buildMomentum ?? null,
        ...(b.buildMomentum === undefined ? { buildMomentumReason: 'not_measured' } : {}),
        stillBuilding: b.stillBuilding,
        ...(b.stillBuildingWithheld ? { stillBuildingWithheld: b.stillBuildingWithheld } : {}),
        // Round 4 (2026-09-30): the API's own state when it sends one, else read from stillBuilding and stillBuildingWithheld.
        stillBuildingState,
        scoringVersion: snapshot.scoringVersion ?? null,
        explainUrl: explain('activity.status'),
      },
      latestMeaningfulChange: latestMeaningful,
      /*
       * A null here is read as "none" unless it says why (ux-data audit,
       * 2026-10-01): the newest five changes can all be market changes while
       * HEY holds a ship from last week.
       */
      ...(latestMeaningful === null
        ? {
            latestMeaningfulChangeReason: !snapshot.latestChanges.available
              ? ('changes_unavailable' as const)
              : b.lastShippedAt || (events30d !== null && events30d > 0)
                ? ('not_in_recent_changes' as const)
                : ('none_recorded' as const),
          }
        : {}),
      recentChanges: { available: snapshot.latestChanges.available, ...(snapshot.latestChanges.available ? {} : { reason: snapshot.latestChanges.reason }), items: changes, url: snapshot.latestChanges.url },
      contractIdentity: {
        token: token ? { chainId: token.chainId, address: token.contractAddress.toLowerCase(), verification: verification?.status ?? null, verificationReason: verification?.reason ?? null } : null,
        ownerVerified: snapshot.verification.ownerVerified,
        contractsUrl: snapshot.contracts.url,
      },
      marketContext: market
        ? {
            contextOnly: true as const,
            valuation: market.marketCap ? { usd: market.marketCap.usd, kind: market.marketCap.kind ?? 'unspecified', source: market.marketCap.source.slice(0, 80), observedAt: market.marketCap.observedAt ?? null } : null,
            valuationWithheld: market.valuationWithheld ?? null,
            liquidityUsd: market.liquidity?.usd ?? null,
            // The API's own qualifier (2026-09-30): `launch_inventory` is a launch pool's supply, not a market's depth.
            ...(market.liquidity?.kind ? { liquidityKind: market.liquidity.kind } : {}),
            volume24hUsd: market.volume24h?.usd ?? null,
            tokenMarketStatus: market.tokenMarket?.status ?? null,
            url: market.url,
          }
        : null,
      usageContext: u
        ? {
            contextOnly: true as const,
            state: u.state,
            reason: u.reason,
            windowDays: u.window?.days ?? null,
            calls: u.calls ?? null,
            activeContracts: u.activeContracts ?? null,
            watchedContracts: u.watchedContracts,
            observedAt: u.observedAt ?? null,
            url: u.url,
          }
        : null,
    },
    rules: [
      { id: 'activity.status', version: snapshot.scoringVersion ?? 'unscored' },
      { id: 'research_summary', version: snapshot.summary.version },
      ...(snapshot.peerContext ? [{ id: 'peers', version: snapshot.peerContext.rulesVersion }] : []),
    ],
    page: snapshot.links.page,
    canonical: [snapshot.links.detail + '/snapshot', snapshot.links.coverage, snapshot.links.explain, snapshot.links.changes],
    citationProject: slug,
    scoringVersion: snapshot.scoringVersion ?? null,
  });
}
