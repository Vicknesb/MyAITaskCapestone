import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["__tests__/setup.ts"],
    testTimeout: 15000,
    poolOptions: { forks: { singleFork: true } }, // serial — shared DB
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/server.ts",  // just app.listen(), not unit-testable
        "src/types/**",   // type-only definitions, no executable code
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
