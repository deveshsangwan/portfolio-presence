import type { PresenceStore } from "./types";

interface MemoryStoreEntry {
  expiresAt?: number;
  value: unknown;
}

export interface MemoryPresenceStore extends PresenceStore {
  clear: () => Promise<void>;
}

/**
 * Persists a value while preserving the package-wide TTL semantics.
 * A zero TTL means that the value must not be retained. This avoids sending an
 * invalid zero-second expiry to stores such as Redis, while also clearing any
 * value left by an earlier write.
 */
export async function setStoreValue<TValue>(
  store: PresenceStore,
  key: string,
  value: TValue,
  ttlSeconds: number | undefined
) {
  if (ttlSeconds === 0) {
    await store.delete(key);
    return;
  }

  await store.set(key, value, ttlSeconds === undefined ? undefined : { ttlSeconds });
}

export function memoryStore(): MemoryPresenceStore {
  const entries = new Map<string, MemoryStoreEntry>();

  return {
    async clear() {
      entries.clear();
    },

    async delete(key) {
      entries.delete(key);
    },

    async get<TValue>(key: string) {
      const entry = entries.get(key);

      if (!entry) {
        return null;
      }

      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }

      return entry.value as TValue;
    },

    async set<TValue>(
      key: string,
      value: TValue,
      options?: { ttlSeconds?: number }
    ) {
      const entry: MemoryStoreEntry = { value };

      if (options?.ttlSeconds !== undefined) {
        entry.expiresAt = Date.now() + options.ttlSeconds * 1000;
      }

      entries.set(key, entry);
    }
  };
}
