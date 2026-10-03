import { PresenceError } from "./errors";
import {
  normalizeResolutionPlan,
  resolvePresenceSnapshot,
  type RecoveryCards,
  type ResolutionPlan
} from "./resolution";
import { assertValidTtlSeconds, memoryStore, setStoreValue } from "./store";
import type {
  FetchLike,
  GetPresenceSnapshotOptions,
  PlayedInput,
  PresenceCacheOptions,
  PresenceCard,
  PresenceClient,
  PresenceConfig,
  PresenceContext,
  PresenceKind,
  PresenceLogger,
  PresenceSnapshot,
  PresenceSource,
  PresenceStore,
  RecordablePlayingSource
} from "./types";
import { assertFetch, withoutUndefined } from "./utils";

const DEFAULT_CACHE_KEY = "portfolio-presence:snapshot";
const DEFAULT_LAST_GOOD_KEY = "portfolio-presence:snapshot:last-good";
const DEFAULT_CACHE_TTL_SECONDS = 60;
const PRESENCE_ORDER: PresenceKind[] = ["building", "playing", "listening"];

interface SnapshotCacheEntry {
  expiresAt: string;
  snapshot: PresenceSnapshot;
}

interface NormalizedCache {
  key: string;
  lastGoodKey: string;
  lastGoodTtlSeconds: number | undefined;
  store: PresenceStore;
  ttlSeconds: number;
}

interface NormalizedPresenceConfig {
  cache: NormalizedCache | undefined;
  fetch: FetchLike | undefined;
  logger: PresenceLogger | undefined;
  resolutionPlan: ResolutionPlan;
}

export function definePresence(config: PresenceConfig): PresenceClient {
  return new Presence(normalizePresenceConfig(config));
}

class Presence implements PresenceClient {
  private readonly cache: NormalizedCache | undefined;
  private readonly fetch: FetchLike | undefined;
  private readonly logger: PresenceLogger | undefined;
  private readonly playingSource: PresenceSource | null;
  private readonly resolutionPlan: ResolutionPlan;

  constructor(config: NormalizedPresenceConfig) {
    this.cache = config.cache;
    this.fetch = config.fetch;
    this.logger = config.logger;
    this.playingSource = config.resolutionPlan[1].source;
    this.resolutionPlan = config.resolutionPlan;
  }

  async getSnapshot(options: GetPresenceSnapshotOptions = {}) {
    const now = options.now ?? new Date();

    if (this.cache?.lastGoodTtlSeconds === 0) {
      await this.clearLastGoodCards();
    }

    if (!options.bypassCache) {
      const cached = await this.readFreshCache(now);

      if (cached) {
        return cached;
      }
    }

    const lastGood = await this.readLastGoodCards();
    const snapshot = await resolvePresenceSnapshot(
      this.resolutionPlan,
      this.createContext(now),
      lastGood
    );

    await this.writeCache(snapshot, now);
    return snapshot;
  }

  async recordPlayed(input: PlayedInput, options: { now?: Date } = {}) {
    if (!isRecordablePlayingSource(this.playingSource)) {
      throw new PresenceError("The playing source does not support recording.", {
        code: "recording_not_supported",
        status: 400
      });
    }

    const card = await this.playingSource.record(
      input,
      this.createContext(options.now ?? new Date())
    );

    if (this.cache) {
      await this.cache.store.delete(this.cache.key);
    }

    return card;
  }

  private createContext(now: Date): PresenceContext {
    return withoutUndefined({
      fetch: this.fetch ?? assertFetch(globalThis.fetch),
      logger: this.logger,
      now
    });
  }

  private async readFreshCache(now: Date) {
    if (!this.cache) {
      return null;
    }

    const entry = await this.cache.store.get<SnapshotCacheEntry>(this.cache.key);

    if (!entry) {
      return null;
    }

    if (new Date(entry.expiresAt).getTime() <= now.getTime()) {
      return null;
    }

    return entry.snapshot;
  }

  private async readLastGoodCards(): Promise<RecoveryCards> {
    if (!this.cache || this.cache.lastGoodTtlSeconds === 0) {
      return {};
    }

    const { lastGoodKey, store } = this.cache;
    const storedEntries = await Promise.all(
      this.resolutionPlan.map(async ({ kind }) => ({
        card: await store.get<PresenceCard>(createLastGoodKey(lastGoodKey, kind)),
        kind
      }))
    );

    const cards: Partial<Record<PresenceKind, PresenceCard>> = {};

    for (const { card, kind } of storedEntries) {
      if (card) {
        cards[kind] = card;
      }
    }

    const legacySnapshot = await store.get<PresenceSnapshot>(lastGoodKey);

    if (!legacySnapshot) {
      return cards;
    }

    // The store cannot preserve a legacy entry's remaining TTL or atomically
    // migrate it without replacing a concurrent fresh write, so only read it.
    for (const { kind } of this.resolutionPlan) {
      if (cards[kind]) {
        continue;
      }

      const card = findFreshCard(legacySnapshot, kind);

      if (card) {
        cards[kind] = card;
      }
    }

    return cards;
  }

  private async clearLastGoodCards() {
    if (!this.cache) {
      return;
    }

    const { lastGoodKey, store } = this.cache;

    await Promise.all([
      store.delete(lastGoodKey),
      ...this.resolutionPlan.map(({ kind }) => {
        return store.delete(createLastGoodKey(lastGoodKey, kind));
      })
    ]);
  }

  private async writeCache(snapshot: PresenceSnapshot, now: Date) {
    if (!this.cache) {
      return;
    }

    const { key, lastGoodKey, lastGoodTtlSeconds, store, ttlSeconds } = this.cache;

    await setStoreValue<SnapshotCacheEntry>(
      store,
      key,
      {
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        snapshot
      },
      ttlSeconds
    );

    if (lastGoodTtlSeconds === 0) {
      return;
    }

    const freshCards = snapshot.cards.filter(
      (card) => snapshot.sources[card.kind].status === "fresh"
    );

    await Promise.all(
      freshCards.map((card) =>
        setStoreValue(
          store,
          createLastGoodKey(lastGoodKey, card.kind),
          card,
          lastGoodTtlSeconds
        )
      )
    );
  }
}

function normalizePresenceConfig(config: PresenceConfig): NormalizedPresenceConfig {
  return Object.freeze({
    cache: normalizeCache(config.cache),
    fetch: config.fetch ? assertFetch(config.fetch) : undefined,
    logger: config.logger,
    resolutionPlan: normalizeResolutionPlan(config)
  });
}

function createLastGoodKey(baseKey: string, kind: PresenceKind) {
  return `${baseKey}:${kind}`;
}

function findFreshCard(snapshot: PresenceSnapshot, kind: PresenceKind) {
  if (snapshot.sources[kind].status !== "fresh") {
    return null;
  }

  return snapshot.cards.find((card) => card.kind === kind) ?? null;
}

function isRecordablePlayingSource(
  source: PresenceSource | null
): source is RecordablePlayingSource {
  if (!source || !("record" in source)) {
    return false;
  }

  return typeof source.record === "function";
}

function normalizeCache(
  cache: false | PresenceCacheOptions | undefined
): NormalizedCache | undefined {
  if (cache === false) {
    return undefined;
  }

  const key = cache?.key ?? DEFAULT_CACHE_KEY;
  const lastGoodKey = cache?.lastGoodKey ?? DEFAULT_LAST_GOOD_KEY;
  const ttlSeconds = cache?.ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  const lastGoodTtlSeconds = cache?.lastGoodTtlSeconds;
  const recoveryKeys = [
    lastGoodKey,
    ...PRESENCE_ORDER.map((kind) => createLastGoodKey(lastGoodKey, kind))
  ];

  if (recoveryKeys.includes(key)) {
    throw new RangeError("Snapshot cache key must not overlap last-good recovery keys.");
  }

  assertValidTtlSeconds(ttlSeconds);
  assertValidTtlSeconds(lastGoodTtlSeconds);

  return {
    key,
    lastGoodKey,
    lastGoodTtlSeconds,
    store: cache?.store ?? memoryStore(),
    ttlSeconds
  };
}
