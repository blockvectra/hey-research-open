import type { SourceAdapter } from '../adapter';

/**
 * Launchpad / public token-registry adapter interface (PRD V4 section 20.1).
 *
 * Launchpads are a discovery input, not something HEY reproduces. The interface
 * is defined here so providers can be added or removed without touching domain
 * logic, but NO concrete provider ships yet: per the backlog, a specific
 * launchpad is only implemented once its data access is public, documented and
 * permitted. Unauthorized scraping must never become a dependency.
 */
export type LaunchpadListing = {
  /** Launchpad-local identifier, used for dedupe. */
  externalId: string;
  chainId: number;
  contractAddress: string;
  name?: string;
  symbol?: string;
  description?: string;
  launchedAt?: Date;
  websiteUrl?: string;
  /** Which launchpad reported the listing; kept as provenance. */
  provenance: string;
};

export type LaunchpadQuery = {
  chainId: number;
  /** Only fetch listings newer than this, when the provider supports it. */
  since?: Date;
  limit?: number;
};

export type LaunchpadAdapter = SourceAdapter<LaunchpadQuery, LaunchpadListing[]>;

/**
 * Registry so discovery (M3) can iterate whatever launchpads are configured
 * without knowing any of them by name.
 */
export class LaunchpadRegistry {
  private readonly adapters = new Map<string, LaunchpadAdapter>();

  register(adapter: LaunchpadAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): LaunchpadAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): LaunchpadAdapter[] {
    return [...this.adapters.values()];
  }
}
