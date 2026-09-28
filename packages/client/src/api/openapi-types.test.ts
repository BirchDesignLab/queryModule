import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderApiTypes } from "./render-api-types.js";

describe("generated OpenAPI types", () => {
  it("match packages/api/openapi.json (run pnpm --filter @querymodule/client gen:api)", async () => {
    const committed = readFileSync(
      new URL("./generated/openapi-types.ts", import.meta.url),
      "utf8",
    );
    // biome.json excludes src/api/generated (#190), so the committed file is the raw
    // openapi-typescript output and this compares it byte for byte.
    expect(committed).toBe(await renderApiTypes());
  });
});
