import { describe, expect, it } from "vitest";
import {
  wakatimeSource,
  type FetchLike,
  type WakaTimeSourceOptions
} from "../src";

const context = {
  fetch,
  now: new Date("2026-06-13T12:30:00.000Z")
};

describe("wakatimeSource", () => {
  it("selects the newest allowed project and normalizes its timestamp", async () => {
    const fetchMock: FetchLike = async () =>
      Response.json({
        data: [
          {
            last_heartbeat_at: "2026-06-13T14:00:00.000Z",
            name: "not-public"
          },
          {
            last_heartbeat_at: "2026-06-13T12:00:00+05:30",
            name: "older-project"
          },
          {
            last_heartbeat_at: "2026-06-13T11:00:00.000Z",
            name: "latest-project"
          }
        ]
      });
    const source = wakatimeSource({
      apiKey: "secret",
      fetch: fetchMock,
      label: "Working on",
      projects: ["older-project", "latest-project"]
    });

    const card = await source.getCard(context);

    expect(card).toEqual({
      kind: "building",
      label: "Working on",
      source: "wakatime",
      title: "Latest Project",
      updatedAt: "2026-06-13T11:00:00.000Z"
    });
  });

  it("maps an allowlisted private name to its public alias and safe link", async () => {
    const privateName = "secret-client-platform";
    const fetchMock: FetchLike = async () =>
      Response.json({
        data: [
          {
            badge: "private-provider-data",
            last_heartbeat_at: "2026-06-13T10:00:00Z",
            name: privateName,
            repository: "private/repository"
          }
        ]
      });
    const source = wakatimeSource({
      apiKey: "secret",
      fetch: fetchMock,
      projects: [
        {
          href: "https://example.test/products/platform",
          label: "Customer Platform",
          name: privateName
        }
      ]
    });

    const card = await source.getCard(context);

    expect(card).toEqual({
      href: "https://example.test/products/platform",
      kind: "building",
      label: "Building",
      source: "wakatime",
      title: "Customer Platform",
      updatedAt: "2026-06-13T10:00:00.000Z"
    });
    expect(JSON.stringify(card)).not.toContain(privateName);
    expect(JSON.stringify(card)).not.toContain("private/repository");
  });

  it("rejects duplicate normalized project names", () => {
    expect(() =>
      wakatimeSource({
        apiKey: "secret",
        projects: [
          {
            label: "Customer Platform",
            name: " private-client-platform "
          },
          "private-client-platform"
        ]
      })
    ).toThrowError(
      expect.objectContaining({
        code: "duplicate_wakatime_project",
        status: 400
      })
    );
  });

  it("rejects a blank public alias", () => {
    expect(() =>
      wakatimeSource({
        apiKey: "secret",
        projects: [
          {
            label: "   ",
            name: "private-client-platform"
          }
        ]
      })
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_wakatime_project",
        message: "WakaTime project labels must not be blank.",
        status: 400
      })
    );
  });

  it("rejects an aliased link that contains the private project name", () => {
    expect(() =>
      wakatimeSource({
        apiKey: "secret",
        projects: [
          {
            href: "https://example.test/projects/PRIVATE-CLIENT-PLATFORM",
            label: "Customer Platform",
            name: "private-client-platform"
          }
        ]
      })
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_wakatime_project",
        message: "WakaTime project links must not contain an aliased project name.",
        status: 400
      })
    );
  });

  it("drops unsafe project links", async () => {
    const fetchMock: FetchLike = async () =>
      Response.json({
        data: [
          {
            last_heartbeat_at: "2026-06-13T10:00:00.000Z",
            name: "portfolio-presence"
          }
        ]
      });
    const source = wakatimeSource({
      apiKey: "secret",
      fetch: fetchMock,
      projects: [
        {
          href: "javascript:alert(document.cookie)",
          name: "portfolio-presence"
        }
      ]
    });

    await expect(source.getCard(context)).resolves.toEqual({
      kind: "building",
      label: "Building",
      source: "wakatime",
      title: "Portfolio Presence",
      updatedAt: "2026-06-13T10:00:00.000Z"
    });
  });

  it("returns null when no valid allowed activity exists", async () => {
    const fetchMock: FetchLike = async () =>
      Response.json({
        data: [
          null,
          { last_heartbeat_at: "not-a-date", name: "allowed" },
          { last_heartbeat_at: "2026-06-13T12:00:00.000Z", name: "not-allowed" },
          { name: "allowed" }
        ]
      });
    const source = wakatimeSource({
      apiKey: "secret",
      fetch: fetchMock,
      projects: ["allowed"]
    });

    await expect(source.getCard(context)).resolves.toBeNull();
  });

  it.each([
    "2026-02-30T12:00:00.000Z",
    "2025-02-29T12:00:00.000Z",
    "2026-06-13 12:00:00.000Z"
  ])("ignores the parseable invalid datetime %s", async (lastHeartbeatAt) => {
    expect(Number.isNaN(Date.parse(lastHeartbeatAt))).toBe(false);
    const fetchMock: FetchLike = async () =>
      Response.json({
        data: [
          {
            last_heartbeat_at: lastHeartbeatAt,
            name: "portfolio-presence"
          }
        ]
      });
    const source = wakatimeSource({
      apiKey: "secret",
      fetch: fetchMock,
      projects: ["portfolio-presence"]
    });

    await expect(source.getCard(context)).resolves.toBeNull();
  });

  it("returns null for an empty project list", async () => {
    const fetchMock: FetchLike = async () => Response.json({ data: [] });
    const source = wakatimeSource({
      apiKey: "secret",
      fetch: fetchMock,
      projects: ["portfolio-presence"]
    });

    await expect(source.getCard(context)).resolves.toBeNull();
  });

  it("authenticates the project-level request without putting the key in the URL", async () => {
    const requests: Array<{ init: RequestInit | undefined; url: string }> = [];
    const fetchMock: FetchLike = async (input, init) => {
      requests.push({ init, url: String(input) });
      return Response.json({ data: [] });
    };
    const options: WakaTimeSourceOptions = {
      apiBaseUrl: "https://wakatime.example/api/v1/",
      apiKey: "server-secret",
      fetch: fetchMock,
      projects: ["portfolio-presence"]
    };
    const source = wakatimeSource(options);

    await source.getCard(context);

    expect(requests).toEqual([
      {
        init: {
          headers: {
            Accept: "application/json",
            Authorization: "Basic c2VydmVyLXNlY3JldA==",
            "User-Agent": "portfolio-presence"
          }
        },
        url: "https://wakatime.example/api/v1/users/current/projects"
      }
    ]);
    expect(requests[0]?.url).not.toContain("server-secret");
  });

  it.each(["not a url", "http://wakatime.example/api/v1"])(
    "rejects the API base URL %s before making a request",
    (apiBaseUrl) => {
      let requestCount = 0;
      const fetchMock: FetchLike = async () => {
        requestCount += 1;
        return Response.json({ data: [] });
      };

      expect(() =>
        wakatimeSource({
          apiBaseUrl,
          apiKey: "server-secret",
          fetch: fetchMock,
          projects: ["portfolio-presence"]
        })
      ).toThrowError(
        expect.objectContaining({
          code: "invalid_wakatime_api_base_url",
          status: 400
        })
      );
      expect(requestCount).toBe(0);
    }
  );

  it.each([
    ["missing data", {}, "wakatime_invalid_response"],
    ["non-array data", { data: {} }, "wakatime_invalid_response"],
    ["provider error", { error: "unauthorized" }, "wakatime_api_error"],
    ["provider errors", { errors: [{ error: "rate limited" }] }, "wakatime_api_error"]
  ])("reports %s with a stable error code", async (_name, payload, code) => {
    const fetchMock: FetchLike = async () => Response.json(payload);
    const source = wakatimeSource({
      apiKey: "secret",
      fetch: fetchMock,
      projects: ["portfolio-presence"]
    });

    await expect(source.getCard(context)).rejects.toMatchObject({
      code,
      status: 502
    });
  });

  it("reports invalid JSON with a stable error code", async () => {
    const fetchMock: FetchLike = async () =>
      new Response("not json", {
        headers: { "Content-Type": "application/json" }
      });
    const source = wakatimeSource({
      apiKey: "secret",
      fetch: fetchMock,
      projects: ["portfolio-presence"]
    });

    await expect(source.getCard(context)).rejects.toMatchObject({
      code: "wakatime_invalid_response",
      status: 502
    });
  });

  it("reports HTTP and network failures with a stable error code", async () => {
    const httpSource = wakatimeSource({
      apiKey: "secret",
      fetch: async () => new Response(null, { status: 429 }),
      projects: ["portfolio-presence"]
    });
    const networkSource = wakatimeSource({
      apiKey: "secret",
      fetch: async () => {
        throw new TypeError("connection reset");
      },
      projects: ["portfolio-presence"]
    });

    await expect(httpSource.getCard(context)).rejects.toMatchObject({
      code: "wakatime_request_failed",
      status: 429
    });
    await expect(networkSource.getCard(context)).rejects.toMatchObject({
      code: "wakatime_request_failed",
      status: 502
    });
  });

  it("validates credentials and the allowlist at construction", () => {
    expect(() =>
      wakatimeSource({
        apiKey: "",
        projects: ["portfolio-presence"]
      })
    ).toThrowError(
      expect.objectContaining({
        code: "wakatime_api_key_required",
        status: 400
      })
    );
    expect(() =>
      wakatimeSource({
        apiKey: "secret",
        projects: []
      })
    ).toThrowError(
      expect.objectContaining({
        code: "wakatime_projects_required",
        status: 400
      })
    );
  });
});
