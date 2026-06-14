# Next.js

The `/next` export provides App Router compatible route handlers.

```ts
import { createPresenceGetHandler } from "portfolio-presence/next";
import { presence } from "@/lib/presence";

export const GET = createPresenceGetHandler(presence);
```

```ts
import { createPlayedIngestHandler } from "portfolio-presence/next";
import { presence } from "@/lib/presence";

export const POST = createPlayedIngestHandler(presence, {
  secret: process.env.PRESENCE_INGEST_SECRET!
});
```

For server-rendered portfolio sections, import your shared `presence` object
directly in a server component and call `getSnapshot()`.
