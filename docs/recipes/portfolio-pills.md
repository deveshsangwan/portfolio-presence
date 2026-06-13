# Portfolio Pills

Render the cards with your own design system.

```tsx
export function PortfolioPresence({ cards }: { cards: PresenceCard[] }) {
  return (
    <div>
      {cards.map((card) => (
        <a key={card.kind} href={card.href}>
          {card.label}: {card.kind === "listening" && card.artist
            ? `${card.title} - ${card.artist}`
            : card.title}
        </a>
      ))}
    </div>
  );
}
```

Keep visual styling in your portfolio. The package should own the data contract,
not your personal UI.
