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

## TTL behavior

The package owns the cache policy and passes it to `PresenceStore.set`:

- `cache.ttlSeconds` expires the regular snapshot cache. The default is 60 seconds.
- `cache.lastGoodTtlSeconds` optionally expires the last-good fallback snapshot.
  Omit it to keep fallback data indefinitely.
- `playedEventSource({ ttlSeconds })` optionally expires the last recorded game.
- A TTL of `0` means the corresponding key is not retained.
- TTLs must be finite, non-negative numbers.

The store adapter owns the backend-specific operation. For example, a Redis
adapter should translate a positive `ttlSeconds` into its client's expiry option
(such as `EX`) and should write without an expiry when the option is omitted.
The snapshot also contains an application-level `expiresAt` value, which prevents
stale reads from stores that cannot enforce physical TTLs.
