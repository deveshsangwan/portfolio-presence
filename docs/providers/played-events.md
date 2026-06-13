# Played Events

Played events power the **Playing** card. The v1 flow is designed for an iOS
Shortcut that POSTs when you open a game.

```ts
playedEventSource({
  store
});
```

The Next.js helper protects the route with a bearer token:

```ts
export const POST = createPlayedIngestHandler(presence, {
  secret: process.env.PRESENCE_INGEST_SECRET!
});
```

Payload:

```json
{
  "title": "MCOC",
  "platform": "ios",
  "url": "https://apps.apple.com/app/id1095691691",
  "occurredAt": "2026-06-13T10:30:00.000Z"
}
```

The model already leaves room for future sources such as PC or console events
without adding those integrations in v1.
