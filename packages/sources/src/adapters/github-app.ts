import { createSign } from 'node:crypto';

import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * The HEY GitHub App's calls to GitHub (2026-10-05, docs/GITHUB_APP.md).
 *
 * Worker only. Two kinds of call:
 *  - minting a short-lived installation token, signed with the app's JWT
 *    (`installation_token`). The token lives in the worker's memory and is
 *    never stored or logged;
 *  - the opt-in README badge pull request, through that token: read the
 *    repository and its README, check for an open badge pull request, make a
 *    new branch, commit the README there, open the pull request. Nothing here
 *    can write to a default branch: the commit call names the new branch and
 *    the caller refuses one that equals the default.
 *
 * The host is fixed (`api.github.com`) and every path segment is checked
 * against GitHub's own name rules before it is put in a URL: nothing a
 * webhook payload or a page says is ever fetched (SSRF).
 */
export const GITHUB_APP_API_BASE = 'https://api.github.com';

/** GitHub's own limits: owners up to 39, repositories up to 100 characters. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}$/;
/** HEY's own branch names only: lowercase words and slashes. */
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
/** A README path as GitHub returns it: plain segments, no `..`, no leading slash. */
const FILE_PATH = /^(?!.*\.\.)(?!\/)[A-Za-z0-9 _./-]{1,200}$/;
const SHA = /^[0-9a-f]{40}$/;

export function isGithubOwnerName(value: string): boolean {
  return OWNER.test(value);
}

export function isGithubRepoName(value: string): boolean {
  return REPO.test(value) && value !== '.' && value !== '..';
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

/**
 * The app's own JWT (RS256): issued a minute in the past for clock drift and
 * valid for nine minutes, under GitHub's ten-minute ceiling. Used only to ask
 * for an installation token.
 */
export function githubAppJwt(appId: string, privateKeyPem: string, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKeyPem).toString('base64url')}`;
}

type Repo = { owner: string; repo: string };
type WithToken = { token: string };

export type GithubAppCall =
  /** The manifest flow's one-time code, exchanged once for the new app's credentials (no auth: the code is the credential). */
  | { kind: 'manifest_conversion'; code: string }
  | { kind: 'installation_token'; appJwt: string; installationId: number }
  | (WithToken & Repo & { kind: 'repo' })
  | (WithToken & Repo & { kind: 'branch_head'; branch: string })
  | (WithToken & Repo & { kind: 'readme' })
  | (WithToken & Repo & { kind: 'open_pulls' })
  | (WithToken & Repo & { kind: 'create_branch'; branch: string; sha: string })
  | (WithToken & Repo & { kind: 'put_file'; path: string; branch: string; message: string; contentBase64: string; sha: string })
  | (WithToken & Repo & { kind: 'create_pull'; title: string; head: string; base: string; body: string });

export type GithubAppCallKind = GithubAppCall['kind'];

const conversionSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  pem: z.string().min(100).max(10_000),
  webhook_secret: z.string().min(20).max(512),
  html_url: z.string().url(),
  owner: z.object({ login: z.string() }).nullish(),
});
const tokenSchema = z.object({
  token: z.string().min(20).max(512),
  expires_at: z.string(),
  permissions: z.record(z.string(), z.string()).optional(),
});
const repoSchema = z.object({
  id: z.number().int(),
  full_name: z.string(),
  default_branch: z.string(),
  archived: z.boolean().optional(),
  owner: z.object({ login: z.string() }),
});
const refSchema = z.object({ ref: z.string(), object: z.object({ sha: z.string().regex(SHA) }) });
const readmeSchema = z.object({
  path: z.string(),
  sha: z.string().regex(SHA),
  encoding: z.string(),
  content: z.string().max(2_000_000),
  size: z.number().int().nonnegative().optional(),
});
const pullsSchema = z.array(z.object({ number: z.number().int(), html_url: z.string(), state: z.string(), head: z.object({ ref: z.string() }) }));
const putSchema = z.object({ commit: z.object({ sha: z.string().regex(SHA) }) });
const pullSchema = z.object({ number: z.number().int(), html_url: z.string().url(), state: z.string() });

export type GithubAppResult =
  /** The client id and client secret GitHub also returns are dropped here: HEY never uses user-to-server OAuth for the app. */
  | { kind: 'manifest_conversion'; id: number; slug: string; pem: string; webhookSecret: string; htmlUrl: string; ownerLogin: string | null }
  | { kind: 'installation_token'; token: string; expiresAt: Date; permissions: Record<string, string> }
  | { kind: 'repo'; repoId: number; fullName: string; defaultBranch: string; archived: boolean; ownerLogin: string }
  | { kind: 'branch_head'; sha: string }
  | { kind: 'readme'; path: string; sha: string; text: string }
  | { kind: 'open_pulls'; pulls: { number: number; url: string; headRef: string }[] }
  | { kind: 'create_branch'; sha: string }
  | { kind: 'put_file'; commitSha: string }
  | { kind: 'create_pull'; number: number; url: string };

const segment = (value: string) => encodeURIComponent(value);
const repoPath = (call: Repo) => `/repos/${segment(call.owner)}/${segment(call.repo)}`;

/** The URL, method and body of one call; refuses anything outside GitHub's name rules. */
export function githubAppRequest(call: GithubAppCall): { method: 'GET' | 'POST' | 'PUT'; path: string; body?: Record<string, unknown> } {
  switch (call.kind) {
    case 'manifest_conversion':
      return { method: 'POST', path: `/app-manifests/${segment(call.code)}/conversions`, body: {} };
    case 'installation_token':
      return { method: 'POST', path: `/app/installations/${call.installationId}/access_tokens`, body: {} };
    case 'repo':
      return { method: 'GET', path: repoPath(call) };
    case 'branch_head':
      return { method: 'GET', path: `${repoPath(call)}/git/ref/heads/${call.branch.split('/').map(segment).join('/')}` };
    case 'readme':
      return { method: 'GET', path: `${repoPath(call)}/readme` };
    case 'open_pulls':
      return { method: 'GET', path: `${repoPath(call)}/pulls?state=open&per_page=100` };
    case 'create_branch':
      return { method: 'POST', path: `${repoPath(call)}/git/refs`, body: { ref: `refs/heads/${call.branch}`, sha: call.sha } };
    case 'put_file':
      return {
        method: 'PUT',
        path: `${repoPath(call)}/contents/${call.path.split('/').map(segment).join('/')}`,
        body: { message: call.message, content: call.contentBase64, sha: call.sha, branch: call.branch },
      };
    case 'create_pull':
      return { method: 'POST', path: `${repoPath(call)}/pulls`, body: { title: call.title, head: call.head, base: call.base, body: call.body, maintainer_can_modify: true } };
  }
}

function callIsWellFormed(call: GithubAppCall): boolean {
  if (call.kind === 'manifest_conversion') return /^[A-Za-z0-9_-]{8,128}$/.test(call.code);
  if (call.kind === 'installation_token') return Number.isSafeInteger(call.installationId) && call.installationId > 0 && call.appJwt.split('.').length === 3;
  if (!isGithubOwnerName(call.owner) || !isGithubRepoName(call.repo) || call.token.length < 20) return false;
  switch (call.kind) {
    case 'branch_head':
      return BRANCH.test(call.branch);
    case 'create_branch':
      return BRANCH.test(call.branch) && SHA.test(call.sha);
    case 'put_file':
      return FILE_PATH.test(call.path) && BRANCH.test(call.branch) && SHA.test(call.sha) && call.message.length > 0 && call.message.length <= 200;
    case 'create_pull':
      return BRANCH.test(call.head) && BRANCH.test(call.base) && call.head !== call.base && call.title.length > 0 && call.title.length <= 200 && call.body.length <= 4_000;
    default:
      return true;
  }
}

function schemaFor(kind: GithubAppCallKind): z.ZodTypeAny {
  switch (kind) {
    case 'manifest_conversion':
      return conversionSchema;
    case 'installation_token':
      return tokenSchema;
    case 'repo':
      return repoSchema;
    case 'branch_head':
    case 'create_branch':
      return refSchema;
    case 'readme':
      return readmeSchema;
    case 'open_pulls':
      return pullsSchema;
    case 'put_file':
      return putSchema;
    case 'create_pull':
      return pullSchema;
  }
}

function normalize(call: GithubAppCall, raw: unknown): GithubAppResult {
  switch (call.kind) {
    case 'manifest_conversion': {
      const value = raw as z.infer<typeof conversionSchema>;
      return { kind: 'manifest_conversion', id: value.id, slug: value.slug, pem: value.pem, webhookSecret: value.webhook_secret, htmlUrl: value.html_url, ownerLogin: value.owner?.login ?? null };
    }
    case 'installation_token': {
      const value = raw as z.infer<typeof tokenSchema>;
      return { kind: 'installation_token', token: value.token, expiresAt: new Date(value.expires_at), permissions: value.permissions ?? {} };
    }
    case 'repo': {
      const value = raw as z.infer<typeof repoSchema>;
      return { kind: 'repo', repoId: value.id, fullName: value.full_name, defaultBranch: value.default_branch, archived: value.archived === true, ownerLogin: value.owner.login };
    }
    case 'branch_head':
      return { kind: 'branch_head', sha: (raw as z.infer<typeof refSchema>).object.sha };
    case 'create_branch':
      return { kind: 'create_branch', sha: (raw as z.infer<typeof refSchema>).object.sha };
    case 'readme': {
      const value = raw as z.infer<typeof readmeSchema>;
      const text = value.encoding === 'base64' ? Buffer.from(value.content.replace(/\s+/g, ''), 'base64').toString('utf8') : value.content;
      return { kind: 'readme', path: value.path, sha: value.sha, text };
    }
    case 'open_pulls':
      return { kind: 'open_pulls', pulls: (raw as z.infer<typeof pullsSchema>).filter((pull) => pull.state === 'open').map((pull) => ({ number: pull.number, url: pull.html_url, headRef: pull.head.ref })) };
    case 'put_file':
      return { kind: 'put_file', commitSha: (raw as z.infer<typeof putSchema>).commit.sha };
    case 'create_pull': {
      const value = raw as z.infer<typeof pullSchema>;
      return { kind: 'create_pull', number: value.number, url: value.html_url };
    }
  }
}

export function createGithubAppAdapter(): SourceAdapter<GithubAppCall, GithubAppResult> {
  return {
    name: 'github-app',
    canHandle: callIsWellFormed,
    async fetch(call, ctx: SourceContext): Promise<SourceResult<GithubAppResult>> {
      if (!callIsWellFormed(call)) {
        return { fetchedAt: ctx.now?.() ?? new Date(), cacheTtlSeconds: 0, status: 'error', errorCode: 'BLOCKED_URL', errorMessage: `refused a malformed ${call.kind} call` };
      }
      const request = githubAppRequest(call);
      const bearer = call.kind === 'manifest_conversion' ? undefined : call.kind === 'installation_token' ? call.appJwt : call.token;
      return performSourceFetch(
        // A write is never retried in process: a second POST could open a second pull request.
        { ...ctx, ...(request.method === 'GET' ? {} : { retry: { attempts: 1, baseDelayMs: 0, maxDelayMs: 0 } }) },
        {
          url: `${GITHUB_APP_API_BASE}${request.path}`,
          method: request.method,
          conditional: false,
          headers: {
            accept: 'application/vnd.github+json',
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            'x-github-api-version': '2022-11-28',
            ...(request.body ? { 'content-type': 'application/json' } : {}),
          },
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
          maxBytes: call.kind === 'readme' ? 3 * 1024 * 1024 : 512 * 1024,
        },
        {
          schema: schemaFor(call.kind),
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 0,
          normalize: (raw) => normalize(call, raw),
        },
      );
    },
  };
}
