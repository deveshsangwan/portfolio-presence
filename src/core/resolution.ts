import { getErrorMessage, PresenceError } from "./errors";
import type {
  BuildingFallback,
  BuildingPresenceCard,
  ListeningFallback,
  ListeningPresenceCard,
  PlayingFallback,
  PlayingPresenceCard,
  PresenceCard,
  PresenceConfig,
  PresenceContext,
  PresenceKind,
  PresenceSnapshot,
  PresenceSource,
  PresenceSourceState
} from "./types";
import { dateToIso, withoutUndefined } from "./utils";

interface ResolutionPlanEntry<TKind extends PresenceKind = PresenceKind> {
  readonly fallback: Readonly<PresenceCard> | null;
  readonly kind: TKind;
  readonly source: PresenceSource | null;
}

export type ResolutionPlan = readonly [
  ResolutionPlanEntry<"building">,
  ResolutionPlanEntry<"playing">,
  ResolutionPlanEntry<"listening">
];

interface KindResolution {
  card: PresenceCard | null;
  state: PresenceSourceState;
}

type SourceOutcome =
  | { type: "disabled" }
  | { card: PresenceCard; type: "fresh" }
  | { source: string; type: "empty" }
  | { source: string; type: "failed" };

type UnrecoveredSourceOutcome = Exclude<SourceOutcome, { type: "fresh" }>;

export type RecoveryCards = Readonly<Partial<Record<PresenceKind, PresenceCard>>>;

export function normalizeResolutionPlan(config: PresenceConfig): ResolutionPlan {
  const building = Object.freeze({
    fallback: freezeFallback(normalizeBuildingFallback(config.fallbacks?.building)),
    kind: "building" as const,
    source: normalizeSource("building", config.sources?.building)
  });
  const playing = Object.freeze({
    fallback: freezeFallback(normalizePlayingFallback(config.fallbacks?.playing)),
    kind: "playing" as const,
    source: normalizeSource("playing", config.sources?.playing)
  });
  const listening = Object.freeze({
    fallback: freezeFallback(normalizeListeningFallback(config.fallbacks?.listening)),
    kind: "listening" as const,
    source: normalizeSource("listening", config.sources?.listening)
  });

  return Object.freeze([building, playing, listening] as const);
}

export async function resolvePresenceSnapshot(
  plan: ResolutionPlan,
  context: PresenceContext,
  lastGood: RecoveryCards
): Promise<PresenceSnapshot> {
  const building = await resolveKind(plan[0], context, lastGood);
  const playing = await resolveKind(plan[1], context, lastGood);
  const listening = await resolveKind(plan[2], context, lastGood);
  const resolutions = [building, playing, listening] as const;

  return {
    cards: compactCards(resolutions.map(({ card }) => card)),
    generatedAt: context.now.toISOString(),
    sources: {
      building: building.state,
      listening: listening.state,
      playing: playing.state
    }
  };
}

async function resolveKind(
  entry: ResolutionPlanEntry,
  context: PresenceContext,
  lastGood: RecoveryCards
): Promise<KindResolution> {
  const outcome = await executeSource(entry, context);

  if (outcome.type === "fresh") {
    return cardResolution("fresh", outcome.card);
  }

  if (outcome.type === "failed") {
    const lastGoodCard = lastGood[entry.kind];

    if (lastGoodCard) {
      return cardResolution("stale", { ...lastGoodCard, stale: true });
    }
  }

  if (entry.fallback) {
    return cardResolution("fallback", { ...entry.fallback });
  }

  return unrecoveredResolution(outcome);
}

async function executeSource(
  entry: ResolutionPlanEntry,
  context: PresenceContext
): Promise<SourceOutcome> {
  const source = entry.source;

  if (!source) {
    return { type: "disabled" };
  }

  try {
    const card = await source.getCard(context);

    if (!card) {
      return { source: source.source, type: "empty" };
    }

    return {
      card: { ...card, stale: false },
      type: "fresh"
    };
  } catch (error) {
    context.logger?.warn?.("Presence source failed.", {
      error: getErrorMessage(error),
      kind: entry.kind,
      source: source.source
    });

    return { source: source.source, type: "failed" };
  }
}

function unrecoveredResolution(outcome: UnrecoveredSourceOutcome): KindResolution {
  if (outcome.type === "disabled") {
    return {
      card: null,
      state: { status: "disabled" }
    };
  }

  if (outcome.type === "empty") {
    return {
      card: null,
      state: { source: outcome.source, status: "empty" }
    };
  }

  return {
    card: null,
    state: { source: outcome.source, status: "error" }
  };
}

function cardResolution(
  status: "fallback" | "fresh" | "stale",
  card: PresenceCard
): KindResolution {
  return {
    card,
    state: state(status, card)
  };
}

function compactCards(cards: readonly (PresenceCard | null)[]): PresenceCard[] {
  return cards.filter((card): card is PresenceCard => card !== null);
}

function normalizeSource(
  kind: PresenceKind,
  source: false | null | PresenceSource | undefined
): PresenceSource | null {
  if (!source) {
    return null;
  }

  if (source.kind !== kind) {
    throw new PresenceError(
      `The ${kind} source declares itself as ${source.kind}.`,
      { code: "source_kind_mismatch", status: 400 }
    );
  }

  return source;
}

function freezeFallback<TCard extends PresenceCard>(
  fallback: TCard | null
): Readonly<TCard> | null {
  return fallback ? Object.freeze(fallback) : null;
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
