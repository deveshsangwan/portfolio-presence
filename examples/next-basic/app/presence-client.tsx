"use client";

import { usePresence } from "portfolio-presence/react";

export function PresenceClient() {
  const { snapshot, status } = usePresence("/api/presence");

  return (
    <p>
      Client status: {status}
      {snapshot ? ` (${snapshot.cards.length} cards)` : ""}
    </p>
  );
}
