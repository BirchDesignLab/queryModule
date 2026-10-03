import { defineProject, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: "web",
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      // #499: jsdom admin tests (userEvent on large builder forms) run ~5-6 s under a full
      // parallel pnpm verify on Windows; 15 s keeps the default 5 s from failing the gate.
      testTimeout: 15_000,
    },
  }),
);
