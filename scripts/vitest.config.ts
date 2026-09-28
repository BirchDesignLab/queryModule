import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "scripts",
    environment: "node",
    include: ["ci/**/*.test.ts", "ops/**/*.test.ts", "dev/**/*.test.ts"],
  },
});
