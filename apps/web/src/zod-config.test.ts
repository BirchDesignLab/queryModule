import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// #132 step 12: zod 4 probes eval with new Function("") unless jitless is set, which the nonce
// CSP (spec 5.9) reports as a script-src eval violation even though zod catches it.
describe("zod runs jitless in the web bundle (spec 5.9 CSP, #132)", () => {
  it("importing the config module turns zod's jitless setting on", async () => {
    await import("./zod-config.js");
    expect(z.config().jitless).toBe(true);
  });
  it("main.tsx imports it first, before any module that builds a schema", () => {
    const src = readFileSync(join(import.meta.dirname, "main.tsx"), "utf8");
    const first = src.split("\n").find((l) => l.startsWith("import "));
    expect(first).toBe('import "./zod-config.js";');
  });
});
