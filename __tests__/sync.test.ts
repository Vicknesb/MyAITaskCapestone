import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown, createAuthUser } from "./helpers";
import { encryptToken } from "../src/lib/crypto/tokenEncryption";
import { SyncStatus } from "@prisma/client";

async function seedRepo(userId: string) {
  const { enc, iv, tag } = encryptToken("ghp_faketoken", 888);
  const repo = await prisma.repository.create({
    data: {
      github_repo_id: 888, full_name: "org/sync-repo",
      owner: "org", name: "sync-repo", is_private: false,
      github_token_enc: enc, token_iv: iv, token_tag: tag,
    },
  });
  await prisma.userRepository.create({ data: { user_id: userId, repository_id: repo.id } });
  return repo;
}

beforeEach(resetDb);
afterAll(teardown);

// ─── POST /api/sync/:repoId ───────────────────────────────────────────────────

describe("POST /api/sync/:repoId", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).post("/api/sync/some-id");
    expect(res.status).toBe(401);
  });

  it("creates a SyncLog with PENDING status and returns 202", async () => {
    const { user, token } = await createAuthUser();
    const repo = await seedRepo(user.id);

    const res = await request(app)
      .post(`/api/sync/${repo.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.sync_log_id).toBeDefined();

    const log = await prisma.syncLog.findFirst({ where: { repository_id: repo.id } });
    // Status transitions immediately (PENDING → RUNNING); check the log exists with correct trigger.
    expect(log).not.toBeNull();
    expect(log?.triggered_by).toBe("manual");
  });

  it("returns 409 SYNC_IN_PROGRESS when a RUNNING sync exists", async () => {
    const { user, token } = await createAuthUser();
    const repo = await seedRepo(user.id);

    await prisma.syncLog.create({
      data: { repository_id: repo.id, status: SyncStatus.RUNNING, triggered_by: "manual" },
    });

    const res = await request(app)
      .post(`/api/sync/${repo.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SYNC_IN_PROGRESS");
  });

  it("returns 403 FORBIDDEN when user does not own the repo", async () => {
    const { user: alice } = await createAuthUser("alice@s.com");
    const { token: bobToken } = await createAuthUser("bob@s.com");
    const repo = await seedRepo(alice.id);

    const res = await request(app)
      .post(`/api/sync/${repo.id}`)
      .set("Authorization", `Bearer ${bobToken}`);

    expect(res.status).toBe(403);
  });

  it("returns 404 for a non-existent repoId", async () => {
    const { token } = await createAuthUser();
    const res = await request(app)
      .post("/api/sync/does-not-exist")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
