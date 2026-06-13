import { useCallback, useEffect, useRef, useState } from "react";
import type { PresenceSnapshot } from "./core/types";

export type PresenceHookStatus = "idle" | "loading" | "success" | "error";

export interface UsePresenceOptions {
  fetcher?: typeof fetch;
  refreshIntervalMs?: number;
}

export interface UsePresenceResult {
  error: Error | null;
  refresh: () => Promise<void>;
  snapshot: PresenceSnapshot | null;
  status: PresenceHookStatus;
}

export function usePresence(
  endpoint = "/api/presence",
  options: UsePresenceOptions = {}
): UsePresenceResult {
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<PresenceHookStatus>("idle");
  const abortController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;

    setStatus((current) => (current === "success" ? current : "loading"));
    setError(null);

    try {
      const fetcher = options.fetcher ?? fetch;
      const response = await fetcher(endpoint, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Presence request failed with ${response.status}.`);
      }

      const nextSnapshot = (await response.json()) as PresenceSnapshot;
      setSnapshot(nextSnapshot);
      setStatus("success");
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }

      setError(caught instanceof Error ? caught : new Error("Presence request failed."));
      setStatus("error");
    }
  }, [endpoint, options.fetcher]);

  useEffect(() => {
    void refresh();

    if (!options.refreshIntervalMs) {
      return () => {
        abortController.current?.abort();
      };
    }

    const interval = window.setInterval(() => {
      void refresh();
    }, options.refreshIntervalMs);

    return () => {
      window.clearInterval(interval);
      abortController.current?.abort();
    };
  }, [options.refreshIntervalMs, refresh]);

  return {
    error,
    refresh,
    snapshot,
    status
  };
}
