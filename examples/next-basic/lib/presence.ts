import {
  definePresence,
  memoryStore,
  playedEventSource,
  wakatimeSource
} from "portfolio-presence";

const store = memoryStore();
const wakatimeApiKey = process.env.WAKATIME_API_KEY;

export const presence = definePresence({
  cache: {
    store,
    ttlSeconds: 60
  },
  fallbacks: {
    building: {
      href: "https://github.com/deveshsangwan/portfolio-presence",
      title: "portfolio-presence"
    },
    listening: {
      artist: "Sidhu Moose Wala",
      title: "PBX 1"
    },
    playing: {
      platform: "ios",
      title: "MCOC"
    }
  },
  sources: {
    building: wakatimeApiKey
      ? wakatimeSource({
          apiKey: wakatimeApiKey,
          projects: [
            {
              href: "https://github.com/deveshsangwan/portfolio-presence",
              label: "portfolio-presence",
              name: "portfolio-presence"
            }
          ]
        })
      : false,
    playing: playedEventSource({ store })
  }
});
