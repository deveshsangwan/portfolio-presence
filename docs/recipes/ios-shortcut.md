# iOS Shortcut

Create a Shortcut for each game:

1. Add a web request action.
2. Set method to `POST`.
3. Set URL to your `/api/presence/played` route.
4. Add `Authorization: Bearer <secret>`.
5. Send JSON with `title`, `platform`, optional `url`, and optional `occurredAt`.
6. Open the game as the final Shortcut action.

Example body:

```json
{
  "title": "MCOC",
  "platform": "ios",
  "url": "https://apps.apple.com/app/id1095691691"
}
```

If `occurredAt` is omitted, the server records the current time.
