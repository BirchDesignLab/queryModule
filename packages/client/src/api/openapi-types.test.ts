import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatApiTypes } from "../../scripts/format-api-types.js";
import { renderApiTypes } from "./render-api-types.js";

describe("generated OpenAPI types", () => {
  it("match packages/api/openapi.json (run pnpm --filter @querymodule/client gen:api)", async () => {
    const committed = readFileSync(
      new URL("./generated/openapi-types.ts", import.meta.url),
      "utf8",
    );
    // gen-api-types.ts formats its output with biome (see that script); reproduce the same
    // step here via the scripts/ helper (S1) so this stays a drift check on content, not on
    // openapi-typescript's raw style, without importing node:child_process from src/.
    const formatted = formatApiTypes(await renderApiTypes());
    expect(committed).toBe(formatted);
  });
});
