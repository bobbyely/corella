import { useEffect, useMemo, useState } from "react";
import type { ProviderView } from "@corella/shared";
import { ApiError, fetchProviders } from "./api.js";

/**
 * Every configured provider with its last check. `null` until the list has
 * arrived, so a page can show "Loading…" rather than an empty choice; `error`
 * is the server's message when it did not. Fetched on mount, and again each
 * second while the server is still checking one, so an agent becomes
 * choosable as soon as its automatic check passes.
 */
export function useProviders(): { providers: ProviderView[] | null; error: string | null } {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    let timer: number | undefined;
    const load = () =>
      fetchProviders()
        .then((res) => {
          if (stale) return;
          setProviders(res.providers);
          if (res.providers.some((p) => p.checking)) timer = window.setTimeout(load, 1_000);
        })
        .catch((err: unknown) => !stale && setError(err instanceof ApiError ? err.kc.message : String(err)));
    void load();
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, []);
  return { providers, error };
}

/** Whether a conversation may be started on or moved to it (invariant 11). */
export const isReady = (p: ProviderView): boolean => p.lastCheck?.status === "ok";

/** The providers whose setup check passed: what every picker and form offers. */
export function useReadyProviders(): { providers: ProviderView[] | null; error: string | null } {
  const { providers, error } = useProviders();
  const ready = useMemo(() => providers?.filter(isReady) ?? null, [providers]);
  return { providers: ready, error };
}
