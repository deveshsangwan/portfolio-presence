export type ISODateString = string;

export type PresenceKind = "building" | "playing" | "listening";

export type PresenceSourceStatus =
  | "fresh"
  | "fallback"
  | "stale"
  | "empty"
  | "disabled"
  | "error";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface PresenceLogger {
  debug?: (message: string, metadata?: JsonRecord) => void;
  error?: (message: string, metadata?: JsonRecord) => void;
  warn?: (message: string, metadata?: JsonRecord) => void;
}

export interface PresenceCardBase<KKind extends PresenceKind> {
  kind: KKind;
  label: string;
  title: string;
  source: string;
  href?: string;
  metadata?: JsonRecord;
  stale?: boolean;
  updatedAt?: ISODateString;
}

export interface BuildingPresenceCard extends PresenceCardBase<"building"> {
  description?: string;
  repo?: string;
}

export interface PlayingPresenceCard extends PresenceCardBase<"playing"> {
  device?: string;
  platform?: string;
}

export interface ListeningPresenceCard extends PresenceCardBase<"listening"> {
  album?: string;
  artist?: string;
  image?: string;
  isNowPlaying?: boolean;
}

export type PresenceCard =
  | BuildingPresenceCard
  | PlayingPresenceCard
  | ListeningPresenceCard;

export interface PresenceSourceState {
  source?: string;
  status: PresenceSourceStatus;
  updatedAt?: ISODateString;
}

export interface PresenceSnapshot {
  cards: PresenceCard[];
  generatedAt: ISODateString;
  sources: Record<PresenceKind, PresenceSourceState>;
}

export interface PresenceContext {
  fetch: FetchLike;
  logger?: PresenceLogger;
  now: Date;
}

export interface PresenceSource<TCard extends PresenceCard = PresenceCard> {
  kind: TCard["kind"];
  source: string;
  getCard: (context: PresenceContext) => Promise<TCard | null>;
}

export interface PlayedInput {
  device?: string;
  href?: string;
  metadata?: JsonRecord;
  occurredAt?: Date | string;
  platform?: string;
  source?: string;
  title: string;
  url?: string;
}

export interface RecordablePlayingSource
  extends PresenceSource<PlayingPresenceCard> {
  record: (
    input: PlayedInput,
    context: PresenceContext
  ) => Promise<PlayingPresenceCard>;
}

export interface BuildingFallback {
  description?: string;
  href?: string;
  label?: string;
  metadata?: JsonRecord;
  repo?: string;
  source?: string;
  title: string;
  updatedAt?: Date | string;
}

export interface PlayingFallback {
  device?: string;
  href?: string;
  label?: string;
  metadata?: JsonRecord;
  platform?: string;
  source?: string;
  title: string;
  updatedAt?: Date | string;
}

export interface ListeningFallback {
  album?: string;
  artist?: string;
  href?: string;
  image?: string;
  isNowPlaying?: boolean;
  label?: string;
  metadata?: JsonRecord;
  source?: string;
  title: string;
  updatedAt?: Date | string;
}

export interface PresenceFallbacks {
  building?: BuildingFallback;
  listening?: ListeningFallback;
  playing?: PlayingFallback;
}

export interface PresenceStore {
  delete: (key: string) => Promise<void>;
  get: <TValue>(key: string) => Promise<TValue | null>;
  set: <TValue>(
    key: string,
    value: TValue,
    options?: { ttlSeconds?: number }
  ) => Promise<void>;
}

export interface PresenceCacheOptions {
  key?: string;
  lastGoodKey?: string;
  store?: PresenceStore;
  ttlSeconds?: number;
}

export interface PresenceConfig {
  cache?: false | PresenceCacheOptions;
  fallbacks?: PresenceFallbacks;
  fetch?: FetchLike;
  logger?: PresenceLogger;
  sources?: Partial<Record<PresenceKind, false | null | PresenceSource>>;
}

export interface GetPresenceSnapshotOptions {
  bypassCache?: boolean;
  now?: Date;
}

export interface PresenceClient {
  getSnapshot: (options?: GetPresenceSnapshotOptions) => Promise<PresenceSnapshot>;
  recordPlayed: (input: PlayedInput, options?: { now?: Date }) => Promise<PlayingPresenceCard>;
}
