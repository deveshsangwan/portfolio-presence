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
const ISO_8601_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function wakatimeSource(
  options: WakaTimeSourceOptions
): PresenceSource<BuildingPresenceCard> {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const apiKey = normalizeApiKey(options.apiKey);
  const projects = normalizeProjects(options.projects);
  const projectsByName = new Map(projects.map((project) => [project.name, project]));

  return {
    kind: "building",
    source: "wakatime",

    async getCard(context) {
      const fetchImpl = options.fetch ?? context.fetch;
      const activity = await fetchProjectActivity(apiBaseUrl, apiKey, fetchImpl);
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
  apiBaseUrl: string,
  apiKey: string,
  fetchImpl: FetchLike
) {
  let response: Response;

  try {
    response = await fetchImpl(`${apiBaseUrl}/users/current/projects`, {
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
    throw createInvalidWakaTimeResponseError();
  }

  if (!isRecord(payload)) {
    throw createInvalidWakaTimeResponseError();
  }

  if (payload.error !== undefined || payload.errors !== undefined) {
    throw new PresenceError("WakaTime API returned an error.", {
      code: "wakatime_api_error",
      status: 502
    });
  }

  if (!Array.isArray(payload.data)) {
    throw createInvalidWakaTimeResponseError();
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
    const timestamp = parseIsoDateTime(lastHeartbeatAt);

    if (timestamp === null || !config || (selected && timestamp <= selected.timestamp)) {
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

function parseIsoDateTime(value: string) {
  const match = ISO_8601_DATETIME.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function daysInMonth(year: number, month: number) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }

  return month >= 1 && month <= 12 ? 31 : 0;
}

function isLeapYear(year: number) {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function normalizeApiBaseUrl(apiBaseUrl: unknown) {
  const value = apiBaseUrl ?? WAKATIME_API_BASE_URL;
  let url: URL;

  if (typeof value !== "string") {
    throw createInvalidWakaTimeApiBaseUrlError();
  }

  try {
    url = new URL(value);
  } catch {
    throw createInvalidWakaTimeApiBaseUrlError();
  }

  if (url.protocol !== "https:" || url.search || url.hash) {
    throw createInvalidWakaTimeApiBaseUrlError();
  }

  return url.href.replace(/\/+$/, "");
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

  const normalizedProjects = projects.map(normalizeProject);
  const projectNames = new Set<string>();

  for (const project of normalizedProjects) {
    if (projectNames.has(project.name)) {
      throw createDuplicateWakaTimeProjectError();
    }

    projectNames.add(project.name);
  }

  return normalizedProjects;
}

function normalizeProject(project: unknown): NormalizedWakaTimeProject {
  if (typeof project === "string") {
    const name = project.trim();

    if (!name) {
      throw createInvalidWakaTimeProjectError();
    }

    return {
      name,
      title: titleFromSlug(name)
    };
  }

  if (!isRecord(project) || typeof project.name !== "string") {
    throw createInvalidWakaTimeProjectError();
  }

  const name = project.name.trim();

  if (!name) {
    throw createInvalidWakaTimeProjectError();
  }

  let publicLabel: string | undefined;

  if (project.label !== undefined) {
    publicLabel = typeof project.label === "string" ? project.label.trim() : "";

    if (!publicLabel) {
      throw createInvalidWakaTimeProjectError(
        "WakaTime project labels must not be blank."
      );
    }
  }

  const href = typeof project.href === "string" ? project.href : undefined;
  const safeHref = isHttpUrl(href) ? href : undefined;

  if (publicLabel && safeHref?.toLowerCase().includes(name.toLowerCase())) {
    throw createInvalidWakaTimeProjectError(
      "WakaTime project links must not contain an aliased project name."
    );
  }

  return withoutUndefined({
    href: safeHref,
    name,
    title: publicLabel || titleFromSlug(name)
  });
}

function createInvalidWakaTimeApiBaseUrlError() {
  return new PresenceError("WakaTime API base URL must be a valid HTTPS URL.", {
    code: "invalid_wakatime_api_base_url",
    status: 400
  });
}

function createDuplicateWakaTimeProjectError() {
  return new PresenceError("WakaTime project names must be unique.", {
    code: "duplicate_wakatime_project",
    status: 400
  });
}

function createInvalidWakaTimeProjectError(
  message = "Invalid WakaTime project config."
) {
  return new PresenceError(message, {
    code: "invalid_wakatime_project",
    status: 400
  });
}

function createInvalidWakaTimeResponseError() {
  return new PresenceError("WakaTime API returned an invalid response.", {
    code: "wakatime_invalid_response",
    status: 502
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
