# GitHub Provider

Use GitHub for the **Building** card when you want the least extra setup.

## Public Repos

Use `mode: "public"` to show the latest public repo owned by `username`.
Forks and archived repos are skipped by default.

```ts
githubSource({
  username: "deveshsangwan",
  token: process.env.GITHUB_TOKEN,
  mode: "public",
  excludeRepos: ["old-demo", "deveshsangwan/test-repo"],
  includeForks: false,
  includeArchived: false
});
```

Public mode calls GitHub's owner repo listing and only considers public repos
owned by `username`. It does not include organization, member, or collaborator
repos.

## Allowlisted Repos

Use the default allowlist mode when you want to choose exactly which repos can
appear, or when you want to safely display a private repo with a public label.

```ts
githubSource({
  username: "deveshsangwan",
  token: process.env.GITHUB_TOKEN,
  repos: [
    "portfolio-presence",
    {
      name: "investment-sync",
      label: "Investment Sync"
    }
  ]
});
```

## Privacy

Public mode only considers public repos owned by `username`. Allowlist mode
only considers repos listed in `repos`. Private repos are skipped unless
`allowPrivate: true` is set in allowlist mode. If private repos are enabled,
provide a public `label` and optional `href` so private names do not leak.

## Recommended Cache

GitHub activity does not need to be fetched on every request. A snapshot TTL of
15 to 60 minutes is usually enough for a portfolio.
