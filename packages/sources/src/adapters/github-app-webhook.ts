import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/**
 * What GitHub posts to the HEY GitHub App's webhook (2026-10-05,
 * docs/GITHUB_APP.md), validated and reduced to the few facts HEY acts on.
 *
 * The reading keeps ids, repository names, a ref and a few booleans. It
 * never keeps a commit message, an author, an e-mail, a release body, a URL
 * from the payload (nothing in a payload is ever fetched) or the sender's
 * login — only the sender's numeric id, which a claim is bound to.
 */

/** The events the app subscribes to, plus `ping` (sent once on creation). */
export const GITHUB_APP_WEBHOOK_EVENTS = ['ping', 'installation', 'installation_repositories', 'release', 'push', 'pull_request'] as const;
export type GithubAppWebhookEvent = (typeof GITHUB_APP_WEBHOOK_EVENTS)[number];

/** GitHub's own ceiling on a delivery is 25 MB; HEY reads at most this much and refuses the rest. */
export const GITHUB_WEBHOOK_MAX_BYTES = 1024 * 1024;

const FULL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const repository = z.object({ id, full_name: z.string().regex(FULL_NAME), private: z.boolean().optional() });
const account = z.object({ login: z.string().min(1).max(39), id, type: z.string().max(32) });
const installation = z.object({
  id,
  account: account.nullish(),
  repository_selection: z.enum(['all', 'selected']).optional(),
  permissions: z.record(z.string().max(64), z.string().max(16)).optional(),
});
const sender = z.object({ id });

const installationEvent = z.object({
  action: z.string().max(40),
  installation: installation.extend({ account, repository_selection: z.enum(['all', 'selected']) }),
  repositories: z.array(repository).max(5000).optional(),
  sender,
});
const installationRepositoriesEvent = z.object({
  action: z.enum(['added', 'removed']),
  installation: installation.extend({ account, repository_selection: z.enum(['all', 'selected']) }),
  repositories_added: z.array(repository).max(5000),
  repositories_removed: z.array(repository.extend({ full_name: z.string().regex(FULL_NAME).optional() })).max(5000),
  sender,
});
const releaseEvent = z.object({
  action: z.string().max(40),
  release: z.object({ id, draft: z.boolean(), prerelease: z.boolean() }),
  repository: repository.extend({ default_branch: z.string().max(255).optional() }),
  installation: z.object({ id }),
});
const pushEvent = z.object({
  ref: z.string().max(255),
  deleted: z.boolean().optional(),
  repository: repository.extend({ default_branch: z.string().min(1).max(255) }),
  installation: z.object({ id }),
});
const pullRequestEvent = z.object({
  action: z.string().max(40),
  pull_request: z.object({
    number: z.number().int().positive(),
    merged: z.boolean().nullish(),
    head: z.object({ ref: z.string().max(255) }),
    base: z.object({ ref: z.string().max(255) }),
  }),
  repository,
  installation: z.object({ id }),
});

/** `isPrivate` as GitHub sent it (2026-10-09); absent when the payload did not say. */
export type GithubAppRepoRef = { id: number; fullName: string; isPrivate?: boolean };
export type GithubAppInstallationFacts = {
  id: number;
  accountLogin: string;
  accountId: number;
  accountType: string;
  repositorySelection: 'all' | 'selected';
  permissions: Record<string, string>;
};

export type GithubAppWebhookFacts =
  | { kind: 'ping' }
  | { kind: 'installation'; action: string; installation: GithubAppInstallationFacts; repositories: GithubAppRepoRef[]; senderId: number }
  | { kind: 'installation_repositories'; action: 'added' | 'removed'; installation: GithubAppInstallationFacts; added: GithubAppRepoRef[]; removed: { id: number; fullName?: string }[]; senderId: number }
  | { kind: 'release'; action: string; installationId: number; repo: GithubAppRepoRef; releaseId: number; draft: boolean; prerelease: boolean }
  | { kind: 'push'; installationId: number; repo: GithubAppRepoRef; ref: string; defaultBranch: string; deleted: boolean }
  | { kind: 'pull_request'; action: string; installationId: number; repo: GithubAppRepoRef; number: number; merged: boolean; headRef: string; baseRef: string };

export type GithubAppWebhookParse =
  | { ok: true; facts: GithubAppWebhookFacts }
  | { ok: false; reason: 'unsupported_event' | 'malformed' };

const repo = (value: { id: number; full_name: string; private?: boolean | undefined }): GithubAppRepoRef => ({ id: value.id, fullName: value.full_name, ...(value.private === undefined ? {} : { isPrivate: value.private }) });
const installationFacts = (value: z.infer<typeof installationEvent>['installation']): GithubAppInstallationFacts => ({
  id: value.id,
  accountLogin: value.account.login,
  accountId: value.account.id,
  accountType: value.account.type,
  repositorySelection: value.repository_selection,
  permissions: value.permissions ?? {},
});

export function isGithubAppWebhookEvent(value: string | null): value is GithubAppWebhookEvent {
  return value !== null && (GITHUB_APP_WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** One delivery, validated: the event names the schema, and anything that does not fit it is malformed. */
export function parseGithubAppWebhook(event: string | null, body: unknown): GithubAppWebhookParse {
  if (!isGithubAppWebhookEvent(event)) return { ok: false, reason: 'unsupported_event' };
  switch (event) {
    case 'ping':
      return typeof body === 'object' && body !== null ? { ok: true, facts: { kind: 'ping' } } : { ok: false, reason: 'malformed' };
    case 'installation': {
      const parsed = installationEvent.safeParse(body);
      if (!parsed.success) return { ok: false, reason: 'malformed' };
      return {
        ok: true,
        facts: {
          kind: 'installation',
          action: parsed.data.action,
          installation: installationFacts(parsed.data.installation),
          repositories: (parsed.data.repositories ?? []).map(repo),
          senderId: parsed.data.sender.id,
        },
      };
    }
    case 'installation_repositories': {
      const parsed = installationRepositoriesEvent.safeParse(body);
      if (!parsed.success) return { ok: false, reason: 'malformed' };
      return {
        ok: true,
        facts: {
          kind: 'installation_repositories',
          action: parsed.data.action,
          installation: installationFacts(parsed.data.installation),
          added: parsed.data.repositories_added.map(repo),
          removed: parsed.data.repositories_removed.map((entry) => ({ id: entry.id, ...(entry.full_name ? { fullName: entry.full_name } : {}) })),
          senderId: parsed.data.sender.id,
        },
      };
    }
    case 'release': {
      const parsed = releaseEvent.safeParse(body);
      if (!parsed.success) return { ok: false, reason: 'malformed' };
      return {
        ok: true,
        facts: {
          kind: 'release',
          action: parsed.data.action,
          installationId: parsed.data.installation.id,
          repo: repo(parsed.data.repository),
          releaseId: parsed.data.release.id,
          draft: parsed.data.release.draft,
          prerelease: parsed.data.release.prerelease,
        },
      };
    }
    case 'push': {
      const parsed = pushEvent.safeParse(body);
      if (!parsed.success) return { ok: false, reason: 'malformed' };
      return {
        ok: true,
        facts: {
          kind: 'push',
          installationId: parsed.data.installation.id,
          repo: repo(parsed.data.repository),
          ref: parsed.data.ref,
          defaultBranch: parsed.data.repository.default_branch,
          deleted: parsed.data.deleted === true,
        },
      };
    }
    case 'pull_request': {
      const parsed = pullRequestEvent.safeParse(body);
      if (!parsed.success) return { ok: false, reason: 'malformed' };
      return {
        ok: true,
        facts: {
          kind: 'pull_request',
          action: parsed.data.action,
          installationId: parsed.data.installation.id,
          repo: repo(parsed.data.repository),
          number: parsed.data.pull_request.number,
          merged: parsed.data.pull_request.merged === true,
          headRef: parsed.data.pull_request.head.ref,
          baseRef: parsed.data.pull_request.base.ref,
        },
      };
    }
  }
}

/** The release actions that may mean a new public release. Drafts and deletions are never read. */
export const GITHUB_APP_RELEASE_ACTIONS = ['published', 'released', 'prereleased'] as const;

/** A push to the repository's default branch, and not a branch deletion: the only pushes HEY acts on. */
export function isDefaultBranchPush(facts: { ref: string; defaultBranch: string; deleted: boolean }): boolean {
  return !facts.deleted && facts.ref === `refs/heads/${facts.defaultBranch}`;
}

/** A release HEY re-reads the repository for: a public release, never a draft. */
export function isActionableRelease(facts: { action: string; draft: boolean }): boolean {
  return !facts.draft && (GITHUB_APP_RELEASE_ACTIONS as readonly string[]).includes(facts.action);
}

const SIGNATURE = /^sha256=([0-9a-f]{64})$/;

/**
 * `X-Hub-Signature-256` against the raw body, in constant time. A header that
 * is missing, not `sha256=<64 hex>`, or computed with another secret fails;
 * the comparison runs over two 32-byte digests, so neither length nor prefix
 * leaks.
 */
export function verifyGithubWebhookSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || header === null) return false;
  const match = SIGNATURE.exec(header.trim().toLowerCase());
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const received = Buffer.from(match[1]!, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** What GitHub would send for a body: used by tests and the e2e suite, never by the receiver. */
export function signGithubWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

/** GitHub's delivery id is a GUID; anything else is not a delivery GitHub made. */
export function isGithubDeliveryId(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
