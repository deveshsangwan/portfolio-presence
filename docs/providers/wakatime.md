# WakaTime provider

Use WakaTime for the Building card when editor activity is a better signal than
repository pushes.

```ts
import { wakatimeSource } from "portfolio-presence";

wakatimeSource({
  apiKey: process.env.WAKATIME_API_KEY ?? "",
  label: "Working on",
  projects: [
    "portfolio-presence",
    {
      name: "private-client-platform",
      label: "Customer Platform",
      href: "https://example.com/products/platform"
    }
  ]
});
```

The source calls `GET /api/v1/users/current/projects` and selects the allowed
project with the newest valid `last_heartbeat_at`. It returns `null` when no
allowed project has valid activity.

## Public names and links

A string entry treats the project name as public and formats it for the card
title. Use an object with `label` when the WakaTime name should remain private.
The card uses the configured label and never copies WakaTime project metadata.

Configured links must use HTTP or HTTPS. The source drops other URL schemes.
For an aliased project, the link must not contain the raw WakaTime project name.
This comparison is case-insensitive.

## Authentication

The source sends the API key through WakaTime's documented HTTP Basic
authentication header. Store the key in a server-only environment variable.
Never use it in a Client Component, browser bundle, or `NEXT_PUBLIC_` variable.
Custom `apiBaseUrl` values must use HTTPS.

WakaTime documents the Projects endpoint and API-key authentication in its
[official API documentation](https://wakatime.com/developers). The source does
not call heartbeat or commit endpoints. It reads the project name and
`last_heartbeat_at`, then discards the rest of the response.

## Provider errors

Provider failures use stable `PresenceError` codes so snapshot recovery can use
stale data or a configured fallback:

- `wakatime_request_failed` for network and non-success HTTP responses
- `wakatime_api_error` for a provider error payload
- `wakatime_invalid_response` for malformed JSON or a missing project list

## Recommended cache

Project activity does not need a request on every page view. A snapshot TTL of
15 to 60 minutes is a reasonable starting point for a portfolio.
