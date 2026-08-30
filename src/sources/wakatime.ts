import { PresenceError } from "../core/errors";
import type {
  BuildingPresenceCard,
  FetchLike,
  PresenceSource
} from "../core/types";
import { isHttpUrl, titleFromSlug, withoutUndefined } from "../core/utils";

export type WakaTimeProjectConfig =
  | string
  | {
      href?: string;
      label?: string;
      name: string;
    };

export interface WakaTimeSourceOptions {
  apiBaseUrl?: string;
  apiKey: string;
  fetch?: FetchLike;
  label?: string;
  projects: WakaTimeProjectConfig[];
}

interface NormalizedWakaTimeProject {
  href?: string;
  name: string;
  title: string;
}

interface SelectedWakaTimeProject {
  config: NormalizedWakaTimeProject;
  timestamp: number;
  updatedAt: string;
}

const WAKATIME_API_BASE_URL = "https://api.wakatime.com/api/v1";

export function wakatimeSource(
  options: WakaTimeSourceOptions
): PresenceSource<BuildingPresenceCard> {
  const apiKey = normalizeApiKey(options.apiKey);
  const projects = normalizeProjects(options.projects);
  const projectsByName = new Map(projects.map((project) => [project.name, project]));

  return {
    kind: "building",
    source: "wakatime",

    async getCard(context) {
      const fetchImpl = options.fetch ?? context.fetch;
      const activity = await fetchProjectActivity(options.apiBaseUrl, apiKey, fetchImpl);
      const selected = selectLatestAllowedProject(activity, projectsByName);

      if (!selected) {
        return null;
      }

      return withoutUndefined({
        href: selected.config.href,
        kind: "building" as const,
        label: options.label ?? "Building",
        source: "wakatime",
        title: selected.config.title,
        updatedAt: selected.updatedAt
      });
    }
  };
}

async function fetchProjectActivity(
  apiBaseUrl: string | undefined,
  apiKey: string,
  fetchImpl: FetchLike
) {
  const baseUrl = (apiBaseUrl ?? WAKATIME_API_BASE_URL).replace(/\/+$/, "");
  let response: Response;

  try {
    response = await fetchImpl(`${baseUrl}/users/current/projects`, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${btoa(apiKey)}`,
        "User-Agent": "portfolio-presence"
      }
    });
  } catch {
    throw new PresenceError("WakaTime request failed.", {
      code: "wakatime_request_failed",
      status: 502
    });
  }

  if (!response.ok) {
    throw new PresenceError(`WakaTime API returned ${response.status}.`, {
      code: "wakatime_request_failed",
      status: response.status
    });
  }

  return readProjectActivity(response);
}

async function readProjectActivity(response: Response): Promise<unknown[]> {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw invalidWakaTimeResponse();
  }

  if (!isRecord(payload)) {
    throw invalidWakaTimeResponse();
  }

  if (payload.error !== undefined || payload.errors !== undefined) {
    throw new PresenceError("WakaTime API returned an error.", {
      code: "wakatime_api_error",
      status: 502
    });
  }

  if (!Array.isArray(payload.data)) {
    throw invalidWakaTimeResponse();
  }

  return payload.data;
}

function selectLatestAllowedProject(
  activity: unknown[],
  projectsByName: Map<string, NormalizedWakaTimeProject>
) {
  let selected: SelectedWakaTimeProject | undefined;

  for (const candidate of activity) {
    if (!isRecord(candidate)) {
      continue;
    }

    const name = candidate.name;
    const lastHeartbeatAt = candidate.last_heartbeat_at;

    if (typeof name !== "string" || typeof lastHeartbeatAt !== "string") {
      continue;
    }

    const config = projectsByName.get(name);
    const timestamp = Date.parse(lastHeartbeatAt);

    if (!config || Number.isNaN(timestamp) || (selected && timestamp <= selected.timestamp)) {
      continue;
    }

    selected = {
      config,
      timestamp,
      updatedAt: new Date(timestamp).toISOString()
    };
  }

  return selected;
}

function normalizeApiKey(apiKey: unknown) {
  const normalized = typeof apiKey === "string" ? apiKey.trim() : "";

  if (!normalized) {
    throw new PresenceError("WakaTime source requires an API key.", {
      code: "wakatime_api_key_required",
      status: 400
    });
  }

  return normalized;
}

function normalizeProjects(projects: unknown) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new PresenceError("WakaTime source requires at least one allowlisted project.", {
      code: "wakatime_projects_required",
      status: 400
    });
  }

  return projects.map(normalizeProject);
}

function normalizeProject(project: unknown): NormalizedWakaTimeProject {
  if (typeof project === "string") {
    const name = project.trim();

    if (!name) {
      throw invalidWakaTimeProject();
    }

    return {
      name,
      title: titleFromSlug(name)
    };
  }

  if (!isRecord(project) || typeof project.name !== "string") {
    throw invalidWakaTimeProject();
  }

  const name = project.name.trim();

  if (!name) {
    throw invalidWakaTimeProject();
  }

  const publicLabel = typeof project.label === "string" ? project.label.trim() : undefined;
  const href = typeof project.href === "string" ? project.href : undefined;

  return withoutUndefined({
    href: isHttpUrl(href) ? href : undefined,
    name,
    title: publicLabel || titleFromSlug(name)
  });
}

function invalidWakaTimeProject() {
  return new PresenceError("Invalid WakaTime project config.", {
    code: "invalid_wakatime_project",
    status: 400
  });
}

function invalidWakaTimeResponse() {
  return new PresenceError("WakaTime API returned an invalid response.", {
    code: "wakatime_invalid_response",
    status: 502
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
