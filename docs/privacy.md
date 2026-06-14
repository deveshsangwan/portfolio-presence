# Privacy

The package defaults to public-display safety.

- GitHub can read public owner repos or an explicit repo allowlist.
- Private GitHub repos are skipped unless explicitly enabled in allowlist mode.
- Private repo names should be mapped to public labels.
- Last.fm supports blocked artists and blocked tracks.
- Played-event ingestion should always use a secret.
- Public snapshots do not expose raw provider responses.

Treat the snapshot as a public API. Anything returned by `getSnapshot()` should
be safe to show on your portfolio and cache at the edge.
