import { quoteExternal } from '@hey/agent-provider-core';
import type { HeySearchSuggestions } from '@hey-research-lab/sdk';

/**
 * The research profile's project lookup (round 4, 2026-09-30): identity only
 * — name, ticker, contract and slug — from `/api/search/suggest`, the one
 * matcher the site's search uses. No market figure and no surface ranked by
 * market attention: the research profile finds a project, and research_answer
 * researches it.
 */
export function renderIdentitySearch(page: HeySearchSuggestions, baseUrl: string): string {
  const rows = page.suggestions.map((row) => {
    const name = `${quoteExternal(row.name, 'project_record')}${row.symbol ? ` (${quoteExternal(row.symbol, 'token_metadata', 40)})` : ''}`;
    const contract = row.contract ? ` · contract ${row.contract}` : '';
    // An issuer's own token (2026-10-02): never a project, never a launch record.
    if (row.type === 'issuer') return `- ${name}${contract} · ${quoteExternal(row.label, 'token_metadata', 80)}, not a project on HEY — ${baseUrl}${row.target}`;
    if (row.type === 'launch') return `- ${name}${contract} · a launch record, not a published project (via ${quoteExternal(row.launchedVia, 'launchpad', 80)}) — ${baseUrl}${row.target}`;
    const slug = /^\/project\/([a-z0-9][a-z0-9-]{0,119})$/.exec(row.target)?.[1];
    return `- ${name}${contract}${slug ? ` · slug ${slug}` : ''} — ${baseUrl}${row.target}`;
  });
  return [
    `# Projects matching ${quoteExternal(page.q, 'caller', 64)} — identity only`,
    '',
    ...(rows.length > 0 ? rows : ['No published project or launch record matches. That is an answer about HEY\'s record, not about the chain.']),
    '',
    `Showing ${rows.length} (the matcher returns at most eight). For one project's research call research_answer with capability research_project and its slug; for a contract, pass the 0x address as query.`,
  ].join('\n');
}
