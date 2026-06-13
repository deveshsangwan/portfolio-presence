import { describe, expect, it } from "vitest";
import {
  definePresence,
  githubSource,
  lastFmSource,
  memoryStore,
  playedEventSource,
  type BuildingPresenceCard,
  type FetchLike,
  type PresenceSource
} from "../src";
import { createPlayedIngestHandler } from "../src/next";

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
});

describe("githubSource", () => {
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
