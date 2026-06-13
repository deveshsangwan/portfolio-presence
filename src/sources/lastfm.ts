import { PresenceError } from "../core/errors";
import type {
  FetchLike,
  ListeningPresenceCard,
  PresenceSource
} from "../core/types";
import { isHttpUrl, withoutUndefined } from "../core/utils";

export interface LastFmSourceOptions {
  apiBaseUrl?: string;
  apiKey: string;
  blockedArtists?: string[];
  blockedTracks?: string[];
  fetch?: FetchLike;
  recentLabel?: string;
  sourceName?: string;
  username: string;
  nowPlayingLabel?: string;
}

interface LastFmRecentTracksResponse {
  error?: number;
  message?: string;
  recenttracks?: {
    track?: LastFmTrack[] | LastFmTrack;
  };
}

interface LastFmImage {
  "#text"?: string;
  size?: string;
}

interface LastFmTrack {
  "@attr"?: {
    nowplaying?: string;
  };
  album?: {
    "#text"?: string;
  };
  artist?: {
    "#text"?: string;
  };
  date?: {
    uts?: string;
  };
  image?: LastFmImage[];
  name?: string;
  url?: string;
}

export function lastFmSource(
  options: LastFmSourceOptions
): PresenceSource<ListeningPresenceCard> {
  return {
    kind: "listening",
    source: options.sourceName ?? "lastfm",

    async getCard(context) {
      const fetchImpl = options.fetch ?? context.fetch;
      const response = await fetchImpl(createLastFmUrl(options));

      if (!response.ok) {
        throw new PresenceError(`Last.fm API returned ${response.status}.`, {
          code: "lastfm_request_failed",
          status: response.status
        });
      }

      const payload = (await response.json()) as LastFmRecentTracksResponse;

      if (payload.error) {
        throw new PresenceError(payload.message ?? "Last.fm API returned an error.", {
          code: "lastfm_api_error",
          status: 502
        });
      }

      const tracks = normalizeTracks(payload.recenttracks?.track);
      const track = tracks.find((candidate) => isAllowedTrack(candidate, options));

      if (!track?.name) {
        return null;
      }

      const isNowPlaying = track["@attr"]?.nowplaying === "true";
      const artist = track.artist?.["#text"];
      const album = track.album?.["#text"];
      const href = isHttpUrl(track.url) ? track.url : undefined;
      const image = selectLargestImage(track.image);
      const updatedAt = isNowPlaying
        ? context.now.toISOString()
        : dateFromUnixSeconds(track.date?.uts);

      return withoutUndefined({
        album: album || undefined,
        artist: artist || undefined,
        href,
        image,
        isNowPlaying,
        kind: "listening" as const,
        label: isNowPlaying
          ? options.nowPlayingLabel ?? "Listening to"
          : options.recentLabel ?? "Listened to",
        source: options.sourceName ?? "lastfm",
        title: track.name,
        updatedAt
      });
    }
  };
}

function createLastFmUrl(options: LastFmSourceOptions) {
  const url = new URL(options.apiBaseUrl ?? "https://ws.audioscrobbler.com/2.0/");
  url.searchParams.set("method", "user.getrecenttracks");
  url.searchParams.set("user", options.username);
  url.searchParams.set("api_key", options.apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  return url;
}

function dateFromUnixSeconds(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const timestamp = Number(value);

  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return new Date(timestamp * 1000).toISOString();
}

function isAllowedTrack(track: LastFmTrack, options: LastFmSourceOptions) {
  const artist = track.artist?.["#text"]?.toLowerCase();
  const name = track.name?.toLowerCase();
  const blockedArtists = new Set(options.blockedArtists?.map((value) => value.toLowerCase()));
  const blockedTracks = new Set(options.blockedTracks?.map((value) => value.toLowerCase()));

  if (artist && blockedArtists.has(artist)) {
    return false;
  }

  if (name && blockedTracks.has(name)) {
    return false;
  }

  return true;
}

function normalizeTracks(track: LastFmTrack[] | LastFmTrack | undefined) {
  if (!track) {
    return [];
  }

  return Array.isArray(track) ? track : [track];
}

function selectLargestImage(images: LastFmImage[] | undefined) {
  if (!images) {
    return undefined;
  }

  const image = [...images]
    .reverse()
    .map((candidate) => candidate["#text"])
    .find((candidate) => isHttpUrl(candidate));

  return image;
}
