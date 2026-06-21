import { getErrorMessage, PresenceError } from "./errors";
import { memoryStore, setStoreValue } from "./store";
import type {
  BuildingFallback,
  BuildingPresenceCard,
  GetPresenceSnapshotOptions,
  ListeningFallback,
  ListeningPresenceCard,
  PlayingFallback,
  PlayingPresenceCard,
  PlayedInput,
  PresenceCacheOptions,
  PresenceCard,
  PresenceClient,
  PresenceConfig,
  PresenceContext,
  PresenceKind,
  PresenceSnapshot,
  PresenceSource,
  PresenceSourceState,
  PresenceStore,
  RecordablePlayingSource
} from "./types";
import { assertFetch, dateToIso, withoutUndefined } from "./utils";

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

export function definePresence(config: PresenceConfig): PresenceClient {
  return new Presence(config);
}

class Presence implements PresenceClient {
  private readonly cache: NormalizedCache | undefined;
  private readonly config: PresenceConfig;

  constructor(config: PresenceConfig) {
    this.config = config;
    this.cache = normalizeCache(config.cache);
  }

  async getSnapshot(options: GetPresenceSnapshotOptions = {}) {
    const now = options.now ?? new Date();

    if (!options.bypassCache) {
      const cached = await this.readFreshCache(now);

      if (cached) {
        return cached;
      }
    }

    const lastGood = await this.readLastGood();
    const context = this.createContext(now);
    const cards: PresenceCard[] = [];
    const states = createEmptyStates();

    for (const kind of PRESENCE_ORDER) {
      const result = await this.resolveKind(kind, context, lastGood);

      if (result.card) {
        cards.push(result.card);
      }

      states[kind] = result.state;
    }

    const snapshot: PresenceSnapshot = {
      cards,
      generatedAt: now.toISOString(),
      sources: states
    };

    await this.writeCache(snapshot, now);
    return snapshot;
  }

  async recordPlayed(input: PlayedInput, options: { now?: Date } = {}) {
    const playingSource = this.config.sources?.playing;

    if (!isRecordablePlayingSource(playingSource)) {
      throw new PresenceError("The playing source does not support recording.", {
        code: "recording_not_supported",
        status: 400
      });
    }

    const card = await playingSource.record(input, this.createContext(options.now ?? new Date()));

    if (this.cache) {
      await this.cache.store.delete(this.cache.key);
    }

    return card;
  }

  private createContext(now: Date): PresenceContext {
    const fetchImpl = this.config.fetch ?? globalThis.fetch;

    return withoutUndefined({
      fetch: assertFetch(fetchImpl),
      logger: this.config.logger,
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

  private async readLastGood() {
    if (!this.cache) {
      return null;
    }

    return this.cache.store.get<PresenceSnapshot>(this.cache.lastGoodKey);
  }

  private async resolveKind(
    kind: PresenceKind,
    context: PresenceContext,
    lastGood: PresenceSnapshot | null
  ) {
    const source = this.config.sources?.[kind];

    if (!source) {
      const fallback = this.fallbackFor(kind);

      if (fallback) {
        return {
          card: fallback,
          state: state("fallback", fallback)
        };
      }

      return {
        card: null,
        state: { status: "disabled" } satisfies PresenceSourceState
      };
    }

    try {
      const card = await source.getCard(context);

      if (card) {
        const freshCard = { ...card, stale: false } as PresenceCard;
        return {
          card: freshCard,
          state: state("fresh", freshCard)
        };
      }

      const fallback = this.fallbackFor(kind);

      if (fallback) {
        return {
          card: fallback,
          state: state("fallback", fallback)
        };
      }

      return {
        card: null,
        state: {
          source: source.source,
          status: "empty"
        } satisfies PresenceSourceState
      };
    } catch (error) {
      context.logger?.warn?.("Presence source failed.", {
        error: getErrorMessage(error),
        kind,
        source: source.source
      });

      const staleCard = lastGood?.cards.find((card) => card.kind === kind);

      if (staleCard) {
        const card = { ...staleCard, stale: true } as PresenceCard;
        return {
          card,
          state: state("stale", card)
        };
      }

      const fallback = this.fallbackFor(kind);

      if (fallback) {
        return {
          card: fallback,
          state: state("fallback", fallback)
        };
      }

      return {
        card: null,
        state: {
          source: source.source,
          status: "error"
        } satisfies PresenceSourceState
      };
    }
  }

  private fallbackFor(kind: PresenceKind): PresenceCard | null {
    if (kind === "building") {
      return normalizeBuildingFallback(this.config.fallbacks?.building);
    }

    if (kind === "playing") {
      return normalizePlayingFallback(this.config.fallbacks?.playing);
    }

    return normalizeListeningFallback(this.config.fallbacks?.listening);
  }

  private async writeCache(snapshot: PresenceSnapshot, now: Date) {
    if (!this.cache) {
      return;
    }

    await setStoreValue<SnapshotCacheEntry>(
      this.cache.store,
      this.cache.key,
      {
        expiresAt: new Date(now.getTime() + this.cache.ttlSeconds * 1000).toISOString(),
        snapshot
      },
      this.cache.ttlSeconds
    );

    await setStoreValue<PresenceSnapshot>(
      this.cache.store,
      this.cache.lastGoodKey,
      snapshot,
      this.cache.lastGoodTtlSeconds
    );
  }
}

function createEmptyStates(): Record<PresenceKind, PresenceSourceState> {
  return {
    building: { status: "disabled" },
    listening: { status: "disabled" },
    playing: { status: "disabled" }
  };
}

function isRecordablePlayingSource(
  source: false | null | PresenceSource | undefined
): source is RecordablePlayingSource {
  return Boolean(source && "record" in source && typeof source.record === "function");
}

function normalizeCache(cache: false | PresenceCacheOptions | undefined) {
  if (cache === false) {
    return undefined;
  }

  return {
    key: cache?.key ?? DEFAULT_CACHE_KEY,
    lastGoodKey: cache?.lastGoodKey ?? DEFAULT_LAST_GOOD_KEY,
    lastGoodTtlSeconds: cache?.lastGoodTtlSeconds,
    store: cache?.store ?? memoryStore(),
    ttlSeconds: cache?.ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS
  } satisfies NormalizedCache;
}

function normalizeBuildingFallback(
  fallback: BuildingFallback | undefined
): BuildingPresenceCard | null {
  if (!fallback) {
    return null;
  }

  return withoutUndefined({
    description: fallback.description,
    href: fallback.href,
    kind: "building" as const,
    label: fallback.label ?? "Building",
    metadata: fallback.metadata,
    repo: fallback.repo,
    source: fallback.source ?? "manual",
    title: fallback.title,
    updatedAt: dateToIso(fallback.updatedAt)
  });
}

function normalizeListeningFallback(
  fallback: ListeningFallback | undefined
): ListeningPresenceCard | null {
  if (!fallback) {
    return null;
  }

  return withoutUndefined({
    album: fallback.album,
    artist: fallback.artist,
    href: fallback.href,
    image: fallback.image,
    isNowPlaying: fallback.isNowPlaying,
    kind: "listening" as const,
    label: fallback.label ?? "Listening to",
    metadata: fallback.metadata,
    source: fallback.source ?? "manual",
    title: fallback.title,
    updatedAt: dateToIso(fallback.updatedAt)
  });
}

function normalizePlayingFallback(
  fallback: PlayingFallback | undefined
): PlayingPresenceCard | null {
  if (!fallback) {
    return null;
  }

  return withoutUndefined({
    device: fallback.device,
    href: fallback.href,
    kind: "playing" as const,
    label: fallback.label ?? "Playing",
    metadata: fallback.metadata,
    platform: fallback.platform,
    source: fallback.source ?? "manual",
    title: fallback.title,
    updatedAt: dateToIso(fallback.updatedAt)
  });
}

function state(
  status: PresenceSourceState["status"],
  card: PresenceCard
): PresenceSourceState {
  return withoutUndefined({
    source: card.source,
    status,
    updatedAt: card.updatedAt
  });
}
