# React

The `/react` export is a headless hook. It does not ship styled components.

```tsx
"use client";

import type { PresenceSnapshot } from "portfolio-presence";
import { usePresence } from "portfolio-presence/react";

export function PresencePills({
  initialSnapshot
}: {
  initialSnapshot: PresenceSnapshot;
}) {
  const { snapshot, status } = usePresence("/api/presence", {
    initialSnapshot,
    refreshIntervalMs: 60_000
  });

  if (status === "loading") {
    return null;
  }

  return snapshot?.cards.map((card) => (
    <a key={card.kind} href={card.href}>
      {card.label}: {card.title}
    </a>
  ));
}
```

Pass a server-rendered snapshot through `initialSnapshot` to keep the first client
render consistent with the page. The hook reports `success` immediately and skips
the mount request. Set `revalidateOnMount: true` when the client should check for
new data as soon as it mounts. Calls without `initialSnapshot` still fetch on
mount.

Use `refreshIntervalMs` for polling. The hook pauses that interval while the page
is hidden and refreshes when the page becomes visible or the window regains focus.
It also exposes `refresh()` for manual updates.
