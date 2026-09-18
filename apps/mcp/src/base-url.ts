import { DEFAULT_BASE_URL } from '@hey-research/sdk';

/**
 * Where this server is allowed to send the key (round-9 security, 2026-09-19).
 *
 * `HEY_API_URL` is read from the environment of whatever launched the server —
 * an assistant's config file, a shell profile, a shared devcontainer — and
 * `HEY_API_KEY` is attached to every request the client makes. Before this,
 * pointing the variable at `http://someone-elses-box` sent the key there in
 * clear text, and nothing said so: the ready line named the base URL, but a
 * reader skims it and a plaintext host does not look different from an https
 * one at a glance.
 *
 * So: https anywhere, http only on the loopback host a developer runs HEY on.
 * The refusal is a start-up error rather than a warning, because a server that
 * came up and then leaked the key is worse than one that did not come up.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export type ResolvedBaseUrl = { baseUrl: string; origin: string };

export function resolveBaseUrl(raw: string | undefined): ResolvedBaseUrl {
  const value = (raw ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`HEY_API_URL is not a URL: ${value}`);
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(
      `HEY_API_URL must be https (http is allowed only on localhost); got ${url.protocol}//${url.host || value}. The API key would travel in clear text.`,
    );
  }
  return { baseUrl: value.replace(/\/+$/, ''), origin: url.origin };
}
