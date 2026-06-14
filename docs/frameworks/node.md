# Node

The core package is framework-neutral.

```ts
import { definePresence, memoryStore } from "portfolio-presence";

const presence = definePresence({
  cache: {
    store: memoryStore(),
    ttlSeconds: 60
  },
  sources: {}
});

const snapshot = await presence.getSnapshot();
```

Any server framework can expose `snapshot` as JSON. If your runtime does not
provide `fetch`, pass a compatible implementation in `definePresence`.
