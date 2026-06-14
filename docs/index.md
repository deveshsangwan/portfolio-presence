# portfolio-presence

`portfolio-presence` creates small, privacy-filtered activity snapshots for
portfolio sites.

It is designed for cards like:

- **Building** from allowlisted GitHub repositories
- **Playing** from an iOS Shortcut that records game launches
- **Listening to** from Last.fm recent tracks

The package is intentionally not realtime. It is a cached "last known public
activity" layer that is safe to render on a personal website.

## Package Shape

- `portfolio-presence`: core API, sources, types, and storage interface
- `portfolio-presence/next`: Next.js App Router route helpers
- `portfolio-presence/react`: optional headless React hook

## Best First Step

Start with the [Quick Start](/quick-start), then read the provider guide for the
sources you want to enable.
