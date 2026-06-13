import { PresenceError } from "../core/errors";
import type {
  BuildingPresenceCard,
  FetchLike,
  PresenceContext,
  PresenceSource
} from "../core/types";
import { isHttpUrl, titleFromSlug, withoutUndefined } from "../core/utils";

export type GitHubRepoConfig =
  | string
  | {
      href?: string;
      label?: string;
      name: string;
      owner?: string;
    };

export interface GitHubSourceOptions {
  allowPrivate?: boolean;
  apiBaseUrl?: string;
  fetch?: FetchLike;
  label?: string;
  repos: GitHubRepoConfig[];
  sourceName?: string;
  token?: string;
  username: string;
}

interface NormalizedRepoConfig {
  href?: string;
  label?: string;
  name: string;
  owner: string;
}

interface GitHubRepoResponse {
  description?: string | null;
  fork?: boolean;
  full_name?: string;
  html_url?: string;
  name?: string;
  private?: boolean;
  pushed_at?: string | null;
  updated_at?: string | null;
}

export function githubSource(options: GitHubSourceOptions): PresenceSource<BuildingPresenceCard> {
  const normalizedRepos = options.repos.map((repo) =>
    normalizeRepoConfig(repo, options.username)
  );

  if (normalizedRepos.length === 0) {
    throw new PresenceError("GitHub source requires at least one allowlisted repo.", {
      code: "github_repos_required",
      status: 400
    });
  }

  return {
    kind: "building",
    source: options.sourceName ?? "github",

    async getCard(context) {
      const fetchImpl = options.fetch ?? context.fetch;
      const repos = await Promise.allSettled(
        normalizedRepos.map((repo) => fetchRepo(repo, options, fetchImpl))
      );

      const visibleRepos = repos
        .flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []))
        .filter((repo) => {
          if (!repo.response.private) {
            return true;
          }

          return Boolean(options.allowPrivate);
        });

      if (visibleRepos.length === 0) {
        const firstError = repos.find((result) => result.status === "rejected");

        if (firstError?.status === "rejected") {
          throw firstError.reason;
        }

        return null;
      }

      visibleRepos.sort(
        (left, right) => repoTimestamp(right.response) - repoTimestamp(left.response)
      );

      const selected = visibleRepos[0];

      if (!selected) {
        return null;
      }

      const repoName = selected.response.name ?? selected.config.name;
      const isPrivate = Boolean(selected.response.private);
      const updatedAt = selected.response.pushed_at ?? selected.response.updated_at ?? undefined;
      const href = isPrivate ? selected.config.href : selected.config.href ?? selected.response.html_url;

      return withoutUndefined({
        description: selected.response.description ?? undefined,
        href: isHttpUrl(href) ? href : undefined,
        kind: "building" as const,
        label: options.label ?? "Building",
        repo: isPrivate ? undefined : selected.response.full_name,
        source: options.sourceName ?? "github",
        title: selected.config.label ?? (isPrivate ? "Private project" : titleFromSlug(repoName)),
        updatedAt
      });
    }
  };
}

async function fetchRepo(
  config: NormalizedRepoConfig,
  options: GitHubSourceOptions,
  fetchImpl: FetchLike
) {
  const baseUrl = options.apiBaseUrl ?? "https://api.github.com";
  const response = await fetchImpl(`${baseUrl}/repos/${config.owner}/${config.name}`, {
    headers: githubHeaders(options.token)
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new PresenceError(`GitHub API returned ${response.status}.`, {
      code: "github_request_failed",
      status: response.status
    });
  }

  return {
    config,
    response: (await response.json()) as GitHubRepoResponse
  };
}

function githubHeaders(token: string | undefined) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "portfolio-presence",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function normalizeRepoConfig(repo: GitHubRepoConfig, username: string): NormalizedRepoConfig {
  if (typeof repo === "string") {
    const [ownerOrName, maybeName] = repo.split("/");

    if (!ownerOrName) {
      throw new PresenceError("Invalid GitHub repo config.", {
        code: "invalid_github_repo",
        status: 400
      });
    }

    return {
      name: maybeName ?? ownerOrName,
      owner: maybeName ? ownerOrName : username
    };
  }

  return withoutUndefined({
    href: repo.href,
    label: repo.label,
    name: repo.name,
    owner: repo.owner ?? username
  });
}

function repoTimestamp(repo: GitHubRepoResponse) {
  const timestamp = repo.pushed_at ?? repo.updated_at;

  if (!timestamp) {
    return 0;
  }

  return new Date(timestamp).getTime();
}
