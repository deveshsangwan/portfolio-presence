import { PresenceError } from "../core/errors";
import type {
  PlayedInput,
  PlayingPresenceCard,
  PresenceContext,
  PresenceStore,
  RecordablePlayingSource
} from "../core/types";
import { cleanString, isHttpUrl, parseTimestamp, withoutUndefined } from "../core/utils";

export interface PlayedEventSourceOptions {
  key?: string;
  label?: string;
  sourceName?: string;
  store: PresenceStore;
  ttlSeconds?: number;
}

const DEFAULT_PLAYED_KEY = "portfolio-presence:playing:last";

export function playedEventSource(
  options: PlayedEventSourceOptions
): RecordablePlayingSource {
  const key = options.key ?? DEFAULT_PLAYED_KEY;

  return {
    kind: "playing" as const,
    source: options.sourceName ?? "shortcut",

    async getCard() {
      return options.store.get<PlayingPresenceCard>(key);
    },

    async record(input: PlayedInput, context: PresenceContext) {
      const card = normalizePlayedInput(input, context.now, options);
      await options.store.set<PlayingPresenceCard>(
        key,
        card,
        options.ttlSeconds === undefined ? undefined : { ttlSeconds: options.ttlSeconds }
      );
      return card;
    }
  };
}

function normalizePlayedInput(
  input: PlayedInput,
  now: Date,
  options: PlayedEventSourceOptions
): PlayingPresenceCard {
  const title = cleanString(input.title, 120);

  if (!title) {
    throw new PresenceError("Game title is required.", {
      code: "played_title_required",
      status: 400
    });
  }

  const occurredAt = parseTimestamp(input.occurredAt, now);
  const href = cleanString(input.href ?? input.url, 500);
  const platform = cleanString(input.platform, 40);
  const device = cleanString(input.device, 80);
  const source = cleanString(input.source, 40) ?? options.sourceName ?? "shortcut";

  return withoutUndefined({
    device,
    href: isHttpUrl(href) ? href : undefined,
    kind: "playing" as const,
    label: options.label ?? "Playing",
    metadata: input.metadata,
    platform,
    source,
    title,
    updatedAt: occurredAt.toISOString()
  });
}
