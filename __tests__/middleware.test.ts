import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown } from "./helpers";
import { signToken, hashToken } from "../src/lib/auth/jwt";
import { hashPassword } from "../src/lib/auth/password";

beforeEach(resetDb);
afterAll(teardown);

// ─── authenticate middleware ──────────────────────────────────────────────────

describe("authenticate middleware", () => {
  async function createUserWithSession(expiresAt: Date) {
    const user = await prisma.user.create({
      data: { email: "mw@example.com", name: "MW", password_hash: await hashPassword("Password123!") },
    });
    const sessionId = `sess-mw-${Date.now()}`;
    const token = signToken(user.id, sessionId);
    const tokenHash = hashToken(token);
    await prisma.session.create({
      data: { id: sessionId, user_id: user.id, token_hash: tokenHash, expires_at: expiresAt },
    });
    return { user, token, sessionId };
  }

  it("returns 401 when the session token has expired", async () => {
    const pastDate = new Date(Date.now() - 1000);
    const { token } = await createUserWithSession(pastDate);

    const res = await request(app)
      .get("/api/repos")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("deletes the expired session row from the database", async () => {
    const pastDate = new Date(Date.now() - 1000);
    const { token, sessionId } = await createUserWithSession(pastDate);

    await request(app)
      .get("/api/repos")
      .set("Authorization", `Bearer ${token}`);

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(session).toBeNull();
  });

  it("issues a renewed session cookie when TTL < 24 h", async () => {
    // Session expires in 23 hours — below the 24 h renewal threshold
    const soonExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);
    const { token } = await createUserWithSession(soonExpiry);

    const res = await request(app)
      .get("/api/repos")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Renewal sets a new httpOnly devpulse_session cookie
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieArr = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    expect(cookieArr.some((c) => c.startsWith("devpulse_session="))).toBe(true);
  });

  it("extends the session expires_at in the DB after renewal", async () => {
    const soonExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);
    const { token, sessionId } = await createUserWithSession(soonExpiry);

    await request(app)
      .get("/api/repos")
      .set("Authorization", `Bearer ${token}`);

    // Renewal sets a new 7-day expiry, which must be later than the original 23 h expiry
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(session?.expires_at.getTime()).toBeGreaterThan(soonExpiry.getTime());
  });

  it("does NOT set a renewal cookie when TTL is well above 24 h", async () => {
    const farExpiry = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const { token } = await createUserWithSession(farExpiry);

    const res = await request(app)
      .get("/api/repos")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieArr = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    expect(cookieArr.some((c) => c.startsWith("devpulse_session="))).toBe(false);
  });

  it("returns 401 when Authorization header is missing Bearer prefix", async () => {
    const validExpiry = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const { token } = await createUserWithSession(validExpiry);

    const res = await request(app)
      .get("/api/repos")
      .set("Authorization", token); // no "Bearer " prefix

    expect(res.status).toBe(401);
  });

  it("returns 401 for a completely invalid garbage token", async () => {
    const res = await request(app)
      .get("/api/repos")
      .set("Authorization", "Bearer not.a.real.token");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("accepts the devpulse_session cookie as authentication", async () => {
    const validExpiry = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const { token } = await createUserWithSession(validExpiry);

    const res = await request(app)
      .get("/api/repos")
      .set("Cookie", `devpulse_session=${token}`);

    expect(res.status).toBe(200);
  });
});
