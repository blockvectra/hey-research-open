import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createRaetoPublicActivityAdapter, createRaetoPublicProjectsAdapter, raetoActivityDays } from './raeto-public-activity';

/**
 * Raeto's public agent-activity reads (2026-10-29). The fixtures are the shapes Raeto documents at
 * raeto.cc/developers#public-activity: an empty list (today's answer), a list with entries, one project's activity
 * and a project that is not shared (404). CI never calls the provider (CLAUDE.md rule 16).
 */
const json = { 'content-type': 'application/json' };

describe('Raeto public projects list', () => {
  const adapter = createRaetoPublicProjectsAdapter();

  it('reads the list without a key and answers an empty list as no projects, never an error', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('raeto-public-projects-empty.json'), headers: json });
    const result = await adapter.fetch({}, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.raeto.cc/v1/public/projects');
    expect(new Headers(stub.requests[0]?.init?.headers).get('authorization')).toBeNull();
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual({ projects: [], updatedAt: new Date('2026-10-29T08:00:00Z') });
  });

  it('keeps each shared project’s id, name, website, X and 7-day model calls, and refuses an id that is not Raeto’s shape', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('raeto-public-projects.json'), headers: json });
    const result = await adapter.fetch({}, testContext({ fetchImpl: stub.fetchImpl }));
    const projects = result.data?.projects ?? [];
    expect(projects.map((project) => project.id)).toEqual(['p_8f3k2m', 'p_q7w1zz', 'p_nosite']);
    expect(projects[0]).toEqual({
      id: 'p_8f3k2m',
      name: 'Orbit Agents',
      websiteUrl: 'https://orbitagents.xyz/',
      xUrl: 'https://x.com/OrbitAgents',
      calls7d: 1284,
      raetoUrl: 'https://raeto.cc/p/p_8f3k2m',
    });
    // A bare host gets its scheme; an @handle becomes the account URL; a measured 0 stays 0.
    expect(projects[1]).toMatchObject({ websiteUrl: 'https://lumen-labs.io/', xUrl: 'https://x.com/LumenLabs', calls7d: 0 });
    // No website and no calls figure are absent, never empty or 0; a page off Raeto's host is never linked.
    expect(projects[2]).toEqual({ id: 'p_nosite', name: 'No Site', xUrl: 'https://x.com/nositeagent' });
  });

  it('refuses a body that is not Raeto’s list', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ object: 'project_activity', days: [] }), headers: json });
    const result = await adapter.fetch({}, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});

describe('Raeto one project’s activity', () => {
  const adapter = createRaetoPublicActivityAdapter();

  it('reads one shared project’s model calls by UTC day', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('raeto-public-project-activity.json'), headers: json });
    const result = await adapter.fetch({ id: 'p_8f3k2m' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.raeto.cc/v1/public/projects/p_8f3k2m');
    expect(result.status).toBe('fresh');
    expect(result.data?.calls7d).toBe(1284);
    expect(result.data?.days).toHaveLength(7);
    expect(result.data?.days[1]).toEqual({ day: '2026-10-24', calls: 0 });
  });

  it('answers a project that is not shared as missing (404), never as zero calls', async () => {
    const stub = stubFetch({ status: 404, body: readFixture('raeto-public-project-not-shared.json'), headers: json });
    const result = await adapter.fetch({ id: 'p_gone00' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('missing');
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.data).toBeUndefined();
  });

  it('never asks for an id that is not Raeto’s shape', () => {
    expect(adapter.canHandle({ id: 'p_8f3k2m' })).toBe(true);
    expect(adapter.canHandle({ id: '../wallets/0xabc/spend' })).toBe(false);
    expect(adapter.canHandle({ id: '' })).toBe(false);
  });

  it('drops the wallet count and any spend field: nothing about a wallet or a spend leaves the adapter (product rule 1)', async () => {
    const body = JSON.parse(readFixture('raeto-public-project-activity.json')) as Record<string, unknown>;
    body.spend_usd = 12.5;
    body.wallets = ['0x1111111111111111111111111111111111111111'];
    body.days = [...(body.days as object[]), { day: '2026-10-30', calls: 4, spend: 0.2, wallet: '0x2222222222222222222222222222222222222222' }];
    const stub = stubFetch({ status: 200, body: JSON.stringify(body), headers: json });
    const result = await adapter.fetch({ id: 'p_8f3k2m' }, testContext({ fetchImpl: stub.fetchImpl }));
    const text = JSON.stringify(result.data);
    expect(text).not.toMatch(/wallet|spend|balance|0x[0-9a-f]{40}/i);
    expect(Object.keys(result.data ?? {}).sort()).toEqual(['calls7d', 'days', 'id', 'name']);
    for (const day of result.data?.days ?? []) expect(Object.keys(day).sort()).toEqual(['calls', 'day']);
  });
});

describe('raetoActivityDays', () => {
  it('keeps real dates with whole, non-negative counts, once a day, oldest first; a bad entry is left out, never 0', () => {
    expect(
      raetoActivityDays([
        { day: '2026-10-28', calls: 5 },
        { day: '2026-10-27', calls: 3 },
        { day: '2026-10-28', calls: 99 },
        { day: '2026-02-30', calls: 1 },
        { day: '2026-10-26', calls: -1 },
        { day: '2026-10-25', calls: 1.5 },
        { day: '2026-10-24', calls: null },
        { day: 20261023, calls: 2 },
      ]),
    ).toEqual([
      { day: '2026-10-27', calls: 3 },
      { day: '2026-10-28', calls: 5 },
    ]);
    expect(raetoActivityDays(undefined)).toEqual([]);
  });
});
