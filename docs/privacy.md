# Privacy

The package defaults to public-display safety.

- GitHub can read public owner repos or an explicit repo allowlist.
- Private GitHub repos are skipped unless explicitly enabled in allowlist mode.
- Private repo names should be mapped to public labels.
- WakaTime only considers projects in its explicit allowlist.
- A string WakaTime project entry publishes that project name as a formatted
  title.
- Private WakaTime project names should use a public `label` and optional
  HTTP(S) `href`.
- WakaTime API keys belong in server-only environment variables, never browser
  bundles.
- Last.fm supports blocked artists and blocked tracks.
- Played-event ingestion should always use a secret.
- Public snapshots do not expose raw provider responses.

Treat the snapshot as a public API. Anything returned by `getSnapshot()` should
be safe to show on your portfolio and cache at the edge.
