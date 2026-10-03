import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModuleKind, transpileModule } from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        force: true,
        recursive: true
      })
    )
  );
});

describe("packed npm package", () => {
  it("can be consumed through root, next, and react exports", async () => {
    const consumerDir = await createConsumerProject();
    await writeConsumerFiles(consumerDir);

    execFileSync("pnpm", ["exec", "tsc", "-p", path.join(consumerDir, "tsconfig.json")], {
      cwd: root,
      stdio: "pipe"
    });

    const consumerSource = await readFile(path.join(consumerDir, "consumer.ts"), "utf8");
    const consumerModule = transpileModule(consumerSource, {
      compilerOptions: { module: ModuleKind.ESNext }
    });
    await writeFile(path.join(consumerDir, "consumer.mjs"), consumerModule.outputText);

    const output = execFileSync("node", [path.join(consumerDir, "runtime.mjs")], {
      cwd: consumerDir,
      encoding: "utf8"
    });

    expect(output.trim()).toBe("ok");
  });

  it("loads the Next example with WakaTime enabled and returns its public project", async () => {
    const consumerDir = await createConsumerProject();
    const exampleSource = await readFile(
      path.join(root, "examples", "next-basic", "lib", "presence.ts"),
      "utf8"
    );
    const exampleModule = transpileModule(exampleSource, {
      compilerOptions: { module: ModuleKind.ESNext }
    });
    await writeFile(path.join(consumerDir, "presence.mjs"), exampleModule.outputText);
    await writeFile(
      path.join(consumerDir, "example-runtime.mjs"),
      `
        globalThis.fetch = async (input) => {
          if (String(input) !== "https://api.wakatime.com/api/v1/users/current/projects") {
            throw new Error("Unexpected provider request.");
          }

          return Response.json({
            data: [{ name: "portfolio-presence", last_heartbeat_at: "2026-06-13T12:00:00Z" }]
          });
        };

        const { presence } = await import("./presence.mjs");
        const snapshot = await presence.getSnapshot();
        console.log(JSON.stringify(snapshot));
      `
    );

    const output = execFileSync("node", [path.join(consumerDir, "example-runtime.mjs")], {
      cwd: consumerDir,
      encoding: "utf8",
      env: { ...process.env, WAKATIME_API_KEY: "test-key" }
    });
    const snapshot: unknown = JSON.parse(output);

    expect(snapshot).toMatchObject({
      cards: expect.arrayContaining([
        {
          href: "https://github.com/deveshsangwan/portfolio-presence",
          kind: "building",
          label: "Building",
          source: "wakatime",
          stale: false,
          title: "Portfolio Presence",
          updatedAt: "2026-06-13T12:00:00.000Z"
        }
      ]),
      sources: { building: { status: "fresh" } }
    });
  });
});

async function createConsumerProject() {
  const dir = await mkdtemp(path.join(tmpdir(), "portfolio-presence-consumer-"));
  tempDirs.push(dir);

  const packageDir = path.join(dir, "node_modules", "portfolio-presence");
  const packDir = path.join(dir, "pack");
  await mkdir(packageDir, { recursive: true });
  await mkdir(packDir, { recursive: true });

  execFileSync("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: root,
    encoding: "utf8"
  });
  const tarballName = (await readdir(packDir)).find((file) =>
    /^portfolio-presence-.+\.tgz$/.test(file)
  );

  if (!tarballName) {
    throw new Error("Could not find packed portfolio-presence tarball.");
  }

  execFileSync(
    "tar",
    ["-xzf", path.join(packDir, tarballName), "-C", packageDir, "--strip-components=1"],
    {
      cwd: root,
      stdio: "pipe"
    }
  );

  await mkdir(path.join(dir, "node_modules", "@types"), { recursive: true });
  await symlink(path.join(root, "node_modules", "react"), path.join(dir, "node_modules", "react"), "dir");
  await symlink(
    path.join(root, "node_modules", "@types", "react"),
    path.join(dir, "node_modules", "@types", "react"),
    "dir"
  );

  return dir;
}

async function writeConsumerFiles(dir: string) {
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          react: "19.2.7"
        },
        name: "portfolio-presence-consumer",
        private: true,
        type: "module"
      },
      null,
      2
    )
  );

  await writeFile(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          jsx: "react-jsx",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022"
        },
        include: ["*.ts", "*.tsx"]
      },
      null,
      2
    )
  );

  await writeFile(
    path.join(dir, "consumer.ts"),
    `
      import {
        definePresence,
        githubSource,
        lastFmSource,
        memoryStore,
        playedEventSource,
        wakatimeSource,
        type GitHubSourceOptions,
        type PresenceSnapshot,
        type WakaTimeSourceOptions
      } from "portfolio-presence";
      import {
        createPlayedIngestHandler,
        createPresenceGetHandler
      } from "portfolio-presence/next";

      const store = memoryStore();
      const presence = definePresence({
        cache: {
          store,
          ttlSeconds: 1
        },
        fallbacks: {
          building: {
            title: "Investment Sync"
          },
          listening: {
            artist: "Sidhu Moose Wala",
            title: "PBX 1"
          }
        },
        sources: {
          playing: playedEventSource({ store })
        }
      });

      const _github = githubSource({
        repos: ["portfolio-presence"],
        username: "deveshsangwan"
      });
      const publicGithubOptions: GitHubSourceOptions = {
        excludeRepos: ["old-demo", "deveshsangwan/test-repo"],
        includeArchived: false,
        includeForks: false,
        mode: "public",
        username: "deveshsangwan"
      };
      const _publicGithub = githubSource(publicGithubOptions);
      const _lastfm = lastFmSource({
        apiKey: "test",
        username: "devesh"
      });
      const wakatimeOptions: WakaTimeSourceOptions = {
        apiKey: "server-secret",
        projects: [
          {
            href: "https://example.test/portfolio-presence",
            name: "portfolio-presence"
          }
        ]
      };
      const _wakatime = wakatimeSource(wakatimeOptions);

      const getHandler = createPresenceGetHandler(presence);
      const postHandler = createPlayedIngestHandler(presence, {
        secret: "secret"
      });

      const snapshot: PresenceSnapshot = await presence.getSnapshot();
      snapshot.cards.map((card) => card.title);
      getHandler satisfies () => Promise<Response>;
      postHandler satisfies (request: Request) => Promise<Response>;
    `
  );

  await writeFile(
    path.join(dir, "consumer.tsx"),
    `
      import { usePresence } from "portfolio-presence/react";

      export function PresenceConsumer() {
        const result = usePresence("/api/presence");
        return result.snapshot?.cards.length ?? null;
      }
    `
  );

  await writeFile(
    path.join(dir, "runtime.mjs"),
    `
      import "./consumer.mjs";
      import {
        definePresence,
        memoryStore,
        playedEventSource,
        wakatimeSource
      } from "portfolio-presence";
      import {
        createPlayedIngestHandler,
        createPresenceGetHandler
      } from "portfolio-presence/next";
      import { usePresence } from "portfolio-presence/react";

      const store = memoryStore();
      const presence = definePresence({
        cache: { store, ttlSeconds: 1 },
        sources: {
          playing: playedEventSource({ store })
        }
      });
      const POST = createPlayedIngestHandler(presence, { secret: "secret" });
      const GET = createPresenceGetHandler(presence);

      const writeResponse = await POST(new Request("https://example.test/api/presence/played", {
        body: JSON.stringify({ title: "MCOC", platform: "ios" }),
        headers: { authorization: "Bearer secret" },
        method: "POST"
      }));
      const readResponse = await GET();
      const snapshot = await readResponse.json();

      if (typeof usePresence !== "function" || typeof wakatimeSource !== "function") {
        throw new Error("Package exports did not load.");
      }

      if (writeResponse.status !== 201 || snapshot.cards[0]?.title !== "MCOC") {
        throw new Error("Packed runtime behavior failed.");
      }

      console.log("ok");
    `
  );

  const consumerPackage = await readFile(path.join(dir, "node_modules", "portfolio-presence", "package.json"), "utf8");
  expect(JSON.parse(consumerPackage).exports["./react"].types).toBe("./dist/react.d.ts");
}
