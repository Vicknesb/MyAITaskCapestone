import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown, createAuthUser } from "./helpers";
import { hashPassword } from "../src/lib/auth/password";

beforeEach(resetDb);
afterAll(teardown);

// ─── POST /api/auth/register ─────────────────────────────────────────────────

describe("POST /api/auth/register", () => {
  it("creates a user and returns 201 with id + email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@example.com", password: "Password123!", name: "Alice" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toHaveProperty("token");
    expect(res.body.data.user).toMatchObject({ email: "alice@example.com", name: "Alice" });
    expect(res.body.data.user).not.toHaveProperty("password_hash");
  });

  it("returns 409 EMAIL_TAKEN for duplicate email", async () => {
    await request(app).post("/api/auth/register").send({ email: "dup@example.com", password: "Password123!" });
    const res = await request(app).post("/api/auth/register").send({ email: "dup@example.com", password: "Password123!" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("returns 400 VALIDATION_ERROR for invalid email", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "notanemail", password: "Password123!" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for password shorter than 8 chars", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "short@example.com", password: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    // Use DB helper directly to avoid the register rate limiter (5/hr)
    await prisma.user.create({
      data: { email: "login@example.com", password_hash: await hashPassword("Password123!") },
    });
  });

  it("returns 200 with session cookie and no token in body", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "login@example.com", password: "Password123!" });

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("token");
    expect(res.body.data.expires_at).toBeDefined();
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("returns RateLimit headers on login responses", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "login@example.com", password: "Password123!" });

    expect(res.status).toBe(200);
    // express-rate-limit draft-7 sends RateLimit header on every response
    const hasRateLimitHeader =
      res.headers["ratelimit"] !== undefined ||
      res.headers["ratelimit-limit"] !== undefined ||
      res.headers["x-ratelimit-limit"] !== undefined;
    expect(hasRateLimitHeader).toBe(true);
  });

  it("creates a session row in the database on login", async () => {
    await request(app).post("/api/auth/login").send({ email: "login@example.com", password: "Password123!" });
    const count = await prisma.session.count();
    expect(count).toBeGreaterThan(0);
  });

  it("returns 401 INVALID_CREDENTIALS for wrong password", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "login@example.com", password: "WrongPass!" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 401 INVALID_CREDENTIALS for unknown email", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "ghost@example.com", password: "Password123!" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

describe("GET /api/auth/me", () => {
  it("returns user data for a valid session token", async () => {
    const { token } = await createAuthUser("me@example.com");
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("me@example.com");
    expect(res.body.data).not.toHaveProperty("password_hash");
  });

  it("returns 401 with no token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with a garbage token", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/auth/logout ─────────────────────────────────────────────────

describe("DELETE /api/auth/logout", () => {
  it("returns 200 and deletes the session row", async () => {
    const { token } = await createAuthUser("logout@example.com");

    const res = await request(app).delete("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const count = await prisma.session.count();
    expect(count).toBe(0);
  });

  it("token is rejected after logout", async () => {
    const { token } = await createAuthUser("after-logout@example.com");
    await request(app).delete("/api/auth/logout").set("Authorization", `Bearer ${token}`);

    const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meRes.status).toBe(401);
  });
});
