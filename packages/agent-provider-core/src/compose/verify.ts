import type { HeyContract, HeyTokenLookup } from '@hey-research-lab/sdk';

import { familyFreshness } from '../freshness';
import type { AgentClaim, AgentEvidenceRef, AgentResponseOf, AgentUnknown, AgentVerifyData } from '../schema';
import { derivedText, externalText, heyText, type AgentText } from '../text';
import { doNotConclude } from '../unknowns';
import { envelope, evidenceRef, looksLikeEvidenceId, type AgentComposeContext } from './common';

/**
 * verify_project (2026-09-30): "does this contract or token appear to belong
 * to this project?"
 *
 * Restated from two canonical reads: the by-contract lookup (the token's
 * project and its token verification — whether the project itself names the
 * contract) and the contract read (the project HEY records any known
 * contract under, and by which link: its token, a contract its record names,
 * or a follow-up its token's deployer put up).
 *
 * - `VERIFIED` — the project itself names this token contract: its own site,
 *   a deploy record in its own repository, or an on-chain signature.
 * - `UNVERIFIED` — HEY records the contract under the project, and the
 *   project has not been seen naming it (a launchpad record, a listing, the
 *   deployer's later contract, a source on the record).
 * - `CONTRACT_MISMATCH` — the project's own site names a different contract,
 *   or HEY records this contract under another published project than the
 *   one asked about.
 * - `UNKNOWN` — HEY holds no published project for the contract, several
 *   projects share the strongest link, or the asked project's record does not
 *   list it. Never a finding that it is not the project's.
 *
 * A verdict is about attribution only: VERIFIED is never "safe", and nothing
 * here is a risk reading.
 */
export type VerifyInput = {
  chainId: number;
  address: string;
  /** The by-contract lookup for the address (`/api/token/{chainId}/{address}`). */
  token: HeyTokenLookup;
  /** The contract read (`/api/contracts/{chainId}/{address}`); null when HEY holds no record of the address. */
  contract: HeyContract | null;
  /** The project the caller named, as HEY found it. */
  asked?: { slug: string; found: boolean; url: string | null; name?: string; tokenAddress?: string | null };
  /** When HEY last checked whether the project names its tracked token (the profile's `verifiedAt`); null when unknown. */
  tokenVerifiedAt?: string | null;
  isEvidenceId?: (id: string) => boolean;
};

/** Where a token verification's reason was read (2026-09-30): the project's site, its own repository, or the chain. */
const REASON_SOURCE: Readonly<Record<string, { name: string; type: 'project_site' | 'builder_source' | 'chain' }>> = {
  onchain_signature: { name: 'on-chain signature', type: 'chain' },
  deploy_record_in_own_repo: { name: 'project’s own repository', type: 'builder_source' },
  site_names_contract: { name: 'project’s own site', type: 'project_site' },
  site_names_another_contract: { name: 'project’s own site', type: 'project_site' },
};

type Verdict = AgentVerifyData['verdict'];

const TOKEN_REASON_WORDS: Readonly<Record<string, string>> = {
  onchain_signature: 'The project’s owner proved control of the deployer or the contract with an on-chain signature.',
  site_names_contract: 'The project’s own website names this contract.',
  deploy_record_in_own_repo: 'A deploy record in the project’s own official repository names this contract on this chain.',
  site_names_another_contract: 'The project’s own website names a different contract than this one.',
  owner_has_not_published_contract: 'The verified owner has not published this contract on the project’s site or signed for it.',
  self_reported: 'The contract was named in the project’s submission; its site or an on-chain signature has not confirmed it.',
  launchpad_record: 'HEY knows the contract from a launchpad record; the project has not been seen naming it.',
  launchpad_record_site_silent: 'HEY knows the contract from a launchpad record, and the project’s site does not name it.',
  market_listing: 'HEY knows the contract from a market listing; the project has not been seen naming it.',
  site_silent: 'The project’s site does not name this contract.',
  not_checked: 'HEY has not yet checked whether the project names this contract.',
};

const ROLE_WORDS: Readonly<Record<'token' | 'declared' | 'followup', string>> = {
  token: 'HEY records this contract as the project’s tracked token.',
  declared: 'HEY records this contract because a source on the project’s record points to it; the project has not been seen naming it as its own.',
  followup: 'HEY records this contract because the project’s token deployer created it later; that is a link through the deployer, not the project naming it.',
};

export function composeVerify(ctx: AgentComposeContext, input: VerifyInput): AgentResponseOf<'verify_project'> {
  const isEvidenceId = input.isEvidenceId ?? looksLikeEvidenceId;
  const address = input.address.toLowerCase();
  const lookupProject = input.token.status === 'published' ? input.token.project : undefined;
  const recorded: AgentVerifyData['recordedProject'] = lookupProject
    ? { slug: lookupProject.slug, url: lookupProject.url, role: 'token' }
    : input.contract?.associatedProject
      ? { slug: input.contract.associatedProject.slug, url: input.contract.associatedProject.url, role: input.contract.role ?? null }
      : null;
  const asked = input.asked;
  const reasons: AgentText[] = [];
  let verdict: Verdict;
  let reasonCode: string;
  let tokenVerification: AgentVerifyData['tokenVerification'] = null;

  if (asked && !asked.found) {
    verdict = 'UNKNOWN';
    reasonCode = 'asked_project_not_found';
    reasons.push(derivedText(`HEY holds no published project with the slug "${asked.slug}".`));
  } else if (asked && recorded && recorded.slug !== asked.slug) {
    verdict = 'CONTRACT_MISMATCH';
    reasonCode = 'recorded_under_another_project';
    reasons.push(derivedText(`HEY records this contract under another published project ("${recorded.slug}"), not "${asked.slug}".`));
  } else if (!recorded) {
    verdict = 'UNKNOWN';
    if (asked?.tokenAddress && asked.tokenAddress.toLowerCase() !== address) {
      reasonCode = 'not_in_project_record';
      reasons.push(derivedText(`HEY's record of "${asked.slug}" does not list this contract; the token HEY tracks for it is ${asked.tokenAddress.toLowerCase()}. That is not a finding that this contract is not the project's.`));
    } else if (input.contract) {
      reasonCode = 'no_single_project_on_record';
      reasons.push(heyText('HEY holds a record of this contract, and no single published project on it: none, or several sharing the strongest link.'));
    } else {
      reasonCode = 'no_record';
      reasons.push(heyText('HEY holds no record of this contract on a published project.'));
    }
  } else if (recorded.role === 'token' && lookupProject) {
    const status = lookupProject.tokenVerification.status;
    const reason = lookupProject.tokenVerification.reason ?? null;
    tokenVerification = { status, reason };
    verdict = status === 'VERIFIED' ? 'VERIFIED' : status === 'MISMATCH' ? 'CONTRACT_MISMATCH' : 'UNVERIFIED';
    reasonCode = status === 'MISMATCH' ? 'site_names_another_contract' : `token_${reason ?? 'not_checked'}`;
    reasons.push(heyText(ROLE_WORDS.token));
    reasons.push(heyText(TOKEN_REASON_WORDS[reason ?? 'not_checked'] ?? 'HEY has not seen the project name this contract.'));
  } else {
    verdict = 'UNVERIFIED';
    reasonCode = recorded.role === 'followup' ? 'deployed_by_token_deployer' : 'recorded_as_project_source';
    reasons.push(heyText(ROLE_WORDS[recorded.role === 'followup' ? 'followup' : 'declared']));
  }

  const evidence: AgentEvidenceRef[] = [
    ...(input.contract?.creation?.evidenceId && isEvidenceId(input.contract.creation.evidenceId) ? [evidenceRef(ctx.baseUrl, input.contract.creation.evidenceId)] : []),
    ...(input.contract?.evidence ?? []).filter(isEvidenceId).map((id) => evidenceRef(ctx.baseUrl, id)),
  ].slice(0, 12);

  const claimStatus: AgentClaim['status'] = verdict === 'VERIFIED' || reasonCode === 'site_names_another_contract' ? 'FACT' : verdict === 'CONTRACT_MISMATCH' ? 'DERIVED' : 'UNKNOWN';
  const claims: AgentClaim[] = [
    {
      id: 'verify.verdict',
      dimension: 'contract',
      statement: derivedText(`${verdict} (${reasonCode}): ${reasons.map((reason) => reason.text).join(' ')}`),
      status: claimStatus,
      value: verdict,
      source: claimStatus === 'UNKNOWN' ? null : claimStatus === 'FACT' ? (REASON_SOURCE[tokenVerification?.reason ?? ''] ?? { name: 'project’s own voice', type: 'project_site' }) : { name: 'hey', type: 'hey_rule' },
      // When HEY checked the token's verification, never the score's time (2026-09-30, methodology review); unknown when not given.
      observedAt: recorded?.role === 'token' ? (input.tokenVerifiedAt ?? null) : null,
      occurredAt: null,
      precision: null,
      freshness: recorded?.role === 'token' && input.tokenVerifiedAt ? familyFreshness('contracts', { observedAt: input.tokenVerifiedAt, now: ctx.now }).freshnessStatus : 'unknown',
      evidence,
      ...(recorded && recorded.role === 'token' ? { explainUrl: `${ctx.baseUrl}/api/projects/${recorded.slug}/explain?fact=token.verification` } : {}),
      reason: reasonCode,
    },
  ];
  const checkedAt = [input.contract?.freshness.sourceCheckedAt, input.contract?.freshness.proxyCheckedAt].filter((at): at is string => Boolean(at)).sort().at(-1) ?? null;
  if (recorded) {
    /*
     * Which project HEY files the contract under is HEY's own record — the
     * contract registry the canonical reads publish — not a source's claim and
     * not a rule's verdict (2026-09-30, adversarial review: it had no path to
     * its basis). It points at the reads that state it: the token lookup for a
     * tracked token, else the contract read (`associatedProject`, `role`); a
     * follow-up contract cites its creation record, the deployer link it rests on.
     */
    const recordUrl = recorded.role === 'token' ? `${ctx.baseUrl}/api/token/${input.chainId}/${address}` : `${ctx.baseUrl}/api/contracts/${input.chainId}/${address}`;
    const observed = recorded.role === 'token' ? (input.tokenVerifiedAt ?? null) : checkedAt;
    claims.push({
      id: 'verify.recorded_project',
      dimension: 'contract',
      statement: derivedText(`HEY records this contract under "${recorded.slug}"${recorded.role ? ` as its ${recorded.role === 'token' ? 'tracked token' : recorded.role === 'declared' ? 'recorded contract' : 'deployer’s follow-up contract'}` : ''}.`),
      status: 'DERIVED',
      value: recorded.slug,
      source: { name: 'contract registry', type: 'hey_record' },
      observedAt: observed,
      occurredAt: null,
      precision: null,
      freshness: observed ? familyFreshness('contracts', { observedAt: observed, now: ctx.now }).freshnessStatus : 'unknown',
      evidence: recorded.role === 'followup' ? evidence.filter((ref) => ref.id === input.contract?.creation?.evidenceId) : [],
      explainUrl: recordUrl,
      reason: `recorded_as_${recorded.role ?? 'project_contract'}`,
    });
  }

  const unknowns: AgentUnknown[] = [];
  if (verdict === 'UNVERIFIED') unknowns.push({ category: 'NOT_VERIFIED', dimension: 'contractOwnership', statement: heyText('The project has not been seen naming this contract as its own.'), doNotConclude: doNotConclude('NOT_VERIFIED'), reason: reasonCode });
  if (verdict === 'UNKNOWN') unknowns.push({ category: 'UNKNOWN', dimension: 'contractAttribution', statement: heyText('HEY cannot attribute this contract to one published project.'), doNotConclude: doNotConclude('UNKNOWN'), reason: reasonCode });

  const answer =
    verdict === 'VERIFIED'
      ? derivedText(`VERIFIED: the project "${recorded?.slug}" itself names ${address}. This is attribution, not a safety reading.`)
      : verdict === 'CONTRACT_MISMATCH'
        ? // Every reason, so the answer says why (benchmark 2026-09-30): the first alone read "HEY records this contract as the project's tracked token", which sounds like a match.
          derivedText(`CONTRACT_MISMATCH: ${reasons.map((reason) => reason.text).join(' ')}`)
        : verdict === 'UNVERIFIED'
          ? derivedText(`UNVERIFIED: HEY records ${address} under "${recorded?.slug}", and the project has not been seen naming it.`)
          : derivedText(`UNKNOWN: ${reasons[0]?.text ?? 'HEY cannot attribute this contract.'} Missing attribution is not evidence against it.`);

  const projectForSubject = recorded ?? (asked?.found && asked.url ? { slug: asked.slug, url: asked.url } : null);
  return envelope(ctx, {
    capability: 'verify_project',
    status: 'ok',
    subject: { kind: 'contract', contract: { chainId: input.chainId, address }, ...(projectForSubject ? { project: { slug: projectForSubject.slug, name: externalText(lookupProject?.name ?? input.contract?.associatedProject?.name ?? asked?.name ?? projectForSubject.slug, 'project_record'), url: projectForSubject.url } } : {}) },
    answer,
    answerStatus: claimStatus,
    claims,
    unknowns,
    freshness: input.contract ? [familyFreshness('contracts', { observedAt: checkedAt, now: ctx.now })] : [],
    data: {
      chainId: input.chainId,
      address,
      verdict,
      reasonCode,
      reasons: reasons.slice(0, 8),
      recordedProject: recorded,
      askedProject: asked ? { slug: asked.slug, found: asked.found, url: asked.url } : null,
      tokenVerification,
      activityAppliesToContract: verdict === 'UNKNOWN' ? null : verdict !== 'CONTRACT_MISMATCH',
      contractUrl: `${ctx.baseUrl}/api/contracts/${input.chainId}/${address}`,
      scanUrl: input.token.scanUrl,
    },
    ...(recorded ? { page: recorded.url, citationProject: recorded.slug } : {}),
    canonical: [`${ctx.baseUrl}/api/token/${input.chainId}/${address}`, `${ctx.baseUrl}/api/contracts/${input.chainId}/${address}`],
  });
}
