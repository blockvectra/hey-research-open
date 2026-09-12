import type { HeyBountyPage, HeyChain, HeyTokenMarket } from './client';
import type { HeyPage, HeyProject, HeyProjectDetail, HeyShip } from './client';

/**
 * HEY's answers, as text a model reads (2026-09-05).
 *
 * An agent will quote whatever comes back, so the rendering carries the same
 * discipline the pages do. Three rules decide everything here:
 *
 *  1. **Say what the claim is.** "Still Building" is a specific, narrow claim —
 *     verified activity through a market drawdown HEY tracked — and an agent
 *     that reads it as "this will go up" has been misled by the rendering, not
 *     by the reader. So the phrase never appears without its meaning.
 *  2. **Never invent a figure.** A project with no market reading gets no
 *     market line at all; a project HEY has not researched says so. Nothing is
 *     rendered as zero, "n/a" or "—" that an agent might average or compare.
 *  3. **Carry the source.** Every ship shows how it is backed and where it came
 *     from, so an agent can cite rather than assert.
 *
 * Pure functions over the API's own shapes: unit-tested without a network.
 */
export const STILL_BUILDING_MEANING =
  'Still Building = verified activity continuing through a market drawdown HEY tracked. It is a record of what happened, not a prediction and not a buy signal.';

const money = (usd: number): string => {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
};

/** "3 days ago" against a stated now, so an agent is not left doing date arithmetic. */
export function ago(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

/** One project on one line: identity, what HEY claims, and the context behind it. */
const STAGE_WORDS: Record<'CURVE' | 'GRADUATED' | 'DEX', string> = {
  CURVE: 'on its launch curve',
  GRADUATED: 'graduated from its curve',
  DEX: 'trading in a DEX pool',
};

export function projectLine(project: HeyProject, now?: Date): string {
  const parts = [project.symbol ? `${project.name} ($${project.symbol})` : project.name];

  // What HEY is actually claiming about activity comes before anything else.
  parts.push(
    project.activityStatus === 'UNKNOWN' && project.hasBuilderSource === false
      ? 'no builder signal yet (no repository, changelog or feed to read; trading is not building)'
      : project.researchLevel === 'INDEXED'
        ? 'activity not researched yet'
        : project.activityStatus.toLowerCase(),
  );
  if (project.stillBuilding) parts.push('STILL BUILDING');
  if (project.lastShippedAt) parts.push(`last shipped ${ago(project.lastShippedAt, now)}`);
  if (project.primaryNarrative) parts.push(project.primaryNarrative.name);
  if (project.launchedVia) parts.push(`via ${project.launchedVia.name}`);
  // Context, and only ever with the provider that reported it.
  if (project.marketCap) parts.push(`${money(project.marketCap.usd)} mcap (${project.marketCap.source})`);
  if (project.liquidity) parts.push(`${money(project.liquidity.usd)} liquidity (${project.liquidity.source})`);
  if (project.volume24h) parts.push(`${money(project.volume24h.usd)} 24h volume (${project.volume24h.source})`);
  if (project.launchStage) parts.push(STAGE_WORDS[project.launchStage]);
  if (project.trades24h) parts.push(`${project.trades24h.buys} buys / ${project.trades24h.sells} sells in 24h (${project.trades24h.source})`);
  if (project.priceChange24hPct !== undefined) parts.push(`${project.priceChange24hPct >= 0 ? '+' : ''}${project.priceChange24hPct.toFixed(1)}% 24h`);
  if (project.venue) parts.push(`trades on ${project.venue}`);

  return `- ${parts.join(' · ')}\n  ${project.url}`;
}

/** A page of projects, with the count, how it was filtered, and how to get more. */
export function renderProjects(page: HeyPage<HeyProject>, now?: Date): string {
  if (page.items.length === 0) {
    return `No published project matches that. HEY holds ${page.total} matching records.\n\nA filter HEY does not recognise is ignored rather than refused, so check the query it read: ${JSON.stringify(page.query)}`;
  }

  const lines = page.items.map((project) => projectLine(project, now));
  const shown = `Showing ${page.items.length} of ${page.total} published projects.`;
  const more =
    page.nextOffset === undefined
      ? ''
      : `\nMore: call again with offset=${page.nextOffset}.`;
  const stillBuilding = page.items.some((project) => project.stillBuilding)
    ? `\n\n${STILL_BUILDING_MEANING}`
    : '';
  // A market order over rows that mostly lack the figure must say so (Market Lens, 2026-09-12).
  const coverage = page.catalogue?.marketCoverage;
  const sort = page.query.sort;
  const denominator = coverage
    ? sort === 'liquidity'
      ? `\n${coverage.liquidity} of ${coverage.base} matching projects have a liquidity reading; the rest follow in activity order, not by liquidity.`
      : sort === 'volume24h'
        ? `\n${coverage.volume24h} of ${coverage.base} matching projects have a 24h volume reading; the rest follow in activity order.`
        : sort === 'marketCap'
          ? `\n${coverage.marketCap} of ${coverage.base} matching projects have a market-cap reading; the rest follow in activity order.`
          : `\nOf ${coverage.base} matching projects: ${coverage.activeMarket} traded in the last day, ${coverage.liveMarket} whose market is not gone, ${coverage.verifiedToken} with a verified token, ${coverage.marketCap} with a market-cap reading.`
    : '';

  return `${shown}${denominator}\nQuery as HEY read it: ${JSON.stringify(page.query)}\n\n${lines.join('\n')}${more}${stillBuilding}\n\n${page.disclaimer}`;
}

/** One project in full — the dossier, with every source HEY registered. */
export function renderProject(project: HeyProjectDetail, now?: Date): string {
  const lines: string[] = [];
  lines.push(project.symbol ? `${project.name} ($${project.symbol})` : project.name);
  lines.push(project.url);
  if (project.shortDescription) lines.push('', project.shortDescription);
  if (project.longDescription && project.longDescription !== project.shortDescription) {
    lines.push('', project.longDescription);
  }

  lines.push('', 'What HEY knows:');
  lines.push(
    project.researchLevel === 'INDEXED'
      ? '- Activity: not researched yet — HEY indexed this record but has not verified activity.'
      : `- Activity: ${project.activityStatus.toLowerCase()}${project.lastShippedAt ? `, last shipped ${ago(project.lastShippedAt, now)}` : ''}`,
  );
  if (project.stillBuilding) lines.push(`- ${STILL_BUILDING_MEANING}`);
  lines.push(`- Kind: ${project.projectKind.toLowerCase()}`);
  if (project.narratives.length > 0) {
    lines.push(`- Narratives: ${project.narratives.map((n) => n.name).join(', ')}`);
  }
  if (project.token) {
    const verification = project.tokenVerification?.status;
    const stance =
      verification === 'MISMATCH'
        ? ' — MISMATCH: the project’s own site names a different contract; do not treat this as the project’s token'
        : verification === 'VERIFIED'
          ? ' — verified: the project stands behind this contract'
          : verification === 'UNVERIFIED'
            ? ' — unverified: HEY has not seen the project name this contract'
            : '';
    lines.push(`- Token: chain ${project.token.chainId}, contract ${project.token.contractAddress}${stance}`);
  } else {
    lines.push('- Token: none recorded — this is a project page, not a token.');
  }
  if (project.launchedVia) {
    lines.push(`- Launched via: ${project.launchedVia.name}${project.launchedVia.url ? ` (${project.launchedVia.url})` : ''}`);
  }
  if (project.officialX) lines.push(`- Official X: @${project.officialX.handle}`);
  if (project.websiteUrl) lines.push(`- Website: ${project.websiteUrl}`);
  lines.push(`- Ownership: ${project.isClaimed ? 'claimed by a verified builder' : project.submitted ? 'self-reported at submission, not yet claimed' : 'not claimed'}`);
  lines.push(`- First seen by HEY: ${project.firstSeenAt.slice(0, 10)}`);

  if (project.market) {
    const m = project.market;
    const figures = [
      m.marketCapUsd === undefined ? undefined : `market cap ${money(m.marketCapUsd)}`,
      m.fdvUsd === undefined ? undefined : `FDV ${money(m.fdvUsd)}`,
      m.liquidityUsd === undefined ? undefined : `liquidity ${money(m.liquidityUsd)}`,
      m.volume24hUsd === undefined ? undefined : `24h volume ${money(m.volume24hUsd)}`,
      m.buys24h === undefined || m.sells24h === undefined ? undefined : `${m.buys24h} buys / ${m.sells24h} sells in 24h`,
      m.priceChange24hPct === undefined ? undefined : `${m.priceChange24hPct >= 0 ? '+' : ''}${m.priceChange24hPct.toFixed(1)}% in 24h`,
      m.venue === undefined ? undefined : `pool on ${m.venue}`,
    ].filter((value): value is string => value !== undefined);
    if (figures.length > 0) {
      lines.push('', `Market context (${m.source}, ${m.observedAt.slice(0, 10)}): ${figures.join(', ')}`);
      lines.push('This is context, not a ranking input. HEY never orders projects by price.');
    }
  }

  if (project.score) {
    const s = project.score;
    const figures = [
      s.buildMomentum === undefined ? undefined : `build momentum ${s.buildMomentum}`,
      s.discoveryGap === undefined ? undefined : `discovery gap ${s.discoveryGap}`,
    ].filter((value): value is string => value !== undefined);
    if (figures.length > 0) {
      lines.push('', `HEY's own measures (${s.scoringVersion}, ${s.calculatedAt.slice(0, 10)}): ${figures.join(', ')}`);
    }
  } else {
    lines.push('', 'HEY has not run its activity measures on this project, so it reports none. That is different from measuring and finding nothing.');
  }

  if (project.onchainActivity) {
    const a = project.onchainActivity;
    lines.push('', `On-chain usage (read from the chain ${a.observedAt.slice(0, 10)}): ${a.events24h}${a.truncated ? '+' : ''} events in 24 h${a.daysCovered > 1 ? `, ${a.events7d}${a.truncated ? '+' : ''} over ${a.daysCovered} days` : ''}. Context only: usage says the contract is used, not that anyone is building.`);
  }

  if (project.defiTvl) {
    lines.push('', `Value locked on Robinhood Chain (DefiLlama, ${project.defiTvl.observedAt.slice(0, 10)}): $${Math.round(project.defiTvl.tvlUsd).toLocaleString('en-US')} in ${project.defiTvl.protocolName}, matched by ${project.defiTvl.matchedBy}. Context only: money in the contracts says the product is used, not that anyone is building.`);
  }

  if (project.sources.length > 0) {
    lines.push('', 'Sources HEY registered:');
    for (const source of project.sources) {
      const state = source.contextOnly
        ? `context only${source.contextReason === 'owner_disowned' ? ', the owner says it is not theirs' : ''} — not this project’s own evidence`
        : source.isVerified
          ? 'verified'
          : source.confidence.toLowerCase();
      lines.push(`- ${source.sourceType}: ${source.url} (${state})`);
    }
  }

  lines.push('', project.disclaimer);
  return lines.join('\n');
}

/** One ship: what it was, when, how it is backed, and where it came from. */
export function shipLine(ship: HeyShip, now?: Date): string {
  const who = ship.project.symbol ? `${ship.project.name} ($${ship.project.symbol})` : ship.project.name;
  const backing = ship.verification.toLowerCase().replace(/_/g, ' ');
  const lines = [`- ${who} — ${ship.title}`, `  ${ship.eventType.toLowerCase().replace(/_/g, ' ')} · ${ago(ship.publishedAt, now)} · ${backing}`];
  if (ship.summary) lines.push(`  ${ship.summary}`);
  // The source is the point: an agent should cite it rather than assert.
  lines.push(ship.sourceUrl ? `  source: ${ship.sourceUrl}` : `  no public source recorded — ${ship.url}`);
  return lines.join('\n');
}

export function renderShips(page: HeyPage<HeyShip>, now?: Date): string {
  if (page.items.length === 0) {
    return `Nothing shipped that matches. Query as HEY read it: ${JSON.stringify(page.query)}`;
  }
  const more = page.nextOffset === undefined ? '' : `\nMore: call again with offset=${page.nextOffset}.`;
  return [
    `Showing ${page.items.length} of ${page.total} ships.`,
    `Query as HEY read it: ${JSON.stringify(page.query)}`,
    '',
    page.items.map((ship) => shipLine(ship, now)).join('\n'),
    more,
    '',
    page.disclaimer,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Open and awarded bounties, with the rules an assistant must repeat: reading is open, claiming is not an API. */
export function renderBounties(page: HeyBountyPage, now?: Date): string {
  if (!page.open) return `Research bounties are closed right now on HEY. Nothing can be claimed.\n\n${page.disclaimer}`;
  if (page.items.length === 0) return `No open or recently awarded bounties. Rules: ${page.rules.claim}\n\n${page.disclaimer}`;
  const lines = page.items.map((bounty) => {
    const parts = [`${bounty.title} [${bounty.status}]`];
    if (bounty.project) parts.push(`project ${bounty.project.name}`);
    parts.push(`reward ${bounty.reward.hey} HEY${bounty.reward.targetUsd ? ` (≈ $${bounty.reward.targetUsd} at quote)` : ''}`);
    if (bounty.status === 'OPEN') {
      if (bounty.claim.claimed) parts.push(`already claimed${bounty.claim.claimedBy ? ` by ${bounty.claim.claimedBy}` : ''}${bounty.claim.expiresAt ? `, claim expires ${ago(bounty.claim.expiresAt, now)}` : ''}`);
      else if (bounty.claim.openToAll) parts.push('unclaimed, open to any wallet sign-in');
      else parts.push(`unclaimed, holders only until ${bounty.claim.holdersOnlyUntil ?? 'later'}`);
    }
    if (bounty.awardedAt) parts.push(`awarded ${ago(bounty.awardedAt, now)}`);
    return `- ${parts.join(' · ')}\n  ${bounty.url}`;
  });
  const summary = page.summary ? `${page.summary.openBounties} open bounties, ${page.summary.committedHey} HEY committed, ${page.summary.paidHey} HEY paid so far.` : '';
  return `${summary}\n\n${lines.join('\n')}\n\nHow claiming works: ${page.rules.claim} ${page.rules.review}\n\n${page.disclaimer}`;
}


const signed = (value: number | undefined) => (value === undefined ? undefined : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`);

/** One token's market in depth, as prose an agent can quote with its sources. */
export function renderTokenMarket(market: HeyTokenMarket, now: Date): string {
  const lines: string[] = [`# ${market.name}${market.symbol ? ` ($${market.symbol})` : ''} — market, from HEY's own daily index`, `Contract ${market.token.contractAddress} on chain ${market.token.chainId}. Market status: ${market.marketStatus.toLowerCase().replace(/_/g, ' ')}; verification: ${market.verification.toLowerCase()}.`, ''];
  if (market.current) {
    const c = market.current;
    const parts = [
      c.priceUsd === undefined ? undefined : `price $${c.priceUsd >= 1 ? c.priceUsd.toFixed(2) : c.priceUsd.toPrecision(3)}`,
      c.marketCapUsd === undefined ? undefined : `market cap ${money(c.marketCapUsd)}`,
      c.liquidityUsd === undefined ? undefined : `liquidity ${money(c.liquidityUsd)}`,
      c.volume24hUsd === undefined ? undefined : `24h volume ${money(c.volume24hUsd)}`,
      c.buys24h === undefined || c.sells24h === undefined ? undefined : `${c.buys24h} buys / ${c.sells24h} sells in 24h`,
      signed(c.priceChange24hPct) === undefined ? undefined : `${signed(c.priceChange24hPct)} in 24h`,
      c.venue ? `pool on ${c.venue}` : undefined,
    ].filter((v): v is string => v !== undefined);
    lines.push(`Now (${c.source}, ${ago(c.observedAt, now)}): ${parts.join(', ')}.`);
  } else {
    lines.push('No market reading in the last week.');
  }
  const l = market.lifecycle;
  const life = [
    l.launchSeenAt ? `launch recorded ${l.launchSeenAt.slice(0, 10)}` : undefined,
    l.pairCreatedAt ? `pool created ${l.pairCreatedAt.slice(0, 10)}` : undefined,
    l.launchStage ? `stage ${l.launchStage.toLowerCase()}${l.launchStageAt ? ` since ${l.launchStageAt.slice(0, 10)}` : ''}` : undefined,
    l.firstTradeDay ? `first indexed trade ${l.firstTradeDay}` : undefined,
    l.lastTradeDay ? `last indexed trade ${l.lastTradeDay}` : undefined,
    l.peakLiquidityUsd === undefined ? undefined : `highest liquidity HEY saw ${money(l.peakLiquidityUsd)}${l.liquidityBelowPeakPct === undefined ? '' : ` (now ${Math.round(100 - l.liquidityBelowPeakPct)}% of it)`}`,
    signed(l.priceChange7dPct) === undefined ? undefined : `${signed(l.priceChange7dPct)} over 7 days`,
    signed(l.priceChange30dPct) === undefined ? undefined : `${signed(l.priceChange30dPct)} over 30 days`,
  ].filter((v): v is string => v !== undefined);
  if (life.length > 0) lines.push(`Lifecycle: ${life.join('; ')}.`);
  lines.push('', `Days indexed: ${market.days.length}. Latest first:`);
  for (const d of [...market.days].reverse().slice(0, 14)) {
    const parts = [
      d.priceCloseUsd === undefined ? undefined : `close $${d.priceCloseUsd >= 1 ? d.priceCloseUsd.toFixed(2) : d.priceCloseUsd.toPrecision(3)}`,
      d.liquidityCloseUsd === undefined ? undefined : `liquidity ${money(d.liquidityCloseUsd)}`,
      d.trades === undefined ? undefined : `${d.trades} trades (${d.buys ?? 0} buys / ${d.sells ?? 0} sells)`,
      d.buyVolumeUsd === undefined && d.sellVolumeUsd === undefined ? (d.volume24hUsd === undefined ? undefined : `24h volume ${money(d.volume24hUsd)}`) : `traded ${money((d.buyVolumeUsd ?? 0) + (d.sellVolumeUsd ?? 0))}`,
      d.transfers === undefined ? undefined : `${d.transfers} transfers`,
    ].filter((v): v is string => v !== undefined);
    lines.push(`- ${d.day}: ${parts.length > 0 ? parts.join(', ') : 'no figures'}${d.source ? ` (${d.source})` : ''}`);
  }
  if (market.checks.length > 0) {
    lines.push('', 'What HEY checked on the contract (facts, never verdicts):');
    for (const check of market.checks) lines.push(`- ${check.label}: ${check.finding}${check.tone === 'noted' ? ' [noted]' : ''}${check.provenance ? ` — ${check.provenance}` : ''}`);
  }
  if (market.onchainDays.length > 0) lines.push('', `Contract events by day: ${market.onchainDays.map((d) => `${d.day} ${d.events}${d.truncated ? '+' : ''}`).join(', ')}.`);
  if (market.tvlDays.length > 0) lines.push(`Value locked (DefiLlama, ${market.tvlDays[0]!.protocolName}): latest ${money(market.tvlDays[market.tvlDays.length - 1]!.tvlUsd)}.`);
  lines.push('', 'Counts of trades, transfers and events, never of accounts. Context only: nothing here reaches activity status or any HEY score, and none of it is a buy signal.', market.url);
  return lines.join('\n');
}

/** Robinhood Chain day by day, as prose. */
export function renderChain(chain: HeyChain): string {
  const lines: string[] = [`# Robinhood Chain (chain ${chain.chainId}), day by day`, chain.lastFullDay ? `Last full day: ${chain.lastFullDay}.${chain.today ? ` ${chain.today} is still being indexed.` : ''}` : 'No full day indexed yet.', ''];
  for (const d of [...chain.days].reverse()) {
    const parts = [
      d.dexTrades === undefined ? undefined : `${d.dexTrades.toLocaleString('en-US')} DEX trades`,
      d.dexVolumeUsd === undefined ? undefined : `${money(d.dexVolumeUsd)} volume`,
      d.tokensTraded === undefined ? undefined : `${d.tokensTraded.toLocaleString('en-US')} tokens traded`,
      d.poolsTraded === undefined ? undefined : `${d.poolsTraded.toLocaleString('en-US')} pools`,
      d.transactions === undefined ? undefined : `${d.transactions.toLocaleString('en-US')} transactions`,
      d.launches === undefined ? undefined : `${d.launches.toLocaleString('en-US')} launches recorded by HEY`,
      d.projectsPublished === undefined ? undefined : `${d.projectsPublished} projects published`,
      d.ships === undefined ? undefined : `${d.ships} verified ships${d.buildersShipping === undefined ? '' : ` from ${d.buildersShipping} builders`}`,
    ].filter((v): v is string => v !== undefined);
    lines.push(`- ${d.day}: ${parts.join(', ')}`);
  }
  lines.push('', chain.volumeNote, 'Aggregates only; nobody is named. Context, never a ranking input.');
  return lines.join('\n');
}
