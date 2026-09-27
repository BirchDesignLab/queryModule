import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "web-ui",
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
