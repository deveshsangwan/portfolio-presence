# portfolio-presence

Privacy-first presence snapshots for portfolio sites.

Full documentation: https://deveshsangwan.github.io/portfolio-presence/

`portfolio-presence` turns a few low-maintenance activity sources into a small
public JSON snapshot you can render however you want. It is designed for
portfolio cards like:

- Building: latest selected GitHub repo
- Playing: latest game recorded by an iOS Shortcut
- Listening to: Last.fm recent track

It is not a realtime presence system. The intended shape is "last known public
activity, cached and safe to display."

## Install

```sh
pnpm add portfolio-presence
```

## Package Shape

The package is hybrid by design:

- `portfolio-presence`: framework-neutral core, sources, store interface
- `portfolio-presence/next`: Next.js App Router compatible route helpers
- `portfolio-presence/react`: optional headless client hook

There are no runtime dependencies. React is an optional peer dependency used
only by the `/react` export.

## Configure Presence

Create a shared server-side module:

```ts
// lib/presence.ts
import {
  definePresence,
  githubSource,
  lastFmSource,
  memoryStore,
  playedEventSource
} from "portfolio-presence";

const store = memoryStore();

export const presence = definePresence({
  cache: {
    store,
    ttlSeconds: 60
  },
  sources: {
    building: githubSource({
      username: "deveshsangwan",
      token: process.env.GITHUB_TOKEN,
      mode: "public",
      excludeRepos: ["old-demo", "test-repo"],
      includeForks: false,
      includeArchived: false
    }),
    playing: playedEventSource({
      store
    }),
    listening: lastFmSource({
      username: process.env.LASTFM_USERNAME!,
      apiKey: process.env.LASTFM_API_KEY!,
      blockedArtists: [],
      blockedTracks: []
    })
  },
  fallbacks: {
    building: {
      title: "Investment Sync",
      href: "https://github.com/deveshsangwan/investment-sync"
    },
    playing: {
      title: "MCOC",
      platform: "ios"
    }
  }
});
```

`cache.ttlSeconds` controls snapshot freshness and is passed to the configured
store as its physical TTL. `cache.lastGoodTtlSeconds` is optional: omit it to
keep the last-good fallback key indefinitely, or set it to expire that key too.
For the played-event key, pass `ttlSeconds` to `playedEventSource`. A zero TTL
means that key is not retained. TTLs must be finite, non-negative numbers.

When using Redis or another persistent store, its `set` implementation must
honor `PresenceStore`'s `ttlSeconds` option—for Redis, that means using the
client's expiry option (for example, `EX`).

`memoryStore()` is useful for local development, but it is not persistent across
serverless cold starts. For production, implement `PresenceStore` with Redis,
Upstash, Vercel KV, Postgres, or the storage your portfolio already uses.

## Next.js Routes

```ts
// app/api/presence/route.ts
import { createPresenceGetHandler } from "portfolio-presence/next";
import { presence } from "@/lib/presence";

export const GET = createPresenceGetHandler(presence);
```

```ts
// app/api/presence/played/route.ts
import { createPlayedIngestHandler } from "portfolio-presence/next";
import { presence } from "@/lib/presence";

export const POST = createPlayedIngestHandler(presence, {
  secret: process.env.PRESENCE_INGEST_SECRET!
});
```

## iOS Shortcut Payload

Send a POST request when you open a game:

```http
POST /api/presence/played
Authorization: Bearer <PRESENCE_INGEST_SECRET>
Content-Type: application/json
```

```json
{
  "title": "MCOC",
  "platform": "ios",
  "url": "https://apps.apple.com/app/id1095691691",
  "occurredAt": "2026-06-13T10:30:00.000Z"
}
```

## Rendering

Server-side rendering is the simplest option:

```ts
const snapshot = await presence.getSnapshot();
```

Client-side rendering is available through the headless hook:

```tsx
"use client";

import { usePresence } from "portfolio-presence/react";

export function PresencePills() {
  const { snapshot } = usePresence("/api/presence");

  return snapshot?.cards.map((card) => (
    <a key={card.kind} href={card.href}>
      {card.label}: {card.title}
    </a>
  ));
}
```

## Snapshot Shape

```ts
{
  generatedAt: string,
  cards: [
    {
      kind: "building",
      label: "Building",
      title: "Investment Sync",
      href: "https://github.com/...",
      source: "github",
      updatedAt: "2026-06-13T10:00:00.000Z",
      stale: false
    }
  ],
  sources: {
    building: { status: "fresh", source: "github" },
    playing: { status: "fallback", source: "manual" },
    listening: { status: "fresh", source: "lastfm" }
  }
}
```

## Privacy Defaults

- GitHub can use public owner repos or an explicit repo allowlist.
- Private GitHub repos are skipped unless `allowPrivate: true` is set in allowlist mode.
- Private repo names are not exposed by default.
- Last.fm supports blocked artists and blocked tracks.
- Played ingestion requires a secret in the Next.js helper.
- Public snapshots never include raw provider payloads.
- Provider failures use stale last-good data or fallbacks instead of breaking the page.

## V1 Scope

Included:

- GitHub source for recently building
- Last.fm source for recently listening
- Recordable played-event source for iOS Shortcuts
- Framework-neutral cache/store model
- Next.js App Router route helpers
- Optional React hook

Skipped for v1:

- WakaTime
- Steam, Xbox, PlayStation, Discord, Spotify, Apple Music
- OAuth flows
- Realtime updates
- Dashboard/admin UI
- Styled React components
- Multi-user SaaS behavior
