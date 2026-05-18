import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown, createAuthUser } from "./helpers";
import { encryptToken } from "../src/lib/crypto/tokenEncryption";

// Mock the GitHub client so tests never hit the real API
vi.mock("../src/lib/github/client", () => ({
  fetchRepoMeta: vi.fn().mockResolvedValue({
    id:             555000999,
    full_name:      "test-org/test-repo",
    name:           "test-repo",
    owner:          { login: "test-org" },
    description:    "A test repo",
    private:        false,
    default_branch: "main",
  }),
}));

import { fetchRepoMeta } from "../src/lib/github/client";
const mockFetchRepo = vi.mocked(fetchRepoMeta);

beforeEach(async () => {
  await resetDb();
  mockFetchRepo.mockResolvedValue({
    id: 555000999, full_name: "test-org/test-repo", name: "test-repo",
    owner: { login: "test-org" }, description: "A test repo",
    private: false, default_branch: "main",
  });
});
afterAll(teardown);

// ─── GET /api/repos ──────────────────────────────────────────────────────────

describe("GET /api/repos", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/repos");
    expect(res.status).toBe(401);
  });

  it("returns empty list when no repos connected", async () => {
    const { token } = await createAuthUser();
    const res = await request(app).get("/api/repos").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.repositories).toHaveLength(0);
  });

  it("returns only the authenticated user's repos", async () => {
    const { user: alice, token: aliceToken } = await createAuthUser("alice@example.com");
    const { token: bobToken }                = await createAuthUser("bob@example.com");

    // Give Alice a repo via DB directly
    const { enc, iv, tag } = encryptToken("ghp_faketoken", 111);
    const repo = await prisma.repository.create({
      data: { github_repo_id: 111, full_name: "alice/repo", owner: "alice", name: "repo",
              is_private: false, github_token_enc: enc, token_iv: iv, token_tag: tag },
    });
    await prisma.userRepository.create({ data: { user_id: alice.id, repository_id: repo.id } });

    const aliceRes = await request(app).get("/api/repos").set("Authorization", `Bearer ${aliceToken}`);
    const bobRes   = await request(app).get("/api/repos").set("Authorization", `Bearer ${bobToken}`);

    expect(aliceRes.body.data.repositories).toHaveLength(1);
    expect(bobRes.body.data.repositories).toHaveLength(0);
  });
});

// ─── POST /api/repos/connect ─────────────────────────────────────────────────

describe("POST /api/repos/connect", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).post("/api/repos/connect").send({ full_name: "a/b", github_token: "ghp_abc123456789012345" });
    expect(res.status).toBe(401);
  });

  it("connects a repo and returns 201", async () => {
    const { token } = await createAuthUser();
    const res = await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "test-org/test-repo", github_token: "ghp_abc123456789012345" });

    expect(res.status).toBe(201);
    expect(res.body.data.full_name).toBe("test-org/test-repo");
  });

  it("stores token encrypted — not plaintext — in DB", async () => {
    const { token } = await createAuthUser();
    await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "test-org/test-repo", github_token: "ghp_supersecrettoken12345" });

    const repo = await prisma.repository.findFirst();
    expect(repo?.github_token_enc).not.toBe("ghp_supersecrettoken12345");
    expect(repo?.token_iv).toBeDefined();
    expect(repo?.token_tag).toBeDefined();
  });

  it("returns 409 REPO_ALREADY_CONNECTED on duplicate", async () => {
    const { token } = await createAuthUser();
    await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "test-org/test-repo", github_token: "ghp_abc123456789012345" });

    const res = await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "test-org/test-repo", github_token: "ghp_abc123456789012345" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPO_ALREADY_CONNECTED");
  });

  it("returns 400 VALIDATION_ERROR for bad full_name format", async () => {
    const { token } = await createAuthUser();
    const res = await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "no-slash-here", github_token: "ghp_abc123456789012345" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 GITHUB_TOKEN_INVALID when GitHub rejects the token", async () => {
    mockFetchRepo.mockRejectedValueOnce(
      Object.assign(new Error("Invalid token"), { code: "GITHUB_TOKEN_INVALID" })
    );
    const { token } = await createAuthUser();
    const res = await request(app)
      .post("/api/repos/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "test-org/test-repo", github_token: "ghp_badtoken1234567890" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("GITHUB_TOKEN_INVALID");
  });
});

// ─── DELETE /api/repos/:id ───────────────────────────────────────────────────

describe("DELETE /api/repos/:id", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).delete("/api/repos/nonexistent-id");
    expect(res.status).toBe(401);
  });

  it("disconnects a repo and returns 200", async () => {
    const { user, token } = await createAuthUser();
    const { enc, iv, tag } = encryptToken("ghp_faketoken", 222);
    const repo = await prisma.repository.create({
      data: { github_repo_id: 222, full_name: "u/repo2", owner: "u", name: "repo2",
              is_private: false, github_token_enc: enc, token_iv: iv, token_tag: tag },
    });
    const link = await prisma.userRepository.create({ data: { user_id: user.id, repository_id: repo.id } });

    const res = await request(app).delete(`/api/repos/${link.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const remaining = await prisma.userRepository.count();
    expect(remaining).toBe(0);
  });

  it("returns 403 when user tries to delete another user's link", async () => {
    const { user: alice } = await createAuthUser("alice2@example.com");
    const { token: bobToken } = await createAuthUser("bob2@example.com");

    const { enc, iv, tag } = encryptToken("ghp_faketoken", 333);
    const repo = await prisma.repository.create({
      data: { github_repo_id: 333, full_name: "a/r3", owner: "a", name: "r3",
              is_private: false, github_token_enc: enc, token_iv: iv, token_tag: tag },
    });
    const aliceLink = await prisma.userRepository.create({ data: { user_id: alice.id, repository_id: repo.id } });

    const res = await request(app).delete(`/api/repos/${aliceLink.id}`).set("Authorization", `Bearer ${bobToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a non-existent link id", async () => {
    const { token } = await createAuthUser();
    const res = await request(app).delete("/api/repos/does-not-exist").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
