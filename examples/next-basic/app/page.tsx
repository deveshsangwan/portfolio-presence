import { PresenceClient } from "./presence-client";
import { presence } from "../lib/presence";

export default async function Page() {
  const snapshot = await presence.getSnapshot();

  return (
    <main>
      <h1>portfolio-presence</h1>
      <ul>
        {snapshot.cards.map((card) => (
          <li key={card.kind}>
            {card.label}: {card.title}
          </li>
        ))}
      </ul>
      <PresenceClient />
    </main>
  );
}
