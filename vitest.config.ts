import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.ts",
      "apps/*/vitest.config.ts",
      "scripts/vitest.config.{ts,mts}",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "scripts/ci/**"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts"],
      thresholds: {
        "packages/core/src/**": { lines: 95, branches: 95 },
        "packages/client/src/**": { lines: 85, branches: 85 },
      },
    },
  },
});
