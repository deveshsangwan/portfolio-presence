import { definePresence, memoryStore, playedEventSource } from "portfolio-presence";

const store = memoryStore();

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
    playing: playedEventSource({ store })
  }
});
