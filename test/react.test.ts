// @vitest-environment jsdom

import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresenceSnapshot } from "../src";
import {
  usePresence,
  type UsePresenceOptions,
  type UsePresenceResult
} from "../src/react";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialSnapshot: PresenceSnapshot = {
  cards: [
    {
      kind: "building",
      label: "Building",
      source: "github",
      title: "portfolio-presence"
    }
  ],
  generatedAt: "2026-08-31T10:00:00.000Z",
  sources: {
    building: { source: "github", status: "fresh" },
    listening: { status: "disabled" },
    playing: { status: "disabled" }
  }
};

const refreshedSnapshot: PresenceSnapshot = {
  ...initialSnapshot,
  generatedAt: "2026-08-31T10:05:00.000Z"
};

const postVisibleSnapshot: PresenceSnapshot = {
  ...initialSnapshot,
  generatedAt: "2026-08-31T10:10:00.000Z"
};

interface HookProbeProps {
  endpoint?: string;
  onRender?: (result: UsePresenceResult) => void;
  options?: UsePresenceOptions;
  refreshOnLayout?: boolean;
}

interface HookRender {
  container: HTMLDivElement;
  rerender: (props: HookProbeProps) => Promise<void>;
  unmount: () => Promise<void>;
}

interface HookRenderOptions {
  strictMode?: boolean;
}

interface Deferred<TValue> {
  promise: Promise<TValue>;
  resolve: (value: TValue) => void;
}

const mountedRoots = new Set<Root>();

function HookProbe({
  endpoint = "/api/presence",
  onRender,
  options,
  refreshOnLayout
}: HookProbeProps) {
  const result = usePresence(endpoint, options);

  useLayoutEffect(() => {
    onRender?.(result);
  }, [onRender, result]);

  useLayoutEffect(() => {
    if (refreshOnLayout) {
      void result.refresh();
    }
  }, [refreshOnLayout, result.refresh]);

  return createElement(
    "output",
    { "data-testid": "presence" },
    JSON.stringify({
      generatedAt: result.snapshot?.generatedAt ?? null,
      status: result.status
    })
  );
}

async function renderHook(
  props: HookProbeProps,
  renderOptions: HookRenderOptions = {}
): Promise<HookRender> {
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);
  mountedRoots.add(root);

  const rerender = async (nextProps: HookProbeProps) => {
    await act(async () => {
      const probe = createElement(HookProbe, nextProps);
      root.render(
        renderOptions.strictMode
          ? createElement(StrictMode, null, probe)
          : probe
      );
    });
  };

  await rerender(props);

  return {
    container,
    rerender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      mountedRoots.delete(root);
      container.remove();
    }
  };
}

function readHookState(container: HTMLElement) {
  const output = container.querySelector('[data-testid="presence"]');

  if (!output?.textContent) {
    throw new Error("The hook probe did not render its state.");
  }

  return JSON.parse(output.textContent) as {
    generatedAt: string | null;
    status: string;
  };
}

function createSnapshotResponse(snapshot: PresenceSnapshot) {
  return new Response(JSON.stringify(snapshot), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve: (value: TValue) => void = (_value) => {
    throw new Error("The deferred promise is not ready.");
  };
  const promise = new Promise<TValue>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function requireHookResult(
  result: UsePresenceResult | undefined
): UsePresenceResult {
  if (!result) {
    throw new Error("The hook probe has not rendered.");
  }

  return result;
}

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => {
      root.unmount();
    });
  }

  mountedRoots.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("usePresence", () => {
  it("starts with a server snapshot without requesting it again", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const rendered = await renderHook({
      options: { fetcher, initialSnapshot }
    });

    expect(readHookState(rendered.container)).toEqual({
      generatedAt: initialSnapshot.generatedAt,
      status: "success"
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("revalidates a server snapshot on mount when requested", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      createSnapshotResponse(refreshedSnapshot)
    );
    const rendered = await renderHook({
      options: {
        fetcher,
        initialSnapshot,
        revalidateOnMount: true
      }
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(readHookState(rendered.container)).toEqual({
      generatedAt: refreshedSnapshot.generatedAt,
      status: "success"
    });
  });

  it("lets consumers refresh during their layout effect", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      createSnapshotResponse(refreshedSnapshot)
    );
    const rendered = await renderHook({
      options: { fetcher, initialSnapshot },
      refreshOnLayout: true
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(readHookState(rendered.container).generatedAt).toBe(
      refreshedSnapshot.generatedAt
    );
  });

  it("keeps layout refresh ready during Strict Mode effect replay", async () => {
    const firstResponse = createDeferred<Response>();
    const replayResponse = createDeferred<Response>();
    const requestSignals: Array<AbortSignal | null | undefined> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      requestSignals.push(init?.signal);
      return requestSignals.length === 1
        ? firstResponse.promise
        : replayResponse.promise;
    });
    let hookResult: UsePresenceResult | undefined;
    const rendered = await renderHook(
      {
        onRender: (result) => {
          hookResult = result;
        },
        options: { fetcher, initialSnapshot },
        refreshOnLayout: true
      },
      { strictMode: true }
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requestSignals[0]?.aborted).toBe(true);
    expect(requestSignals[1]?.aborted).toBe(false);

    const replayRequest = requireHookResult(hookResult).refresh();
    await act(async () => {
      replayResponse.resolve(createSnapshotResponse(refreshedSnapshot));
      await replayRequest;
      firstResponse.resolve(createSnapshotResponse(initialSnapshot));
      await Promise.resolve();
    });
    expect(readHookState(rendered.container).generatedAt).toBe(
      refreshedSnapshot.generatedAt
    );
  });

  it("fetches on mount when no server snapshot is available", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      createSnapshotResponse(initialSnapshot)
    );
    const rendered = await renderHook({
      options: { fetcher, revalidateOnMount: false }
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(readHookState(rendered.container)).toEqual({
      generatedAt: initialSnapshot.generatedAt,
      status: "success"
    });
  });

  it("pauses interval refreshes while hidden and restarts when visible", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        createSnapshotResponse(refreshedSnapshot)
      );
    await renderHook({
      options: {
        fetcher,
        initialSnapshot,
        refreshIntervalMs: 1_000
      }
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    visibilityState = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("refreshes after visibility returns when earlier work is still active", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState
    );
    const preHideResponse = createDeferred<Response>();
    const postVisibleResponse = createDeferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(preHideResponse.promise)
      .mockReturnValueOnce(postVisibleResponse.promise);
    let hookResult: UsePresenceResult | undefined;
    const rendered = await renderHook({
      onRender: (result) => {
        hookResult = result;
      },
      options: { fetcher, initialSnapshot }
    });
    let preHideRequest: Promise<void> | undefined;
    await act(async () => {
      preHideRequest = requireHookResult(hookResult).refresh();
      await Promise.resolve();
    });

    await act(async () => {
      visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fetcher).toHaveBeenCalledOnce();

    await act(async () => {
      preHideResponse.resolve(createSnapshotResponse(refreshedSnapshot));
      await preHideRequest;
    });

    expect(fetcher).toHaveBeenCalledTimes(2);

    const postVisibleRequest = requireHookResult(hookResult).refresh();
    await act(async () => {
      postVisibleResponse.resolve(createSnapshotResponse(postVisibleSnapshot));
      await postVisibleRequest;
    });
    expect(readHookState(rendered.container).generatedAt).toBe(
      postVisibleSnapshot.generatedAt
    );
  });

  it("refreshes when the window regains focus", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      createSnapshotResponse(refreshedSnapshot)
    );
    await renderHook({ options: { fetcher, initialSnapshot } });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("shares active work across manual, timer, focus, and visibility refreshes", async () => {
    vi.useFakeTimers();
    const response = createDeferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    let hookResult: UsePresenceResult | undefined;
    await renderHook({
      onRender: (result) => {
        hookResult = result;
      },
      options: {
        fetcher,
        initialSnapshot,
        refreshIntervalMs: 1_000
      }
    });

    let manualRefresh: Promise<void> | undefined;
    await act(async () => {
      manualRefresh = requireHookResult(hookResult).refresh();
      await vi.advanceTimersByTimeAsync(1_000);
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fetcher).toHaveBeenCalledOnce();

    await act(async () => {
      response.resolve(createSnapshotResponse(refreshedSnapshot));
      await manualRefresh;
    });
  });

  it("does not let an obsolete request replace a newer endpoint result", async () => {
    const firstResponse = createDeferred<Response>();
    const secondResponse = createDeferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) =>
      input === "/first" ? firstResponse.promise : secondResponse.promise
    );
    let hookResult: UsePresenceResult | undefined;
    const onRender = (result: UsePresenceResult) => {
      hookResult = result;
    };
    const options = {
      fetcher,
      initialSnapshot,
      revalidateOnMount: true
    };
    const rendered = await renderHook({
      endpoint: "/first",
      onRender,
      options
    });
    const firstRequest = requireHookResult(hookResult).refresh();

    await rendered.rerender({
      endpoint: "/second",
      onRender,
      options
    });
    const secondRequest = requireHookResult(hookResult).refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondResponse.resolve(createSnapshotResponse(refreshedSnapshot));
      await secondRequest;
    });
    expect(readHookState(rendered.container).generatedAt).toBe(
      refreshedSnapshot.generatedAt
    );

    await act(async () => {
      firstResponse.resolve(createSnapshotResponse(initialSnapshot));
      await firstRequest;
    });
    expect(readHookState(rendered.container).generatedAt).toBe(
      refreshedSnapshot.generatedAt
    );
  });

  it("drops queued visibility work when the endpoint changes", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState
    );
    const firstResponse = createDeferred<Response>();
    const secondResponse = createDeferred<Response>();
    let firstEndpointCalls = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      if (input === "/first") {
        firstEndpointCalls += 1;
        return firstEndpointCalls === 1
          ? firstResponse.promise
          : Promise.resolve(createSnapshotResponse(initialSnapshot));
      }

      return secondResponse.promise;
    });
    let hookResult: UsePresenceResult | undefined;
    const onRender = (result: UsePresenceResult) => {
      hookResult = result;
    };
    const options = { fetcher, initialSnapshot };
    const rendered = await renderHook({
      endpoint: "/first",
      onRender,
      options
    });
    let firstRequest: Promise<void> | undefined;
    await act(async () => {
      firstRequest = requireHookResult(hookResult).refresh();
      await Promise.resolve();
    });

    await act(async () => {
      visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await rendered.rerender({
      endpoint: "/second",
      onRender,
      options
    });

    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      "/first",
      "/second"
    ]);

    const secondRequest = requireHookResult(hookResult).refresh();
    await act(async () => {
      secondResponse.resolve(createSnapshotResponse(postVisibleSnapshot));
      await secondRequest;
    });

    await act(async () => {
      firstResponse.resolve(createSnapshotResponse(initialSnapshot));
      await firstRequest;
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(readHookState(rendered.container).generatedAt).toBe(
      postVisibleSnapshot.generatedAt
    );
  });

  it("allows a retry after a fetcher throws before returning a promise", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => {
        throw new Error("The fetcher failed before starting.");
      })
      .mockResolvedValueOnce(createSnapshotResponse(refreshedSnapshot));
    let hookResult: UsePresenceResult | undefined;
    const rendered = await renderHook({
      onRender: (result) => {
        hookResult = result;
      },
      options: { fetcher }
    });

    expect(readHookState(rendered.container).status).toBe("error");

    await act(async () => {
      await requireHookResult(hookResult).refresh();
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(readHookState(rendered.container)).toEqual({
      generatedAt: refreshedSnapshot.generatedAt,
      status: "success"
    });
  });

  it("aborts active work and removes matching lifecycle listeners on unmount", async () => {
    vi.useFakeTimers();
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const response = createDeferred<Response>();
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      requestSignal = init?.signal;
      return response.promise;
    });
    let hookResult: UsePresenceResult | undefined;
    const rendered = await renderHook({
      onRender: (result) => {
        hookResult = result;
      },
      options: {
        fetcher,
        initialSnapshot,
        refreshIntervalMs: 1_000
      }
    });
    const request = requireHookResult(hookResult).refresh();
    const focusListener = addWindowListener.mock.calls.find(
      ([eventType]) => eventType === "focus"
    )?.[1];
    const visibilityListener = addDocumentListener.mock.calls.find(
      ([eventType]) => eventType === "visibilitychange"
    )?.[1];

    if (!focusListener || !visibilityListener) {
      throw new Error("The hook did not register its lifecycle listeners.");
    }

    await rendered.unmount();

    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindowListener).toHaveBeenCalledWith("focus", focusListener);
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      visibilityListener
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(5_000);
      response.resolve(createSnapshotResponse(refreshedSnapshot));
      await request;
    });

    expect(fetcher).toHaveBeenCalledOnce();
  });
});
