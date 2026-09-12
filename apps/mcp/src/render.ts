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
export function projectLine(project: HeyProject, now?: Date): string {
  const parts = [project.symbol ? `${project.name} ($${project.symbol})` : project.name];

  // What HEY is actually claiming about activity comes before anything else.
  parts.push(
    project.researchLevel === 'INDEXED'
      ? 'activity not researched yet'
      : project.activityStatus.toLowerCase(),
  );
  if (project.stillBuilding) parts.push('STILL BUILDING');
  if (project.lastShippedAt) parts.push(`last shipped ${ago(project.lastShippedAt, now)}`);
  if (project.primaryNarrative) parts.push(project.primaryNarrative.name);
  if (project.launchedVia) parts.push(`via ${project.launchedVia.name}`);
  // Context, and only ever with the provider that reported it.
  if (project.marketCap) parts.push(`${money(project.marketCap.usd)} mcap (${project.marketCap.source})`);

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

  return `${shown}\nQuery as HEY read it: ${JSON.stringify(page.query)}\n\n${lines.join('\n')}${more}${stillBuilding}\n\n${page.disclaimer}`;
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
