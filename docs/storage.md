# Storage

`memoryStore()` is included for local development and simple demos.

It is not production-safe for serverless deployments because data can disappear
on cold starts. Use persistent storage for the played-event source and for
last-good snapshot recovery.

The store contract is intentionally small:

```ts
interface PresenceStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Good production options include Redis, Upstash, Vercel KV, Postgres, or any
storage you already run for your portfolio.
