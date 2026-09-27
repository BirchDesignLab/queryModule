import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderApiTypes } from "./render-api-types.js";

describe("generated OpenAPI types", () => {
  it("match packages/api/openapi.json (run pnpm --filter @querymodule/client gen:api)", async () => {
    const committed = readFileSync(
      new URL("./generated/openapi-types.ts", import.meta.url),
      "utf8",
    );
    // gen-api-types.ts formats its output with biome (see that script); reproduce the same
    // step here so this stays a drift check on content, not on openapi-typescript's raw style.
    const formatted = execSync("pnpm exec biome format --stdin-file-path=openapi-types.ts -", {
      input: await renderApiTypes(),
      encoding: "utf8",
    });
    expect(committed).toBe(formatted);
  });
});
