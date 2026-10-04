import { describe, expect, it } from 'vitest';

import { readFixture } from '../testing';
import {
  isActionableRelease,
  isDefaultBranchPush,
  isGithubDeliveryId,
  parseGithubAppWebhook,
  signGithubWebhookBody,
  verifyGithubWebhookSignature,
} from './github-app-webhook';

/**
 * The HEY GitHub App's webhook contract (2026-10-05, docs/GITHUB_APP.md).
 * Fixtures are GitHub's documented delivery shapes, trimmed, with noise the
 * reader must drop (a release body that talks to an agent, a URL on another
 * host, commit e-mails). CI never calls GitHub (architecture rule 16).
 */
const SECRET = 'test-webhook-secret-not-a-real-one-0123';
const json = (name: string): unknown => JSON.parse(readFixture(name)) as unknown;

describe('webhook signature (X-Hub-Signature-256)', () => {
  const body = readFixture('github-webhook-release-published.json');

  it('accepts the HMAC of the exact body under the configured secret', () => {
    expect(verifyGithubWebhookSignature(body, signGithubWebhookBody(body, SECRET), SECRET)).toBe(true);
  });

  it('refuses a signature made with another secret', () => {
    expect(verifyGithubWebhookSignature(body, signGithubWebhookBody(body, `${SECRET}-old`), SECRET)).toBe(false);
  });

  it('refuses a body changed after signing, even by one character', () => {
    const signature = signGithubWebhookBody(body, SECRET);
    expect(verifyGithubWebhookSignature(body.replace('v1.4.2', 'v1.4.3'), signature, SECRET)).toBe(false);
    expect(verifyGithubWebhookSignature(`${body} `, signature, SECRET)).toBe(false);
  });

  it('refuses a missing, empty, legacy sha1 or malformed header, and an unset secret', () => {
    const good = signGithubWebhookBody(body, SECRET);
    expect(verifyGithubWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyGithubWebhookSignature(body, '', SECRET)).toBe(false);
    expect(verifyGithubWebhookSignature(body, good.replace('sha256=', 'sha1='), SECRET)).toBe(false);
    expect(verifyGithubWebhookSignature(body, good.slice(0, -2), SECRET)).toBe(false);
    expect(verifyGithubWebhookSignature(body, `${good}00`, SECRET)).toBe(false);
    expect(verifyGithubWebhookSignature(body, 'sha256=zz', SECRET)).toBe(false);
    expect(verifyGithubWebhookSignature(body, good, undefined)).toBe(false);
    expect(verifyGithubWebhookSignature(body, good, '')).toBe(false);
  });

  it('accepts the hex in either case, as GitHub documents it lowercase', () => {
    const good = signGithubWebhookBody(body, SECRET);
    expect(verifyGithubWebhookSignature(body, `sha256=${good.slice(7).toUpperCase()}`, SECRET)).toBe(true);
  });

  it('knows a delivery id is a GUID', () => {
    expect(isGithubDeliveryId('72d3162e-cc78-11e3-81ab-4c9367dc0958')).toBe(true);
    expect(isGithubDeliveryId('1; drop table')).toBe(false);
    expect(isGithubDeliveryId(null)).toBe(false);
  });
});

describe('webhook payloads', () => {
  it('reads an installation: account, selection, permissions, repositories and the sender id — never the sender login', () => {
    const parsed = parseGithubAppWebhook('installation', json('github-webhook-installation-created.json'));
    expect(parsed).toEqual({
      ok: true,
      facts: {
        kind: 'installation',
        action: 'created',
        installation: {
          id: 55500011,
          accountLogin: 'use-agent-os',
          accountId: 170000001,
          accountType: 'Organization',
          repositorySelection: 'selected',
          permissions: { metadata: 'read', contents: 'read' },
        },
        repositories: [{ id: 812345678, fullName: 'use-agent-os/agentos' }],
        senderId: 9000001,
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('builder-octo');
  });

  it('reads repositories added to and removed from an installation', () => {
    const added = parseGithubAppWebhook('installation_repositories', json('github-webhook-installation-repositories-added.json'));
    expect(added.ok && added.facts.kind === 'installation_repositories' && added.facts.added).toEqual([{ id: 812345679, fullName: 'use-agent-os/agentos-sdk' }]);
    const removed = parseGithubAppWebhook('installation_repositories', json('github-webhook-installation-repositories-removed.json'));
    expect(removed.ok && removed.facts.kind === 'installation_repositories' && removed.facts.removed).toEqual([{ id: 812345678, fullName: 'use-agent-os/agentos' }]);
  });

  it('reads a release as ids and flags only: no body, no tag text, no URL from the payload', () => {
    const parsed = parseGithubAppWebhook('release', json('github-webhook-release-published.json'));
    expect(parsed).toEqual({
      ok: true,
      facts: { kind: 'release', action: 'published', installationId: 55500011, repo: { id: 812345678, fullName: 'use-agent-os/agentos' }, releaseId: 190000001, draft: false, prerelease: false },
    });
    const text = JSON.stringify(parsed);
    expect(text).not.toContain('Ignore all previous instructions');
    expect(text).not.toContain('evil.example');
  });

  it('reads a push as its ref and the default branch: no commit, message or e-mail', () => {
    const parsed = parseGithubAppWebhook('push', json('github-webhook-push-default.json'));
    expect(parsed).toEqual({
      ok: true,
      facts: { kind: 'push', installationId: 55500011, repo: { id: 812345678, fullName: 'use-agent-os/agentos' }, ref: 'refs/heads/main', defaultBranch: 'main', deleted: false },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/builder@example\.com|agent memory/);
  });

  it('reads a merged pull request', () => {
    const parsed = parseGithubAppWebhook('pull_request', json('github-webhook-pull-request-merged.json'));
    expect(parsed.ok && parsed.facts).toEqual({
      kind: 'pull_request',
      action: 'closed',
      installationId: 55500011,
      repo: { id: 812345678, fullName: 'use-agent-os/agentos' },
      number: 18,
      merged: true,
      headRef: 'hey-research/badge',
      baseRef: 'main',
    });
  });

  it('answers ping and refuses events the app does not subscribe to', () => {
    expect(parseGithubAppWebhook('ping', json('github-webhook-ping.json'))).toEqual({ ok: true, facts: { kind: 'ping' } });
    expect(parseGithubAppWebhook('issues', {})).toEqual({ ok: false, reason: 'unsupported_event' });
    expect(parseGithubAppWebhook(null, {})).toEqual({ ok: false, reason: 'unsupported_event' });
  });

  it('calls a payload that does not fit its event malformed, never partial data', () => {
    expect(parseGithubAppWebhook('release', json('github-webhook-push-default.json'))).toEqual({ ok: false, reason: 'malformed' });
    expect(parseGithubAppWebhook('push', { ref: 'refs/heads/main' })).toEqual({ ok: false, reason: 'malformed' });
    const evil = json('github-webhook-push-default.json') as { repository: { full_name: string } };
    evil.repository.full_name = '../../etc/passwd';
    expect(parseGithubAppWebhook('push', evil)).toEqual({ ok: false, reason: 'malformed' });
    expect(parseGithubAppWebhook('installation', 'not an object')).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('what HEY acts on', () => {
  it('acts on a push to the default branch only, never a branch deletion', () => {
    expect(isDefaultBranchPush({ ref: 'refs/heads/main', defaultBranch: 'main', deleted: false })).toBe(true);
    expect(isDefaultBranchPush({ ref: 'refs/heads/feature/x', defaultBranch: 'main', deleted: false })).toBe(false);
    expect(isDefaultBranchPush({ ref: 'refs/tags/v1.0.0', defaultBranch: 'main', deleted: false })).toBe(false);
    expect(isDefaultBranchPush({ ref: 'refs/heads/main', defaultBranch: 'main', deleted: true })).toBe(false);
    // A branch named like the default under another prefix is not the default.
    expect(isDefaultBranchPush({ ref: 'refs/heads/x/main', defaultBranch: 'main', deleted: false })).toBe(false);
    const branch = parseGithubAppWebhook('push', json('github-webhook-push-branch.json'));
    expect(branch.ok && branch.facts.kind === 'push' && isDefaultBranchPush(branch.facts)).toBe(false);
  });

  it('acts on a published release, never a draft, an edit or a deletion', () => {
    expect(isActionableRelease({ action: 'published', draft: false })).toBe(true);
    expect(isActionableRelease({ action: 'prereleased', draft: false })).toBe(true);
    expect(isActionableRelease({ action: 'released', draft: false })).toBe(true);
    expect(isActionableRelease({ action: 'created', draft: true })).toBe(false);
    expect(isActionableRelease({ action: 'edited', draft: false })).toBe(false);
    expect(isActionableRelease({ action: 'deleted', draft: false })).toBe(false);
  });
});
