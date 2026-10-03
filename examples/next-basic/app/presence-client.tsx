"use client";

import type { PresenceSnapshot } from "portfolio-presence";
import { usePresence } from "portfolio-presence/react";

export function PresenceClient({
  initialSnapshot
}: {
  initialSnapshot: PresenceSnapshot;
}) {
  const { snapshot, status } = usePresence("/api/presence", {
    initialSnapshot
  });

  return (
    <p>
      Client status: {status}
      {snapshot ? ` (${snapshot.cards.length} cards)` : ""}
    </p>
  );
}
