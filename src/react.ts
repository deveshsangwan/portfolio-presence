import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import type { PresenceSnapshot } from "./core/types";

export type PresenceHookStatus = "idle" | "loading" | "success" | "error";

export interface UsePresenceOptions {
  fetcher?: typeof fetch;
  initialSnapshot?: PresenceSnapshot;
  refreshIntervalMs?: number;
  revalidateOnMount?: boolean;
}

export interface UsePresenceResult {
  error: Error | null;
  refresh: () => Promise<void>;
  snapshot: PresenceSnapshot | null;
  status: PresenceHookStatus;
}

interface ActivePresenceRequest {
  controller: AbortController;
  promise: Promise<void>;
}

export function usePresence(
  endpoint = "/api/presence",
  options: UsePresenceOptions = {}
): UsePresenceResult {
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(
    () => options.initialSnapshot ?? null
  );
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<PresenceHookStatus>(() =>
    options.initialSnapshot ? "success" : "idle"
  );
  const activeRequest = useRef<ActivePresenceRequest | null>(null);
  const isMounted = useRef(false);
  const mountPolicy = useRef({
    hasInitialSnapshot: options.initialSnapshot !== undefined,
    revalidateOnMount: options.revalidateOnMount === true
  });
  const pendingLifecycleRefresh = useRef(false);
  const requestConfig = useRef({
    endpoint,
    fetcher: options.fetcher
  });
  const requestGeneration = useRef(0);

  const cancelActiveRequest = useCallback(() => {
    const request = activeRequest.current;

    if (!request) {
      return;
    }

    requestGeneration.current += 1;
    request.controller.abort();
    activeRequest.current = null;
  }, []);

  const refresh = useCallback(() => {
    if (!isMounted.current) {
      return Promise.resolve();
    }

    if (activeRequest.current) {
      return activeRequest.current.promise;
    }

    const controller = new AbortController();
    const generation = ++requestGeneration.current;
    const isCurrentRequest = () =>
      generation === requestGeneration.current && !controller.signal.aborted;

    setStatus((current) => (current === "success" ? current : "loading"));
    setError(null);

    const performRequest = async () => {
      try {
        const fetcher = options.fetcher ?? fetch;
        const response = await fetcher(endpoint, {
          signal: controller.signal
        });

        if (!isCurrentRequest()) {
          return;
        }

        if (!response.ok) {
          throw new Error(`Presence request failed with ${response.status}.`);
        }

        const nextSnapshot = (await response.json()) as PresenceSnapshot;

        if (!isCurrentRequest()) {
          return;
        }

        setSnapshot(nextSnapshot);
        setStatus("success");
      } catch (caught) {
        if (!isCurrentRequest()) {
          return;
        }

        const requestError =
          caught instanceof Error
            ? caught
            : new Error("Presence request failed.");

        setError(requestError);
        setStatus("error");
      } finally {
        if (activeRequest.current?.controller === controller) {
          activeRequest.current = null;
        }
      }
    };

    const promise = Promise.resolve().then(performRequest);

    activeRequest.current = { controller, promise };

    return promise;
  }, [endpoint, options.fetcher]);

  const queueLifecycleRefresh = useCallback(() => {
    const request = activeRequest.current;

    if (!request) {
      void refresh();
      return;
    }

    if (pendingLifecycleRefresh.current) {
      return;
    }

    pendingLifecycleRefresh.current = true;
    void request.promise.then(() => {
      if (!pendingLifecycleRefresh.current) {
        return;
      }

      pendingLifecycleRefresh.current = false;

      if (isMounted.current) {
        void refresh();
      }
    });
  }, [refresh]);

  useLayoutEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
      pendingLifecycleRefresh.current = false;
      cancelActiveRequest();
    };
  }, [cancelActiveRequest]);

  useEffect(() => {
    const previousConfig = requestConfig.current;
    const hasRequestConfigChanged =
      previousConfig.endpoint !== endpoint ||
      previousConfig.fetcher !== options.fetcher;

    requestConfig.current = {
      endpoint,
      fetcher: options.fetcher
    };

    if (hasRequestConfigChanged) {
      pendingLifecycleRefresh.current = false;
      cancelActiveRequest();
      void refresh();
      return;
    }

    if (
      !mountPolicy.current.hasInitialSnapshot ||
      mountPolicy.current.revalidateOnMount
    ) {
      void refresh();
    }
  }, [cancelActiveRequest, endpoint, options.fetcher, refresh]);

  useEffect(() => {
    let interval: number | undefined;
    let wasPageHidden = document.visibilityState === "hidden";

    const stopInterval = () => {
      if (interval === undefined) {
        return;
      }

      window.clearInterval(interval);
      interval = undefined;
    };

    const startInterval = () => {
      stopInterval();

      if (!options.refreshIntervalMs || document.visibilityState === "hidden") {
        return;
      }

      interval = window.setInterval(() => {
        if (document.visibilityState === "hidden") {
          stopInterval();
          return;
        }

        void refresh();
      }, options.refreshIntervalMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasPageHidden = true;
        stopInterval();
        return;
      }

      if (wasPageHidden) {
        wasPageHidden = false;
        queueLifecycleRefresh();
      } else {
        void refresh();
      }

      startInterval();
    };

    const handleFocus = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void refresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    startInterval();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      stopInterval();
    };
  }, [options.refreshIntervalMs, queueLifecycleRefresh, refresh]);

  return {
    error,
    refresh,
    snapshot,
    status
  };
}
