import { PresenceError } from "../core/errors";
import type {
  BuildingPresenceCard,
  FetchLike,
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

interface GitHubCommonOptions {
  apiBaseUrl?: string;
  fetch?: FetchLike;
  label?: string;
  sourceName?: string;
  token?: string;
  username: string;
}

export interface GitHubAllowlistOptions {
  allowPrivate?: boolean;
  mode?: "allowlist";
  repos: GitHubRepoConfig[];
}

export interface GitHubPublicOptions {
  excludeRepos?: string[];
  includeArchived?: boolean;
  includeForks?: boolean;
  mode: "public";
}

export type GitHubSourceOptions = GitHubCommonOptions &
  (GitHubAllowlistOptions | GitHubPublicOptions);

interface NormalizedRepoConfig {
  href?: string;
  label?: string;
  name: string;
  owner: string;
}

interface GitHubRepoResponse {
  archived?: boolean;
  description?: string | null;
  fork?: boolean;
  full_name?: string;
  html_url?: string;
  name?: string;
  owner?: {
    login?: string;
  };
  private?: boolean;
  pushed_at?: string | null;
  updated_at?: string | null;
}

interface SelectedGitHubRepo {
  config: NormalizedRepoConfig;
  response: GitHubRepoResponse;
}

const PUBLIC_REPOS_PER_PAGE = 100;

export function githubSource(options: GitHubSourceOptions): PresenceSource<BuildingPresenceCard> {
  if (options.mode === "public") {
    return createGitHubSource(options, (fetchImpl) => fetchLatestPublicRepo(options, fetchImpl));
  }

  if (!Array.isArray(options.repos) || options.repos.length === 0) {
    throw new PresenceError("GitHub source requires at least one allowlisted repo.", {
      code: "github_repos_required",
      status: 400
    });
  }

  const normalizedRepos = options.repos.map((repo) => normalizeRepoConfig(repo, options.username));

  return createGitHubSource(options, (fetchImpl) =>
    fetchLatestAllowlistedRepo(normalizedRepos, options, fetchImpl)
  );
}

function createGitHubSource(
  options: GitHubSourceOptions,
  resolveRepo: (fetchImpl: FetchLike) => Promise<SelectedGitHubRepo | null>
): PresenceSource<BuildingPresenceCard> {
  const sourceName = options.sourceName ?? "github";

  return {
    kind: "building",
    source: sourceName,

    async getCard(context) {
      const fetchImpl = options.fetch ?? context.fetch;
      const selected = await resolveRepo(fetchImpl);

      if (!selected) {
        return null;
      }

      return repoToCard(selected, options, sourceName);
    }
  };
}

async function fetchLatestAllowlistedRepo(
  normalizedRepos: NormalizedRepoConfig[],
  options: GitHubCommonOptions & GitHubAllowlistOptions,
  fetchImpl: FetchLike
) {
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

  visibleRepos.sort((left, right) => repoTimestamp(right.response) - repoTimestamp(left.response));

  return visibleRepos[0] ?? null;
}

async function fetchLatestPublicRepo(
  options: GitHubCommonOptions & GitHubPublicOptions,
  fetchImpl: FetchLike
) {
  const excludedRepos = createExcludedRepoSet(options.excludeRepos);
  let page = 1;

  while (true) {
    const result = await fetchPublicReposPage(options, fetchImpl, page);
    const selected = result.repos.find((repo) => isPublicRepoVisible(repo, options, excludedRepos));

    if (selected) {
      return {
        config: normalizeRepoResponseConfig(selected, options.username),
        response: selected
      };
    }

    if (!result.hasNextPage) {
      return null;
    }

    page += 1;
  }
}

async function fetchRepo(
  config: NormalizedRepoConfig,
  options: GitHubCommonOptions,
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

async function fetchPublicReposPage(
  options: GitHubCommonOptions & GitHubPublicOptions,
  fetchImpl: FetchLike,
  page: number
) {
  const baseUrl = options.apiBaseUrl ?? "https://api.github.com";
  const response = await fetchImpl(
    `${baseUrl}/users/${options.username}/repos?type=owner&sort=pushed&direction=desc&per_page=${PUBLIC_REPOS_PER_PAGE}&page=${page}`,
    {
      headers: githubHeaders(options.token)
    }
  );

  if (response.status === 404) {
    return {
      hasNextPage: false,
      repos: []
    };
  }

  if (!response.ok) {
    throw new PresenceError(`GitHub API returned ${response.status}.`, {
      code: "github_request_failed",
      status: response.status
    });
  }

  const repos = (await response.json()) as GitHubRepoResponse[];

  return {
    hasNextPage: hasNextLink(response.headers) || repos.length === PUBLIC_REPOS_PER_PAGE,
    repos
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

function repoToCard(
  selected: SelectedGitHubRepo,
  options: GitHubCommonOptions,
  sourceName: string
) {
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
    source: sourceName,
    title: selected.config.label ?? (isPrivate ? "Private project" : titleFromSlug(repoName)),
    updatedAt
  });
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

function normalizeRepoResponseConfig(
  repo: GitHubRepoResponse,
  username: string
): NormalizedRepoConfig {
  const [fullOwner, fullName] = repo.full_name?.split("/") ?? [];

  return {
    name: repo.name ?? fullName ?? "repository",
    owner: repo.owner?.login ?? fullOwner ?? username
  };
}

function createExcludedRepoSet(excludeRepos: string[] | undefined) {
  return new Set((excludeRepos ?? []).map(normalizeRepoKey).filter(Boolean));
}

function isPublicRepoVisible(
  repo: GitHubRepoResponse,
  options: GitHubPublicOptions,
  excludedRepos: Set<string>
) {
  if (repo.private) {
    return false;
  }

  if (repo.fork && !options.includeForks) {
    return false;
  }

  if (repo.archived && !options.includeArchived) {
    return false;
  }

  return !isExcludedRepo(repo, excludedRepos);
}

function isExcludedRepo(repo: GitHubRepoResponse, excludedRepos: Set<string>) {
  const repoName = repo.name ? normalizeRepoKey(repo.name) : undefined;
  const fullName = repo.full_name ? normalizeRepoKey(repo.full_name) : undefined;

  return Boolean(
    (repoName && excludedRepos.has(repoName)) || (fullName && excludedRepos.has(fullName))
  );
}

function normalizeRepoKey(repo: string) {
  return repo.trim().toLowerCase();
}

function hasNextLink(headers: Headers) {
  return headers.get("Link")?.includes('rel="next"') ?? false;
}

function repoTimestamp(repo: GitHubRepoResponse) {
  const timestamp = repo.pushed_at ?? repo.updated_at;

  if (!timestamp) {
    return 0;
  }

  return new Date(timestamp).getTime();
}
