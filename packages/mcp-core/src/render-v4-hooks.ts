import type { HeyV4HookDetail } from '@hey-research-lab/sdk';

import { quoteExternal } from '@hey/agent-provider-core';

import { quotedName, TAG_LEGEND } from './render';

/**
 * One Uniswap v4 hook as text (2026-10-11), for `get_v4_hook`. Says no more
 * than `GET /api/v4-hooks/{address}`: a project is named only when the API
 * names it (HEY lists the hook under it), the callbacks are what the address
 * declares — never what the code does or whether it is safe — pools are
 * context, never an order, and every unknown is UNKNOWN with its reason.
 */
export function renderV4Hook(h: HeyV4HookDetail): string {
  const lines: string[] = [`# Uniswap v4 hook ${h.address} (chain ${h.chainId})`, h.page, ''];
  if (h.project && h.tie) {
    lines.push(`Answer: HEY ties this hook to ${quotedName(h.project.name)} (${h.project.slug}) — ${h.tie.basisLabel}: ${h.tie.tie}${h.tie.tieDetail ? ` (${h.tie.tieDetail})` : ''}.`);
    if (h.tie.basis === 'review') lines.push('DERIVED: confirmed by HEY’s review; not proven on chain.');
    if (h.project.activityLabel) lines.push(`DERIVED: the project’s activity status — ${h.project.activityLabel}.`);
    if (h.project.latestShip) lines.push(`FACT: its latest counted ship — ${quoteExternal(h.project.latestShip.title, 'release_title')}, ${h.project.latestShip.publishedAt.slice(0, 10)} (${h.project.latestShip.id}).`);
  } else {
    lines.push(`Answer: ${h.answer}`);
  }
  lines.push(`DERIVED: HEY’s reading of its creation — ${h.creation.words}.`);
  lines.push(`FACT: callbacks its address declares — ${h.permissions.length > 0 ? h.permissions.join(', ') : 'none'}. ${h.capabilities} (What the PoolManager calls, never what the code does or whether it is safe.)`);
  lines.push(`${h.source.verifiedSource.state === 'MEASURED' || h.source.verifiedSource.state === 'NO_SOURCE' ? 'FACT' : 'UNKNOWN'}: published source code — ${h.source.verifiedSource.words}`);
  lines.push(`${h.source.proxy.state === 'MEASURED' ? 'FACT' : 'UNKNOWN'}: proxy — ${h.source.proxy.words}`);
  if (h.hooklist.state === 'LISTED' && h.hooklist.listing) {
    lines.push(`FACT: Uniswap’s hooklist lists it as ${quoteExternal(h.hooklist.listing.name, 'hooklist')} — a third-party listing, context only, never a tie.`);
  } else {
    lines.push(`${h.hooklist.state === 'NOT_READ' ? 'UNKNOWN' : 'FACT'}: ${h.hooklist.words}`);
  }
  const pools = h.pools;
  lines.push(
    pools.onTrackedTokens === 0
      ? 'FACT: pools on tokens HEY tracks using it — none read.'
      : `FACT: pools on tokens HEY tracks using it — ${pools.onTrackedTokens} (all of them counted), init blocks ${pools.firstInitBlock}–${pools.lastInitBlock}. Context, never an order.`,
  );
  const weeks = pools.weekly.weeks.filter((week) => week.pools !== null && week.pools > 0).map((week) => `${week.isoWeek} ${week.pools}${week.complete ? '' : ' (so far)'}`);
  lines.push(`FACT: pools HEY recorded by week (by when HEY recorded them, not block time; last ${pools.weekly.weeks.length} weeks) — ${weeks.length > 0 ? weeks.join(', ') : 'none in these weeks'}.`);
  lines.push(`FACT: first pool HEY read at block ${h.when.firstPoolInitBlock}${h.when.firstPoolInitAt ? ` (${h.when.firstPoolInitAt.slice(0, 10)})` : ''}; newest at block ${h.when.lastPoolInitBlock}.`);
  if (h.relatedShip.deployment) lines.push(`FACT: ${h.relatedShip.deployment.kind === 'hook_deployment' ? 'the follow-up deployment it counts through' : 'the factory’s own deployment'} — ${h.relatedShip.deployment.id}.`);
  for (const unknown of h.unknowns) lines.push(`UNKNOWN: ${unknown.label.toLowerCase()} — ${unknown.words}`);
  lines.push('', `Evidence: ${h.listed ? h.id : `${h.id} (no standing receipt: HEY lists no project for this hook)`} · ${h.explorer}`);
  lines.push('', TAG_LEGEND, h.trademark, h.disclaimer);
  return lines.join('\n');
}
