import { describe, expect, it, vi } from "vitest";
import {
  definePresence,
  githubSource,
  lastFmSource,
  memoryStore,
  playedEventSource,
  type BuildingPresenceCard,
  type FetchLike,
  type ListeningPresenceCard,
  type PresenceCard,
  type PresenceSnapshot,
  type PresenceStore,
  type PresenceSource
} from "../src";
import { setStoreValue } from "../src/core/store";
import { createPlayedIngestHandler } from "../src/next";

function recordingStore(): PresenceStore & {
  deletedKeys: string[];
  writes: Array<{ key: string; ttlSeconds: number | undefined }>;
} {
  const deletedKeys: string[] = [];
  const values = new Map<string, unknown>();
  const writes: Array<{ key: string; ttlSeconds: number | undefined }> = [];

  return {
    deletedKeys,
    writes,

    async delete(key) {
      deletedKeys.push(key);
      values.delete(key);
    },

    async get<TValue>(key: string) {
      return values.has(key) ? (values.get(key) as TValue) : null;
    },

    async set(key, value, options) {
      writes.push({ key, ttlSeconds: options?.ttlSeconds });
      values.set(key, value);
    }
  };
}

const freshBuildingCard: BuildingPresenceCard = {
  kind: "building",
  label: "Building",
  source: "test",
  title: "Investment Sync"
};

const freshBuildingSource: PresenceSource<BuildingPresenceCard> = {
  kind: "building",
  source: "test",
  async getCard() {
    return freshBuildingCard;
  }
};

function scriptedSource<TCard extends PresenceCard>(
  kind: TCard["kind"],
  sourceName: string,
  outcomes: Array<Error | TCard | null>
): PresenceSource<TCard> {
  let outcomeIndex = 0;

  return {
    kind,
    source: sourceName,
    async getCard() {
      const outcome = outcomes[outcomeIndex];
      outcomeIndex += 1;

      if (outcome === undefined) {
        throw new Error("Scripted source has no remaining outcome.");
      }

      if (outcome instanceof Error) {
        throw outcome;
      }

      return outcome;
    }
  };
}

function listeningCard(title: string): ListeningPresenceCard {
  return {
    kind: "listening",
    label: "Listening to",
    source: "test",
    title
  };
}

function createBuildingSnapshot(
  card: BuildingPresenceCard,
  status: "fallback" | "fresh"
): PresenceSnapshot {
  return {
    cards: [card],
    generatedAt: "2026-06-13T10:00:00.000Z",
    sources: {
      building: {
        source: card.source,
        status
      },
      listening: { status: "disabled" },
      playing: { status: "disabled" }
    }
  };
}

describe("store TTL validation", () => {
  it.each([-1, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY])(
    "rejects invalid TTL %p before changing the store",
    async (ttlSeconds) => {
      const store = recordingStore();

      await expect(setStoreValue(store, "key", { value: true }, ttlSeconds)).rejects.toThrow(
        "ttlSeconds must be a finite number greater than or equal to 0."
      );
      expect(store.deletedKeys).toEqual([]);
      expect(store.writes).toEqual([]);
    }
  );
});

describe("definePresence", () => {
  it("returns cached snapshots within the cache ttl", async () => {
    let calls = 0;
    const source: PresenceSource<BuildingPresenceCard> = {
      kind: "building",
      source: "test",
      async getCard() {
        calls += 1;

        return {
          kind: "building",
          label: "Building",
          source: "test",
          title: `Project ${calls}`,
          updatedAt: "2026-06-13T10:00:00.000Z"
        };
      }
    };

    const presence = definePresence({
      cache: {
        store: memoryStore(),
        ttlSeconds: 60
      },
      sources: {
        building: source
      }
    });

    const first = await presence.getSnapshot({
      now: new Date("2026-06-13T10:00:00.000Z")
    });
    const second = await presence.getSnapshot({
      now: new Date("2026-06-13T10:00:30.000Z")
    });

    expect(calls).toBe(1);
    expect(first.cards[0]?.title).toBe("Project 1");
    expect(second.cards[0]?.title).toBe("Project 1");
  });

  it("uses the last good card as stale when a source starts failing", async () => {
    let shouldFail = false;
    const source: PresenceSource<BuildingPresenceCard> = {
      kind: "building",
      source: "test",
      async getCard() {
        if (shouldFail) {
          throw new Error("Provider down");
        }

        return {
          kind: "building",
          label: "Building",
          source: "test",
          title: "Investment Sync"
        };
      }
    };

    const store = memoryStore();
    const presence = definePresence({
      cache: {
        store,
        ttlSeconds: 0
      },
      sources: {
        building: source
      }
    });

    await presence.getSnapshot({
      now: new Date("2026-06-13T10:00:00.000Z")
    });

    shouldFail = true;
    const snapshot = await presence.getSnapshot({
      bypassCache: true,
      now: new Date("2026-06-13T10:01:00.000Z")
    });

    expect(snapshot.cards[0]).toMatchObject({
      kind: "building",
      stale: true,
      title: "Investment Sync"
    });
    expect(snapshot.sources.building.status).toBe("stale");
  });

  it("preserves a fresh card through an empty response and later failure", async () => {
    let outcome: "empty" | "error" | "fresh" = "fresh";
    const source: PresenceSource<BuildingPresenceCard> = {
      kind: "building",
      source: "test",
      async getCard() {
        if (outcome === "error") {
          throw new Error("Provider down");
        }

        if (outcome === "empty") {
          return null;
        }

        return {
          kind: "building",
          label: "Building",
          source: "test",
          title: "Investment Sync"
        };
      }
    };

    const presence = definePresence({
      cache: {
        store: memoryStore(),
        ttlSeconds: 60
      },
      sources: {
        building: source
      }
    });

    await presence.getSnapshot({
      now: new Date("2026-06-13T10:00:00.000Z")
    });

    outcome = "empty";
    const emptySnapshot = await presence.getSnapshot({
      bypassCache: true,
      now: new Date("2026-06-13T10:01:00.000Z")
    });

    expect(emptySnapshot.cards).toEqual([]);
    expect(emptySnapshot.sources.building.status).toBe("empty");

    outcome = "error";
    const cachedEmptySnapshot = await presence.getSnapshot({
      now: new Date("2026-06-13T10:01:30.000Z")
    });

    expect(cachedEmptySnapshot).toEqual(emptySnapshot);

    const recoveredSnapshot = await presence.getSnapshot({
      bypassCache: true,
      now: new Date("2026-06-13T10:02:00.000Z")
    });

    expect(recoveredSnapshot.cards[0]).toMatchObject({
      kind: "building",
      stale: true,
      title: "Investment Sync"
    });
    expect(recoveredSnapshot.sources.building.status).toBe("stale");
  });

  it("preserves last-good cards independently when another kind stays fresh", async () => {
    let buildingOutcome: "empty" | "error" | "fresh" = "fresh";
    let listeningShouldFail = false;
    let track = "First Track";
    const buildingSource: PresenceSource<BuildingPresenceCard> = {
      kind: "building",
      source: "test-building",
      async getCard() {
        if (buildingOutcome === "error") {
          throw new Error("Provider down");
        }

        if (buildingOutcome === "empty") {
          return null;
        }

        return {
          kind: "building",
          label: "Building",
          source: "test-building",
          title: "Investment Sync"
        };
      }
    };

    const listeningSource: PresenceSource<ListeningPresenceCard> = {
      kind: "listening",
      source: "test-listening",
      async getCard() {
        if (listeningShouldFail) {
          throw new Error("Provider down");
        }

        return {
          kind: "listening",
          label: "Listening to",
          source: "test-listening",
          title: track
        };
      }
    };

    const presence = definePresence({
      cache: {
        store: memoryStore(),
        ttlSeconds: 0
      },
      sources: {
        building: buildingSource,
        listening: listeningSource
      }
    });

    await presence.getSnapshot();

    buildingOutcome = "empty";
    track = "Second Track";
    await presence.getSnapshot({ bypassCache: true });

    buildingOutcome = "error";
    listeningShouldFail = true;
    const recoveredSnapshot = await presence.getSnapshot({ bypassCache: true });

    expect(recoveredSnapshot.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "building",
          stale: true,
          title: "Investment Sync"
        }),
        expect.objectContaining({
          kind: "listening",
          stale: true,
          title: "Second Track"
        })
      ])
    );
    expect(recoveredSnapshot.sources.building.status).toBe("stale");
    expect(recoveredSnapshot.sources.listening.status).toBe("stale");
  });

  it("expires last-good cards independently by kind", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-06-13T10:00:00.000Z"));

      const buildingSource = scriptedSource<BuildingPresenceCard>("building", "test", [
        freshBuildingCard,
        new Error("Provider down"),
        new Error("Provider down")
      ]);
      const listeningSource = scriptedSource<ListeningPresenceCard>("listening", "test", [
        listeningCard("First Track"),
        listeningCard("Second Track"),
        new Error("Provider down")
      ]);

      const presence = definePresence({
        cache: {
          lastGoodTtlSeconds: 60,
          store: memoryStore(),
          ttlSeconds: 0
        },
        sources: {
          building: buildingSource,
          listening: listeningSource
        }
      });

      await presence.getSnapshot();

      vi.advanceTimersByTime(30_000);
      const mixedSnapshot = await presence.getSnapshot({ bypassCache: true });

      expect(mixedSnapshot.sources.building.status).toBe("stale");
      expect(mixedSnapshot.sources.listening.status).toBe("fresh");

      vi.advanceTimersByTime(31_000);
      const expiredSnapshot = await presence.getSnapshot({ bypassCache: true });

      expect(expiredSnapshot.cards.find((card) => card.kind === "building")).toBeUndefined();
      expect(expiredSnapshot.cards.find((card) => card.kind === "listening")).toMatchObject({
        stale: true,
        title: "Second Track"
      });
      expect(expiredSnapshot.sources.building.status).toBe("error");
      expect(expiredSnapshot.sources.listening.status).toBe("stale");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves concurrent fresh updates to different kinds", async () => {
    const store = memoryStore();
    let releaseSources = () => {};
    const sourceGate = new Promise<void>((resolve) => {
      releaseSources = resolve;
    });
    const buildingSource: PresenceSource<BuildingPresenceCard> = {
      kind: "building",
      source: "test",
      async getCard() {
        await sourceGate;

        return freshBuildingCard;
      }
    };
    const listeningSource: PresenceSource<ListeningPresenceCard> = {
      kind: "listening",
      source: "test",
      async getCard() {
        await sourceGate;

        return listeningCard("Second Track");
      }
    };

    const buildingPresence = definePresence({
      cache: {
        store,
        ttlSeconds: 0
      },
      sources: {
        building: buildingSource
      }
    });

    const listeningPresence = definePresence({
      cache: {
        store,
        ttlSeconds: 0
      },
      sources: {
        listening: listeningSource
      }
    });

    const buildingRefresh = buildingPresence.getSnapshot({ bypassCache: true });
    const listeningRefresh = listeningPresence.getSnapshot({ bypassCache: true });

    releaseSources();
    await Promise.all([buildingRefresh, listeningRefresh]);

    const failingPresence = definePresence({
      cache: {
        store,
        ttlSeconds: 0
      },
      sources: {
        building: scriptedSource<BuildingPresenceCard>("building", "test", [
          new Error("Provider down")
        ]),
        listening: scriptedSource<ListeningPresenceCard>("listening", "test", [
          new Error("Provider down")
        ])
      }
    });

    const recoveredSnapshot = await failingPresence.getSnapshot({ bypassCache: true });

    expect(recoveredSnapshot.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "building",
          stale: true,
          title: "Investment Sync"
        }),
        expect.objectContaining({
          kind: "listening",
          stale: true,
          title: "Second Track"
        })
      ])
    );
    expect(recoveredSnapshot.sources.building.status).toBe("stale");
    expect(recoveredSnapshot.sources.listening.status).toBe("stale");
  });

  it("keeps a fallback as fallback when its source later fails", async () => {
    let calls = 0;
    let shouldFail = false;
    const source: PresenceSource<BuildingPresenceCard> = {
      kind: "building",
      source: "test",
      async getCard() {
        calls += 1;

        if (shouldFail) {
          throw new Error("Provider down");
        }

        return null;
      }
    };

    const presence = definePresence({
      cache: {
        store: memoryStore(),
        ttlSeconds: 60
      },
      fallbacks: {
        building: {
          title: "Manual Project"
        }
      },
      sources: {
        building: source
      }
    });

    const fallbackSnapshot = await presence.getSnapshot({
      now: new Date("2026-06-13T10:00:00.000Z")
    });

    expect(fallbackSnapshot.cards[0]).toMatchObject({
      kind: "building",
      source: "manual",
      title: "Manual Project"
    });
    expect(fallbackSnapshot.cards[0]).not.toHaveProperty("stale");
    expect(fallbackSnapshot.sources.building.status).toBe("fallback");

    shouldFail = true;
    const cachedFallbackSnapshot = await presence.getSnapshot({
      now: new Date("2026-06-13T10:00:30.000Z")
    });

    expect(cachedFallbackSnapshot).toEqual(fallbackSnapshot);
    expect(calls).toBe(1);

    const failedSnapshot = await presence.getSnapshot({
      bypassCache: true,
      now: new Date("2026-06-13T10:01:00.000Z")
    });

    expect(failedSnapshot.cards[0]).toMatchObject({
      kind: "building",
      source: "manual",
      title: "Manual Project"
    });
    expect(failedSnapshot.cards[0]).not.toHaveProperty("stale");
    expect(failedSnapshot.sources.building.status).toBe("fallback");
  });

  it("preserves a fresh card through a fallback response and later failure", async () => {
    const source = scriptedSource<BuildingPresenceCard>("building", "test", [
      freshBuildingCard,
      null,
      new Error("Provider down")
    ]);
    const presence = definePresence({
      cache: {
        store: memoryStore(),
        ttlSeconds: 0
      },
      fallbacks: {
        building: {
          title: "Manual Project"
        }
      },
      sources: {
        building: source
      }
    });

    const freshSnapshot = await presence.getSnapshot();
    const fallbackSnapshot = await presence.getSnapshot({ bypassCache: true });
    const recoveredSnapshot = await presence.getSnapshot({ bypassCache: true });

    expect(freshSnapshot.sources.building.status).toBe("fresh");
    expect(fallbackSnapshot.cards[0]).toMatchObject({
      source: "manual",
      title: "Manual Project"
    });
    expect(fallbackSnapshot.sources.building.status).toBe("fallback");
    expect(recoveredSnapshot.cards[0]).toMatchObject({
      source: "test",
      stale: true,
      title: "Investment Sync"
    });
    expect(recoveredSnapshot.sources.building.status).toBe("stale");
  });

  it("preserves a fresh card while its source is disabled", async () => {
    const store = memoryStore();
    const cache = {
      store,
      ttlSeconds: 0
    };

    const activePresence = definePresence({
      cache,
      sources: {
        building: freshBuildingSource
      }
    });

    await activePresence.getSnapshot();

    const disabledPresence = definePresence({ cache });
    const disabledSnapshot = await disabledPresence.getSnapshot({ bypassCache: true });

    expect(disabledSnapshot.cards).toEqual([]);
    expect(disabledSnapshot.sources.building.status).toBe("disabled");

    const failingPresence = definePresence({
      cache,
      sources: {
        building: scriptedSource<BuildingPresenceCard>("building", "test", [
          new Error("Provider down")
        ])
      }
    });

    const recoveredSnapshot = await failingPresence.getSnapshot({ bypassCache: true });

    expect(recoveredSnapshot.cards[0]).toMatchObject({
      source: "test",
      stale: true,
      title: "Investment Sync"
    });
    expect(recoveredSnapshot.sources.building.status).toBe("stale");
  });

  it("ignores non-fresh cards already present in recovery storage", async () => {
    const store = memoryStore();

    await store.set(
      "last-good",
      createBuildingSnapshot(
        {
          kind: "building",
          label: "Building",
          source: "manual",
          title: "Legacy Fallback"
        },
        "fallback"
      )
    );

    const presence = definePresence({
      cache: {
        lastGoodKey: "last-good",
        store,
        ttlSeconds: 0
      },
      sources: {
        building: {
          kind: "building",
          source: "test",
          async getCard() {
            throw new Error("Provider down");
          }
        }
      }
    });

    const snapshot = await presence.getSnapshot();

    expect(snapshot.cards).toEqual([]);
    expect(snapshot.sources.building.status).toBe("error");
  });

  it("keeps the original expiry of legacy recovery during failed refreshes", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-06-13T10:00:00.000Z"));

      const store = memoryStore();
      const legacySnapshot = createBuildingSnapshot(freshBuildingCard, "fresh");

      await store.set("last-good", legacySnapshot, { ttlSeconds: 60 });

      const presence = definePresence({
        cache: {
          lastGoodKey: "last-good",
          lastGoodTtlSeconds: 60,
          store,
          ttlSeconds: 0
        },
        sources: {
          building: scriptedSource<BuildingPresenceCard>("building", "test", [
            new Error("Provider down"),
            new Error("Provider down")
          ])
        }
      });

      vi.advanceTimersByTime(59_000);
      const beforeExpiry = await presence.getSnapshot({ bypassCache: true });

      expect(beforeExpiry.sources.building.status).toBe("stale");

      vi.advanceTimersByTime(1_000);
      const afterExpiry = await presence.getSnapshot({ bypassCache: true });

      expect(afterExpiry.cards).toEqual([]);
      expect(afterExpiry.sources.building.status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a delayed legacy read overwrite a newer fresh card", async () => {
    const storage = memoryStore();
    const legacySnapshot = createBuildingSnapshot(freshBuildingCard, "fresh");
    let releaseLegacyRead = () => {};
    let notifyLegacyRead = () => {};
    const legacyReadStarted = new Promise<void>((resolve) => {
      notifyLegacyRead = resolve;
    });
    const legacyReadGate = new Promise<void>((resolve) => {
      releaseLegacyRead = resolve;
    });
    let hasDelayedLegacyRead = false;
    const store: PresenceStore = {
      delete: storage.delete,
      set: storage.set,
      async get<TValue>(key: string) {
        const value = await storage.get<TValue>(key);

        if (key === "last-good" && !hasDelayedLegacyRead) {
          hasDelayedLegacyRead = true;
          notifyLegacyRead();
          await legacyReadGate;
        }

        return value;
      }
    };

    await storage.set("last-good", legacySnapshot);

    const cache = { lastGoodKey: "last-good", store, ttlSeconds: 0 };
    const failingPresence = definePresence({
      cache,
      sources: {
        building: scriptedSource<BuildingPresenceCard>("building", "test", [
          new Error("Provider down")
        ])
      }
    });
    const freshPresence = definePresence({
      cache,
      sources: {
        building: scriptedSource<BuildingPresenceCard>("building", "test", [
          { ...freshBuildingCard, title: "Newer Project" }
        ])
      }
    });

    const failedRefresh = failingPresence.getSnapshot({ bypassCache: true });
    await legacyReadStarted;
    await freshPresence.getSnapshot({ bypassCache: true });
    releaseLegacyRead();
    await failedRefresh;

    await expect(storage.get("last-good:building")).resolves.toMatchObject({
      title: "Newer Project"
    });
  });

  it("does not persist legacy recovery during an empty refresh", async () => {
    const store = recordingStore();

    await store.set("last-good", createBuildingSnapshot(freshBuildingCard, "fresh"));
    store.writes.length = 0;

    const presence = definePresence({
      cache: {
        lastGoodKey: "last-good",
        store,
        ttlSeconds: 0
      },
      sources: {
        building: scriptedSource<BuildingPresenceCard>("building", "test", [null])
      }
    });

    const snapshot = await presence.getSnapshot({ bypassCache: true });

    expect(snapshot.sources.building.status).toBe("empty");
    expect(store.writes).toEqual([]);
    expect(store.deletedKeys).not.toContain("last-good");
  });

  it("reads fresh cards from legacy aggregate recovery storage", async () => {
    const store = memoryStore();

    await store.set("last-good", createBuildingSnapshot(freshBuildingCard, "fresh"));

    const presence = definePresence({
      cache: {
        lastGoodKey: "last-good",
        store,
        ttlSeconds: 0
      },
      sources: {
        building: scriptedSource<BuildingPresenceCard>("building", "test", [
          new Error("Provider down")
        ])
      }
    });

    const snapshot = await presence.getSnapshot({ bypassCache: true });

    expect(snapshot.cards[0]).toMatchObject({
      stale: true,
      title: "Investment Sync"
    });
    await expect(store.get("last-good")).resolves.toEqual(
      createBuildingSnapshot(freshBuildingCard, "fresh")
    );
    await expect(store.get("last-good:building")).resolves.toBeNull();
  });

  it("fills missing per-kind recovery from legacy aggregate storage", async () => {
    const store = memoryStore();
    const legacyListeningCard = listeningCard("Second Track");

    await store.set("last-good:building", freshBuildingCard);
    await store.set<PresenceSnapshot>("last-good", {
      cards: [legacyListeningCard],
      generatedAt: "2026-06-13T10:00:00.000Z",
      sources: {
        building: { status: "disabled" },
        listening: {
          source: "test",
          status: "fresh"
        },
        playing: { status: "disabled" }
      }
    });

    const presence = definePresence({
      cache: {
        lastGoodKey: "last-good",
        store,
        ttlSeconds: 0
      },
      sources: {
        building: scriptedSource<BuildingPresenceCard>("building", "test", [
          new Error("Provider down")
        ]),
        listening: scriptedSource<ListeningPresenceCard>("listening", "test", [
          new Error("Provider down")
        ])
      }
    });

    const snapshot = await presence.getSnapshot({ bypassCache: true });

    expect(snapshot.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "building", title: "Investment Sync" }),
        expect.objectContaining({ kind: "listening", title: "Second Track" })
      ])
    );
    await expect(store.get("last-good")).resolves.toMatchObject({
      cards: [legacyListeningCard]
    });
    await expect(store.get("last-good:building")).resolves.toMatchObject({
      title: "Investment Sync"
    });
    await expect(store.get("last-good:listening")).resolves.toBeNull();
  });

  it("clears existing recovery data when the last-good ttl is zero", async () => {
    const store = memoryStore();
    const cachedSnapshot = createBuildingSnapshot(freshBuildingCard, "fresh");

    await store.set("snapshot", {
      expiresAt: "2026-06-13T11:00:00.000Z",
      snapshot: cachedSnapshot
    });
    await store.set("last-good", createBuildingSnapshot(freshBuildingCard, "fresh"));
    await store.set("last-good:building", freshBuildingCard);
    await store.set("last-good:listening", listeningCard("Second Track"));
    await store.set("last-good:playing", {
      kind: "playing",
      label: "Playing",
      source: "test",
      title: "MCOC"
    });

    const presence = definePresence({
      cache: {
        key: "snapshot",
        lastGoodKey: "last-good",
        lastGoodTtlSeconds: 0,
        store,
        ttlSeconds: 60
      },
      sources: {
        building: scriptedSource<BuildingPresenceCard>("building", "test", [
          new Error("Provider down")
        ])
      }
    });

    const snapshot = await presence.getSnapshot({
      now: new Date("2026-06-13T10:30:00.000Z")
    });

    expect(snapshot).toEqual(cachedSnapshot);

    for (const key of [
      "last-good",
      "last-good:building",
      "last-good:listening",
      "last-good:playing"
    ]) {
      await expect(store.get(key)).resolves.toBeNull();
    }
  });

  it("does not renew a positive last-good ttl during repeated failures", async () => {
    let shouldFail = false;
    const source: PresenceSource<BuildingPresenceCard> = {
      kind: "building",
      source: "test",
      async getCard() {
        if (shouldFail) {
          throw new Error("Provider down");
        }

        return {
          kind: "building",
          label: "Building",
          source: "test",
          title: "Investment Sync"
        };
      }
    };

    const store = recordingStore();
    const presence = definePresence({
      cache: {
        key: "snapshot",
        lastGoodKey: "last-good",
        lastGoodTtlSeconds: 3600,
        store,
        ttlSeconds: 60
      },
      sources: {
        building: source
      }
    });

    await presence.getSnapshot();

    shouldFail = true;
    const firstFailure = await presence.getSnapshot({ bypassCache: true });
    const secondFailure = await presence.getSnapshot({ bypassCache: true });

    expect(firstFailure.sources.building.status).toBe("stale");
    expect(secondFailure.sources.building.status).toBe("stale");
    expect(store.writes.filter(({ key }) => key === "last-good:building")).toEqual([
      { key: "last-good:building", ttlSeconds: 3600 }
    ]);
    expect(store.writes.filter(({ key }) => key === "snapshot")).toHaveLength(3);
  });

  it("forwards snapshot and last-good TTLs to the store", async () => {
    const store = recordingStore();
    const presence = definePresence({
      cache: {
        key: "snapshot",
        lastGoodKey: "snapshot:last-good",
        lastGoodTtlSeconds: 3600,
        store,
        ttlSeconds: 60
      },
      sources: {
        building: freshBuildingSource
      }
    });

    await presence.getSnapshot();

    expect(store.writes).toEqual([
      { key: "snapshot", ttlSeconds: 60 },
      { key: "snapshot:last-good:building", ttlSeconds: 3600 }
    ]);
  });

  it("keeps last-good snapshots persistent when no TTL is configured", async () => {
    const store = recordingStore();
    const presence = definePresence({
      cache: {
        key: "snapshot",
        lastGoodKey: "snapshot:last-good",
        store,
        ttlSeconds: 60
      },
      sources: {
        building: freshBuildingSource
      }
    });

    await presence.getSnapshot();

    expect(store.writes).toEqual([
      { key: "snapshot", ttlSeconds: 60 },
      { key: "snapshot:last-good:building", ttlSeconds: undefined }
    ]);
  });

  it("does not retain entries configured with a zero TTL", async () => {
    const store = recordingStore();
    const presence = definePresence({
      cache: {
        key: "snapshot",
        lastGoodKey: "snapshot:last-good",
        lastGoodTtlSeconds: 0,
        store,
        ttlSeconds: 0
      },
      sources: {
        building: freshBuildingSource
      }
    });

    await presence.getSnapshot();

    expect([...store.deletedKeys].sort()).toEqual([
      "snapshot",
      "snapshot:last-good",
      "snapshot:last-good:building",
      "snapshot:last-good:listening",
      "snapshot:last-good:playing"
    ]);
    expect(store.writes).toEqual([]);
  });

  it("rejects invalid cache TTLs before writing a snapshot", () => {
    expect(() =>
      definePresence({
        cache: { ttlSeconds: Number.POSITIVE_INFINITY }
      })
    ).toThrow("ttlSeconds must be a finite number greater than or equal to 0.");

    expect(() =>
      definePresence({
        cache: { lastGoodTtlSeconds: Number.NaN }
      })
    ).toThrow("ttlSeconds must be a finite number greater than or equal to 0.");
  });

  it.each([
    "last-good",
    "last-good:building",
    "last-good:playing",
    "last-good:listening"
  ])("rejects the snapshot cache key collision %s", (key) => {
    expect(() =>
      definePresence({
        cache: {
          key,
          lastGoodKey: "last-good"
        }
      })
    ).toThrow("Snapshot cache key must not overlap last-good recovery keys.");
  });
});

describe("played event ingestion", () => {
  it("requires a secret and records valid game events", async () => {
    const store = memoryStore();
    const presence = definePresence({
      sources: {
        playing: playedEventSource({ store })
      }
    });
    const handler = createPlayedIngestHandler(presence, {
      secret: "super-secret"
    });

    const unauthorized = await handler(
      new Request("https://example.test/api/presence/played", {
        body: JSON.stringify({ title: "MCOC" }),
        method: "POST"
      })
    );

    expect(unauthorized.status).toBe(401);

    const authorized = await handler(
      new Request("https://example.test/api/presence/played", {
        body: JSON.stringify({
          occurredAt: "2026-06-13T10:00:00.000Z",
          platform: "ios",
          title: "MCOC",
          url: "https://apps.apple.com/app/id1095691691"
        }),
        headers: {
          authorization: "Bearer super-secret"
        },
        method: "POST"
      })
    );

    expect(authorized.status).toBe(201);

    const snapshot = await presence.getSnapshot({ bypassCache: true });
    expect(snapshot.cards[0]).toMatchObject({
      href: "https://apps.apple.com/app/id1095691691",
      kind: "playing",
      platform: "ios",
      title: "MCOC"
    });
  });

  it("forwards a played-event TTL to the store", async () => {
    const store = recordingStore();
    const source = playedEventSource({ store, ttlSeconds: 300 });

    await source.record(
      { title: "MCOC" },
      {
        fetch,
        now: new Date("2026-06-13T10:00:00.000Z")
      }
    );

    expect(store.writes).toEqual([
      { key: "portfolio-presence:playing:last", ttlSeconds: 300 }
    ]);
  });

  it("does not retain a played event configured with a zero TTL", async () => {
    const store = recordingStore();
    const source = playedEventSource({ store, ttlSeconds: 0 });

    await source.record(
      { title: "MCOC" },
      {
        fetch,
        now: new Date("2026-06-13T10:00:00.000Z")
      }
    );

    expect(store.deletedKeys).toEqual(["portfolio-presence:playing:last"]);
    expect(store.writes).toEqual([]);
  });
});

describe("githubSource", () => {
  it("throws a PresenceError when allowlist repos are missing at runtime", () => {
    let error: unknown;

    try {
      githubSource({
        mode: "allowlist",
        username: "devesh"
      } as Parameters<typeof githubSource>[0]);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "github_repos_required",
      message: "GitHub source requires at least one allowlisted repo.",
      status: 400
    });
  });

  it("chooses the latest public allowlisted repo and avoids private repo names by default", async () => {
    const fetchMock: FetchLike = async (input) => {
      const url = String(input);

      if (url.endsWith("/repos/devesh/private-work")) {
        return Response.json({
          name: "private-work",
          private: true,
          pushed_at: "2026-06-13T12:00:00.000Z"
        });
      }

      return Response.json({
        description: "A useful app",
        full_name: "devesh/investment-sync",
        html_url: "https://github.com/devesh/investment-sync",
        name: "investment-sync",
        private: false,
        pushed_at: "2026-06-13T10:00:00.000Z"
      });
    };

    const source = githubSource({
      fetch: fetchMock,
      repos: ["investment-sync", "private-work"],
      username: "devesh"
    });

    const card = await source.getCard({
      fetch: fetchMock,
      now: new Date("2026-06-13T12:30:00.000Z")
    });

    expect(card).toMatchObject({
      href: "https://github.com/devesh/investment-sync",
      repo: "devesh/investment-sync",
      title: "Investment Sync"
    });
  });

  it("chooses the latest public repo owned by the user in public mode", async () => {
    const fetchMock: FetchLike = async (input) => {
      expect(String(input)).toBe(
        "https://api.github.com/users/devesh/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=1"
      );

      return Response.json([
        {
          description: "Presence snapshots",
          full_name: "devesh/portfolio-presence",
          html_url: "https://github.com/devesh/portfolio-presence",
          name: "portfolio-presence",
          private: false,
          pushed_at: "2026-06-13T12:00:00.000Z"
        }
      ]);
    };

    const source = githubSource({
      fetch: fetchMock,
      mode: "public",
      username: "devesh"
    });

    const card = await source.getCard({
      fetch: fetchMock,
      now: new Date("2026-06-13T12:30:00.000Z")
    });

    expect(card).toMatchObject({
      description: "Presence snapshots",
      href: "https://github.com/devesh/portfolio-presence",
      repo: "devesh/portfolio-presence",
      title: "Portfolio Presence",
      updatedAt: "2026-06-13T12:00:00.000Z"
    });
  });

  it("excludes public repos by short name and full name case-insensitively", async () => {
    const fetchMock: FetchLike = async () =>
      Response.json([
        {
          full_name: "devesh/old-demo",
          html_url: "https://github.com/devesh/old-demo",
          name: "old-demo",
          private: false,
          pushed_at: "2026-06-13T12:00:00.000Z"
        },
        {
          full_name: "devesh/test-repo",
          html_url: "https://github.com/devesh/test-repo",
          name: "test-repo",
          private: false,
          pushed_at: "2026-06-13T11:00:00.000Z"
        },
        {
          full_name: "devesh/investment-sync",
          html_url: "https://github.com/devesh/investment-sync",
          name: "investment-sync",
          private: false,
          pushed_at: "2026-06-13T10:00:00.000Z"
        }
      ]);

    const source = githubSource({
      excludeRepos: ["OLD-DEMO", "Devesh/Test-Repo"],
      fetch: fetchMock,
      mode: "public",
      username: "devesh"
    });

    const card = await source.getCard({
      fetch: fetchMock,
      now: new Date("2026-06-13T12:30:00.000Z")
    });

    expect(card).toMatchObject({
      repo: "devesh/investment-sync",
      title: "Investment Sync"
    });
  });

  it("filters forks and archived repos by default in public mode", async () => {
    const fetchMock: FetchLike = async () =>
      Response.json([
        {
          fork: true,
          full_name: "devesh/forked-project",
          name: "forked-project",
          private: false,
          pushed_at: "2026-06-13T12:00:00.000Z"
        },
        {
          archived: true,
          full_name: "devesh/archived-project",
          name: "archived-project",
          private: false,
          pushed_at: "2026-06-13T11:00:00.000Z"
        },
        {
          full_name: "devesh/current-project",
          name: "current-project",
          private: false,
          pushed_at: "2026-06-13T10:00:00.000Z"
        }
      ]);

    const source = githubSource({
      fetch: fetchMock,
      mode: "public",
      username: "devesh"
    });

    const card = await source.getCard({
      fetch: fetchMock,
      now: new Date("2026-06-13T12:30:00.000Z")
    });

    expect(card).toMatchObject({
      repo: "devesh/current-project",
      title: "Current Project"
    });
  });

  it("can include forks and archived repos in public mode", async () => {
    const fetchMock: FetchLike = async () =>
      Response.json([
        {
          archived: true,
          fork: true,
          full_name: "devesh/old-fork",
          html_url: "https://github.com/devesh/old-fork",
          name: "old-fork",
          private: false,
          pushed_at: "2026-06-13T12:00:00.000Z"
        },
        {
          full_name: "devesh/current-project",
          name: "current-project",
          private: false,
          pushed_at: "2026-06-13T10:00:00.000Z"
        }
      ]);

    const source = githubSource({
      fetch: fetchMock,
      includeArchived: true,
      includeForks: true,
      mode: "public",
      username: "devesh"
    });

    const card = await source.getCard({
      fetch: fetchMock,
      now: new Date("2026-06-13T12:30:00.000Z")
    });

    expect(card).toMatchObject({
      href: "https://github.com/devesh/old-fork",
      repo: "devesh/old-fork",
      title: "Old Fork"
    });
  });

  it("paginates public repos until it finds a visible repo", async () => {
    const pages: string[] = [];
    const fetchMock: FetchLike = async (input) => {
      const url = String(input);
      pages.push(url);

      if (url.endsWith("page=1")) {
        return Response.json(
          [
            {
              fork: true,
              full_name: "devesh/forked-project",
              name: "forked-project",
              private: false,
              pushed_at: "2026-06-13T12:00:00.000Z"
            }
          ],
          {
            headers: {
              Link: '<https://api.github.com/users/devesh/repos?page=2>; rel="next"'
            }
          }
        );
      }

      return Response.json([
        {
          full_name: "devesh/next-page-project",
          html_url: "https://github.com/devesh/next-page-project",
          name: "next-page-project",
          private: false,
          pushed_at: "2026-06-13T10:00:00.000Z"
        }
      ]);
    };

    const source = githubSource({
      fetch: fetchMock,
      mode: "public",
      username: "devesh"
    });

    const card = await source.getCard({
      fetch: fetchMock,
      now: new Date("2026-06-13T12:30:00.000Z")
    });

    expect(pages).toEqual([
      "https://api.github.com/users/devesh/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=1",
      "https://api.github.com/users/devesh/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=2"
    ]);
    expect(card).toMatchObject({
      repo: "devesh/next-page-project",
      title: "Next Page Project"
    });
  });
});

describe("lastFmSource", () => {
  it("normalizes the first allowed recent track", async () => {
    const fetchMock: FetchLike = async () =>
      Response.json({
        recenttracks: {
          track: [
            {
              artist: { "#text": "Blocked Artist" },
              name: "Hidden Song"
            },
            {
              "@attr": { nowplaying: "true" },
              album: { "#text": "Album" },
              artist: { "#text": "Sidhu Moose Wala" },
              image: [
                { "#text": "", size: "small" },
                { "#text": "https://example.test/cover.jpg", size: "large" }
              ],
              name: "PBX 1",
              url: "https://last.fm/music/example"
            }
          ]
        }
      });

    const source = lastFmSource({
      apiKey: "key",
      blockedArtists: ["Blocked Artist"],
      fetch: fetchMock,
      username: "devesh"
    });

    const card = await source.getCard({
      fetch: fetchMock,
      now: new Date("2026-06-13T10:00:00.000Z")
    });

    expect(card).toMatchObject({
      artist: "Sidhu Moose Wala",
      image: "https://example.test/cover.jpg",
      isNowPlaying: true,
      label: "Listening to",
      title: "PBX 1",
      updatedAt: "2026-06-13T10:00:00.000Z"
    });
  });
});
