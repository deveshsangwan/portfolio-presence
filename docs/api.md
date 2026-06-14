# API Reference

## Core

- `definePresence(config)`: creates a presence client.
- `memoryStore()`: local async key-value store.

## Sources

- `githubSource(options)`: creates a Building source from public or allowlisted GitHub repos.
- `lastFmSource(options)`: creates a Listening source from Last.fm recent tracks.
- `playedEventSource(options)`: creates a recordable Playing source.

## Next.js

- `createPresenceGetHandler(presence, options?)`: returns a public GET handler.
- `createPlayedIngestHandler(presence, options)`: returns a protected POST handler.

## React

- `usePresence(endpoint?, options?)`: fetches a presence snapshot from the browser.

## Main Types

- `PresenceSnapshot`
- `PresenceCard`
- `PresenceStore`
- `PresenceSource`
- `PlayedInput`
