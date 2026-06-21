# Concepts

## Snapshot

A snapshot is the public JSON object your portfolio renders. It contains ordered
cards and per-source state.

## Cards

Cards are normalized display objects. They do not expose raw provider payloads.

The v1 card kinds are:

- `building`
- `playing`
- `listening`

## Sources

Sources know how to fetch or record activity and return one normalized card.
The built-in v1 sources are GitHub, Last.fm, and played events.

## Store

The store is a tiny async key-value interface used for snapshot cache and played
event persistence. The package passes configured TTLs through this interface;
the application's store adapter applies the equivalent expiry in its backend.
Snapshot cache entries also carry an `expiresAt` timestamp so they stay fresh
even when a backend cannot enforce TTLs.

## Fallbacks And Stale Data

Fallbacks keep your page populated when a source is empty. Last-good stale data
keeps your page stable when a provider temporarily fails.
