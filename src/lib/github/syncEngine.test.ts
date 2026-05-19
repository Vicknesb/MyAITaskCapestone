import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// vi.hoisted ensures these mocks are defined before module imports during hoisting
const mockPrisma = vi.hoisted(() => ({
  syncLog: {
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  repository: {
    findUniqueOrThrow: vi.fn(),
  },
  metric: {
    upsert: vi.fn(),
  },
}));

vi.mock("../db", () => ({ prisma: mockPrisma }));
vi.mock("../crypto/tokenEncryption", () => ({
  decryptToken: vi.fn().mockReturnValue("ghp_mock_token"),
}));

import { runSync } from "./syncEngine";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_REPO = {
  id: "repo-id-1",
  full_name: "owner/repo",
  github_repo_id: 123,
  github_token_enc: "enc",
  token_iv: "iv",
  token_tag: "tag",
  default_branch: "main",
};

function makeGHCommit(daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    sha: `sha-${daysAgo}`,
    commit: { author: { name: "Author", email: "a@b.com", date }, message: "msg" },
    author: { login: "author", avatar_url: "https://github.com/author.png" },
  };
}

function makeGHPR(daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: daysAgo, number: daysAgo, state: "closed", title: "PR",
    created_at: date, closed_at: date, merged_at: date,
    user: { login: "author", avatar_url: "https://github.com/author.png" },
    requested_reviewers: [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runSync", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.syncLog.update.mockResolvedValue({});
    mockPrisma.syncLog.findFirst.mockResolvedValue(null);
    mockPrisma.repository.findUniqueOrThrow.mockResolvedValue(MOCK_REPO);
    mockPrisma.metric.upsert.mockResolvedValue({});

    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockGitHubSuccess(commits: unknown[], prs: unknown[]) {
    mockFetch.mockImplementation((url: string) => {
      const headers = { get: (_: string) => "100" };
      if ((url as string).includes("/commits")) {
        return Promise.resolve({
          ok: true, status: 200, headers,
          json: () => Promise.resolve(commits),
        });
      }
      return Promise.resolve({
        ok: true, status: 200, headers,
        json: () => Promise.resolve(prs),
      });
    });
  }

  it("marks sync RUNNING then SUCCESS on the happy path", async () => {
    mockGitHubSuccess([makeGHCommit(1), makeGHCommit(2)], [makeGHPR(1)]);

    await runSync("repo-id-1", "sync-log-id");

    expect(mockPrisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RUNNING" }) })
    );
    const lastCall = mockPrisma.syncLog.update.mock.calls.at(-1)![0];
    expect(lastCall.data.status).toBe("SUCCESS");
  });

  it("upserts 8 metric rows (4 types × 2 periods) on success", async () => {
    mockGitHubSuccess([makeGHCommit(1)], [makeGHPR(1)]);

    await runSync("repo-id-1", "sync-log-id");

    expect(mockPrisma.metric.upsert).toHaveBeenCalledTimes(8);
  });

  it("marks sync FAILED when GitHub API returns a non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      headers: { get: () => null },
    });

    await runSync("repo-id-1", "sync-log-id");

    const lastCall = mockPrisma.syncLog.update.mock.calls.at(-1)![0];
    expect(lastCall.data.status).toBe("FAILED");
    expect(lastCall.data.error_message).toContain("GitHub API 500");
  });

  it("marks sync FAILED and records error message on unexpected error", async () => {
    mockPrisma.repository.findUniqueOrThrow.mockRejectedValue(new Error("DB connection lost"));

    await runSync("repo-id-1", "sync-log-id");

    const lastCall = mockPrisma.syncLog.update.mock.calls.at(-1)![0];
    expect(lastCall.data.status).toBe("FAILED");
    expect(lastCall.data.error_message).toBe("DB connection lost");
  });

  it("uses last successful sync time as the 'since' query param", async () => {
    const lastSync = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    mockPrisma.syncLog.findFirst.mockResolvedValue({ last_synced_at: lastSync });
    mockGitHubSuccess([], []);

    await runSync("repo-id-1", "sync-log-id");

    const commitCall = mockFetch.mock.calls.find(
      (c) => (c[0] as string).includes("/commits")
    );
    expect(commitCall![0]).toContain(`since=${lastSync.toISOString()}`);
  });

  it("handles empty repo (GitHub 409) without failing the sync", async () => {
    mockFetch.mockImplementation((url: string) => {
      const headers = { get: () => null };
      if ((url as string).includes("/commits")) {
        return Promise.resolve({ ok: false, status: 409, headers });
      }
      return Promise.resolve({
        ok: true, status: 200, headers,
        json: () => Promise.resolve([]),
      });
    });

    await runSync("repo-id-1", "sync-log-id");

    const lastCall = mockPrisma.syncLog.update.mock.calls.at(-1)![0];
    expect(lastCall.data.status).toBe("SUCCESS");
  });

  it("records items_fetched as commit + PR count", async () => {
    const commits = [makeGHCommit(1), makeGHCommit(2)];
    const prs = [makeGHPR(1), makeGHPR(2), makeGHPR(3)];
    mockGitHubSuccess(commits, prs);

    await runSync("repo-id-1", "sync-log-id");

    const lastCall = mockPrisma.syncLog.update.mock.calls.at(-1)![0];
    expect(lastCall.data.items_fetched).toBe(5);
  });

  it("uses PR created_at as last_synced_at when commits array is empty", async () => {
    const pr = makeGHPR(3);
    mockGitHubSuccess([], [pr]);

    await runSync("repo-id-1", "sync-log-id");

    const lastCall = mockPrisma.syncLog.update.mock.calls.at(-1)![0];
    expect(lastCall.data.status).toBe("SUCCESS");
    expect(lastCall.data.last_synced_at.toISOString()).toBe(pr.created_at);
  });

  it("records String(err) when a non-Error value is thrown", async () => {
    mockPrisma.repository.findUniqueOrThrow.mockRejectedValue("plain string error");

    await runSync("repo-id-1", "sync-log-id");

    const lastCall = mockPrisma.syncLog.update.mock.calls.at(-1)![0];
    expect(lastCall.data.status).toBe("FAILED");
    expect(lastCall.data.error_message).toBe("plain string error");
  });
});
