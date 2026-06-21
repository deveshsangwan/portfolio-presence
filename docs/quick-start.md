# Quick Start

Install the package:

```sh
pnpm add portfolio-presence
```

Create a shared server-side presence module:

```ts
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
      repos: [{ name: "investment-sync", label: "Investment Sync" }]
    }),
    playing: playedEventSource({ store }),
    listening: lastFmSource({
      username: process.env.LASTFM_USERNAME!,
      apiKey: process.env.LASTFM_API_KEY!
    })
  }
});
```

Expose a public snapshot route:

```ts
import { createPresenceGetHandler } from "portfolio-presence/next";
import { presence } from "@/lib/presence";

export const GET = createPresenceGetHandler(presence);
```

Record played events with a private route:

```ts
import { createPlayedIngestHandler } from "portfolio-presence/next";
import { presence } from "@/lib/presence";

export const POST = createPlayedIngestHandler(presence, {
  secret: process.env.PRESENCE_INGEST_SECRET!
});
```

Render the snapshot however your portfolio wants:

```ts
const snapshot = await presence.getSnapshot();
```

`cache.ttlSeconds` is forwarded to the configured store. For Redis-backed
stores, make sure the store translates it to the client's expiry option. Add
`lastGoodTtlSeconds` when the last-good fallback should expire as well; omit it
to retain the fallback indefinitely.
