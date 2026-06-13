export { PresenceError, getErrorMessage } from "./core/errors";
export { definePresence } from "./core/presence";
export { memoryStore, type MemoryPresenceStore } from "./core/store";
export type {
  BuildingFallback,
  BuildingPresenceCard,
  FetchLike,
  GetPresenceSnapshotOptions,
  ISODateString,
  JsonPrimitive,
  JsonRecord,
  JsonValue,
  ListeningFallback,
  ListeningPresenceCard,
  PlayedInput,
  PlayingFallback,
  PlayingPresenceCard,
  PresenceCacheOptions,
  PresenceCard,
  PresenceClient,
  PresenceConfig,
  PresenceContext,
  PresenceFallbacks,
  PresenceKind,
  PresenceLogger,
  PresenceSnapshot,
  PresenceSource,
  PresenceSourceState,
  PresenceSourceStatus,
  PresenceStore,
  RecordablePlayingSource
} from "./core/types";
export { githubSource, type GitHubRepoConfig, type GitHubSourceOptions } from "./sources/github";
export { lastFmSource, type LastFmSourceOptions } from "./sources/lastfm";
export { playedEventSource, type PlayedEventSourceOptions } from "./sources/played";
