# Last.fm Provider

Use Last.fm for the **Listening to** card.

```ts
lastFmSource({
  username: process.env.LASTFM_USERNAME!,
  apiKey: process.env.LASTFM_API_KEY!,
  blockedArtists: ["Private Artist"],
  blockedTracks: ["Private Track"]
});
```

If Last.fm marks a track as now playing, the label defaults to `Listening to`.
Otherwise it defaults to `Listened to`.

## Privacy

Use `blockedArtists` and `blockedTracks` for anything you never want rendered on
your public portfolio. The public snapshot only returns normalized fields such
as title, artist, album, image, URL, and timestamp.
