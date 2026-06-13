# React

The `/react` export is a headless hook. It does not ship styled components.

```tsx
"use client";

import { usePresence } from "portfolio-presence/react";

export function PresencePills() {
  const { snapshot, status } = usePresence("/api/presence");

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

Use the hook when you want client-side refreshes. For most portfolio home pages,
server rendering is simpler.
