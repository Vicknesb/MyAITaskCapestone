/**
 * Targeted edge-case tests that close specific branch gaps identified
 * by the coverage report.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown, createAuthUser } from "./helpers";
import { encryptToken } from "../src/lib/crypto/tokenEncryption";

// Mock fetchRepoMeta so connect tests never call the real GitHub API
vi.mock("../src/lib/github/client", () => ({
  fetchRepoMeta: vi.fn(),
}));

import { fetchRepoMeta } from "../src/lib/github/client";
const mockFetchRepo = vi.mocked(fetchRepoMeta);

beforeEach(async () => {
  await resetDb();
  mockFetchRepo.mockResolvedValue({
    id: 300001, full_name: "org/edge-repo", name: "edge-repo",
    owner: { login: "org" }, description: null,
    private: false, default_branch: "main",
  });
});
afterAll(teardown);

// ─── POST /api/auth/login — validation error (auth.ts:69-71) ─────────────────

describe("POST /api/auth/login — validation error branch", () => {
  it("returns 400 VALIDATION_ERROR when body has no password field", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com" }); // missing password

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when body is completely empty", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ─── GET /api/repos — with completed sync log (repos.ts:42-43) ───────────────

describe("GET /api/repos — sync log with last_synced_at set", () => {
  it("returns last_synced_at and sync_status from the most recent completed sync", async () => {
    const { user, token } = await createAuthUser();

    const { enc, iv, tag } = encryptToken("ghp_faketoken", 300002);
    const repo = await prisma.repository.create({
      data: {
        github_repo_id: 300002,
        full_name: "org/synced-repo",
        owner: "org",
        name: "synced-repo",
        is_private: false,
        github_token_enc: enc,
        token_iv: iv,
        token_tag: tag,
      },
    });
    await prisma.userRepository.create({ data: { user_id: user.id, repository_id: repo.id } });

    const syncedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 h ago
    await prisma.syncLog.create({
      data: {
        repository_id: repo.id,
        triggered_by: "manual",
        status: "SUCCESS",
        last_synced_at: syncedAt,
        finished_at: syncedAt,
        items_fetched: 42,
      },
    });

    const res = await request(app)
      .get("/api/repos")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const returned = res.body.data.repositories[0];
    expect(returned.sync_status).toBe("SUCCESS");
    expect(returned.last_synced_at).toBeDefined();
    expect(new Date(returned.last_synced_at).toISOString()).toBe(syncedAt.toISOString());
  });
});

// ─── POST /api/repos/connect — REPO_NOT_FOUND from GitHub (repos.ts:75-76) ───

describe("POST /api/repos/connect — REPO_NOT_FOUND branch", () => {
  it("returns 404 when GitHub cannot find the repository", async () => {
    const { token } = await createAuthUser();

    const notFoundErr = Object.assign(new Error("Repository not found on GitHub"), {
      code: "REPO_NOT_FOUND",
    });
    mockFetchRepo.mockRejectedValueOnce(notFoundErr);

    const res = await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "org/nonexistent", github_token: "ghp_avalidtoken123456" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("REPO_NOT_FOUND");
  });

  it("returns 500 for an unexpected error from GitHub (no matching error code)", async () => {
    const { token } = await createAuthUser();

    const unknownErr = Object.assign(new Error("Unexpected upstream error"), {
      code: "SOME_UNKNOWN_CODE",
    });
    mockFetchRepo.mockRejectedValueOnce(unknownErr);

    const res = await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "org/broken-repo", github_token: "ghp_avalidtoken123456" });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("SOME_UNKNOWN_CODE");
  });
});

// ─── GET /api/auth/me — extra edge cases ─────────────────────────────────────

describe("GET /api/auth/me — additional edge cases", () => {
  it("does not expose password_hash in the response", async () => {
    const { token } = await createAuthUser("safe@example.com");

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("password_hash");
    expect(res.body.data).toHaveProperty("email");
    expect(res.body.data).toHaveProperty("created_at");
  });
});
