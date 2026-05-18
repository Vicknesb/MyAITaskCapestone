import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown, createAuthUser } from "./helpers";
import { encryptToken } from "../src/lib/crypto/tokenEncryption";
import { MetricType } from "@prisma/client";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

async function seedRepoWithMetrics(userId: string) {
  const { enc, iv, tag } = encryptToken("ghp_faketoken", 777);
  const repo = await prisma.repository.create({
    data: {
      github_repo_id: 777, full_name: "org/metrics-repo",
      owner: "org", name: "metrics-repo", is_private: false,
      github_token_enc: enc, token_iv: iv, token_tag: tag,
    },
  });
  await prisma.userRepository.create({ data: { user_id: userId, repository_id: repo.id } });

  const now = new Date();
  const types: MetricType[] = ["COMMIT_FREQ", "PR_STATS", "ACTIVITY", "CONTRIBUTOR"];
  for (const type of types) {
    await prisma.metric.create({
      data: {
        repository_id: repo.id, type,
        recorded_at: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        period_days: 7,
        payload: { stub: true, type },
      },
    });
  }
  return repo;
}

beforeEach(resetDb);
afterAll(teardown);

// ─── GET /api/metrics/:repoId ─────────────────────────────────────────────────

describe("GET /api/metrics/:repoId", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/metrics/some-id");
    expect(res.status).toBe(401);
  });

  it("returns metrics for a repo the user owns", async () => {
    const { user, token } = await createAuthUser();
    const repo = await seedRepoWithMetrics(user.id);

    const res = await request(app)
      .get(`/api/metrics/${repo.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.metrics.length).toBe(4);
    expect(res.body.data.repository.full_name).toBe("org/metrics-repo");
  });

  it("filters metrics by type query param", async () => {
    const { user, token } = await createAuthUser();
    const repo = await seedRepoWithMetrics(user.id);

    const res = await request(app)
      .get(`/api/metrics/${repo.id}?type=COMMIT_FREQ`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.metrics).toHaveLength(1);
    expect(res.body.data.metrics[0].type).toBe("COMMIT_FREQ");
  });

  it("returns 403 FORBIDDEN for a repo the user does not own", async () => {
    const { user: alice } = await createAuthUser("alice@m.com");
    const { token: bobToken } = await createAuthUser("bob@m.com");
    const repo = await seedRepoWithMetrics(alice.id);

    const res = await request(app)
      .get(`/api/metrics/${repo.id}`)
      .set("Authorization", `Bearer ${bobToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("returns 404 for a non-existent repoId", async () => {
    const { token } = await createAuthUser();
    const res = await request(app)
      .get("/api/metrics/does-not-exist")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("filters by date range — returns nothing when range excludes all metrics", async () => {
    const { user, token } = await createAuthUser();
    const repo = await seedRepoWithMetrics(user.id);

    // Metrics are 5 days ago; request range is 1 year ago to 6 months ago
    const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const to   = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .get(`/api/metrics/${repo.id}?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.metrics).toHaveLength(0);
  });
});

// ─── GET /api/dashboard ──────────────────────────────────────────────────────

describe("GET /api/dashboard", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns summary counts across all user repos", async () => {
    const { user, token } = await createAuthUser();
    await seedRepoWithMetrics(user.id);

    const res = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("summary");
    expect(res.body.data.summary.repos_tracked).toBe(1);
    expect(res.body.data).toHaveProperty("per_repo");
    expect(res.body.data.per_repo).toHaveLength(1);
  });

  it("returns empty summary when user has no repos", async () => {
    const { token } = await createAuthUser();
    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.repos_tracked).toBe(0);
  });
});
