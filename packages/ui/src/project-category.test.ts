import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProjectCard } from './project-card';
import { projectCategory } from './project-category';

/**
 * One category rule for the card, the public comparison and `/api/compare`
 * (OA-G, 2026-10-02). The outsider analyst read Chit as "Infrastructure" on
 * the homepage and "Other" on the comparison: its primary narrative is the
 * catch-all, which the card drops and the comparison printed raw.
 */
describe('projectCategory', () => {
  it('drops the catch-all narrative and names the kind (the Chit case)', () => {
    const category = projectCategory({ primaryNarrative: { slug: 'other', name: 'Other' }, projectKind: 'INFRASTRUCTURE' });
    expect(category).toEqual({ kindLabel: 'Infrastructure', categorised: true, label: 'Infrastructure' });
    expect(category.label).not.toContain('Other');
  });

  it('names a real narrative, then a kind it does not already name', () => {
    expect(projectCategory({ primaryNarrative: { slug: 'ai-agents', name: 'AI Agents' }, projectKind: 'UTILITY' }).label).toBe('AI Agents · Utility');
    expect(projectCategory({ primaryNarrative: { slug: 'infrastructure', name: 'Infrastructure' }, projectKind: 'INFRASTRUCTURE' }).label).toBe('Infrastructure');
  });

  it('never prints "Uncategorised" beside a category, and says it only when nothing else names the project', () => {
    expect(projectCategory({ primaryNarrative: { slug: 'defi', name: 'DeFi' }, projectKind: 'OTHER' })).toEqual({ narrative: { slug: 'defi', name: 'DeFi' }, categorised: true, label: 'DeFi' });
    expect(projectCategory({ primaryNarrative: { slug: 'other', name: 'Other' }, projectKind: 'OTHER' })).toEqual({ categorised: false, label: 'Uncategorised' });
    expect(projectCategory({ projectKind: 'OTHER' }).label).toBe('Uncategorised');
    expect(projectCategory({ primaryNarrative: null, projectKind: 'MEME' }).label).toBe('Meme');
  });
});

describe('the card prints the same category', () => {
  const words = (html: string) =>
    [...html.matchAll(/data-testid="(?:card-narrative|project-kind)"[^>]*>([^<]*)</g)].map((match) => match[1]).join(' · ');
  const cases: { primaryNarrative?: { slug: string; name: string }; projectKind: string }[] = [
    { primaryNarrative: { slug: 'other', name: 'Other' }, projectKind: 'INFRASTRUCTURE' },
    { primaryNarrative: { slug: 'ai-agents', name: 'AI Agents' }, projectKind: 'UTILITY' },
    { primaryNarrative: { slug: 'infrastructure', name: 'Infrastructure' }, projectKind: 'INFRASTRUCTURE' },
    { primaryNarrative: { slug: 'defi', name: 'DeFi' }, projectKind: 'OTHER' },
    { projectKind: 'MEME' },
  ];
  it.each(cases)('%o', (shape) => {
    const html = renderToStaticMarkup(createElement(ProjectCard, { project: { slug: 'chit', name: 'Chit', symbol: 'CHIT', activityStatus: 'SHIPPING', ...shape } }));
    expect(words(html)).toBe(projectCategory(shape).label);
  });
});
