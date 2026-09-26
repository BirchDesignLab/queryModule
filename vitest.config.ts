import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.ts",
      "apps/*/vitest.config.ts",
      "scripts/vitest.config.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "scripts/ci/**"],
      // index.ts files are excluded only as pure re-export barrels; scripts/ci/barrels.test.ts enforces it.
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts"],
      thresholds: {
        "packages/core/src/**": { lines: 95, branches: 95 },
        "packages/client/src/**": { lines: 85, branches: 85 },
        // Spec 10.5: 100% branches in the four sensitive API directories; 85% lines for the rest.
        // One key per directory; a glob that matches no file yet passes (W1 fix I4).
        "packages/api/src/audit/**": { branches: 100 },
        "packages/api/src/credentials/**": { branches: 100 },
        "packages/api/src/delegation/**": { branches: 100 },
        "packages/api/src/dispatch/**": { branches: 100 },
        "packages/api/src/**": { lines: 85 },
      },
    },
  },
});
