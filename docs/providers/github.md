# GitHub Provider

Use GitHub for the **Building** card when you want the least extra setup.

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

Only repos listed in `repos` are considered. Private repos are skipped unless
`allowPrivate: true` is set. If private repos are enabled, provide a public
`label` and optional `href` so private names do not leak.

## Recommended Cache

GitHub activity does not need to be fetched on every request. A snapshot TTL of
15 to 60 minutes is usually enough for a portfolio.
