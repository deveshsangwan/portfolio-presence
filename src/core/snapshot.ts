import type {
  JsonRecord,
  JsonValue,
  PresenceCard,
  PresenceSnapshot,
  PresenceSourceState
} from "./types";

export function isPresenceSnapshot(value: unknown): value is PresenceSnapshot {
  if (!isRecord(value) || !isRecord(value.sources)) {
    return false;
  }

  return (
    typeof value.generatedAt === "string" &&
    Array.isArray(value.cards) &&
    value.cards.every(isPresenceCard) &&
    isPresenceSourceState(value.sources.building) &&
    isPresenceSourceState(value.sources.playing) &&
    isPresenceSourceState(value.sources.listening)
  );
}

function isPresenceCard(value: unknown): value is PresenceCard {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.label !== "string" ||
    typeof value.title !== "string" ||
    typeof value.source !== "string"
  ) {
    return false;
  }

  if (
    !hasOptionalStrings(value, ["href", "updatedAt"]) ||
    ("stale" in value && typeof value.stale !== "boolean") ||
    ("metadata" in value && !isJsonRecord(value.metadata))
  ) {
    return false;
  }

  switch (value.kind) {
    case "building":
      return hasOptionalStrings(value, ["description", "repo"]);
    case "playing":
      return hasOptionalStrings(value, ["device", "platform"]);
    case "listening":
      return (
        hasOptionalStrings(value, ["album", "artist", "image"]) &&
        (!("isNowPlaying" in value) || typeof value.isNowPlaying === "boolean")
      );
    default:
      return false;
  }
}

function isPresenceSourceState(value: unknown): value is PresenceSourceState {
  if (!isRecord(value) || !hasOptionalStrings(value, ["source", "updatedAt"])) {
    return false;
  }

  return (
    value.status === "fresh" ||
    value.status === "fallback" ||
    value.status === "stale" ||
    value.status === "empty" ||
    value.status === "disabled" ||
    value.status === "error"
  );
}

function hasOptionalStrings(value: Record<string, unknown>, keys: readonly string[]) {
  return keys.every((key) => !(key in value) || typeof value[key] === "string");
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isJsonRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
