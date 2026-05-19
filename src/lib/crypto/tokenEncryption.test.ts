import { vi, describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "./tokenEncryption";

describe("tokenEncryption — startup guard", () => {
  it("throws at module load when ENCRYPTION_KEY is not set", async () => {
    const original = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    vi.resetModules();
    try {
      await expect(import("./tokenEncryption")).rejects.toThrow(
        "ENCRYPTION_KEY environment variable is required"
      );
    } finally {
      process.env.ENCRYPTION_KEY = original;
      vi.resetModules();
    }
  });
});

describe("tokenEncryption — derivedKey validation", () => {
  it("throws when ENCRYPTION_KEY decodes to fewer than 32 bytes", () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    try {
      expect(() => encryptToken("my-github-token", 999)).toThrow(
        "at least 32 bytes"
      );
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });

  it("encrypts and decrypts a token correctly (round-trip)", () => {
    const plaintext = "ghp_testtoken12345678901234567890";
    const { enc, iv, tag } = encryptToken(plaintext, 42);
    expect(decryptToken(enc, iv, tag, 42)).toBe(plaintext);
  });
});
