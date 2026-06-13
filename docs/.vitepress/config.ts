import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/portfolio-presence/",
  description: "Privacy-first presence snapshots for portfolio sites.",
  lastUpdated: true,
  title: "portfolio-presence",
  themeConfig: {
    nav: [
      { link: "/quick-start", text: "Quick Start" },
      { link: "/api", text: "API" },
      { link: "https://github.com/deveshsangwan/portfolio-presence", text: "GitHub" }
    ],
    search: {
      provider: "local"
    },
    sidebar: [
      {
        items: [
          { link: "/", text: "Introduction" },
          { link: "/quick-start", text: "Quick Start" },
          { link: "/concepts", text: "Concepts" }
        ],
        text: "Start"
      },
      {
        items: [
          { link: "/providers/github", text: "GitHub" },
          { link: "/providers/lastfm", text: "Last.fm" },
          { link: "/providers/played-events", text: "Played Events" }
        ],
        text: "Providers"
      },
      {
        items: [
          { link: "/frameworks/nextjs", text: "Next.js" },
          { link: "/frameworks/react", text: "React" },
          { link: "/frameworks/node", text: "Node" }
        ],
        text: "Frameworks"
      },
      {
        items: [
          { link: "/storage", text: "Storage" },
          { link: "/privacy", text: "Privacy" },
          { link: "/api", text: "API Reference" },
          { link: "/recipes/portfolio-pills", text: "Portfolio Pills" },
          { link: "/recipes/ios-shortcut", text: "iOS Shortcut" }
        ],
        text: "Guides"
      }
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/deveshsangwan/portfolio-presence" }
    ]
  }
});
