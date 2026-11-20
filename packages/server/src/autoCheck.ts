import type { ProviderConfig } from "@corella/shared";
import { checkProvider } from "./check.js";
import type { Store } from "./store.js";

/**
 * Runs each provider's setup check by itself: once when the server starts,
 * and again whenever a provider is added or its command changes. So a new
 * chat can trust the check (invariant 11) without anyone pressing Check; the
 * button stays in Settings for diagnosis.
 *
 * Runs in the background. The providers list says which are still being
 * checked, and the page asks again until none are.
 */
export class AutoCheck {
  /** What each provider looked like when this server last checked it. */
  private readonly checked = new Map<string, string>();
  private readonly running = new Set<string>();

  constructor(private readonly store: Store) {}

  /** Checks every provider not yet checked in its current form. */
  run(providers: ProviderConfig[]): void {
    for (const provider of providers) {
      const form = JSON.stringify([provider.command, provider.args, provider.env ?? null, provider.cwd ?? null]);
      if (this.checked.get(provider.id) === form) continue;
      this.checked.set(provider.id, form);
      this.running.add(provider.id);
      checkProvider(provider)
        .then((result) => this.store.saveCheck(result))
        .catch((err: unknown) => console.error(`[check ${provider.id}] automatic check failed:`, err))
        .finally(() => this.running.delete(provider.id));
    }
  }

  checking(providerId: string): boolean {
    return this.running.has(providerId);
  }
}
