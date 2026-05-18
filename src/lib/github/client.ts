export interface GitHubRepoMeta {
  id:             number;
  full_name:      string;
  name:           string;
  owner:          { login: string };
  description:    string | null;
  private:        boolean;
  default_branch: string;
}

export interface GitHubError extends Error {
  code: string;
}

export async function fetchRepoMeta(
  fullName: string,
  token: string
): Promise<GitHubRepoMeta> {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (res.status === 401 || res.status === 403) {
    const err = new Error("GitHub token invalid or insufficient permissions") as GitHubError;
    err.code = "GITHUB_TOKEN_INVALID";
    throw err;
  }
  if (res.status === 404) {
    const err = new Error("Repository not found on GitHub") as GitHubError;
    err.code = "REPO_NOT_FOUND";
    throw err;
  }
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}`);
  }

  return res.json() as Promise<GitHubRepoMeta>;
}
