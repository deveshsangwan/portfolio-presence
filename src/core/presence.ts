import { getErrorMessage, PresenceError } from "./errors";
import { assertValidTtlSeconds, memoryStore, setStoreValue } from "./store";
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

type LastGoodCards = Partial<Record<PresenceKind, PresenceCard>>;

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

  private async readLastGoodCards(): Promise<LastGoodCards> {
    if (!this.cache || this.cache.lastGoodTtlSeconds === 0) {
      return {};
    }

    const { lastGoodKey, lastGoodTtlSeconds, store } = this.cache;
    const storedEntries = await Promise.all(
      PRESENCE_ORDER.map(async (kind) => ({
        card: await store.get<PresenceCard>(createLastGoodKey(lastGoodKey, kind)),
        kind
      }))
    );

    const cards: LastGoodCards = {};

    for (const { card, kind } of storedEntries) {
      if (card) {
        cards[kind] = card;
      }
    }

    const legacySnapshot = await store.get<PresenceSnapshot>(lastGoodKey);

    if (!legacySnapshot) {
      return cards;
    }

    const legacyCards = PRESENCE_ORDER.flatMap((kind) => {
      if (cards[kind]) {
        return [];
      }

      const card = findFreshCard(legacySnapshot, kind);
      return card ? [card] : [];
    });

    for (const card of legacyCards) {
      cards[card.kind] = card;
    }

    await Promise.all(
      legacyCards.map((card) =>
        setStoreValue(
          store,
          createLastGoodKey(lastGoodKey, card.kind),
          card,
          lastGoodTtlSeconds
        )
      )
    );

    await store.delete(lastGoodKey);

    return cards;
  }

  private async clearLastGoodCards() {
    if (!this.cache) {
      return;
    }

    const { lastGoodKey, store } = this.cache;

    await Promise.all([
      store.delete(lastGoodKey),
      ...PRESENCE_ORDER.map((kind) => store.delete(createLastGoodKey(lastGoodKey, kind)))
    ]);
  }

  private async resolveKind(
    kind: PresenceKind,
    context: PresenceContext,
    lastGood: LastGoodCards
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

      const staleCard = lastGood[kind];

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

function createEmptyStates(): Record<PresenceKind, PresenceSourceState> {
  return {
    building: { status: "disabled" },
    listening: { status: "disabled" },
    playing: { status: "disabled" }
  };
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
  source: false | null | PresenceSource | undefined
): source is RecordablePlayingSource {
  return Boolean(source && "record" in source && typeof source.record === "function");
}

function normalizeCache(cache: false | PresenceCacheOptions | undefined) {
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
