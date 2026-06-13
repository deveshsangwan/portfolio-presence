import type { PresenceStore } from "./types";

interface MemoryStoreEntry {
  expiresAt?: number;
  value: unknown;
}

export interface MemoryPresenceStore extends PresenceStore {
  clear: () => Promise<void>;
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
