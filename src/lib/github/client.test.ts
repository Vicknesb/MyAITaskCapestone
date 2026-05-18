import { vi, describe, it, expect, afterEach } from "vitest";
import { fetchRepoMeta } from "./client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  mockFetch.mockReset();
});

const mockRepo = {
  id: 12345,
  full_name: "owner/repo",
  name: "repo",
  owner: { login: "owner" },
  description: "A test repo",
  private: false,
  default_branch: "main",
};

describe("fetchRepoMeta", () => {
  it("returns repo metadata on a successful 200 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockRepo),
    });

    const result = await fetchRepoMeta("owner/repo", "ghp_token123");
    expect(result).toMatchObject(mockRepo);
  });

  it("sends Authorization and Accept headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockRepo),
    });

    await fetchRepoMeta("owner/repo", "ghp_mytoken");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_mytoken",
          Accept: "application/vnd.github+json",
        }),
      })
    );
  });

  it("throws GITHUB_TOKEN_INVALID for a 401 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(fetchRepoMeta("owner/repo", "bad-token")).rejects.toMatchObject({
      code: "GITHUB_TOKEN_INVALID",
    });
  });

  it("throws GITHUB_TOKEN_INVALID for a 403 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    await expect(fetchRepoMeta("owner/repo", "bad-token")).rejects.toMatchObject({
      code: "GITHUB_TOKEN_INVALID",
    });
  });

  it("throws REPO_NOT_FOUND for a 404 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(fetchRepoMeta("owner/missing", "ghp_token")).rejects.toMatchObject({
      code: "REPO_NOT_FOUND",
    });
  });

  it("throws a generic error for other non-ok status codes", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(fetchRepoMeta("owner/repo", "ghp_token")).rejects.toThrow(
      "GitHub API error 500"
    );
  });

  it("throws a generic error for 503 service unavailable", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(fetchRepoMeta("owner/repo", "ghp_token")).rejects.toThrow(
      "GitHub API error 503"
    );
  });
});
