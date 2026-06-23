import { describe, expect, it } from "vitest";
import {
  definePresence,
  githubSource,
  lastFmSource,
  memoryStore,
  playedEventSource,
  type BuildingPresenceCard,
  type FetchLike,
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
  const writes: Array<{ key: string; ttlSeconds: number | undefined }> = [];

  return {
    deletedKeys,
    writes,

    async delete(key) {
      deletedKeys.push(key);
    },

    async get() {
      return null;
    },

    async set(key, _value, options) {
      writes.push({ key, ttlSeconds: options?.ttlSeconds });
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

  it("forwards snapshot and last-good TTLs to the store", async () => {
    const store = recordingStore();
    const presence = definePresence({
      cache: {
        key: "snapshot",
        lastGoodKey: "snapshot:last-good",
        lastGoodTtlSeconds: 3600,
        store,
        ttlSeconds: 60
      }
    });

    await presence.getSnapshot();

    expect(store.writes).toEqual([
      { key: "snapshot", ttlSeconds: 60 },
      { key: "snapshot:last-good", ttlSeconds: 3600 }
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
      }
    });

    await presence.getSnapshot();

    expect(store.writes).toEqual([
      { key: "snapshot", ttlSeconds: 60 },
      { key: "snapshot:last-good", ttlSeconds: undefined }
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
      }
    });

    await presence.getSnapshot();

    expect(store.deletedKeys).toEqual(["snapshot", "snapshot:last-good"]);
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
