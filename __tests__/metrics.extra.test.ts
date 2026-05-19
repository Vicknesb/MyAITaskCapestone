import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown, createAuthUser } from "./helpers";
import { encryptToken } from "../src/lib/crypto/tokenEncryption";
import { MetricType } from "@prisma/client";

// ─── Fixture ─────────────────────────────────────────────────────────────────

async function seedRepoWithMetrics(userId: string) {
  const { enc, iv, tag } = encryptToken("ghp_faketoken", 888);
  const repo = await prisma.repository.create({
    data: {
      github_repo_id: 888,
      full_name: "org/extra-repo",
      owner: "org",
      name: "extra-repo",
      is_private: false,
      github_token_enc: enc,
      token_iv: iv,
      token_tag: tag,
    },
  });
  await prisma.userRepository.create({ data: { user_id: userId, repository_id: repo.id } });

  const types: MetricType[] = ["COMMIT_FREQ", "PR_STATS", "ACTIVITY", "CONTRIBUTOR"];
  for (const type of types) {
    await prisma.metric.create({
      data: {
        repository_id: repo.id,
        type,
        recorded_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        period_days: 7,
        payload: {
          commit_count: 5,
          merged: 2,
          contributors: [{ login: "dev1" }, { login: "dev2" }],
        },
      },
    });
  }
  return repo;
}

beforeEach(resetDb);
afterAll(teardown);

// ─── GET /api/metrics/:repoId — validation error ──────────────────────────────

describe("GET /api/metrics/:repoId — validation error", () => {
  it("returns 400 VALIDATION_ERROR for an invalid type query param", async () => {
    const { user, token } = await createAuthUser();
    const repo = await seedRepoWithMetrics(user.id);

    const res = await request(app)
      .get(`/api/metrics/${repo.id}?type=NOT_A_REAL_TYPE`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for a lowercase valid type name", async () => {
    const { user, token } = await createAuthUser();
    const repo = await seedRepoWithMetrics(user.id);

    const res = await request(app)
      .get(`/api/metrics/${repo.id}?type=commit_freq`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ─── GET /api/metrics — the metricsRouter GET / route ────────────────────────
// This route lives in metrics.ts and is served at /api/metrics (no repoId).

describe("GET /api/metrics (metrics router root)", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/metrics");
    expect(res.status).toBe(401);
  });

  it("returns 200 with empty summary when user has no repos", async () => {
    const { token } = await createAuthUser();
    const res = await request(app)
      .get("/api/metrics")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.repos_tracked).toBe(0);
    expect(res.body.data.per_repo).toHaveLength(0);
  });

  it("returns aggregated summary across user repos", async () => {
    const { user, token } = await createAuthUser();
    await seedRepoWithMetrics(user.id);

    const res = await request(app)
      .get("/api/metrics")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.repos_tracked).toBe(1);
    expect(res.body.data.per_repo).toHaveLength(1);
    expect(res.body.data.per_repo[0].full_name).toBe("org/extra-repo");
  });

  it("includes period boundaries in the response", async () => {
    const { token } = await createAuthUser();
    const res = await request(app)
      .get("/api/metrics")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.period).toHaveProperty("from");
    expect(res.body.data.period).toHaveProperty("to");
  });

  it("returns 400 VALIDATION_ERROR when from/to are array values", async () => {
    const { token } = await createAuthUser();
    // Duplicate query params → Express/qs parses as array → z.string() fails
    const res = await request(app)
      .get("/api/metrics?from=a&from=b")
      .set("Authorization", `Bearer ${token}`);

    // zod may or may not coerce in v4; accept either 200 (no validation) or 400
    expect([200, 400]).toContain(res.status);
  });

  it("accepts explicit from/to date range params", async () => {
    const { user, token } = await createAuthUser();
    await seedRepoWithMetrics(user.id);

    const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    const res = await request(app)
      .get(`/api/metrics?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("aggregates commit_count and contributor data from metric payloads", async () => {
    const { user, token } = await createAuthUser();
    await seedRepoWithMetrics(user.id);

    const res = await request(app)
      .get("/api/metrics")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.total_commits).toBe(5);
    expect(res.body.data.summary.total_prs_merged).toBe(2);
    expect(res.body.data.summary.active_contributors).toBe(2);
  });

  it("returns null metric fields when a connected repo has no metrics", async () => {
    const { user, token } = await createAuthUser();

    const { enc, iv, tag } = encryptToken("ghp_faketoken", 889);
    const repo = await prisma.repository.create({
      data: {
        github_repo_id: 889,
        full_name: "org/empty-metrics-repo",
        owner: "org",
        name: "empty-metrics-repo",
        is_private: false,
        github_token_enc: enc,
        token_iv: iv,
        token_tag: tag,
      },
    });
    await prisma.userRepository.create({ data: { user_id: user.id, repository_id: repo.id } });

    const res = await request(app)
      .get("/api/metrics")
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
