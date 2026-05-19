import { vi, describe, it, expect } from "vitest";
import { validateEnv } from "./env";

describe("validateEnv", () => {
  it("throws listing all missing variables when none are set", () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    };
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(() => validateEnv()).toThrow("DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY");
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it("throws naming only the missing variable when one is absent", () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => validateEnv()).toThrow("DATABASE_URL");
    } finally {
      process.env.DATABASE_URL = saved;
    }
  });

  it("does not throw when all required variables are set", () => {
    expect(() => validateEnv()).not.toThrow();
  });
});
