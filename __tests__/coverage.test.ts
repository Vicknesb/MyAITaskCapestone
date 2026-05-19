/**
 * Additional tests that close branch-coverage gaps identified by the coverage report.
 * Covers: validation boundaries, auth edge cases, repo cascades, date-range guards.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown, createAuthUser } from "./helpers";
import { encryptToken } from "../src/lib/crypto/tokenEncryption";

// Mock GitHub client so no real HTTP calls are made
vi.mock("../src/lib/github/client", () => ({
  fetchRepoMeta: vi.fn(),
}));
import { fetchRepoMeta } from "../src/lib/github/client";
const mockFetchRepo = vi.mocked(fetchRepoMeta);

beforeEach(async () => {
  await resetDb();
  mockFetchRepo.mockResolvedValue({
    id: 400001,
    full_name: "org/cov-repo",
    name: "cov-repo",
    owner: { login: "org" },
    description: null,
    private: false,
    default_branch: "main",
  });
});
afterAll(teardown);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedRepo(userId: string, githubId = 500001) {
  const { enc, iv, tag } = encryptToken("ghp_faketoken123456", githubId);
  const repo = await prisma.repository.create({
    data: {
      github_repo_id: githubId,
      full_name: `org/repo-${githubId}`,
      owner: "org",
      name: `repo-${githubId}`,
      is_private: false,
      github_token_enc: enc,
      token_iv: iv,
      token_tag: tag,
    },
  });
  const link = await prisma.userRepository.create({
    data: { user_id: userId, repository_id: repo.id },
  });
  return { repo, link };
}

// ─── Auth — input validation boundaries ──────────────────────────────────────

describe("POST /api/auth/register — input validation boundaries", () => {
  it("returns 400 when password exceeds 128 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "long@example.com", password: "A1!".repeat(50) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when name exceeds 100 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "nm@example.com", password: "Password123!", name: "x".repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("succeeds when name is exactly 100 characters (boundary)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "nm100@example.com", password: "Password123!", name: "x".repeat(100) });

    expect(res.status).toBe(201);
  });
});

// ─── Auth — GET /me response shape ───────────────────────────────────────────

describe("GET /api/auth/me — response shape", () => {
  it("returns id, email, name, and created_at — never password_hash", async () => {
    const { token } = await createAuthUser("shape@example.com");
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data).toHaveProperty("email", "shape@example.com");
    expect(res.body.data).toHaveProperty("created_at");
    expect(res.body.data).not.toHaveProperty("password_hash");
  });

  it("returns 401 for a valid JWT that was signed with the correct secret but has no matching session", async () => {
    const { signToken } = await import("../src/lib/auth/jwt");
    // Token is cryptographically valid but no session row exists for it
    const orphanToken = signToken("nonexistent-user-id", "nonexistent-session-id");

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${orphanToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });
});

// ─── Repos — connect validation ───────────────────────────────────────────────

describe("POST /api/repos/connect — token too short", () => {
  it("returns 400 VALIDATION_ERROR when github_token is under 20 characters", async () => {
    const { token } = await createAuthUser();
    const res = await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "org/repo", github_token: "short" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when full_name contains only owner (no slash)", async () => {
    const { token } = await createAuthUser();
    const res = await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "justowner", github_token: "ghp_avalidtoken123456" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ─── Repos — path traversal ───────────────────────────────────────────────────

describe("GET /api/repos/:id/files — path traversal protection", () => {
  it("returns 400 INVALID_PATH for a path containing '..'", async () => {
    const { user, token } = await createAuthUser();
    const { repo } = await seedRepo(user.id, 500010);

    const res = await request(app)
      .get(`/api/repos/${repo.id}/files?path=src/../etc/passwd`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PATH");
  });

  it("returns 400 INVALID_PATH for a path with disallowed characters", async () => {
    const { user, token } = await createAuthUser();
    const { repo } = await seedRepo(user.id, 500011);

    const res = await request(app)
      .get(`/api/repos/${repo.id}/files?path=src/<script>`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PATH");
  });

  it("allows a clean nested path", async () => {
    const { user, token } = await createAuthUser();
    const { repo } = await seedRepo(user.id, 500012);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve([]),
    }));

    const res = await request(app)
      .get(`/api/repos/${repo.id}/files?path=src/lib/utils`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });
});

// ─── Repos — cascade delete ───────────────────────────────────────────────────

describe("DELETE /api/repos/:id — cascade behaviour", () => {
  it("does NOT delete the repository row when a second user is still connected", async () => {
    const { user: alice, token: aliceToken } = await createAuthUser("alice@cov.com");
    const { user: bob } = await createAuthUser("bob@cov.com");

    const { repo, link: aliceLink } = await seedRepo(alice.id, 500020);
    // Bob also connects to the same repo
    await prisma.userRepository.create({
      data: { user_id: bob.id, repository_id: repo.id },
    });

    const res = await request(app)
      .delete(`/api/repos/${aliceLink.id}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    // Repository must still exist because Bob is still connected
    const stillExists = await prisma.repository.findUnique({ where: { id: repo.id } });
    expect(stillExists).not.toBeNull();
  });

  it("deletes the repository row when the last user disconnects", async () => {
    const { user, token } = await createAuthUser("last@cov.com");
    const { repo, link } = await seedRepo(user.id, 500021);

    const res = await request(app)
      .delete(`/api/repos/${link.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const gone = await prisma.repository.findUnique({ where: { id: repo.id } });
    expect(gone).toBeNull();
  });
});

// ─── Metrics / Dashboard — date range validation ──────────────────────────────

describe("GET /api/metrics/:repoId — date range validation", () => {
  it("returns 400 VALIDATION_ERROR when from is after to", async () => {
    const { user, token } = await createAuthUser();
    const { repo } = await seedRepo(user.id, 500030);

    const from = new Date().toISOString();
    const to   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // yesterday

    const res = await request(app)
      .get(`/api/metrics/${repo.id}?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when date range exceeds 90 days", async () => {
    const { user, token } = await createAuthUser();
    const { repo } = await seedRepo(user.id, 500031);

    const from = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const to   = new Date().toISOString();

    const res = await request(app)
      .get(`/api/metrics/${repo.id}?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 when date range is exactly 90 days (boundary)", async () => {
    const { user, token } = await createAuthUser();
    const { repo } = await seedRepo(user.id, 500032);

    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const to   = new Date().toISOString();

    const res = await request(app)
      .get(`/api/metrics/${repo.id}?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe("GET /api/dashboard — date range validation", () => {
  it("returns 400 VALIDATION_ERROR when from is after to", async () => {
    const { token } = await createAuthUser();

    const from = new Date().toISOString();
    const to   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .get(`/api/dashboard?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when date range exceeds 90 days", async () => {
    const { token } = await createAuthUser();

    const from = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const to   = new Date().toISOString();

    const res = await request(app)
      .get(`/api/dashboard?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ─── Dashboard — aggregate summary with real payloads ─────────────────────────

describe("GET /api/dashboard — aggregate summary", () => {
  it("sums commit_count, merged PRs, and unique contributors across repos", async () => {
    const { user, token } = await createAuthUser();
    const { repo } = await seedRepo(user.id, 500040);

    await prisma.metric.createMany({
      data: [
        {
          repository_id: repo.id,
          type: "COMMIT_FREQ",
          period_days: 30,
          recorded_at: new Date(),
          payload: { commit_count: 10, author_breakdown: [] },
        },
        {
          repository_id: repo.id,
          type: "PR_STATS",
          period_days: 30,
          recorded_at: new Date(),
          payload: { merged: 4, open: 1, closed: 2, avg_merge_time_hrs: 3, review_count: 5 },
        },
        {
          repository_id: repo.id,
          type: "CONTRIBUTOR",
          period_days: 30,
          recorded_at: new Date(),
          payload: { contributors: [{ login: "alice" }, { login: "bob" }] },
        },
      ],
    });

    const res = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.total_commits).toBe(10);
    expect(res.body.data.summary.total_prs_merged).toBe(4);
    expect(res.body.data.summary.active_contributors).toBe(2);
  });
});

// ─── Dashboard — repo connected but no metrics ────────────────────────────────

describe("GET /api/dashboard — repo with no metrics in range", () => {
  it("returns null for all metric fields when repo has no metrics", async () => {
    const { user, token } = await createAuthUser();
    // Connect a repo but seed zero metrics for it
    const { enc, iv, tag } = encryptToken("ghp_faketoken123456", 600001);
    const repo = await prisma.repository.create({
      data: {
        github_repo_id: 600001,
        full_name: "org/no-metrics-repo",
        owner: "org",
        name: "no-metrics-repo",
        is_private: false,
        github_token_enc: enc,
        token_iv: iv,
        token_tag: tag,
      },
    });
    await prisma.userRepository.create({
      data: { user_id: user.id, repository_id: repo.id },
    });

    const res = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.repos_tracked).toBe(1);
    const entry = res.body.data.per_repo[0];
    expect(entry.commit_freq).toBeNull();
    expect(entry.pr_stats).toBeNull();
    expect(entry.activity).toBeNull();
    expect(entry.contributors).toBeNull();
  });
});

// ─── 404 catch-all ────────────────────────────────────────────────────────────

describe("Express 404 catch-all", () => {
  it("returns 404 NOT_FOUND for unknown routes", async () => {
    const res = await request(app).get("/api/does-not-exist-at-all");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
