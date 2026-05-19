import { vi, describe, it, expect } from "vitest";
import { signToken, verifyToken, hashToken } from "./jwt";

describe("jwt — startup guard", () => {
  it("throws at module load when JWT_SECRET is not set", async () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    vi.resetModules();
    try {
      await expect(import("./jwt")).rejects.toThrow(
        "JWT_SECRET environment variable is required"
      );
    } finally {
      process.env.JWT_SECRET = original;
      vi.resetModules();
    }
  });
});

describe("jwt — token operations", () => {
  it("signs and verifies a token round-trip", () => {
    const token = signToken("user-id-123", "session-id-456");
    const payload = verifyToken(token);
    expect(payload.sub).toBe("user-id-123");
    expect(payload.sid).toBe("session-id-456");
  });

  it("hashToken returns a deterministic hex string", () => {
    const hash1 = hashToken("some-token");
    const hash2 = hashToken("some-token");
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});
